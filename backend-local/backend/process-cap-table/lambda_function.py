import json
import os
import base64
import io
import re
import ssl
from typing import Dict, Any

import pg8000
import pandas as pd

# ──────────────────────────────────────────────────────────────────────────
# Utility helpers
# ──────────────────────────────────────────────────────────────────────────

def make_unique_columns(columns):
    """Ensure column names are unique by appending a number to duplicates."""
    seen = {}
    unique_columns = []
    for col in columns:
        col_str = str(col)
        if col_str in seen:
            seen[col_str] += 1
            unique_columns.append(f"{col_str}_{seen[col_str]}")
        else:
            seen[col_str] = 1
            unique_columns.append(col_str)
    return unique_columns


def convert_fds(value: Any) -> float:
    """Return a decimal fraction for % FDS whether the sheet stores it as 0.076 or 7.6."""
    try:
        val = float(value)
    except (TypeError, ValueError):
        return 0.0
    # If it's already < 1 assume it's a fraction; otherwise percentage
    return val / 100.0 if val > 1 else val


def sanitize_round_name(raw: str) -> str:
    """Extract a clean round label like 'Series A‑3' from a noisy cell."""
    if not isinstance(raw, str):
        return "Current"
    m = re.search(r"Series\s+[A-Z]+(?:-?\d+)?", raw, re.IGNORECASE)
    return m.group(0).title() if m else raw.strip()

# ──────────────────────────────────────────────────────────────────────────
# Lambda entrypoint
# ──────────────────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    """AWS Lambda function to process cap‑table XLSX files."""

    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }

    if event.get("httpMethod") == "OPTIONS" or event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return {"statusCode": 200, "headers": headers, "body": json.dumps({"message": "CORS preflight handled"})}

    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "Invalid JSON in request body"})}

    if (op := (event.get("operation") or body.get("operation"))) != "process_cap_table_xlsx":
        return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "Invalid operation"})}

    xlsx_b64 = body.get("xlsx_data")
    filename = body.get("filename", "cap_table.xlsx")
    if not xlsx_b64:
        return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "Missing xlsx_data"})}

    result = process_cap_table_xlsx(xlsx_b64, filename)
    status = 200 if result["success"] else 500
    return {"statusCode": status, "headers": headers, "body": json.dumps(result)}

# ──────────────────────────────────────────────────────────────────────────
# Core XLSX processing logic (metadata + investor table)
# ──────────────────────────────────────────────────────────────────────────

def process_cap_table_xlsx(xlsx_b64: str, filename: str) -> Dict[str, Any]:
    return process_cap_table_xlsx_with_override(xlsx_b64, filename, None)

def process_cap_table_xlsx_with_override(xlsx_b64: str, filename: str, company_name_override: str = None) -> Dict[str, Any]:
    try:
        xlsx_io = io.BytesIO(base64.b64decode(xlsx_b64))

        # ——— 1 Metadata (first 6 rows) ———
        try:
            df_meta = pd.read_excel(xlsx_io, nrows=6, header=None)
            extracted_company_name = df_meta.iloc[0, 1] if df_meta.shape[1] > 1 else "Unknown Company"
            
            # Use override if provided, otherwise use extracted name
            company_name = company_name_override if company_name_override else extracted_company_name

            # Drop first row/col then tidy up
            df_meta = df_meta.iloc[1:, 1:].dropna(how="all", axis=0).dropna(how="all", axis=1)
            if not df_meta.empty:
                df_meta.iloc[0, 0] = "Round"
                df_meta = df_meta.T
                df_meta.columns = df_meta.iloc[0]
                df_meta = df_meta.iloc[1:].reset_index(drop=True)

            # Latest round row containing the word "Series"
            if not df_meta.empty and "Round" in df_meta.columns:
                series_rows = df_meta["Round"].dropna().astype(str)
                round_raw = series_rows[series_rows.str.contains("Series", case=False)].iloc[-1] if not series_rows.empty else "Current"
            else:
                round_raw = "Current"
            round_name = sanitize_round_name(round_raw)

            # Pull valuation, amount raised, and round date (take most recent / last row)
            effective_cols = [c for c in df_meta.columns if "Effective Post-Money" in str(c)]
            raised_cols = [c for c in df_meta.columns if "Total Amt Raised" in str(c)]
            date_cols = [c for c in df_meta.columns if "date" in str(c).lower()]

            valuation = float(df_meta[effective_cols[0]].dropna().iloc[-1]) if effective_cols else None
            amount_raised = float(df_meta[raised_cols[0]].dropna().iloc[-1]) if raised_cols else None

            # Match the same row we chose for round_name to fetch its date
            round_date = None
            if date_cols:
                date_col = date_cols[0]
                if "Round" in df_meta.columns:
                    series_rows = df_meta["Round"].dropna().astype(str)
                    mask = series_rows.str.contains("Series", case=False, na=False)
                    idx = mask[mask].index[-1] if mask.any() else df_meta.index[-1]
                    raw_date = df_meta.at[idx, date_col]
                    try:
                        round_date = pd.to_datetime(raw_date, errors="coerce").date().isoformat() if pd.notna(raw_date) else None
                    except Exception:
                        round_date = None
        except Exception as e:
            print(f"⚠️  Metadata parse error: {e}")
            company_name, round_name, valuation, amount_raised, round_date = "Unknown Company", "Current", None, None, None

        # Reset buffer for main table read
        xlsx_io.seek(0)

        # ——— 2 Main investor table ———
        df = pd.read_excel(xlsx_io, skiprows=5).iloc[:, 1:]
        if df.empty:
            return {"success": False, "error": "No data rows found in XLSX"}

        df.columns = make_unique_columns(df.iloc[0])
        df = df.iloc[1:].reset_index(drop=True)
        df.columns = ["Investor"] + df.columns.tolist()[1:]
        df.fillna(0, inplace=True)

        # Numeric conversions
        fds_cols = [c for c in df.columns if "% FDS" in str(c)]
        invested_cols = [c for c in df.columns if "Total $ Invested" in str(c)]
        df[fds_cols + invested_cols] = df[fds_cols + invested_cols].apply(pd.to_numeric, errors="coerce").fillna(0)

        last_fds_col = fds_cols[-1] if fds_cols else None
        if last_fds_col:
            df["Final % FDS"] = df[last_fds_col]
        last_invested_col = invested_cols[-1] if invested_cols else None
        df["Total Invested"] = df[invested_cols].sum(axis=1)
        df["Final Round Investment"] = df[last_invested_col] if last_invested_col else 0

        # ——— 3 Pool values ———
        def row_value(inv_name, column):
            row = df.loc[df["Investor"].astype(str).str.strip() == inv_name]
            return row[column].values[0] if not row.empty and column in row else 0

        total_pool_size_raw = row_value("Options Outstanding", "Final % FDS") + row_value("Pool Increase", "Final % FDS")
        available_pool_raw = row_value("Option Pool Available", "Final % FDS")
        total_pool_size = convert_fds(total_pool_size_raw)
        available_pool = convert_fds(available_pool_raw)

        # ——— 4 Investor list ———
        exclude = {"Warrants Preferred", "Warrants Common", "Options Outstanding", "Option Pool Available", "Pool Increase", "TOTAL", "0"}
        investors = []
        for _, r in df.iterrows():
            name = str(r["Investor"]).strip()
            if name in exclude or not name:
                continue
            investors.append({
                "investor_name": name,
                "total_invested": float(r["Total Invested"]),
                "final_fds": convert_fds(r["Final % FDS"]),
                "final_round_investment": float(r["Final Round Investment"]),
            })

        # Bundle for DB save
        cap_table = {
            "company_name": company_name,
            "round_data": {
                "round_name": round_name,
                "valuation": valuation,
                "amount_raised": amount_raised,
                "round_date": round_date,
                "total_pool_size": total_pool_size,
                "pool_available": available_pool,
            },
            "investors": investors,
        }
        save_result = save_cap_table_round_internal(cap_table)
        if not save_result["success"]:
            return {"success": False, "error": save_result["error"]}

        return {
            "success": True,
            "data": {
                **save_result["data"],
                "filename": filename,
                "valuation_extracted": valuation is not None,
                "amount_raised_extracted": amount_raised is not None,
                "round_extracted": round_name != "Current",
                "pool_data_found": bool(total_pool_size_raw > 0),
                "investors_with_investments": sum(1 for i in investors if i["final_round_investment"] > 0),
            },
        }
    except Exception as e:
        return {"success": False, "error": f"XLSX processing failed: {e}"}

# ──────────────────────────────────────────────────────────────────────────
# DB save (unchanged except for conversion removal) 
# ──────────────────────────────────────────────────────────────────────────

def save_cap_table_round_internal(data: Dict[str, Any]) -> Dict[str, Any]:
    """Persist round + investors; identical to your original flow."""

    db_cfg = {
        "host": os.environ.get("DB_HOST"),
        "port": int(os.environ.get("DB_PORT", "5432")),
        "database": os.environ.get("DB_NAME"),
        "user": os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD"),
    }

    required = ["company_name", "round_data"]
    if any(not data.get(f) for f in required):
        return {"success": False, "error": "Missing required fields"}

    round_data = data["round_data"]
    if not round_data.get("round_name"):
        return {"success": False, "error": "round_name is required"}

    try:
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_cfg, ssl_context=ctx, timeout=30)
        cur = conn.cursor()

        norm_name = normalize_company_name(data["company_name"])
        cur.execute("""INSERT INTO companies (name, normalized_name, manually_edited, edited_by, edited_at, created_at, updated_at)
                        VALUES (%s,%s,%s,%s,NOW(),NOW(),NOW()) ON CONFLICT (normalized_name) DO NOTHING""", [data["company_name"], norm_name, False, "system_import"])
        cur.execute("SELECT id FROM companies WHERE normalized_name=%s", [norm_name])
        company_id = cur.fetchone()[0]

        cur.execute(
            """INSERT INTO cap_table_rounds (company_id, round_name, valuation, amount_raised, round_date,
               total_pool_size, pool_available, manually_edited, edited_by, edited_at, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW(),NOW())
               ON CONFLICT (company_id, round_name) DO UPDATE SET
                    valuation=EXCLUDED.valuation,
                    amount_raised=EXCLUDED.amount_raised,
                    round_date=EXCLUDED.round_date,
                    total_pool_size=EXCLUDED.total_pool_size,
                    pool_available=EXCLUDED.pool_available,
                    manually_edited=EXCLUDED.manually_edited,
                    edited_by=EXCLUDED.edited_by,
                    edited_at=NOW(),
                    updated_at=NOW() RETURNING id""",
            [company_id, round_data["round_name"], round_data.get("valuation"), round_data.get("amount_raised"), round_data.get("round_date"), round_data.get("total_pool_size"), round_data.get("pool_available"), False, "system_import"],
        )
        round_id = cur.fetchone()[0]

        # refresh investors
        cur.execute("DELETE FROM cap_table_investors WHERE cap_table_round_id=%s", [round_id])
        inv_insert = """INSERT INTO cap_table_investors (cap_table_round_id, investor_name, total_invested, final_fds, final_round_investment, manually_edited, edited_by, edited_at, created_at)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())"""
        for inv in data.get("investors", []):
            cur.execute(inv_insert, [round_id, inv["investor_name"], inv["total_invested"], inv["final_fds"], inv["final_round_investment"], False, "system_import"])

        cur.execute("""INSERT INTO cap_table_current (company_id, cap_table_round_id, updated_at)
                        VALUES (%s,%s,NOW()) ON CONFLICT (company_id) DO UPDATE SET cap_table_round_id=EXCLUDED.cap_table_round_id, updated_at=NOW()""", [company_id, round_id])
        conn.commit()
        cur.close(); conn.close()

        return {"success": True, "data": {"company_name": data["company_name"], "company_id": company_id, "round_id": round_id, "round_name": round_data["round_name"], "investors_count": len(data.get("investors", []))}}
    except Exception as e:
        return {"success": False, "error": f"DB save failed: {e}"}


def normalize_company_name(name: str) -> str:
    if not name:
        return ""
    return (
        name.lower()
        .replace("corp", "").replace("corporation", "")
        .replace("inc", "").replace("incorporated", "")
        .replace("ltd", "").replace("limited", "")
        .replace("llc", "").replace("co.", "").replace("co", "")
        .strip()
    )
