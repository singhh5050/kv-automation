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
            ssl_context=True         # correct SSL flag
        )

        conn.autocommit = True       # every DDL is its own tx

        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()[0]
        print(f"Connected to PostgreSQL: {version}")

        schema_result = create_database_schema(conn)

        response_body = {
            "status": "success",
            "message": f'Database completely wiped and schema recreated on {db_config["host"]}',
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
    Completely wipes the DB (everything in schema `public`) and rebuilds
    the core tables + indexes from scratch.
    """
    cursor = conn.cursor()

    # ---- 1. Nuke everything in one statement  --------------------------
    print("💥 Dropping entire public schema …")
    cursor.execute("DROP SCHEMA public CASCADE;")
    cursor.execute("CREATE SCHEMA public;")        # puts it back
    print("✅ Schema dropped & recreated")

    # ---- 2. Recreate tables -------------------------------------------
    cursor.execute("""
    CREATE TABLE companies (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(255) NOT NULL,
        normalized_name VARCHAR(255) UNIQUE NOT NULL,
        sector          VARCHAR(20) CHECK (sector IN ('healthcare','consumer','enterprise','manufacturing')),
        manually_edited BOOLEAN DEFAULT FALSE,
        edited_by       VARCHAR(100),
        edited_at       TIMESTAMP,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cursor.execute("""
    CREATE TABLE financial_reports (
        id SERIAL PRIMARY KEY,
        company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        file_name           VARCHAR(500) NOT NULL,
        report_date         DATE,
        report_period       VARCHAR(50),
        sector              VARCHAR(20) CHECK (sector IN ('healthcare','consumer','enterprise','manufacturing')),
        cash_on_hand        NUMERIC(15,2),
        monthly_burn_rate   NUMERIC(15,2),
        cash_out_date       TEXT,
        runway              INTEGER,
        budget_vs_actual    TEXT,
        financial_summary   TEXT,
        sector_highlight_a  TEXT,
        sector_highlight_b  TEXT,
        key_risks           TEXT,
        personnel_updates   TEXT,
        next_milestones     TEXT,
        upload_date         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processing_status   VARCHAR(50) DEFAULT 'pending',
        manually_edited     BOOLEAN DEFAULT FALSE,
        edited_by           VARCHAR(100),
        edited_at           TIMESTAMP,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cursor.execute("""
    CREATE TABLE cap_table_rounds (
        id                  SERIAL PRIMARY KEY,
        company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        round_name          VARCHAR(100) NOT NULL,
        valuation           NUMERIC(20,2),
        amount_raised       NUMERIC(20,2),
        round_date          DATE,
        total_pool_size     NUMERIC(8,6),
        pool_available      NUMERIC(8,6),
        pool_utilization    NUMERIC(8,6),
        options_outstanding NUMERIC(8,6),
        manually_edited     BOOLEAN DEFAULT FALSE,
        edited_by           VARCHAR(100),
        edited_at           TIMESTAMP,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (company_id, round_name)
    );
    """)

    cursor.execute("""
    CREATE TABLE cap_table_investors (
        id                      SERIAL PRIMARY KEY,
        cap_table_round_id      INTEGER NOT NULL REFERENCES cap_table_rounds(id) ON DELETE CASCADE,
        investor_name           VARCHAR(255) NOT NULL,
        total_invested          NUMERIC(20,2),
        final_fds               NUMERIC(8,6),
        final_round_investment  NUMERIC(20,2),
        manually_edited         BOOLEAN DEFAULT FALSE,
        edited_by               VARCHAR(100),
        edited_at               TIMESTAMP,
        created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (cap_table_round_id, investor_name)
    );
    """)

    cursor.execute("""
    CREATE TABLE cap_table_current (
        company_id          INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
        cap_table_round_id  INTEGER NOT NULL REFERENCES cap_table_rounds(id) ON DELETE CASCADE,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cursor.execute("""
    CREATE TABLE company_enrichments (
        id                      SERIAL PRIMARY KEY,
        company_id              INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        harmonic_entity_urn     VARCHAR(255),
        harmonic_data           JSONB,
        extracted_data          JSONB,
        enrichment_status       VARCHAR(50) DEFAULT 'pending',
        enriched_at             TIMESTAMP,
        created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        -- Additional structured fields for better querying and performance
        funding_total           NUMERIC,
        funding_stage           VARCHAR(50),
        valuation               NUMERIC,
        headcount               INTEGER,
        web_traffic             INTEGER,
        stage                   VARCHAR(50),
        company_type            VARCHAR(50),
        location_city           VARCHAR(100),
        location_state          VARCHAR(100),
        location_country        VARCHAR(100),
        
        UNIQUE (company_id)
    );
    """)

    cursor.execute("""
    CREATE TABLE person_enrichments (
        id                      SERIAL PRIMARY KEY,
        person_urn              VARCHAR(255) UNIQUE NOT NULL,
        company_id              INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        full_name               VARCHAR(255),
        first_name              VARCHAR(100),
        last_name               VARCHAR(100),
        title                   VARCHAR(255),
        harmonic_data           JSONB NOT NULL,
        extracted_data          JSONB,
        enrichment_status       VARCHAR(50) DEFAULT 'pending',
        enriched_at             TIMESTAMP,
        created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # ---- 3. Indexes ----------------------------------------------------
    cursor.execute("CREATE INDEX idx_companies_normalized_name ON companies(normalized_name);")
    cursor.execute("CREATE INDEX idx_financial_reports_company_date ON financial_reports(company_id, report_date DESC);")
    cursor.execute("CREATE INDEX idx_financial_reports_company_period ON financial_reports(company_id, report_period, report_date DESC);")
    cursor.execute("CREATE INDEX idx_cap_table_rounds_company_date ON cap_table_rounds(company_id, round_date DESC);")
    cursor.execute("CREATE INDEX idx_cap_table_investors_round ON cap_table_investors(cap_table_round_id);")
    cursor.execute("CREATE INDEX idx_company_enrichments_company_id ON company_enrichments(company_id);")
    cursor.execute("CREATE INDEX idx_company_enrichments_status ON company_enrichments(enrichment_status);")
    cursor.execute("CREATE INDEX idx_company_enrichments_funding ON company_enrichments(funding_total, funding_stage);")
    cursor.execute("CREATE INDEX idx_company_enrichments_location ON company_enrichments(location_country, location_state, location_city);")
    cursor.execute("CREATE INDEX idx_person_enrichments_person_urn ON person_enrichments(person_urn);")
    cursor.execute("CREATE INDEX idx_person_enrichments_company_id ON person_enrichments(company_id);")
    cursor.execute("CREATE INDEX idx_person_enrichments_status ON person_enrichments(enrichment_status);")

    print("🎉 Fresh schema created successfully")
    return {
        "success": True,
        "message": "Database completely wiped and schema recreated",
        "tables_created": [
            "companies", "financial_reports",
            "cap_table_rounds", "cap_table_investors", "cap_table_current", 
            "company_enrichments", "person_enrichments"
        ]
    }


# Local test runner
if __name__ == "__main__":
    print(json.dumps(lambda_handler({}, {}), indent=2))
