"""
Voice Query Lambda - Natural Language to SQL using Vanna.AI
MVP Version - Handles natural language queries about portfolio companies
"""

import json
import os
import ssl
from urllib.parse import quote_plus

import pg8000
from langchain_openai import OpenAIEmbeddings
from vanna.pgvector import PG_VectorStore
from vanna.openai import OpenAI_Chat

CA_BUNDLE_PATH = os.path.join(os.path.dirname(__file__), "rds-combined-ca-bundle.pem")

# ────────────────────────────────────────────────────────────
# Configuration
# ────────────────────────────────────────────────────────────

def get_db_config():
    """Get database configuration from environment variables"""
    return {
        "host": os.environ.get("DB_HOST"),
        "port": int(os.environ.get("DB_PORT", 5432)),
        "database": os.environ.get("DB_NAME"),
        "user": os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD")
    }

class PostgresVanna(PG_VectorStore, OpenAI_Chat):
    """Vanna stack backed by Postgres/pgvector for embeddings plus OpenAI for SQL generation."""

    def __init__(
        self,
        *,
        connection_string: str,
        openai_api_key: str,
        openai_model: str,
        embedding_model: str,
        n_results: int,
    ):
        embeddings = OpenAIEmbeddings(model=embedding_model, api_key=openai_api_key)
        vector_config = {
            "connection_string": connection_string,
            "embedding_function": embeddings,
            "n_results": n_results,
        }
        PG_VectorStore.__init__(self, config=vector_config)

        OpenAI_Chat.__init__(
            self,
            config={
                "api_key": openai_api_key,
                "model": openai_model,
            },
        )


_local_vanna = None


def get_vanna_client():
    """Initialize (or reuse) the local Vanna instance with Postgres vector storage."""
    global _local_vanna
    if _local_vanna:
        return _local_vanna

    openai_api_key = os.environ.get("OPENAI_API_KEY")
    if not openai_api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set")

    openai_model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    db_config = get_db_config()
    password = quote_plus(db_config["password"] or "")
    connection_string = os.environ.get("PGVECTOR_CONNECTION_STRING")
    if not connection_string:
        connection_string = (
            f"postgresql+psycopg://{db_config['user']}:{password}"
            f"@{db_config['host']}:{db_config['port']}/{db_config['database']}"
        )

    embedding_model = os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
    n_results = int(os.environ.get("VANNA_N_RESULTS", "8"))

    vn = PostgresVanna(
        connection_string=connection_string,
        openai_api_key=openai_api_key,
        openai_model=openai_model,
        embedding_model=embedding_model,
        n_results=n_results,
    )
    vn.connect_to_postgres(
        host=db_config["host"],
        dbname=db_config["database"],
        user=db_config["user"],
        password=db_config["password"],
        port=db_config["port"],
    )

    _local_vanna = vn
    return vn

# ────────────────────────────────────────────────────────────
# Training Functions (Run once to teach Vanna your schema)
# ────────────────────────────────────────────────────────────

def train_vanna_on_schema(vn):
    """
    Train Vanna on your database schema
    This only needs to be run ONCE (or when schema changes)
    """
    
    print("🎓 Training Vanna on database schema...")

    # 1. Use automatic training plan from information_schema
    try:
        schema_df = vn.run_sql("""
            SELECT table_schema, table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name, ordinal_position
        """)
        plan = vn.get_training_plan_generic(schema_df)
        if plan:
            print("🧠 Training plan summary:")
            for line in plan.get_summary()[:15]:
                print(f"   • {line}")
            vn.train(plan=plan)
            print("✅ Automatic schema training plan applied")
    except Exception as plan_error:
        print(f"⚠️ Failed to apply automatic training plan: {plan_error}")
    
    # Core tables DDL - Vanna learns relationships from this
    ddl_statements = [
        # Companies table
        """
        CREATE TABLE companies (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            normalized_name VARCHAR(255) UNIQUE NOT NULL,
            sector VARCHAR(20) CHECK (sector IN ('healthcare','consumer','enterprise','manufacturing')),
            manually_edited BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # Financial reports table
        """
        CREATE TABLE financial_reports (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            file_name VARCHAR(500) NOT NULL,
            report_date DATE,
            report_period VARCHAR(50),
            sector VARCHAR(20),
            cash_on_hand NUMERIC(15,2),
            monthly_burn_rate NUMERIC(15,2),
            cash_out_date TEXT,
            runway INTEGER,
            budget_vs_actual TEXT,
            financial_summary TEXT,
            sector_highlight_a TEXT,
            sector_highlight_b TEXT,
            key_risks TEXT,
            personnel_updates TEXT,
            next_milestones TEXT,
            upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # Cap table rounds
        """
        CREATE TABLE cap_table_rounds (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            round_name VARCHAR(100),
            valuation NUMERIC(15,2),
            amount_raised NUMERIC(15,2),
            round_date DATE,
            total_pool_size NUMERIC(10,4),
            pool_available NUMERIC(10,4),
            pool_utilization NUMERIC(10,4),
            options_outstanding NUMERIC(15,2),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # Cap table investors
        """
        CREATE TABLE cap_table_investors (
            id SERIAL PRIMARY KEY,
            round_id INTEGER NOT NULL REFERENCES cap_table_rounds(id) ON DELETE CASCADE,
            investor_name VARCHAR(255),
            total_invested NUMERIC(15,2),
            final_fds NUMERIC(10,4),
            final_round_investment NUMERIC(15,2),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # Company milestones
        """
        CREATE TABLE company_milestones (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            financial_report_id INTEGER REFERENCES financial_reports(id),
            milestone_date DATE NOT NULL,
            description TEXT NOT NULL,
            priority VARCHAR(10) CHECK (priority IN ('critical', 'high', 'medium', 'low')),
            completed BOOLEAN DEFAULT FALSE,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # Company health check
        """
        CREATE TABLE company_health_check (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            health_score VARCHAR(10) NOT NULL CHECK (health_score IN ('GREEN', 'YELLOW', 'RED')),
            justification TEXT NOT NULL,
            criticality_level INTEGER CHECK (criticality_level >= 1 AND criticality_level <= 10),
            manual_override BOOLEAN DEFAULT FALSE,
            analysis_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # Company executives
        """
        CREATE TABLE company_executives (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            full_name VARCHAR(255),
            title VARCHAR(255),
            linkedin_url VARCHAR(500),
            is_ceo BOOLEAN DEFAULT FALSE,
            is_active BOOLEAN DEFAULT TRUE,
            display_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """,
        
        # Company notes
        """
        CREATE TABLE company_notes (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            subject VARCHAR(255) NOT NULL,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
    ]
    
    # Train on DDL
    for ddl in ddl_statements:
        vn.train(ddl=ddl)
    
    print("✅ Schema training complete")
    
    # Train on common query patterns - these teach Vanna what users want
    example_queries = [
        # Portfolio overview queries
        {
            "question": "How many companies do we have in the portfolio?",
            "sql": "SELECT COUNT(*) as total_companies FROM companies;"
        },
        {
            "question": "Show me all companies by sector",
            "sql": "SELECT sector, COUNT(*) as count FROM companies GROUP BY sector ORDER BY count DESC;"
        },
        
        # Financial queries
        {
            "question": "Which companies have less than 6 months runway?",
            "sql": """
                SELECT c.name, fr.runway, fr.cash_on_hand, fr.monthly_burn_rate
                FROM companies c
                JOIN financial_reports fr ON fr.company_id = c.id
                WHERE fr.id = (
                    SELECT id FROM financial_reports 
                    WHERE company_id = c.id 
                    ORDER BY report_date DESC LIMIT 1
                )
                AND fr.runway < 6
                ORDER BY fr.runway ASC;
            """
        },
        {
            "question": "What's the total cash on hand across all companies?",
            "sql": """
                SELECT SUM(fr.cash_on_hand) as total_cash
                FROM companies c
                JOIN financial_reports fr ON fr.company_id = c.id
                WHERE fr.id = (
                    SELECT id FROM financial_reports 
                    WHERE company_id = c.id 
                    ORDER BY report_date DESC LIMIT 1
                );
            """
        },
        {
            "question": "Show me companies with their latest financial data",
            "sql": """
                SELECT 
                    c.name,
                    c.sector,
                    fr.cash_on_hand,
                    fr.monthly_burn_rate,
                    fr.runway,
                    fr.report_date
                FROM companies c
                LEFT JOIN LATERAL (
                    SELECT * FROM financial_reports
                    WHERE company_id = c.id
                    ORDER BY report_date DESC
                    LIMIT 1
                ) fr ON true
                ORDER BY c.name;
            """
        },
        
        # Health check queries
        {
            "question": "Which companies have red health scores?",
            "sql": """
                SELECT c.name, hc.health_score, hc.justification
                FROM companies c
                JOIN company_health_check hc ON hc.company_id = c.id
                WHERE hc.id = (
                    SELECT id FROM company_health_check
                    WHERE company_id = c.id
                    ORDER BY created_at DESC LIMIT 1
                )
                AND hc.health_score = 'RED'
                ORDER BY hc.created_at DESC;
            """
        },
        
        # Milestone queries
        {
            "question": "Show me all overdue milestones",
            "sql": """
                SELECT 
                    c.name as company_name,
                    m.description,
                    m.milestone_date,
                    m.priority
                FROM company_milestones m
                JOIN companies c ON m.company_id = c.id
                WHERE m.completed = FALSE
                AND m.milestone_date < CURRENT_DATE
                ORDER BY m.priority DESC, m.milestone_date ASC;
            """
        },
        {
            "question": "What are the critical milestones due this month?",
            "sql": """
                SELECT 
                    c.name as company_name,
                    m.description,
                    m.milestone_date
                FROM company_milestones m
                JOIN companies c ON m.company_id = c.id
                WHERE m.priority = 'critical'
                AND m.completed = FALSE
                AND m.milestone_date >= DATE_TRUNC('month', CURRENT_DATE)
                AND m.milestone_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
                ORDER BY m.milestone_date ASC;
            """
        },
        
        # Cap table / ownership queries
        {
            "question": "What's our KV ownership across all companies?",
            "sql": """
                SELECT 
                    c.name as company_name,
                    SUM(ci.final_fds) as kv_ownership_percentage
                FROM companies c
                JOIN cap_table_rounds cr ON cr.company_id = c.id
                JOIN cap_table_investors ci ON ci.round_id = cr.id
                WHERE ci.investor_name LIKE 'KV%'
                GROUP BY c.id, c.name
                ORDER BY kv_ownership_percentage DESC;
            """
        },
        
        # Executive queries
        {
            "question": "Who are the CEOs of our portfolio companies?",
            "sql": """
                SELECT 
                    c.name as company_name,
                    ce.full_name as ceo_name,
                    ce.linkedin_url
                FROM companies c
                JOIN company_executives ce ON ce.company_id = c.id
                WHERE ce.is_ceo = TRUE
                AND ce.is_active = TRUE
                ORDER BY c.name;
            """
        },
        
        # Combined/complex queries
        {
            "question": "Show me healthcare companies with low runway and their health scores",
            "sql": """
                SELECT 
                    c.name,
                    fr.runway,
                    fr.cash_on_hand,
                    hc.health_score,
                    hc.justification
                FROM companies c
                JOIN financial_reports fr ON fr.company_id = c.id
                LEFT JOIN company_health_check hc ON hc.company_id = c.id
                WHERE c.sector = 'healthcare'
                AND fr.id = (
                    SELECT id FROM financial_reports 
                    WHERE company_id = c.id 
                    ORDER BY report_date DESC LIMIT 1
                )
                AND hc.id = (
                    SELECT id FROM company_health_check
                    WHERE company_id = c.id
                    ORDER BY created_at DESC LIMIT 1
                )
                AND fr.runway < 9
                ORDER BY fr.runway ASC;
            """
        }
    ]
    
    # Train on example queries
    print("🎓 Training Vanna on example queries...")
    for example in example_queries:
        vn.train(
            question=example["question"],
            sql=example["sql"]
        )
    
    print("✅ Query pattern training complete")
    print(f"🎉 Vanna is trained on {len(ddl_statements)} tables and {len(example_queries)} query patterns")
    
    return {
        "success": True,
        "tables_trained": len(ddl_statements),
        "queries_trained": len(example_queries)
    }

# ────────────────────────────────────────────────────────────
# Query Functions
# ────────────────────────────────────────────────────────────

def generate_sql_from_question(vn, question: str):
    """
    Convert natural language question to SQL
    """
    try:
        print(f"🤔 Generating SQL for: {question}")
        
        # Vanna generates SQL from the question
        sql = vn.generate_sql(question)
        
        print(f"✅ Generated SQL: {sql}")
        
        return {
            "success": True,
            "sql": sql,
            "question": question
        }
    
    except Exception as e:
        print(f"❌ Error generating SQL: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "question": question
        }

def execute_query_safely(sql: str):
    """
    Execute SQL query with safety checks
    Uses pg8000 directly instead of Vanna to avoid pandas dependency
    """
    try:
        # Safety check - only allow SELECT queries
        sql_upper = sql.strip().upper()
        if not sql_upper.startswith("SELECT"):
            return {
                "success": False,
                "error": "Only SELECT queries are allowed for security"
            }
        
        # Check for dangerous keywords
        dangerous_keywords = ["DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "TRUNCATE", "CREATE"]
        for keyword in dangerous_keywords:
            if keyword in sql_upper:
                return {
                    "success": False,
                    "error": f"Query contains forbidden keyword: {keyword}"
                }
        
        print(f"🔍 Executing SQL: {sql}")
        
        # Execute query using pg8000 directly
        db_config = get_db_config()
        ca_bundle = os.environ.get("RDS_CA_PATH", CA_BUNDLE_PATH)
        ssl_context = None
        if ca_bundle and os.path.exists(ca_bundle):
            ssl_context = ssl.create_default_context(cafile=ca_bundle)
        else:
            ssl_context = ssl.create_default_context()

        conn = pg8000.connect(
            host=db_config["host"],
            port=db_config["port"],
            database=db_config["database"],
            user=db_config["user"],
            password=db_config["password"],
            ssl_context=ssl_context
        )
        
        cursor = conn.cursor()
        cursor.execute(sql)
        
        # Get column names
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
        
        # Fetch results
        rows = cursor.fetchall()
        
        # Convert to list of dicts
        results = [dict(zip(columns, row)) for row in rows]
        
        cursor.close()
        conn.close()
        
        print(f"✅ Query returned {len(results)} rows")
        
        return {
            "success": True,
            "data": results,
            "row_count": len(results)
        }
    
    except Exception as e:
        print(f"❌ Error executing query: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }

def format_response_for_voice(question: str, data: list, sql: str):
    """
    Format query results into natural language for voice response
    Uses Claude to generate conversational response
    """
    import anthropic
    
    try:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        
        # Create a natural language summary of the data
        prompt = f"""You are a helpful portfolio management assistant. 

The user asked: "{question}"

The database query returned this data:
{json.dumps(data, indent=2, default=str)}

Create a concise, natural language response that:
1. Directly answers the user's question
2. Highlights the most important findings
3. Is suitable for voice output (conversational, not too long)
4. Uses specific numbers and names from the data
5. If there are many results, summarize patterns rather than listing everything

Keep your response under 100 words for voice clarity."""

        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=500,
            messages=[{
                "role": "user",
                "content": prompt
            }]
        )
        
        natural_response = response.content[0].text
        
        return {
            "success": True,
            "natural_language_response": natural_response,
            "raw_data": data,
            "sql_query": sql
        }
    
    except Exception as e:
        # Fallback: simple formatting if Claude fails
        print(f"⚠️ Claude formatting failed, using simple fallback: {str(e)}")
        
        if len(data) == 0:
            simple_response = f"No results found for: {question}"
        elif len(data) == 1:
            simple_response = f"Found 1 result: {json.dumps(data[0])}"
        else:
            simple_response = f"Found {len(data)} results. First result: {json.dumps(data[0])}"
        
        return {
            "success": True,
            "natural_language_response": simple_response,
            "raw_data": data,
            "sql_query": sql
        }

# ────────────────────────────────────────────────────────────
# Lambda Handler
# ────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    """
    Main Lambda handler for voice queries
    
    Supported actions:
    - train_schema: Train Vanna on database schema (run once)
    - query: Convert natural language to SQL and execute
    """
    
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
    
    # Handle OPTIONS for CORS
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": headers, "body": json.dumps({"message": "CORS OK"})}
    
    try:
        # Parse request body
        body = {}
        if event.get("body"):
            body = json.loads(event["body"])
        
        action = body.get("action") or event.get("action")
        
        if not action:
            return {
                "statusCode": 400,
                "headers": headers,
                "body": json.dumps({"error": "action is required (train_schema or query)"})
            }
        
        # Initialize Vanna
        vn = get_vanna_client()
        
        # ── Training action ──
        if action == "train_schema":
            result = train_vanna_on_schema(vn)
            return {
                "statusCode": 200,
                "headers": headers,
                "body": json.dumps({
                    "status": "success",
                    "action": "train_schema",
                    "data": result
                })
            }
        
        # ── Query action ──
        elif action == "query":
            question = body.get("question")
            
            if not question:
                return {
                    "statusCode": 400,
                    "headers": headers,
                    "body": json.dumps({"error": "question is required for query action"})
                }
            
            # Step 1: Generate SQL from question
            sql_result = generate_sql_from_question(vn, question)
            
            if not sql_result["success"]:
                return {
                    "statusCode": 500,
                    "headers": headers,
                    "body": json.dumps({
                        "status": "failed",
                        "error": sql_result.get("error"),
                        "step": "sql_generation"
                    })
                }
            
            sql = sql_result["sql"]
            
            # Step 2: Execute SQL safely (without using Vanna's run_sql to avoid pandas)
            query_result = execute_query_safely(sql)
            
            if not query_result["success"]:
                return {
                    "statusCode": 500,
                    "headers": headers,
                    "body": json.dumps({
                        "status": "failed",
                        "error": query_result.get("error"),
                        "sql": sql,
                        "step": "query_execution"
                    })
                }
            
            # Step 3: Format response for voice
            formatted = format_response_for_voice(
                question=question,
                data=query_result["data"],
                sql=sql
            )
            
            return {
                "statusCode": 200,
                "headers": headers,
                "body": json.dumps({
                    "status": "success",
                    "action": "query",
                    "question": question,
                    "response": formatted["natural_language_response"],
                    "data": formatted["raw_data"],
                    "sql_executed": sql,
                    "row_count": len(formatted["raw_data"])
                })
            }
        
        else:
            return {
                "statusCode": 400,
                "headers": headers,
                "body": json.dumps({"error": f"Unknown action: {action}"})
            }
    
    except Exception as e:
        print(f"💥 Lambda error: {str(e)}")
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps({
                "status": "failed",
                "error": str(e)
            })
        }


# Local testing
if __name__ == "__main__":
    # Test training
    test_event = {"action": "train_schema"}
    result = lambda_handler(test_event, None)
    print(json.dumps(json.loads(result["body"]), indent=2))
    
    # Test query
    test_event = {
        "action": "query",
        "question": "How many companies do we have?"
    }
    result = lambda_handler(test_event, None)
    print(json.dumps(json.loads(result["body"]), indent=2))

