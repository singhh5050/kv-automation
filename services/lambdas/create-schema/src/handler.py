import json
import os
import pg8000
import ssl   # still imported in case you want custom CA later

# ────────────────────────────────────────────────────────────
def lambda_handler(event, context):
    """
    Lambda function to create (or idempotently verify) the DB schema.
    Supports force_recreate to completely rebuild all tables.
    Also supports 'get_platform_stats' action to retrieve comprehensive metrics.
    """

    # Parse request body for options
    body = {}
    try:
        if event.get("body"):
            body = json.loads(event["body"])
    except:
        pass  # Use defaults if parsing fails
    
    # Check for action parameter
    action = event.get("action") or body.get("action")
    
    # If action is get_platform_stats, run the stats function
    if action == "get_platform_stats":
        return get_platform_stats(event, context)

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

    # ---- SAFE: Add company_health_check table if it doesn't exist ----
    print("🔧 Creating company_health_check table...")
    try:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS company_health_check (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            health_score VARCHAR(10) NOT NULL CHECK (health_score IN ('GREEN', 'YELLOW', 'RED')),
            justification TEXT NOT NULL,
            criticality_level INTEGER CHECK (criticality_level >= 1 AND criticality_level <= 10),
            manual_override BOOLEAN DEFAULT FALSE,
            analysis_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by VARCHAR(100) DEFAULT 'system'
        );
        """)
        print("✅ Company health check table created successfully")
        
        # Add indexes for efficient queries
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_health_check_company_id ON company_health_check(company_id);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_health_check_timestamp ON company_health_check(analysis_timestamp DESC);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_health_check_score ON company_health_check(health_score);
        """)
        print("✅ Company health check table indexes created successfully")
        
    except Exception as e:
        print(f"⚠️ Error creating company_health_check table: {e}")
        raise e

    # ---- SAFE: Add async_analysis_jobs table if it doesn't exist ------------
    print("🔧 Creating async_analysis_jobs table...")
    try:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS async_analysis_jobs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            stage VARCHAR(50) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
            progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
            results TEXT,
            error_message TEXT,
            reports_analyzed INTEGER DEFAULT 0,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by VARCHAR(100) DEFAULT 'system'
        );
        """)
        print("✅ Async analysis jobs table created successfully")
        
        # Add indexes for efficient queries
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_async_jobs_company_id ON async_analysis_jobs(company_id);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_async_jobs_status ON async_analysis_jobs(status);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_async_jobs_created_at ON async_analysis_jobs(created_at DESC);
        """)
        print("✅ Async analysis jobs table indexes created successfully")
        
    except Exception as e:
        print(f"⚠️ Error creating async_analysis_jobs table: {e}")
        raise e

    # ---- SAFE: Add company_executives table if it doesn't exist ----
    print("🔧 Creating company_executives table...")
    try:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS company_executives (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            
            -- Core fields (user-editable)
            full_name VARCHAR(255),
            title VARCHAR(255),
            linkedin_url VARCHAR(500),
            
            -- Metadata
            display_order INTEGER DEFAULT 0,
            is_ceo BOOLEAN DEFAULT FALSE,
            is_active BOOLEAN DEFAULT TRUE,
            
            -- Source tracking
            harmonic_person_urn VARCHAR(255),
            source VARCHAR(50) DEFAULT 'manual', -- 'harmonic', 'manual', 'pdf'
            
            -- Audit
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by VARCHAR(100) DEFAULT 'system',
            
            UNIQUE(company_id, display_order)
        );
        """)
        print("✅ Company executives table created successfully")
        
        # Add indexes for efficient queries
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_executives_company_id ON company_executives(company_id);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_executives_is_active ON company_executives(is_active);
        """)
        print("✅ Company executives table indexes created successfully")
        
    except Exception as e:
        print(f"⚠️ Error creating company_executives table: {e}")
        raise e

    # ---- SAFE: Add company_competition_analysis table if it doesn't exist ----
    print("🔧 Creating company_competition_analysis table...")
    try:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS company_competition_analysis (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            
            -- Analysis content
            analysis_content TEXT NOT NULL,
            is_public BOOLEAN DEFAULT FALSE,
            
            -- Metadata
            analysis_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by VARCHAR(100) DEFAULT 'system'
        );
        """)
        print("✅ Company competition analysis table created successfully")
        
        # Add indexes for efficient queries
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_competition_analysis_company_id ON company_competition_analysis(company_id);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_competition_analysis_timestamp ON company_competition_analysis(analysis_timestamp DESC);
        """)
        print("✅ Company competition analysis table indexes created successfully")
        
    except Exception as e:
        print(f"⚠️ Error creating company_competition_analysis table: {e}")
        raise e

    # ---- SAFE: Add company_milestones table if it doesn't exist ----
    print("🔧 Creating company_milestones table...")
    try:
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS company_milestones (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            financial_report_id INTEGER REFERENCES financial_reports(id) ON DELETE CASCADE,
            
            -- Milestone data
            milestone_date DATE NOT NULL,
            description TEXT NOT NULL,
            priority VARCHAR(10) CHECK (priority IN ('critical', 'high', 'medium', 'low')),
            
            -- Completion tracking
            completed BOOLEAN DEFAULT FALSE,
            completed_at TIMESTAMP,
            
            -- Metadata
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)
        print("✅ Company milestones table created successfully")
        
        # Add completed columns if they don't exist (for existing tables)
        try:
            cursor.execute("""
            ALTER TABLE company_milestones 
            ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT FALSE;
            """)
            cursor.execute("""
            ALTER TABLE company_milestones 
            ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
            """)
            print("✅ Completion columns added to company_milestones table")
        except Exception as e:
            if "already exists" in str(e).lower() or "duplicate column" in str(e).lower():
                print("ℹ️ Completion columns already exist")
            else:
                print(f"⚠️ Warning adding completion columns: {e}")
        
        # Add indexes for efficient queries
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_milestones_company_id ON company_milestones(company_id);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_milestones_date ON company_milestones(milestone_date);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_milestones_priority ON company_milestones(priority);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_company_milestones_report_id ON company_milestones(financial_report_id);
        """)
        print("✅ Company milestones table indexes created successfully")
        
    except Exception as e:
        print(f"⚠️ Error creating company_milestones table: {e}")
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

    ensure_vector_store_tables(cursor)
    
    print("🎉 Schema migration completed successfully")
    return {
        "success": True,
        "message": "Schema migration complete with all tables including company_competition_analysis",
        "operation": "full_schema_migration",
        "affected_tables": ["financial_reports", "company_notes", "company_kpi_analysis", "company_health_check", "company_competition_analysis", "company_executives", "company_milestones", "langchain_pg_collection", "langchain_pg_embedding"],
        "new_columns": ["evidence JSONB"],
        "new_tables": ["company_notes", "company_kpi_analysis", "company_health_check", "company_competition_analysis", "company_executives", "company_milestones", "langchain_pg_collection", "langchain_pg_embedding"]
    }


def ensure_vector_store_tables(cursor):
    """Create pgvector extension and the tables the Vanna PG vector store relies on."""
    print("🔧 Ensuring pgvector extension and embeddings tables exist...")
    try:
        cursor.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
        cursor.execute("CREATE EXTENSION IF NOT EXISTS vector;")

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS langchain_pg_collection (
            uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT UNIQUE NOT NULL,
            cmetadata JSONB
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS langchain_pg_embedding (
            id TEXT PRIMARY KEY,
            collection_id UUID REFERENCES langchain_pg_collection(uuid) ON DELETE CASCADE,
            embedding vector(1536),
            document TEXT,
            cmetadata JSONB
        );
        """)

        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_langchain_collection_name
        ON langchain_pg_collection (name);
        """)

        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_langchain_embedding_collection
        ON langchain_pg_embedding (collection_id);
        """)

        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_langchain_embedding_metadata
        ON langchain_pg_embedding
        USING GIN (cmetadata jsonb_path_ops);
        """)

        print("✅ pgvector extension and embeddings tables ready")
    except Exception as e:
        print(f"⚠️ Error ensuring vector store tables: {e}")
        raise e


# ────────────────────────────────────────────────────────────
def safe_query(conn, cursor, query, default=0):
    """Execute a query and return result, or default if table/column doesn't exist."""
    try:
        cursor.execute(query)
        result = cursor.fetchone()
        return result[0] if result else default
    except Exception as e:
        error_str = str(e)
        # 42P01 = table doesn't exist, 42703 = column doesn't exist
        if '42P01' in error_str or '42703' in error_str or 'does not exist' in error_str:
            try:
                conn.rollback()  # Reset transaction state
            except:
                pass
            return default
        raise

def safe_query_all(conn, cursor, query, default=None):
    """Execute a query and return all results, or default if table/column doesn't exist."""
    try:
        cursor.execute(query)
        return cursor.fetchall()
    except Exception as e:
        error_str = str(e)
        # 42P01 = table doesn't exist, 42703 = column doesn't exist
        if '42P01' in error_str or '42703' in error_str or 'does not exist' in error_str:
            try:
                conn.rollback()  # Reset transaction state
            except:
                pass
            return default if default is not None else []
        raise

def get_platform_stats(event, context):
    """
    Returns comprehensive platform statistics and KPIs.
    This is a showcase function to demonstrate the scale and capabilities of the platform.
    """
    
    db_config = {
        "host":     os.environ.get("DB_HOST"),
        "port":     int(os.environ.get("DB_PORT")),
        "database": os.environ.get("DB_NAME"),
        "user":     os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD")
    }
    
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
    
    conn = None
    cursor = None
    
    try:
        conn = pg8000.connect(
            host=db_config["host"],
            port=db_config["port"],
            database=db_config["database"],
            user=db_config["user"],
            password=db_config["password"],
            timeout=30,
            ssl_context=ssl.create_default_context()
        )
        
        conn.autocommit = True  # Prevent transaction issues on read-only queries
        cursor = conn.cursor()
        
        stats = {}
        
        # ═══════════════════════════════════════════════════════════════
        # CORE ENTITY COUNTS
        # ═══════════════════════════════════════════════════════════════
        
        # Companies
        cursor.execute("SELECT COUNT(*) FROM companies")
        stats['total_companies'] = cursor.fetchone()[0]
        
        # Financial Reports
        cursor.execute("SELECT COUNT(*) FROM financial_reports")
        stats['total_financial_reports'] = cursor.fetchone()[0]
        
        # Cap Table Rounds
        cursor.execute("SELECT COUNT(*) FROM cap_table_rounds")
        stats['total_cap_table_rounds'] = cursor.fetchone()[0]
        
        # Cap Table Investors
        cursor.execute("SELECT COUNT(*) FROM cap_table_investors")
        stats['total_investor_entries'] = cursor.fetchone()[0]
        
        # Unique Investors (normalized)
        cursor.execute("""
            SELECT COUNT(DISTINCT LOWER(TRIM(investor_name))) 
            FROM cap_table_investors 
            WHERE investor_name IS NOT NULL
        """)
        stats['unique_investors'] = cursor.fetchone()[0]
        
        # ═══════════════════════════════════════════════════════════════
        # ENRICHMENT & AI DATA
        # ═══════════════════════════════════════════════════════════════
        
        # Company Enrichments (Harmonic)
        cursor.execute("SELECT COUNT(*) FROM company_enrichments")
        stats['company_enrichments'] = cursor.fetchone()[0]
        
        # Person Enrichments (Harmonic)
        cursor.execute("SELECT COUNT(*) FROM person_enrichments")
        stats['person_enrichments'] = cursor.fetchone()[0]
        
        # Company Executives (table may not exist)
        stats['active_executives'] = safe_query(conn, cursor, "SELECT COUNT(*) FROM company_executives WHERE is_active = TRUE", 0)
        
        # Health Checks (table may not exist)
        stats['health_checks_performed'] = safe_query(conn, cursor, "SELECT COUNT(*) FROM company_health_check", 0)
        
        # Health Check Distribution
        health_rows = safe_query_all(conn, cursor, """
            SELECT health_score, COUNT(*) 
            FROM company_health_check 
            GROUP BY health_score
        """, [])
        health_dist = {}
        for row in health_rows:
            health_dist[row[0]] = row[1]
        stats['health_check_distribution'] = health_dist
        
        # KPI Analyses (table may not exist)
        stats['kpi_analyses'] = safe_query(conn, cursor, "SELECT COUNT(*) FROM company_kpi_analysis", 0)
        
        # Competition Analyses (table may not exist)
        stats['competition_analyses'] = safe_query(conn, cursor, "SELECT COUNT(*) FROM company_competition_analysis", 0)
        
        # ═══════════════════════════════════════════════════════════════
        # MILESTONES
        # ═══════════════════════════════════════════════════════════════
        
        # Total Milestones (table may not exist)
        stats['total_milestones'] = safe_query(conn, cursor, "SELECT COUNT(*) FROM company_milestones", 0)
        
        # Completed vs Incomplete (table may not exist)
        try:
            cursor.execute("""
                SELECT 
                    COUNT(*) FILTER (WHERE completed = TRUE) as completed,
                    COUNT(*) FILTER (WHERE completed = FALSE OR completed IS NULL) as incomplete
                FROM company_milestones
            """)
            row = cursor.fetchone()
            stats['milestones_completed'] = row[0]
            stats['milestones_incomplete'] = row[1]
        except:
            stats['milestones_completed'] = 0
            stats['milestones_incomplete'] = 0
        
        # Milestones by Priority (table may not exist)
        priority_rows = safe_query_all(conn, cursor, """
            SELECT priority, COUNT(*) 
            FROM company_milestones 
            WHERE priority IS NOT NULL
            GROUP BY priority 
            ORDER BY COUNT(*) DESC
        """, [])
        priority_dist = {}
        for row in priority_rows:
            priority_dist[row[0]] = row[1]
        stats['milestones_by_priority'] = priority_dist
        
        # Overdue Milestones (table may not exist)
        stats['overdue_milestones'] = safe_query(conn, cursor, """
            SELECT COUNT(*) 
            FROM company_milestones 
            WHERE milestone_date < CURRENT_DATE 
            AND (completed = FALSE OR completed IS NULL)
        """, 0)
        
        # ═══════════════════════════════════════════════════════════════
        # NOTES & USER CONTENT
        # ═══════════════════════════════════════════════════════════════
        
        # Company Notes (table may not exist)
        stats['company_notes'] = safe_query(conn, cursor, "SELECT COUNT(*) FROM company_notes", 0)
        
        # Manual Overrides (table may not exist)
        stats['manual_overrides'] = safe_query(conn, cursor, "SELECT COUNT(*) FROM company_manual_overrides", 0)
        
        # ═══════════════════════════════════════════════════════════════
        # ASYNC JOBS (table may not exist)
        # ═══════════════════════════════════════════════════════════════
        
        job_rows = safe_query_all(conn, cursor, """
            SELECT status, COUNT(*) 
            FROM async_analysis_jobs 
            GROUP BY status
        """, [])
        job_dist = {}
        for row in job_rows:
            job_dist[row[0]] = row[1]
        stats['async_jobs_by_status'] = job_dist
        
        # ═══════════════════════════════════════════════════════════════
        # FINANCIAL METRICS (AGGREGATED)
        # ═══════════════════════════════════════════════════════════════
        
        # Total Portfolio Valuation (from current cap tables)
        cursor.execute("""
            SELECT COALESCE(SUM(ctr.valuation), 0)
            FROM cap_table_current ctc
            JOIN cap_table_rounds ctr ON ctc.cap_table_round_id = ctr.id
        """)
        stats['total_portfolio_valuation'] = float(cursor.fetchone()[0] or 0)
        
        # Average Company Valuation
        cursor.execute("""
            SELECT COALESCE(AVG(ctr.valuation), 0)
            FROM cap_table_current ctc
            JOIN cap_table_rounds ctr ON ctc.cap_table_round_id = ctr.id
            WHERE ctr.valuation > 0
        """)
        stats['average_company_valuation'] = float(cursor.fetchone()[0] or 0)
        
        # Total Amount Raised (across all rounds)
        cursor.execute("""
            SELECT COALESCE(SUM(amount_raised), 0) FROM cap_table_rounds
        """)
        stats['total_amount_raised'] = float(cursor.fetchone()[0] or 0)
        
        # ═══════════════════════════════════════════════════════════════
        # KV-SPECIFIC METRICS
        # ═══════════════════════════════════════════════════════════════
        
        # Total KV Investment
        cursor.execute("""
            SELECT COALESCE(SUM(total_invested), 0) 
            FROM cap_table_investors 
            WHERE investor_name ~* '(^KV$|^KV |.*Seed.*|.*Opp.*|.*Excelsior.*)'
        """)
        stats['total_kv_investment'] = float(cursor.fetchone()[0] or 0)
        
        # Count of KV Fund Entries
        cursor.execute("""
            SELECT COUNT(*) 
            FROM cap_table_investors 
            WHERE investor_name ~* '(^KV$|^KV |.*Seed.*|.*Opp.*|.*Excelsior.*)'
        """)
        stats['kv_fund_entries'] = cursor.fetchone()[0]
        
        # Distinct KV Funds
        cursor.execute("""
            SELECT DISTINCT investor_name 
            FROM cap_table_investors 
            WHERE investor_name ~* '(^KV$|^KV |.*Seed.*|.*Opp.*|.*Excelsior.*)'
            ORDER BY investor_name
        """)
        stats['distinct_kv_funds'] = [row[0] for row in cursor.fetchall()]
        
        # Companies by Investment Stage
        cursor.execute("""
            WITH stage_classification AS (
                SELECT 
                    c.id,
                    CASE 
                        WHEN MAX(CASE WHEN cti.investor_name ~* '.*(Opp|Excelsior).*' THEN 3 ELSE 0 END) = 3 THEN 'Growth Stage'
                        WHEN MAX(CASE WHEN cti.investor_name ~* '^KV [IVX]+$' THEN 2 ELSE 0 END) = 2 THEN 'Main Stage'
                        WHEN MAX(CASE WHEN cti.investor_name ~* '.*Seed.*' THEN 1 ELSE 0 END) = 1 THEN 'Early Stage'
                        ELSE 'Unknown'
                    END as investment_stage
                FROM companies c
                LEFT JOIN cap_table_current ctc ON c.id = ctc.company_id
                LEFT JOIN cap_table_rounds ctr ON ctc.cap_table_round_id = ctr.id
                LEFT JOIN cap_table_investors cti ON ctr.id = cti.cap_table_round_id
                GROUP BY c.id
            )
            SELECT investment_stage, COUNT(*) 
            FROM stage_classification 
            GROUP BY investment_stage 
            ORDER BY COUNT(*) DESC
        """)
        stage_dist = {}
        for row in cursor.fetchall():
            stage_dist[row[0]] = row[1]
        stats['companies_by_stage'] = stage_dist
        
        # ═══════════════════════════════════════════════════════════════
        # REPORT ANALYSIS METRICS
        # ═══════════════════════════════════════════════════════════════
        
        # Reports with Cash Data
        cursor.execute("""
            SELECT COUNT(*) FROM financial_reports 
            WHERE cash_on_hand IS NOT NULL AND cash_on_hand > 0
        """)
        stats['reports_with_cash_data'] = cursor.fetchone()[0]
        
        # Reports with Runway Data
        cursor.execute("""
            SELECT COUNT(*) FROM financial_reports 
            WHERE runway IS NOT NULL AND runway > 0
        """)
        stats['reports_with_runway_data'] = cursor.fetchone()[0]
        
        # Reports with Milestones Extracted
        cursor.execute("""
            SELECT COUNT(*) FROM financial_reports 
            WHERE next_milestones IS NOT NULL AND next_milestones != ''
        """)
        stats['reports_with_milestones'] = cursor.fetchone()[0]
        
        # Average Reports per Company
        cursor.execute("""
            SELECT AVG(report_count) FROM (
                SELECT COUNT(*) as report_count 
                FROM financial_reports 
                GROUP BY company_id
            ) sub
        """)
        avg = cursor.fetchone()[0]
        stats['avg_reports_per_company'] = float(avg) if avg else 0
        
        # ═══════════════════════════════════════════════════════════════
        # VECTOR STORE METRICS
        # ═══════════════════════════════════════════════════════════════
        
        try:
            cursor.execute("SELECT COUNT(*) FROM langchain_pg_embedding")
            stats['vector_embeddings'] = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM langchain_pg_collection")
            stats['vector_collections'] = cursor.fetchone()[0]
        except:
            stats['vector_embeddings'] = 0
            stats['vector_collections'] = 0
        
        # ═══════════════════════════════════════════════════════════════
        # DATABASE HEALTH
        # ═══════════════════════════════════════════════════════════════
        
        # Get list of all tables
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        """)
        stats['database_tables'] = [row[0] for row in cursor.fetchall()]
        stats['total_tables'] = len(stats['database_tables'])
        
        # Total records across all main tables
        total_records = (
            stats['total_companies'] +
            stats['total_financial_reports'] +
            stats['total_cap_table_rounds'] +
            stats['total_investor_entries'] +
            stats['company_enrichments'] +
            stats['person_enrichments'] +
            stats['total_milestones'] +
            stats['company_notes'] +
            stats['health_checks_performed'] +
            stats['kpi_analyses']
        )
        stats['total_database_records'] = total_records
        
        # ═══════════════════════════════════════════════════════════════
        # TIMESTAMPS & ACTIVITY
        # ═══════════════════════════════════════════════════════════════
        
        # Most recent financial report
        cursor.execute("""
            SELECT MAX(processed_at) FROM financial_reports
        """)
        result = cursor.fetchone()[0]
        stats['last_report_processed'] = result.isoformat() if result else None
        
        # Most recent enrichment
        cursor.execute("""
            SELECT MAX(enriched_at) FROM company_enrichments
        """)
        result = cursor.fetchone()[0]
        stats['last_enrichment'] = result.isoformat() if result else None
        
        # Most recent milestone created
        cursor.execute("""
            SELECT MAX(created_at) FROM company_milestones
        """)
        result = cursor.fetchone()[0]
        stats['last_milestone_created'] = result.isoformat() if result else None
        
        # ═══════════════════════════════════════════════════════════════
        # DATA EXTRACTION QUALITY & COMPLETENESS
        # ═══════════════════════════════════════════════════════════════
        
        # Reports with complete financial data (all key fields)
        cursor.execute("""
            SELECT COUNT(*) FROM financial_reports
            WHERE cash_on_hand IS NOT NULL 
            AND monthly_burn_rate IS NOT NULL 
            AND runway IS NOT NULL
            AND cash_out_date IS NOT NULL
        """)
        stats['reports_fully_extracted'] = cursor.fetchone()[0]
        
        # Calculate extraction success rate
        if stats['total_financial_reports'] > 0:
            stats['extraction_success_rate'] = round(
                (stats['reports_fully_extracted'] / stats['total_financial_reports']) * 100, 1
            )
        else:
            stats['extraction_success_rate'] = 0
        
        # Total text content extracted (proxy for data richness)
        cursor.execute("""
            SELECT 
                COALESCE(SUM(LENGTH(financial_summary)), 0) +
                COALESCE(SUM(LENGTH(key_risks)), 0) +
                COALESCE(SUM(LENGTH(sector_highlight_a)), 0) +
                COALESCE(SUM(LENGTH(sector_highlight_b)), 0) +
                COALESCE(SUM(LENGTH(personnel_updates)), 0) +
                COALESCE(SUM(LENGTH(next_milestones)), 0) +
                COALESCE(SUM(LENGTH(budget_vs_actual)), 0)
            FROM financial_reports
        """)
        stats['total_text_extracted_chars'] = cursor.fetchone()[0] or 0
        stats['total_text_extracted_words'] = stats['total_text_extracted_chars'] // 5  # Rough estimate
        
        # Reports with evidence citations (PDF page references)
        cursor.execute("""
            SELECT COUNT(*) FROM financial_reports 
            WHERE evidence IS NOT NULL AND evidence != 'null'
        """)
        stats['reports_with_citations'] = cursor.fetchone()[0]
        
        # Average fields populated per report (data density)
        cursor.execute("""
            SELECT AVG(
                CASE WHEN cash_on_hand IS NOT NULL THEN 1 ELSE 0 END +
                CASE WHEN monthly_burn_rate IS NOT NULL THEN 1 ELSE 0 END +
                CASE WHEN runway IS NOT NULL THEN 1 ELSE 0 END +
                CASE WHEN cash_out_date IS NOT NULL THEN 1 ELSE 0 END +
                CASE WHEN financial_summary IS NOT NULL AND financial_summary != '' THEN 1 ELSE 0 END +
                CASE WHEN key_risks IS NOT NULL AND key_risks != '' THEN 1 ELSE 0 END +
                CASE WHEN sector_highlight_a IS NOT NULL AND sector_highlight_a != '' THEN 1 ELSE 0 END +
                CASE WHEN next_milestones IS NOT NULL AND next_milestones != '' THEN 1 ELSE 0 END +
                CASE WHEN personnel_updates IS NOT NULL AND personnel_updates != '' THEN 1 ELSE 0 END +
                CASE WHEN budget_vs_actual IS NOT NULL AND budget_vs_actual != '' THEN 1 ELSE 0 END
            )
            FROM financial_reports
        """)
        avg = cursor.fetchone()[0]
        stats['avg_fields_per_report'] = round(float(avg), 1) if avg else 0
        stats['data_density_percent'] = round((stats['avg_fields_per_report'] / 10) * 100, 1)  # 10 possible fields
        
        # ═══════════════════════════════════════════════════════════════
        # RELATIONSHIP COMPLEXITY & DATA MODEL DEPTH
        # ═══════════════════════════════════════════════════════════════
        
        # Average investors per company (cap table complexity)
        cursor.execute("""
            SELECT AVG(investor_count) FROM (
                SELECT ctr.company_id, COUNT(DISTINCT cti.id) as investor_count
                FROM cap_table_rounds ctr
                JOIN cap_table_investors cti ON ctr.id = cti.cap_table_round_id
                GROUP BY ctr.company_id
            ) sub
        """)
        avg = cursor.fetchone()[0]
        stats['avg_investors_per_company'] = round(float(avg), 1) if avg else 0
        
        # Companies with multiple funding rounds tracked
        cursor.execute("""
            SELECT COUNT(*) FROM (
                SELECT company_id FROM cap_table_rounds
                GROUP BY company_id
                HAVING COUNT(*) > 1
            ) sub
        """)
        stats['companies_with_multiple_rounds'] = cursor.fetchone()[0]
        
        # Cross-company investor overlap (how many investors appear in 2+ companies)
        cursor.execute("""
            SELECT COUNT(*) FROM (
                SELECT LOWER(TRIM(investor_name)) as inv_name
                FROM cap_table_investors cti
                JOIN cap_table_rounds ctr ON cti.cap_table_round_id = ctr.id
                WHERE investor_name IS NOT NULL
                GROUP BY LOWER(TRIM(investor_name))
                HAVING COUNT(DISTINCT ctr.company_id) > 1
            ) sub
        """)
        stats['investors_in_multiple_companies'] = cursor.fetchone()[0]
        
        # ═══════════════════════════════════════════════════════════════
        # ENRICHMENT DEPTH (Harmonic API Integration)
        # ═══════════════════════════════════════════════════════════════
        
        # Enrichment coverage rate
        if stats['total_companies'] > 0:
            stats['enrichment_coverage_percent'] = round(
                (stats['company_enrichments'] / stats['total_companies']) * 100, 1
            )
        else:
            stats['enrichment_coverage_percent'] = 0
        
        # Average executives per enriched company (table may not exist)
        avg = safe_query(conn, cursor, """
            SELECT AVG(exec_count) FROM (
                SELECT company_id, COUNT(*) as exec_count
                FROM company_executives
                WHERE is_active = TRUE
                GROUP BY company_id
            ) sub
        """, None)
        stats['avg_executives_per_company'] = round(float(avg), 1) if avg else 0
        
        # Companies with CEO identified (table may not exist)
        stats['companies_with_ceo_identified'] = safe_query(conn, cursor, """
            SELECT COUNT(DISTINCT company_id) FROM company_executives WHERE is_ceo = TRUE
        """, 0)
        
        # ═══════════════════════════════════════════════════════════════
        # USER ENGAGEMENT & MANUAL CURATION
        # ═══════════════════════════════════════════════════════════════
        
        # Manual edits to financial reports (shows data curation, column may not exist)
        stats['manually_edited_reports'] = safe_query(conn, cursor, """
            SELECT COUNT(*) FROM financial_reports WHERE manually_edited = TRUE
        """, 0)
        
        # Manual edits to companies (column may not exist)
        stats['manually_edited_companies'] = safe_query(conn, cursor, """
            SELECT COUNT(*) FROM companies WHERE manually_edited = TRUE
        """, 0)
        
        # Average notes per company (where notes exist, table may not exist)
        avg = safe_query(conn, cursor, """
            SELECT AVG(note_count) FROM (
                SELECT company_id, COUNT(*) as note_count
                FROM company_notes
                GROUP BY company_id
            ) sub
        """, None)
        stats['avg_notes_per_company'] = round(float(avg), 1) if avg else 0
        
        # ═══════════════════════════════════════════════════════════════
        # BUSINESS INTELLIGENCE GENERATED
        # ═══════════════════════════════════════════════════════════════
        
        # Auto-extracted milestones (from PDF analysis, not manual, table may not exist)
        stats['auto_extracted_milestones'] = safe_query(conn, cursor, """
            SELECT COUNT(*) FROM company_milestones 
            WHERE financial_report_id IS NOT NULL
        """, 0)
        
        # Manual milestones (user-created)
        stats['manual_milestones'] = stats['total_milestones'] - stats['auto_extracted_milestones']
        
        # Companies with health assessment (table may not exist)
        stats['companies_with_health_check'] = safe_query(conn, cursor, """
            SELECT COUNT(DISTINCT company_id) FROM company_health_check
        """, 0)
        
        # ═══════════════════════════════════════════════════════════════
        # RUNWAY & RISK ANALYSIS (Business-Critical Metrics)
        # ═══════════════════════════════════════════════════════════════
        
        # Companies with <12 months runway (latest report)
        cursor.execute("""
            WITH latest_runway AS (
                SELECT DISTINCT ON (company_id) company_id, runway
                FROM financial_reports
                WHERE runway IS NOT NULL
                ORDER BY company_id, report_date DESC, processed_at DESC
            )
            SELECT COUNT(*) FROM latest_runway WHERE runway < 12
        """)
        stats['companies_low_runway'] = cursor.fetchone()[0]
        
        # Average runway across portfolio
        cursor.execute("""
            WITH latest_runway AS (
                SELECT DISTINCT ON (company_id) company_id, runway
                FROM financial_reports
                WHERE runway IS NOT NULL AND runway > 0
                ORDER BY company_id, report_date DESC, processed_at DESC
            )
            SELECT AVG(runway) FROM latest_runway
        """)
        avg = cursor.fetchone()[0]
        stats['avg_portfolio_runway_months'] = round(float(avg), 1) if avg else 0
        
        # Total cash across portfolio (latest reports)
        cursor.execute("""
            WITH latest_cash AS (
                SELECT DISTINCT ON (company_id) company_id, cash_on_hand
                FROM financial_reports
                WHERE cash_on_hand IS NOT NULL AND cash_on_hand > 0
                ORDER BY company_id, report_date DESC, processed_at DESC
            )
            SELECT SUM(cash_on_hand) FROM latest_cash
        """)
        total_cash = cursor.fetchone()[0]
        stats['total_portfolio_cash'] = float(total_cash) if total_cash else 0
        
        # Total monthly burn across portfolio
        cursor.execute("""
            WITH latest_burn AS (
                SELECT DISTINCT ON (company_id) company_id, monthly_burn_rate
                FROM financial_reports
                WHERE monthly_burn_rate IS NOT NULL AND monthly_burn_rate > 0
                ORDER BY company_id, report_date DESC, processed_at DESC
            )
            SELECT SUM(monthly_burn_rate) FROM latest_burn
        """)
        total_burn = cursor.fetchone()[0]
        stats['total_portfolio_monthly_burn'] = float(total_burn) if total_burn else 0
        
        # ═══════════════════════════════════════════════════════════════
        # DATA FRESHNESS & COVERAGE
        # ═══════════════════════════════════════════════════════════════
        
        # Companies with reports in last 90 days
        cursor.execute("""
            SELECT COUNT(DISTINCT company_id) FROM financial_reports
            WHERE report_date > CURRENT_DATE - INTERVAL '90 days'
        """)
        stats['companies_reported_last_90_days'] = cursor.fetchone()[0]
        
        # Companies with cap table data
        cursor.execute("""
            SELECT COUNT(DISTINCT company_id) FROM cap_table_current
        """)
        stats['companies_with_cap_table'] = cursor.fetchone()[0]
        
        # Cap table coverage rate
        if stats['total_companies'] > 0:
            stats['cap_table_coverage_percent'] = round(
                (stats['companies_with_cap_table'] / stats['total_companies']) * 100, 1
            )
        else:
            stats['cap_table_coverage_percent'] = 0
        
        cursor.close()
        conn.close()
        
        # ═══════════════════════════════════════════════════════════════
        # FORMAT SUMMARY - Organized for Vinod Presentation
        # ═══════════════════════════════════════════════════════════════
        
        stats['_summary'] = {
            # SCALE
            'portfolio_size': f"{stats['total_companies']} portfolio companies",
            'total_valuation': f"${stats['total_portfolio_valuation']:,.0f}",
            'kv_investment': f"${stats['total_kv_investment']:,.0f}",
            'total_raised': f"${stats['total_amount_raised']:,.0f}",
            
            # DATA EXTRACTION & AI
            'board_decks_analyzed': f"{stats['total_financial_reports']} board decks processed",
            'extraction_quality': f"{stats['extraction_success_rate']}% full extraction rate ({stats['reports_fully_extracted']}/{stats['total_financial_reports']})",
            'text_extracted': f"~{stats['total_text_extracted_words']:,} words of structured intelligence",
            'data_density': f"{stats['data_density_percent']}% field completion rate",
            
            # RELATIONSHIP GRAPH
            'investors_tracked': f"{stats['unique_investors']} unique investors across {stats['total_investor_entries']} positions",
            'avg_investors_per_co': f"{stats['avg_investors_per_company']} investors per company average",
            'cross_portfolio_investors': f"{stats['investors_in_multiple_companies']} investors appear in 2+ companies",
            
            # ENRICHMENT
            'companies_enriched': f"{stats['company_enrichments']}/{stats['total_companies']} companies ({stats['enrichment_coverage_percent']}%)",
            'people_enriched': f"{stats['person_enrichments']} executives profiled",
            'ceos_identified': f"{stats['companies_with_ceo_identified']} CEOs identified",
            
            # MILESTONE INTELLIGENCE
            'milestones_tracked': f"{stats['total_milestones']} milestones ({stats['auto_extracted_milestones']} AI-extracted, {stats['manual_milestones']} manual)",
            'milestone_status': f"{stats['milestones_completed']} completed, {stats['overdue_milestones']} overdue",
            
            # RISK MONITORING
            'low_runway_alert': f"{stats['companies_low_runway']} companies with <12mo runway",
            'avg_runway': f"{stats['avg_portfolio_runway_months']} months average runway",
            'portfolio_cash': f"${stats['total_portfolio_cash']:,.0f} total cash tracked",
            'portfolio_burn': f"${stats['total_portfolio_monthly_burn']:,.0f}/mo aggregate burn",
            
            # AI ANALYSES
            'health_checks': f"{stats['health_checks_performed']} health assessments",
            'kpi_analyses': f"{stats['kpi_analyses']} custom KPI analyses",
            
            # COVERAGE
            'cap_table_coverage': f"{stats['cap_table_coverage_percent']}% have cap table data",
            'recent_reports': f"{stats['companies_reported_last_90_days']} companies reported in last 90 days",
            
            # DATABASE
            'total_records': f"{stats['total_database_records']:,} records",
            'tables': f"{stats['total_tables']} tables",
            'kv_funds_tracked': stats['distinct_kv_funds']
        }
        
        # Add headline metrics for slides
        stats['_headlines'] = {
            'portfolio_aum': f"${stats['total_portfolio_valuation']/1e9:.1f}B+ portfolio tracked",
            'data_processed': f"{stats['total_financial_reports']} board decks → {stats['total_text_extracted_words']:,} words extracted",
            'ai_extractions': f"{stats['extraction_success_rate']}% automated extraction accuracy",
            'investor_graph': f"{stats['unique_investors']} investors, {stats['investors_in_multiple_companies']} cross-portfolio connections",
            'enrichment': f"{stats['person_enrichments']} executives enriched via Harmonic API",
            'milestones': f"{stats['auto_extracted_milestones']} milestones auto-extracted from PDFs",
            'real_time_risk': f"{stats['companies_low_runway']} low-runway alerts active"
        }
        
        return {
            "statusCode": 200,
            "headers": headers,
            "body": json.dumps({
                "status": "success",
                "action": "get_platform_stats",
                "stats": stats
            })
        }
        
    except Exception as e:
        if conn:
            conn.close()
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps({
                "status": "failed",
                "error": f"Failed to get platform stats: {str(e)}"
            })
        }


# Local test runner
if __name__ == "__main__":
    print(json.dumps(lambda_handler({}, {}), indent=2))
