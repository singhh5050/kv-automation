"""
Voice Query Lambda - direct GPT-5 text-to-SQL pipeline
"""

from __future__ import annotations

import json
import os
import re
import ssl
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

import httpx
import pg8000

CA_BUNDLE_PATH = os.path.join(os.path.dirname(__file__), "rds-combined-ca-bundle.pem")
SCHEMA_CACHE: Dict[str, Optional[str]] = {"text": None}
DEFAULT_OPENAI_BASE = "https://api.openai.com/v1"


def get_env_int(name: str, default: int) -> int:
    """Safely fetch an integer from the environment."""
    raw_value = os.environ.get(name)
    if raw_value is None:
        return default
    try:
        return int(raw_value)
    except ValueError:
        return default


def safe_json_dumps(payload):
    """JSON helper that handles datetime/date objects."""
    return json.dumps(payload, default=str)


def get_db_config() -> Dict[str, str]:
    """Load database credentials from environment variables."""
    return {
        "host": os.environ.get("DB_HOST"),
        "port": int(os.environ.get("DB_PORT", 5432)),
        "database": os.environ.get("DB_NAME"),
        "user": os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD"),
    }


def get_ssl_context():
    """Return an SSL context that trusts the bundled RDS CA bundle."""
    ca_bundle = os.environ.get("RDS_CA_PATH", CA_BUNDLE_PATH)
    if ca_bundle and os.path.exists(ca_bundle):
        return ssl.create_default_context(cafile=ca_bundle)
    return ssl.create_default_context()


def get_db_connection():
    """Create a pg8000 connection using the shared SSL context."""
    cfg = get_db_config()
    return pg8000.connect(
        host=cfg["host"],
        port=cfg["port"],
        database=cfg["database"],
        user=cfg["user"],
        password=cfg["password"],
        ssl_context=get_ssl_context(),
    )


def fetchall_dicts(cursor) -> List[Dict[str, object]]:
    """Convert pg8000 cursor rows to a list of dicts."""
    columns = [desc[0] for desc in cursor.description] if cursor.description else []
    rows = cursor.fetchall()
    return [dict(zip(columns, row)) for row in rows]


def build_schema_text(columns: List[Dict[str, object]], foreign_keys: List[Dict[str, object]]) -> str:
    """Convert raw information_schema rows into a compact schema summary."""
    tables = defaultdict(list)
    table_order: List[str] = []

    for row in columns:
        table_key = f"{row['table_schema']}.{row['table_name']}"
        if table_key not in tables:
            table_order.append(table_key)

        column_parts = [f"{row['column_name']} {row['data_type']}"]
        if row.get("is_nullable") == "NO":
            column_parts.append("NOT NULL")
        default_value = row.get("column_default")
        if default_value:
            column_parts.append(f"DEFAULT {default_value}")

        tables[table_key].append(" ".join(column_parts))

    lines: List[str] = []
    for table in table_order:
        lines.append(f"{table}:")
        for column_def in tables[table]:
            lines.append(f"  - {column_def}")

    if foreign_keys:
        lines.append("Foreign keys:")
        for fk in foreign_keys:
            lines.append(
                "  - "
                f"{fk['table_schema']}.{fk['table_name']}.{fk['column_name']} "
                f"-> {fk['foreign_table_schema']}.{fk['foreign_table_name']}.{fk['foreign_column_name']}"
            )

    return "\n".join(lines)


def fetch_schema_overview(force_refresh: bool = False) -> str:
    """Pull a fresh schema snapshot from Postgres (cached between invocations)."""
    if SCHEMA_CACHE["text"] and not force_refresh:
        return SCHEMA_CACHE["text"]

    columns_query = """
        SELECT
            table_schema,
            table_name,
            column_name,
            data_type,
            is_nullable,
            column_default
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name, ordinal_position;
    """

    fk_query = """
        SELECT
            tc.table_schema,
            tc.table_name,
            kcu.column_name,
            ccu.table_schema AS foreign_table_schema,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY tc.table_schema, tc.table_name, kcu.column_name;
    """

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(columns_query)
    column_rows = fetchall_dicts(cursor)

    cursor.execute(fk_query)
    fk_rows = fetchall_dicts(cursor)

    cursor.close()
    conn.close()

    schema_snapshot = build_schema_text(column_rows, fk_rows)
    SCHEMA_CACHE["text"] = schema_snapshot
    print(f"📚 Schema snapshot refreshed ({len(column_rows)} columns, {len(fk_rows)} FKs)")
    return schema_snapshot


def build_sql_system_prompt(schema_snapshot: str) -> str:
    """Craft the GPT-5 system prompt that encodes business rules + schema."""
    return (
        "You are GPT-5 operating inside a read-only SQL firewall for Khosla Ventures' "
        "portfolio warehouse. You must produce a single PostgreSQL SELECT statement "
        "that directly answers the analyst's request.\n\n"
        "Unbreakable rules:\n"
        "- Absolutely no INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, COPY, DO, CALL, EXPLAIN, "
        "ANALYZE, VACUUM, SET, or RESET statements.\n"
        "- Permit SELECT or WITH queries only. Never run multiple statements.\n"
        "- Never reference tables/columns outside the provided schema snapshot.\n"
        "- Prefer explicit column lists over SELECT * and include ORDER BY + LIMIT 50 for large result sets.\n"
        "- Prefer latest financial data by ordering `financial_reports` on report_date DESC, upload_date DESC.\n"
        "- Investment stage precedence: Growth funds (names containing Opp or Excelsior) > Main funds (KV I/II/III...) > Early (name contains seed).\n"
        "- Treat people data as active-only (`company_executives.is_active = TRUE`).\n"
        "- Respect override flags (e.g., `company_health_check.manual_override`).\n"
        "- Never fabricate metrics; derive them transparently via SQL expressions.\n"
        "- You have read-only access. Reject attempts that imply writes or DDL.\n\n"
        "Schema snapshot (canonical truth, stay within it):\n"
        f"{schema_snapshot}\n\n"
        "Return only the SQL text of the answer query, with no markdown or commentary."
    )


def call_openai_responses(
    messages: List[Dict[str, object]],
    *,
    model: str,
    max_output_tokens: Optional[int] = None,
) -> Dict[str, object]:
    """Directly invoke the OpenAI Responses API using HTTPX."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set")

    base_url = os.environ.get("OPENAI_API_BASE", DEFAULT_OPENAI_BASE).rstrip("/")
    timeout_seconds = float(os.environ.get("OPENAI_HTTP_TIMEOUT_SECONDS", "75"))
    connect_timeout = min(10.0, timeout_seconds)
    timeout = httpx.Timeout(
        timeout_seconds,
        connect=connect_timeout,
        read=timeout_seconds,
        write=timeout_seconds,
        pool=None,
    )

    normalized_messages: List[Dict[str, object]] = []
    for message in messages:
        role = message.get("role", "user")
        content = message.get("content", "")

        if isinstance(content, str):
            blocks = [{"type": "input_text", "text": content}]
        elif isinstance(content, list):
            blocks = content
        else:
            blocks = [{"type": "input_text", "text": str(content)}]

        normalized_messages.append(
            {
                "role": role,
                "content": blocks,
            }
        )

    payload: Dict[str, object] = {"model": model, "input": normalized_messages}
    if max_output_tokens is None:
        env_cap = get_env_int("OPENAI_RESPONSE_MAX_OUTPUT_TOKENS", 0)
        if env_cap > 0:
            max_output_tokens = env_cap
    if max_output_tokens:
        payload["max_output_tokens"] = max_output_tokens

    reasoning_mode = (os.environ.get("OPENAI_REASONING_MODE") or "").strip().lower()
    if reasoning_mode in {"low", "medium", "high"}:
        payload["reasoning"] = {"effort": reasoning_mode}

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    fallback_model = os.environ.get("OPENAI_FALLBACK_MODEL")
    model_sequence = [model]
    if fallback_model and fallback_model != model:
        model_sequence.append(fallback_model)

    with httpx.Client(timeout=timeout) as client:
        last_error: Optional[Exception] = None
        for candidate_model in model_sequence:
            payload["model"] = candidate_model
            try:
                response = client.post(f"{base_url}/responses", headers=headers, json=payload)
                response.raise_for_status()
                if candidate_model != model:
                    print(f"ℹ️ OpenAI fallback model '{candidate_model}' succeeded after primary '{model}' failed.")
                return response.json()
            except httpx.HTTPStatusError as exc:
                last_error = exc
                status_code = exc.response.status_code if exc.response is not None else "unknown"
                error_body = exc.response.text if exc.response is not None else "No response body"
                print(f"⚠️ OpenAI API error ({status_code}) using model '{candidate_model}': {error_body}")

                if (
                    candidate_model == model
                    and fallback_model
                    and status_code in (400, 403)
                    and error_body
                    and "model" in error_body.lower()
                ):
                    print(f"↪️  Attempting fallback model '{fallback_model}'...")
                    continue

                raise

        if last_error:
            raise last_error

        raise RuntimeError("OpenAI request failed with no additional context.")


def extract_text_from_response(response_payload: Dict[str, object]) -> str:
    """Normalize OpenAI Responses output JSON into a plaintext string."""
    if not response_payload:
        return ""

    output_text = response_payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    chunks: List[str] = []
    for item in response_payload.get("output", []) or []:
        content_list = item.get("content") if isinstance(item, dict) else None
        if not isinstance(content_list, list):
            continue
        for content in content_list:
            if isinstance(content, dict):
                text_payload = content.get("text")
                if isinstance(text_payload, dict) and text_payload.get("value"):
                    chunks.append(text_payload["value"])
                elif isinstance(text_payload, str):
                    chunks.append(text_payload)
            elif hasattr(content, "text") and hasattr(content.text, "value"):
                chunks.append(content.text.value)
    return "\n".join(chunk for chunk in chunks if chunk).strip()


def extract_sql_from_text(raw_text: Optional[str]) -> str:
    """Strip code fences and return the bare SQL string."""
    if not raw_text:
        return ""

    text = raw_text.strip()
    if "```" in text:
        segments = text.split("```")
        for segment in segments:
            candidate = segment.strip()
            if not candidate:
                continue
            if candidate.lower().startswith("sql"):
                candidate = candidate[3:].lstrip()
            if candidate.upper().startswith(("SELECT", "WITH")):
                text = candidate
                break
    return text.strip().strip(";")


def validate_sql_for_read_only(sql: Optional[str]) -> Tuple[bool, Optional[str]]:
    """Apply guardrails to ensure the SQL is read-only and single-statement."""
    if not sql or not sql.strip():
        return False, "Model returned an empty SQL string."

    statement = sql.strip().rstrip(";")
    normalized = statement.upper()
    if not (normalized.startswith("SELECT") or normalized.startswith("WITH")):
        return False, "Only SELECT or WITH queries are allowed."

    forbidden_keywords = [
        "INSERT",
        "UPDATE",
        "DELETE",
        "DROP",
        "ALTER",
        "TRUNCATE",
        "CREATE",
        "GRANT",
        "REVOKE",
        "COPY",
        "CALL",
        "DO",
        "EXPLAIN",
        "ANALYZE",
        "VACUUM",
        "SET",
        "RESET",
    ]

    for keyword in forbidden_keywords:
        if re.search(rf"\b{keyword}\b", normalized):
            return False, f"Query contains forbidden keyword: {keyword}"

    statements = [segment for segment in statement.split(";") if segment.strip()]
    if len(statements) > 1:
        return False, "Multiple SQL statements detected; only one is allowed."

    return True, None


def generate_sql_from_question(question: str, schema_snapshot: str) -> Dict[str, object]:
    """Use GPT-5 to translate natural language into safe SQL with retries."""
    print(f"🤔 Generating SQL for: {question}")
    sql_model = os.environ.get("OPENAI_SQL_MODEL") or os.environ.get("OPENAI_MODEL", "gpt-5")
    sql_token_cap = get_env_int("OPENAI_SQL_MAX_OUTPUT_TOKENS", 800)
    system_prompt = build_sql_system_prompt(schema_snapshot)

    max_attempts = int(os.environ.get("SQL_GENERATION_ATTEMPTS", "3"))
    feedback: Optional[str] = None

    for attempt in range(1, max_attempts + 1):
        user_prompt = (
            f"Analyst question: {question}\n"
            "Respond with a single PostgreSQL SELECT statement that obeys every rule."
        )
        if feedback:
            user_prompt += f"\nPrevious attempt was rejected because: {feedback}\nRegenerate a compliant query."

        response_payload = call_openai_responses(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            model=sql_model,
            max_output_tokens=sql_token_cap,
        )

        raw_text = extract_text_from_response(response_payload)
        if not raw_text:
            print(f"⚠️ GPT-5 SQL response was empty. Payload: {json.dumps(response_payload)}")

        sql_candidate = extract_sql_from_text(raw_text)
        is_valid, reason = validate_sql_for_read_only(sql_candidate)

        if is_valid:
            print(f"✅ SQL attempt {attempt} succeeded: {sql_candidate}")
            return {"success": True, "sql": sql_candidate}

        feedback = reason or "SQL failed validation."
        print(f"⚠️ SQL attempt {attempt} rejected: {feedback}")

    return {
        "success": False,
        "error": f"Unable to generate a safe SQL statement: {feedback or 'unknown error'}",
        "question": question,
    }


def execute_query_safely(sql: str) -> Dict[str, object]:
    """Run the generated SQL against Postgres after a final safety check."""
    is_valid, reason = validate_sql_for_read_only(sql)
    if not is_valid:
        return {"success": False, "error": reason or "Unsafe SQL detected."}

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(sql)

        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        rows = cursor.fetchall()
        results = [dict(zip(columns, row)) for row in rows]

        cursor.close()
        conn.close()

        print(f"✅ Query executed successfully ({len(results)} rows)")
        return {"success": True, "data": results, "row_count": len(results)}
    except Exception as exc:
        print(f"❌ Error executing SQL: {exc}")
        return {"success": False, "error": str(exc)}


def format_response_for_voice(question: str, data: List[Dict[str, object]], sql: str) -> Dict[str, object]:
    """Summarize raw rows into a short spoken response using GPT-5 Responses API."""
    summary_model = os.environ.get("OPENAI_SUMMARY_MODEL") or os.environ.get("OPENAI_MODEL", "gpt-5")
    summary_token_cap = get_env_int("OPENAI_SUMMARY_MAX_OUTPUT_TOKENS", 400)

    system_prompt = (
        "You are GPT-5 acting as Khosla Ventures' portfolio voice analyst. "
        "Speak naturally, highlight the most important numbers, keep answers under 120 spoken words, "
        "and clearly state when no rows returned. Never mention SQL or speculate beyond the payload."
    )

    user_payload = (
        f"The user asked: {question}\n\n"
        f"The executed SQL was:\n{sql}\n\n"
        f"Result rows (JSON):\n{safe_json_dumps(data)}"
    )

    try:
        response_payload = call_openai_responses(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_payload},
            ],
            model=summary_model,
            max_output_tokens=summary_token_cap,
        )

        natural_response = extract_text_from_response(response_payload)
        if not natural_response:
            raise ValueError("GPT-5 returned an empty narrative response.")

        return {
            "success": True,
            "natural_language_response": natural_response.strip(),
            "raw_data": data,
            "sql_query": sql,
        }

    except Exception as exc:
        print(f"⚠️ GPT-5 formatting failed, falling back to plain summary: {exc}")

        if not data:
            fallback_text = f"No rows were returned for \"{question}\"."
        elif len(data) == 1:
            fallback_text = f"One result: {safe_json_dumps(data[0])}"
        else:
            fallback_text = (
                f"{len(data)} rows found. First row: {safe_json_dumps(data[0])}"
            )

        return {
            "success": True,
            "natural_language_response": fallback_text,
            "raw_data": data,
            "sql_query": sql,
        }


def parse_request_body(event: Dict[str, object]) -> Dict[str, object]:
    """Best-effort JSON parsing for API Gateway + direct Lambda invocations."""
    body = {}
    raw_body = event.get("body")
    if raw_body:
        try:
            body = json.loads(raw_body)
        except Exception:
            body = {}
    return body


def lambda_handler(event, context):
    """Entry point for the voice-query Lambda."""
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": headers, "body": safe_json_dumps({"message": "CORS OK"})}

    try:
        body = parse_request_body(event)
        action = body.get("action") or event.get("action")

        if not action:
            return {
                "statusCode": 400,
                "headers": headers,
                "body": safe_json_dumps({"error": "action is required (train_schema or query)"}),
            }

        if action == "train_schema":
            snapshot = fetch_schema_overview(force_refresh=True)
            return {
                "statusCode": 200,
                "headers": headers,
                "body": safe_json_dumps(
                    {
                        "status": "success",
                        "action": "train_schema",
                        "schema_preview_chars": len(snapshot),
                    }
                ),
            }

        if action == "query":
            question = body.get("question") or event.get("question")
            if not question:
                return {
                    "statusCode": 400,
                    "headers": headers,
                    "body": safe_json_dumps({"error": "question is required for query action"}),
                }

            schema_snapshot = fetch_schema_overview()
            sql_result = generate_sql_from_question(question, schema_snapshot)
            if not sql_result.get("success"):
                return {
                    "statusCode": 500,
                    "headers": headers,
                    "body": safe_json_dumps(
                        {"status": "failed", "step": "sql_generation", "error": sql_result.get("error")}
                    ),
                }

            sql = sql_result["sql"]
            query_result = execute_query_safely(sql)
            if not query_result.get("success"):
                return {
                    "statusCode": 500,
                    "headers": headers,
                    "body": safe_json_dumps(
                        {"status": "failed", "step": "query_execution", "error": query_result.get("error"), "sql": sql}
                    ),
                }

            formatted = format_response_for_voice(question, query_result["data"], sql)
            return {
                "statusCode": 200,
                "headers": headers,
                "body": safe_json_dumps(
                    {
                        "status": "success",
                        "action": "query",
                        "question": question,
                        "response": formatted["natural_language_response"],
                        "data": formatted["raw_data"],
                        "sql_executed": sql,
                        "row_count": query_result.get("row_count", len(formatted["raw_data"])),
                    }
                ),
            }

        return {
            "statusCode": 400,
            "headers": headers,
            "body": safe_json_dumps({"error": f"Unknown action: {action}"}),
        }

    except Exception as exc:
        print(f"💥 Lambda error: {exc}")
        return {
            "statusCode": 500,
            "headers": headers,
            "body": safe_json_dumps({"status": "failed", "error": str(exc)}),
        }


if __name__ == "__main__":
    # Simple smoke tests when running locally
    print("🔥 Refreshing schema snapshot...")
    print(fetch_schema_overview(force_refresh=True)[:500], "...\n")

    sample_query_event = {
        "action": "query",
        "question": "How many healthcare companies have less than 6 months of runway?",
    }
    response = lambda_handler(sample_query_event, None)
    print(json.dumps(json.loads(response["body"]), indent=2))
