import json
import os
import base64
import io
import re
import ssl
import math
from datetime import datetime
from dateutil.relativedelta import relativedelta
from typing import Dict, Any

import pg8000
import pandas as pd
import numpy as np

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
    """Extract a clean round label like 'Series A‑3' from a noisy cell."""
    if not isinstance(raw, str):
        return "Current"
    m = re.search(r"Series\s+[A-Z]+(?:-?\d+)?", raw, re.IGNORECASE)
    return m.group(0).title() if m else raw.strip()


# ──────────────────────────────────────────────────────────────────────────
# Defensive data cleaning utilities
# ──────────────────────────────────────────────────────────────────────────

def _is_missing(x):
    """True for None, NaN, NaT, blank strings, or placeholder text."""
    if x is None:
        return True
    if isinstance(x, float) and (math.isnan(x) or pd.isna(x)):
        return True
    if x is pd.NaT:
        return True
    if isinstance(x, str) and not x.strip():
        return True
    if isinstance(x, str) and x.strip().lower() in {"tbd", "tbc", "na", "n/a", "nat", "--"}:
        return True
    return False

def _clean_string(x, default="", fixes_log=None):
    """Return a trimmed string or the default."""
    if _is_missing(x):
        if fixes_log is not None:
            fixes_log.append(f"Cleaned missing/invalid string value '{x}' → '{default}'")
        return default
    return str(x).strip()

def _clean_date(raw, fallback_months=1, fixes_log=None):
    """
    Return a real `datetime.date`.
    - If the cell parses, use it.
    - Else return today() - fallback_months.
    """
    ts = pd.to_datetime(raw, errors="coerce")
    if pd.isna(ts):
        fallback_date = datetime.utcnow().date() - relativedelta(months=fallback_months)
        if fixes_log is not None:
            fixes_log.append(f"Fixed invalid date '{raw}' → {fallback_date} (today - {fallback_months} months)")
        return fallback_date
    return ts.date()     # already naive date object

def _clean_float(raw, fixes_log=None):
    """Coerce to float or None."""
    try:
        f = float(raw)
        if math.isnan(f):
            if fixes_log is not None:
                fixes_log.append(f"Cleaned NaN float value → None")
            return None
        return f
    except Exception:
        if fixes_log is not None:
            fixes_log.append(f"Fixed invalid numeric value '{raw}' → None")
        return None

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
    company_name_override = body.get("company_name_override")
    user_provided_name = body.get("user_provided_name", False)
    
    if not xlsx_b64:
        return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "Missing xlsx_data"})}

    result = process_cap_table_xlsx_with_override(xlsx_b64, filename, company_name_override, user_provided_name)
    status = 200 if result["success"] else 500
    return {"statusCode": status, "headers": headers, "body": json.dumps(result)}

# ──────────────────────────────────────────────────────────────────────────
# Core XLSX processing logic (metadata + investor table)
# ──────────────────────────────────────────────────────────────────────────

def process_cap_table_xlsx(xlsx_b64: str, filename: str) -> Dict[str, Any]:
    return process_cap_table_xlsx_with_override(xlsx_b64, filename, None)

def process_cap_table_xlsx_with_override(xlsx_b64: str, filename: str, company_name_override: str = None, user_provided_name: bool = False) -> Dict[str, Any]:
    defensive_fixes = []  # Track what defensive fixes were applied
    try:
        xlsx_io = io.BytesIO(base64.b64decode(xlsx_b64))

        # ——— 1 Metadata (first 6 rows) ———
        try:
            df_meta = pd.read_excel(xlsx_io, nrows=6, header=None)
            row0 = df_meta.iloc[0]
            extracted_company_name = next(
                (_clean_string(c, fixes_log=defensive_fixes) for c in row0 if not _is_missing(c)), 
                "Unknown Company"
            )
            
            # Use override if provided, otherwise use extracted name
            company_name = company_name_override if company_name_override else extracted_company_name

            # Drop first row/col then tidy up
            df_meta = df_meta.iloc[1:, 1:].dropna(how="all", axis=0).dropna(how="all", axis=1)
            if not df_meta.empty:
                df_meta.iloc[0, 0] = "Round"
                df_meta = df_meta.T
                df_meta.columns = df_meta.iloc[0]
                df_meta = df_meta.iloc[1:].reset_index(drop=True)

            # Helper function to safely convert to float, removing currency symbols
            def safe_float(x):
                try:
                    # remove commas, €, $ etc. before casting
                    return float(re.sub(r"[^\d.\-]", "", str(x))) if pd.notna(x) else None
                except ValueError:
                    return None

            # Find the latest round row containing the word "Series"
            effective_cols = [c for c in df_meta.columns if "Effective Post-Money" in str(c)]
            raised_cols = [c for c in df_meta.columns if "Total Amt Raised" in str(c)]
            date_cols = [c for c in df_meta.columns if "date" in str(c).lower()]
            
            if not df_meta.empty and "Round" in df_meta.columns:
                series_mask = df_meta["Round"].astype(str).str.contains(
                    r"Series",  # Could extend with r"(Series|Seed|SAFE)" if needed
                    case=False,
                    na=False,
                )
                if series_mask.any():
                    # Use the same row for round name, valuation, amount raised, and date
                    idx = series_mask[series_mask].index[-1]
                    round_raw = df_meta.at[idx, "Round"]
                    round_name = sanitize_round_name(round_raw)
                    
                    # Extract valuation and amount raised from the same Series row
                    valuation = _clean_float(df_meta.at[idx, effective_cols[0]], fixes_log=defensive_fixes) if effective_cols else None
                    amount_raised = _clean_float(df_meta.at[idx, raised_cols[0]], fixes_log=defensive_fixes) if raised_cols else None
                    
                    # Extract round date from the same row
                    round_date = _clean_date(df_meta.at[idx, date_cols[0]], fixes_log=defensive_fixes) if date_cols else _clean_date(None, fixes_log=defensive_fixes)
                else:
                    # No Series rows found, fall back to graceful defaults
                    round_raw = "Current"
                    round_name = sanitize_round_name(round_raw)
                    valuation = _clean_float(df_meta[effective_cols[0]].dropna().iloc[-1], fixes_log=defensive_fixes) if effective_cols else None
                    amount_raised = _clean_float(df_meta[raised_cols[0]].dropna().iloc[-1], fixes_log=defensive_fixes) if raised_cols else None
                    round_date = None
            else:
                # No Round column found, fall back to old behavior
                round_raw = "Current"
                round_name = sanitize_round_name(round_raw)
                valuation = safe_float(df_meta[effective_cols[0]].dropna().iloc[-1]) if effective_cols else None
                amount_raised = safe_float(df_meta[raised_cols[0]].dropna().iloc[-1]) if raised_cols else None
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

        # ——— 3 Pool values ———
        def row_value(inv_name, column):
            row = df.loc[df["Investor"].astype(str).str.strip() == inv_name]
            return row[column].values[0] if not row.empty and column in row else 0

        # Raw values (still in whatever units the sheet stores – shares or % FDS)
        options_outstanding_raw = row_value("Options Outstanding", "Final % FDS")
        option_pool_available_raw = row_value("Option Pool Available", "Final % FDS")
        pool_increase_raw = row_value("Pool Increase", "Final % FDS")
        
        # Correct total calculation: Options Outstanding + Options Available + Pool Increase
        total_pool_size_raw = options_outstanding_raw + option_pool_available_raw + pool_increase_raw
        
        # Convert to decimal fractions so 6.2 % ➜ 0.062
        options_outstanding = convert_fds(options_outstanding_raw)
        options_available = convert_fds(option_pool_available_raw)
        total_pool_size = convert_fds(total_pool_size_raw)
        available_pool = options_available  # For backwards compatibility
        
        # Handy VC KPI: what % of the pool is used?
        # (aka "pool utilization", "pool burn", "option pool filled")
        pool_utilization = (
            options_outstanding / total_pool_size
            if total_pool_size else 0
        )

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
            "user_provided_name": user_provided_name,  # NEW: Flag for user-provided names
            "round_data": {
                "round_name": round_name,
                "valuation": valuation,
                "amount_raised": amount_raised,
                "round_date": round_date,
                "total_pool_size": total_pool_size,
                "pool_available": available_pool,  # For backwards compatibility
                "pool_utilization": pool_utilization,  # NEW
                "options_outstanding": options_outstanding,  # NEW
            },
            "investors": investors,
            "defensive_fixes": defensive_fixes,
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
                "option_pool_utilization": pool_utilization,   # NEW
                "option_pool_used_pct": round(pool_utilization * 100, 2),  # human-readable
                "options_outstanding": options_outstanding,    # NEW
                "options_available": options_available,        # NEW (renamed for clarity)
                "pool_increase": convert_fds(pool_increase_raw),  # NEW - for debugging
                # Raw values for debugging
                "debug_raw_values": {
                    "options_outstanding_raw": options_outstanding_raw,
                    "option_pool_available_raw": option_pool_available_raw,
                    "pool_increase_raw": pool_increase_raw,
                    "total_pool_size_raw": total_pool_size_raw
                },
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
    
    # Get defensive fixes list from input data
    defensive_fixes = data.get("defensive_fixes", [])

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

    # Last-chance defensive scrub before SQL
    round_data["round_date"] = _clean_date(round_data.get("round_date"), fixes_log=defensive_fixes)
    round_data["valuation"] = _clean_float(round_data.get("valuation"), fixes_log=defensive_fixes)
    round_data["amount_raised"] = _clean_float(round_data.get("amount_raised"), fixes_log=defensive_fixes)

    try:
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_cfg, ssl_context=ctx, timeout=30)
        cur = conn.cursor()

        # Handle user-provided vs auto-detected names differently
        user_provided = data.get("user_provided_name", False)
        if user_provided:
            # For user-provided names, use exact name matching - no normalization
            exact_name = data["company_name"].strip()
            manually_edited = True
            edited_by = "user_provided"
            
            # Try exact match first
            cur.execute("SELECT id FROM companies WHERE name = %s", [exact_name])
            existing = cur.fetchone()
            
            if not existing:
                # Create new company with exact name and itself as normalized name for uniqueness
                cur.execute("""INSERT INTO companies (name, normalized_name, manually_edited, edited_by, edited_at, created_at, updated_at)
                                VALUES (%s,%s,%s,%s,NOW(),NOW(),NOW())""", [exact_name, exact_name, manually_edited, edited_by])
                cur.execute("SELECT id FROM companies WHERE name = %s", [exact_name])
            
            company_id = cur.fetchone()[0] if not existing else existing[0]
        else:
            # For auto-detected names, use normalization for fuzzy matching
            norm_name = normalize_company_name(data["company_name"])
            manually_edited = False
            edited_by = "system_import"
            
            cur.execute("""INSERT INTO companies (name, normalized_name, manually_edited, edited_by, edited_at, created_at, updated_at)
                            VALUES (%s,%s,%s,%s,NOW(),NOW(),NOW()) ON CONFLICT (normalized_name) DO NOTHING""", [data["company_name"], norm_name, manually_edited, edited_by])
            cur.execute("SELECT id FROM companies WHERE normalized_name=%s", [norm_name])
            company_id = cur.fetchone()[0]

        cur.execute(
            """INSERT INTO cap_table_rounds (company_id, round_name, valuation, amount_raised, round_date,
               total_pool_size, pool_available, pool_utilization, options_outstanding, 
               manually_edited, edited_by, edited_at, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW(),NOW())
               ON CONFLICT (company_id, round_name) DO UPDATE SET
                    valuation=EXCLUDED.valuation,
                    amount_raised=EXCLUDED.amount_raised,
                    round_date=EXCLUDED.round_date,
                    total_pool_size=EXCLUDED.total_pool_size,
                    pool_available=EXCLUDED.pool_available,
                    pool_utilization=EXCLUDED.pool_utilization,
                    options_outstanding=EXCLUDED.options_outstanding,
                    manually_edited=EXCLUDED.manually_edited,
                    edited_by=EXCLUDED.edited_by,
                    edited_at=NOW(),
                    updated_at=NOW() RETURNING id""",
            [company_id, round_data["round_name"], round_data.get("valuation"), round_data.get("amount_raised"), round_data.get("round_date"), round_data.get("total_pool_size"), round_data.get("pool_available"), round_data.get("pool_utilization"), round_data.get("options_outstanding"), False, "system_import"],
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

        return {
            "success": True, 
            "data": {
                "company_name": data["company_name"], 
                "company_id": company_id, 
                "round_id": round_id, 
                "round_name": round_data["round_name"], 
                "investors_count": len(data.get("investors", [])),
                "defensive_fixes": defensive_fixes
            }
        }
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
