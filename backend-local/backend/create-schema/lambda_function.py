import json
import os
import pg8000
import ssl   # still imported in case you want custom CA later

# ────────────────────────────────────────────────────────────
def lambda_handler(event, context):
    """
    Lambda function to create (or idempotently verify) the DB schema.
    """

    # ── DB connection settings come from environment variables ──
    db_config = {
        "host":     os.environ.get("DB_HOST"),
        "port":     int(os.environ.get("DB_PORT")),
        "database": os.environ.get("DB_NAME"),
        "user":     os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD")   # ← provide via Lambda env or Secrets Manager
    }

    conn = None
    cursor = None
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }

    try:
        # ── Connect with pg8000; default SSL settings already validate RDS cert ──
        conn = pg8000.connect(
            host=db_config["host"],
            port=db_config["port"],
            database=db_config["database"],
            user=db_config["user"],
            password=db_config["password"],
            timeout=30,
            ssl=True                  # pg8000 will create a safe SSL context
        )

        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()[0]
        print(f"Connected to PostgreSQL: {version}")

        schema_result = create_database_schema(conn)

        response_body = {
            "status": "success",
            "message": f'Connected successfully to {db_config["host"]}',
            "schema_created": schema_result["success"],
            "details": schema_result
        }
        status_code = 200

    except Exception as e:
        if conn:
            conn.rollback()
        response_body = {
            "status": "failed",
            "message": f"Failed to connect or create schema: {str(e)}",
            "schema_created": False
        }
        status_code = 500
        print(response_body["message"])

    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

    return {
        "statusCode": status_code,
        "headers": headers,
        "body": json.dumps(response_body)
    }

# ────────────────────────────────────────────────────────────
def create_database_schema(conn):
    """
    Creates/validates all tables & indexes.
    """
    cursor = conn.cursor()
    try:
        # companies
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS companies (
            id              SERIAL PRIMARY KEY,
            name            VARCHAR(255) NOT NULL,
            normalized_name VARCHAR(255) UNIQUE NOT NULL,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # financial_reports
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS financial_reports (
            id SERIAL PRIMARY KEY,
            company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            file_name           VARCHAR(500) NOT NULL,
            report_date         DATE,
            report_period       VARCHAR(50),
            cash_on_hand        TEXT,
            monthly_burn_rate   TEXT,
            cash_out_date       TEXT,
            runway              TEXT,
            budget_vs_actual    TEXT,
            financial_summary   TEXT,
            clinical_progress   TEXT,
            research_development TEXT,
            upload_date         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            processed_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            processing_status   VARCHAR(50) DEFAULT 'pending',
            created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # cap_table_rounds
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS cap_table_rounds (
            id              SERIAL PRIMARY KEY,
            company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            round_name      VARCHAR(100) NOT NULL,
            valuation       NUMERIC(20,2),
            amount_raised   NUMERIC(20,2),
            round_date      DATE,
            total_pool_size NUMERIC(8,6),
            pool_available  NUMERIC(8,6),
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (company_id, round_name)
        );
        """)

        # cap_table_investors
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS cap_table_investors (
            id                      SERIAL PRIMARY KEY,
            cap_table_round_id      INTEGER NOT NULL REFERENCES cap_table_rounds(id) ON DELETE CASCADE,
            investor_name           VARCHAR(255) NOT NULL,
            total_invested          NUMERIC(20,2),
            final_fds               NUMERIC(8,6),
            final_round_investment  NUMERIC(20,2),
            created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (cap_table_round_id, investor_name)
        );
        """)

        # cap_table_current (pointer)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS cap_table_current (
            company_id          INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
            cap_table_round_id  INTEGER NOT NULL REFERENCES cap_table_rounds(id) ON DELETE CASCADE,
            updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # Indexes
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_companies_normalized_name
        ON companies(normalized_name);
        """)

        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_financial_reports_company_date
        ON financial_reports(company_id, report_date DESC);
        """)

        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_financial_reports_company_period
        ON financial_reports(company_id, report_period, report_date DESC);
        """)

        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_cap_table_rounds_company_date
        ON cap_table_rounds(company_id, round_date DESC);
        """)

        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_cap_table_investors_round
        ON cap_table_investors(cap_table_round_id);
        """)

        conn.commit()
        return {
            "success": True,
            "message": "Schema created/verified",
            "tables_created": [
                "companies", "financial_reports",
                "cap_table_rounds", "cap_table_investors", "cap_table_current"
            ]
        }

    except Exception as e:
        conn.rollback()
        raise e

    finally:
        cursor.close()


# Local test runner
if __name__ == "__main__":
    print(json.dumps(lambda_handler({}, {}), indent=2))

