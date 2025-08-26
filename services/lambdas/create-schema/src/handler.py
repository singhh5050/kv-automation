import json
import os
import pg8000
import ssl   # still imported in case you want custom CA later

# ────────────────────────────────────────────────────────────
def lambda_handler(event, context):
    """
    Lambda function to create (or idempotently verify) the DB schema.
    Supports force_recreate to completely rebuild all tables.
    """

    # Parse request body for options (kept for backward compatibility but not used)
    try:
        if event.get("body"):
            body = json.loads(event["body"])
        elif event.get("force_recreate"):
            pass  # Ignore force_recreate parameter
    except:
        pass  # Use defaults if parsing fails

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
        # ── Connect with pg8000; proper SSL and timeout settings ──
        conn = pg8000.connect(
            host=db_config["host"],
            port=db_config["port"],
            database=db_config["database"],
            user=db_config["user"],
            password=db_config["password"],
            timeout=30,              # connection timeout
            ssl_context=ssl.create_default_context()  # proper SSL context
        )

        conn.autocommit = True       # every DDL is its own tx

        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()[0]
        print(f"Connected to PostgreSQL: {version}")

        schema_result = create_database_schema(conn)

        response_body = {
            "status": "success", 
            "message": f'Evidence field added safely to database on {db_config["host"]}',
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
    SAFE MODE: Just adds the evidence field to financial_reports table.
    The destructive recreation is commented out for safety.
    """
    cursor = conn.cursor()

    # ---- COMMENTED OUT: Destructive schema recreation ----------------
    # print("💥 Dropping entire public schema …")
    # cursor.execute("DROP SCHEMA public CASCADE;")
    # cursor.execute("CREATE SCHEMA public;")        # puts it back
    # print("✅ Schema dropped & recreated")
    
    # ---- SAFE: Just add evidence field if it doesn't exist ------------
    print("🔧 Adding evidence field to financial_reports table...")
    try:
        cursor.execute("""
        ALTER TABLE financial_reports 
        ADD COLUMN evidence JSONB;
        """)
        print("✅ Evidence field added successfully")
    except Exception as e:
        if "already exists" in str(e).lower() or "duplicate column" in str(e).lower():
            print("ℹ️ Evidence field already exists, skipping")
        else:
            print(f"⚠️ Error adding evidence field: {e}")
            raise e

    # ---- SAFE: Add company_notes table if it doesn't exist ------------
    print("🔧 Creating company_notes table...")
    try:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS company_notes (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            subject VARCHAR(255) NOT NULL,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by VARCHAR(100),
            updated_by VARCHAR(100)
        );
        """)
        print("✅ Company notes table created successfully")
        
        # Add indexes for efficient queries
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_notes_company_id ON company_notes(company_id);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_notes_created_at ON company_notes(created_at DESC);
        """)
        print("✅ Company notes table indexes created successfully")
        
    except Exception as e:
        print(f"⚠️ Error creating company_notes table: {e}")
        raise e

    # ---- SAFE: Add company_kpi_analysis table if it doesn't exist ----
    print("🔧 Creating company_kpi_analysis table...")
    try:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS company_kpi_analysis (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            analysis_content TEXT NOT NULL,
            stage VARCHAR(50) NOT NULL,
            reports_analyzed INTEGER DEFAULT 0,
            generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by VARCHAR(100) DEFAULT 'system'
        );
        """)
        print("✅ Company KPI analysis table created successfully")
        
        # Add indexes for efficient queries
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_kpi_analysis_company_id ON company_kpi_analysis(company_id);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_kpi_analysis_generated_at ON company_kpi_analysis(generated_at DESC);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_kpi_analysis_stage ON company_kpi_analysis(stage);
        """)
        print("✅ Company KPI analysis table indexes created successfully")
        
    except Exception as e:
        print(f"⚠️ Error creating company_kpi_analysis table: {e}")
        raise e

    # ---- COMMENTED OUT: Table recreation (safe mode) -----------------
    # cursor.execute("""
    # CREATE TABLE companies (
    #     id              SERIAL PRIMARY KEY,
    #     name            VARCHAR(255) NOT NULL,
    #     normalized_name VARCHAR(255) UNIQUE NOT NULL,
    #     sector          VARCHAR(20) CHECK (sector IN ('healthcare','consumer','enterprise','manufacturing')),
    #     manually_edited BOOLEAN DEFAULT FALSE,
    #     edited_by       VARCHAR(100),
    #     edited_at       TIMESTAMP,
    #     created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    #     updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    # );
    # """)

    # cursor.execute("""
    # CREATE TABLE financial_reports (
    #     id SERIAL PRIMARY KEY,
    #     company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    #     file_name           VARCHAR(500) NOT NULL,
    #     report_date         DATE,
    #     report_period       VARCHAR(50),
    #     sector              VARCHAR(20) CHECK (sector IN ('healthcare','consumer','enterprise','manufacturing')),
    #     cash_on_hand        NUMERIC(15,2),
    #     monthly_burn_rate   NUMERIC(15,2),
    #     cash_out_date       TEXT,
    #     runway              INTEGER,
    #     budget_vs_actual    TEXT,
    #     financial_summary   TEXT,
    #     sector_highlight_a  TEXT,
    #     sector_highlight_b  TEXT,
    #     key_risks           TEXT,
    #     personnel_updates   TEXT,
    #     next_milestones     TEXT,
    #     upload_date         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    #     processed_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    #     processing_status   VARCHAR(50) DEFAULT 'pending',
    #     manually_edited     BOOLEAN DEFAULT FALSE,
    #     edited_by           VARCHAR(100),
    #     edited_at           TIMESTAMP,
    #     created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    #     updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    # );
    # """)

    # ALL TABLE CREATION AND INDEXES COMMENTED OUT IN SAFE MODE
    # (Rest of the table creation code is commented out for safety)
    
    print("🎉 Schema migration completed successfully")
    return {
        "success": True,
        "message": "Evidence field added to financial_reports table, company_notes and company_kpi_analysis tables created safely",
        "operation": "add_evidence_field_notes_and_kpi_tables",
        "affected_tables": ["financial_reports", "company_notes", "company_kpi_analysis"],
        "new_columns": ["evidence JSONB"],
        "new_tables": ["company_notes", "company_kpi_analysis"]
    }


# Local test runner
if __name__ == "__main__":
    print(json.dumps(lambda_handler({}, {}), indent=2))
