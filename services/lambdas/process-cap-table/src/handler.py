import json
import os
import base64
import io
import re
import ssl
import math
from datetime import datetime, date
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


def normalize_header_text(value: Any) -> str:
    """Lowercase alphanumeric/% tokens to compare header labels."""
    if not isinstance(value, str):
        return ""
    cleaned = re.sub(r"[^A-Za-z0-9%]+", " ", value)
    return re.sub(r"\s+", " ", cleaned).strip().lower()


HEADER_ALIASES = {
    "percent_fds": [r"final\s*%?\s*fds", r"%\s*fds"],
    "total_fds": [r"final\s*fds", r"total\s*fds"],
    "total_invested": [r"total\s*\$\s*invested\s*/\s*lp", r"total\s*\$\s*invested"],
}


def find_columns_by_alias(columns, alias_patterns):
    """Return [(idx, column_name)] for headers that match any alias pattern."""
    matches = []
    for idx, col in enumerate(columns):
        col_str = str(col)
        norm = normalize_header_text(col_str)
        for alias in alias_patterns:
            alias_norm = normalize_header_text(alias)
            if alias_norm and norm == alias_norm:
                matches.append((idx, col_str))
                break
            if re.search(alias, col_str, re.IGNORECASE):
                matches.append((idx, col_str))
                break
    return matches


def _json_safe(value):
    """Convert numpy/pandas types to JSON-serializable Python primitives."""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, set):
        return [_json_safe(v) for v in value]
    if isinstance(value, (np.integer, np.int_)):
        return int(value)
    if isinstance(value, (np.floating, np.float_)):
        return float(value)
    if isinstance(value, np.ndarray):
        return [_json_safe(v) for v in value.tolist()]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


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
    company_id = body.get("company_id")  # NEW: Explicit company to attach cap table to
    
    if not xlsx_b64:
        return {"statusCode": 400, "headers": headers, "body": json.dumps({"error": "Missing xlsx_data"})}

    result = process_cap_table_xlsx_with_override(
        xlsx_b64, filename, company_name_override, user_provided_name, company_id
    )
    status = 200 if result["success"] else 500
    safe_body = _json_safe(result)
    return {"statusCode": status, "headers": headers, "body": json.dumps(safe_body)}

# ──────────────────────────────────────────────────────────────────────────
# Core XLSX processing logic (metadata + investor table)
# ──────────────────────────────────────────────────────────────────────────

def process_cap_table_xlsx(xlsx_b64: str, filename: str) -> Dict[str, Any]:
    return process_cap_table_xlsx_with_override(xlsx_b64, filename, None)

def process_cap_table_xlsx_with_override(xlsx_b64: str, filename: str, company_name_override: str = None, user_provided_name: bool = False, company_id: int | None = None) -> Dict[str, Any]:
    defensive_fixes = []  # Track what defensive fixes were applied
    try:
        xlsx_io = io.BytesIO(base64.b64decode(xlsx_b64))

        # ——— 1 Metadata Parsing (Robust) ———
        try:
            # Read enough rows to be safe
            df_meta_raw = pd.read_excel(xlsx_io, nrows=20, header=None)
            
            # 1. Extract Company Name (usually Row 0 or 1)
            row0 = df_meta_raw.iloc[0]
            extracted_company_name = next(
                (_clean_string(c, fixes_log=defensive_fixes) for c in row0 if not _is_missing(c)), 
                "Unknown Company"
            )
            company_name = company_name_override if company_name_override else extracted_company_name

            # 2. Identify the "Label Column" (row headers like "Round", "Price", "Valuation")
            label_col_idx = 0 # Default to first column
            for col_idx in range(min(5, len(df_meta_raw.columns))):
                col_vals = df_meta_raw.iloc[:, col_idx].astype(str).str.lower()
                if col_vals.str.contains(r"post[\s\-]?money|valuation|price|raised").any():
                    label_col_idx = col_idx
                    break
            
            # Slice metadata from the label column
            df_meta = df_meta_raw.iloc[:, label_col_idx:]
            
            # Drop fully empty rows/cols
            df_meta = df_meta.dropna(how="all", axis=0).dropna(how="all", axis=1)

            # 3. Identify the "Round Row"
            # The row that actually contains "Series A", "Seed", etc. might not be the first row.
            round_row_idx = 0
            if not df_meta.empty:
                # Scan first 10 rows for round keywords
                for r_idx in range(min(10, len(df_meta))):
                    # exclude the label column itself (index 0 of sliced df) from check
                    row_vals = df_meta.iloc[r_idx, 1:].astype(str)
                    if row_vals.str.contains(r"Series|Seed|Preferred|Common|Class", case=False, regex=True).any():
                        round_row_idx = r_idx
                        break
                
                # Force the label for this row to be "Round" so it becomes the index name upon transpose
                df_meta.iat[round_row_idx, 0] = "Round"

                # 4. Transpose: Rows become Columns
                df_meta = df_meta.T
                
                # Set headers from the first row (which corresponds to the Original Label Column)
                # This aligns "Price", "Valuation" labels with their data columns
                df_meta.columns = make_unique_columns(df_meta.iloc[0])
                
                # Drop the header row from the data
                df_meta = df_meta.iloc[1:].reset_index(drop=True)

            # 5. Forward Fill "Round" names to handle Merged Cells
            if "Round" in df_meta.columns:
                df_meta["Round"] = df_meta["Round"].ffill()

            # Helper function to safely convert to float
            def safe_float(x):
                try:
                    return float(re.sub(r"[^\d.\-]", "", str(x))) if pd.notna(x) else None
                except ValueError:
                    return None

            # Identify candidate columns
            date_cols = [c for c in df_meta.columns if "date" in str(c).lower()]
            post_money_cols = [c for c in df_meta.columns if re.search(r"post[\s\-–]?money", str(c).lower())]
            amt_raised_cols = [c for c in df_meta.columns if (("amt" in str(c).lower() and "raised" in str(c).lower()) or "amount raised" in str(c).lower())]

            # 6. Selection Logic: Find the Rightmost Round
            chosen_round_name = None
            chosen_date = None
            
            # Try to find latest date first
            latest_date = None
            latest_date_round = None
            
            if not df_meta.empty and "Round" in df_meta.columns:
                for idx in df_meta.index:
                    # Date Check
                    r_date = None
                    for dc in date_cols:
                        try:
                            d = pd.to_datetime(df_meta.at[idx, dc], errors="coerce")
                            if pd.notna(d):
                                r_date = d.to_pydatetime().date()
                        except: pass
                    
                    r_name = str(df_meta.at[idx, "Round"]).strip()
                    if not r_name or r_name.lower() in ["nan", "none", ""]:
                        continue

                    if r_date:
                        if latest_date is None or r_date > latest_date:
                            latest_date = r_date
                            latest_date_round = r_name
            
            if latest_date:
                chosen_round_name = latest_date_round
                chosen_date = latest_date
            else:
                # Fallback: Pick the last Round Name in the dataframe (Rightmost)
                if "Round" in df_meta.columns:
                    # Get unique rounds preserving order
                    unique_rounds = df_meta["Round"].dropna().unique()
                    if len(unique_rounds) > 0:
                        chosen_round_name = unique_rounds[-1] # Last one is rightmost

            # 7. Extract Values for the Chosen Round
            valuation = None
            amount_raised = None
            
            if chosen_round_name:
                round_name = sanitize_round_name(chosen_round_name)
                # Filter meta rows for this round
                round_rows = df_meta[df_meta["Round"] == chosen_round_name]
                
                # Scan these rows for our values
                for idx, row in round_rows.iterrows():
                    for col in post_money_cols:
                        val = safe_float(row.get(col))
                        if val is not None:
                            valuation = val
                    
                    for col in amt_raised_cols:
                        val = safe_float(row.get(col))
                        if val is not None:
                            amount_raised = val
            else:
                round_name = "Current"

            round_date = chosen_date

        except Exception as e:
            print(f"⚠️  Metadata parse error: {e}")
            company_name, round_name, valuation, amount_raised, round_date = "Unknown Company", "Current", None, None, None

        # Reset buffer for main table read
        xlsx_io.seek(0)

        # ——— 2 Main investor table (Dynamic Header Search) ———
        df_raw = pd.read_excel(xlsx_io, header=None)
        
        header_row_idx = None
        # Scan first 20 rows for the header
        for idx, row in df_raw.head(20).iterrows():
            row_str = row.astype(str).str.cat(sep=" ")
            # Look for a row containing both "Total" and either "FDS" or "Common"
            if "Total" in row_str and ("FDS" in row_str or "%" in row_str) and ("Invested" in row_str or "Common" in row_str):
                header_row_idx = idx
                break
        
        if header_row_idx is None:
            header_row_idx = 6 # Fallback

        # Slice from the found header row
        df = df_raw.iloc[header_row_idx:]
        df = df.iloc[:, 1:] # Drop Column A (often empty margin)
        df.columns = make_unique_columns(df.iloc[0])
        df = df.iloc[1:].reset_index(drop=True)

        if df.empty:
            return {"success": False, "error": "No data rows found in XLSX"}

        # Ensure we have a clean "Investor" column name
        cols = df.columns.tolist()
        cols[0] = "Investor"
        df.columns = cols
        df.fillna(0, inplace=True)

        # Numeric conversions with header aliases
        fds_matches = find_columns_by_alias(df.columns, HEADER_ALIASES["percent_fds"])
        fds_cols = [col for _, col in fds_matches] or [c for c in df.columns if "% FDS" in str(c)]

        invested_matches = find_columns_by_alias(df.columns, HEADER_ALIASES["total_invested"])
        invested_cols = [col for _, col in invested_matches] or [c for c in df.columns if "Total $ Invested" in str(c)]

        numeric_cols = list(dict.fromkeys(fds_cols + invested_cols))
        if numeric_cols:
            df[numeric_cols] = df[numeric_cols].apply(pd.to_numeric, errors="coerce").fillna(0)

        final_fds_col_name = fds_cols[-1] if fds_cols else None
        if final_fds_col_name is None:
             final_fds_col_name = "Final % FDS"
             df[final_fds_col_name] = 0
             defensive_fixes.append("Missing % FDS columns; defaulted Final % FDS to 0")

        last_invested_col = invested_cols[-1] if invested_cols else None
        if invested_cols:
            df["Total Invested"] = df[invested_cols].sum(axis=1)
        else:
            df["Total Invested"] = 0
            defensive_fixes.append("Missing Total $ Invested columns; defaulted totals to 0")

        df["Final Round Investment"] = df[last_invested_col] if last_invested_col else 0

        # ——— 3 Pool values ———
        def row_value(inv_name, column):
            if column not in df.columns: return 0
            row = df.loc[df["Investor"].astype(str).str.strip() == inv_name]
            return row[column].values[0] if not row.empty else 0

        options_outstanding_raw = row_value("Options Outstanding", final_fds_col_name)
        option_pool_available_raw = row_value("Option Pool Available", final_fds_col_name)
        pool_increase_raw = row_value("Pool Increase", final_fds_col_name)
        
        total_pool_size_raw = options_outstanding_raw + option_pool_available_raw + pool_increase_raw
        
        options_outstanding = convert_fds(options_outstanding_raw)
        options_available = convert_fds(option_pool_available_raw)
        total_pool_size = convert_fds(total_pool_size_raw)
        available_pool = options_available
        
        pool_utilization = (
            options_outstanding / total_pool_size
            if total_pool_size else 0
        )

        # ——— 4 Investor list ———
        exclude = {"Warrants Preferred", "Warrants Common", "Options Outstanding", "Option Pool Available", "Pool Increase", "TOTAL", "0"}
        investors = []
        for _, r in df.iterrows():
            name = str(r["Investor"]).strip()
            if name in exclude or not name:
                continue
            investors.append({
                "investor_name": name,
                "total_invested": float(r["Total Invested"]),
                "final_fds": convert_fds(r.get(final_fds_col_name, 0)),
                "final_round_investment": float(r["Final Round Investment"]),
            })

        # Bundle for DB save
        cap_table = {
            "company_name": company_name,
            "user_provided_name": user_provided_name, 
            "company_id": company_id, 
            "round_data": {
                "round_name": round_name,
                "valuation": valuation,
                "amount_raised": amount_raised,
                "round_date": round_date,
                "total_pool_size": total_pool_size,
                "pool_available": available_pool, 
                "pool_utilization": pool_utilization,
                "options_outstanding": options_outstanding, 
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
                "option_pool_utilization": pool_utilization,
                "option_pool_used_pct": round(pool_utilization * 100, 2), 
                "options_outstanding": options_outstanding, 
                "options_available": options_available,
                "pool_increase": convert_fds(pool_increase_raw), 
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

        # If explicit company_id is provided, trust it and skip name resolution
        explicit_company_id = data.get("company_id")
        if explicit_company_id:
            cur.execute("SELECT id FROM companies WHERE id = %s", [explicit_company_id])
            row = cur.fetchone()
            if not row:
                return {"success": False, "error": f"Company with id {explicit_company_id} not found"}
            company_id = explicit_company_id
            manually_edited = True
            edited_by = "user_provided"
        else:
            # Handle user-provided vs auto-detected names differently
            user_provided = data.get("user_provided_name", False)
            if user_provided:
                # For user-provided names, use exact name matching - no normalization
                exact_name = data["company_name"].strip()
                normalized_exact = exact_name.lower().strip()
                manually_edited = True
                edited_by = "user_provided"
                
                # Prefer exact match by name
                cur.execute("SELECT id FROM companies WHERE name = %s", [exact_name])
                existing = cur.fetchone()
                
                if existing:
                    company_id = existing[0]
                else:
                    # Try match by normalized_name to avoid duplicate cards differing only by case/spacing
                    cur.execute("SELECT id FROM companies WHERE normalized_name = %s", [normalized_exact])
                    existing_norm = cur.fetchone()
                    if existing_norm:
                        company_id = existing_norm[0]
                    else:
                        # Create new company; guard against race or pre-existing record with same normalized_name
                        cur.execute(
                            """
                            INSERT INTO companies (name, normalized_name, manually_edited, edited_by, edited_at, created_at, updated_at)
                            VALUES (%s,%s,%s,%s,NOW(),NOW(),NOW())
                            ON CONFLICT (normalized_name) DO NOTHING
                            """,
                            [exact_name, normalized_exact, manually_edited, edited_by]
                        )
                        # Select by normalized_name to get id regardless of conflict/no-conflict
                        cur.execute("SELECT id FROM companies WHERE normalized_name = %s", [normalized_exact])
                        company_id = cur.fetchone()[0]
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
    return name.lower().strip()