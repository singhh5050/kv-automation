import json
import os
import pg8000
import ssl

def lambda_handler(event, context):
    """
    Lambda function to create database schema using pg8000 with SSL
    """
    
    # Database configuration
    db_config = {
        'host': os.environ.get('DB_HOST', 'database-1.cgr2i0s2iki4.us-east-1.rds.amazonaws.com'),
        'port': int(os.environ.get('DB_PORT', 5432)),
        'database': os.environ.get('DB_NAME', 'postgres'),
        'user': os.environ.get('DB_USER', 'postgres'),
        'password': os.environ.get('DB_PASSWORD', 'frontbackandbesideit')
    }
    
    try:
        # Create SSL context for secure connection
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE  # For testing; use proper certs in production
        
        # Connect to PostgreSQL using pg8000 with SSL
        conn = pg8000.connect(
            host=db_config['host'],
            port=db_config['port'],
            database=db_config['database'],
            user=db_config['user'],
            password=db_config['password'],
            ssl_context=ssl_context,
            timeout=30
        )
        
        # Test the connection
        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()
        print(f"Connected to PostgreSQL: {version[0]}")
        
        # Create schema if it doesn't exist
        schema_result = create_database_schema(conn)
        
        cursor.close()
        conn.close()
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            'body': json.dumps({
                'status': 'success',
                'message': f'Connected successfully to {db_config["host"]}',
                'schema_created': schema_result['success'],
                'details': schema_result
            })
        }
        
    except Exception as e:
        error_message = str(e)
        print(f"Database connection failed: {error_message}")
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            'body': json.dumps({
                'status': 'failed',
                'message': f'Failed to connect: {error_message}',
                'schema_created': False
            })
        }

def create_database_schema(conn):
    """
    Create the database schema for financial data
    Creates companies and financial_reports tables to match CRUD expectations
    """
    try:
        cursor = conn.cursor()
        
        # Create the companies table first
        create_companies_table = """
        CREATE TABLE IF NOT EXISTS companies (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            normalized_name VARCHAR(255) UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        
        cursor.execute(create_companies_table)
        print("Created companies table")
        
        # Create the financial_reports table
        create_financial_reports_table = """
        CREATE TABLE IF NOT EXISTS financial_reports (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            file_name VARCHAR(500) NOT NULL,
            report_date DATE,
            report_period VARCHAR(50),
            cash_on_hand TEXT,
            monthly_burn_rate TEXT,
            cash_out_date TEXT,
            runway TEXT,
            budget_vs_actual TEXT,
            financial_summary TEXT,
            clinical_progress TEXT,
            research_development TEXT,
            upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            processing_status VARCHAR(50) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """
        
        cursor.execute(create_financial_reports_table)
        print("Created financial_reports table")
        
        # Create indexes for better query performance
        create_company_index = """
        CREATE INDEX IF NOT EXISTS idx_companies_normalized_name 
        ON companies(normalized_name);
        """
        
        cursor.execute(create_company_index)
        print("Created companies index")
        
        create_reports_index = """
        CREATE INDEX IF NOT EXISTS idx_financial_reports_company_date 
        ON financial_reports(company_id, report_date DESC);
        """
        
        cursor.execute(create_reports_index)
        print("Created financial_reports index")
        
        # Create a compound index for faster lookups
        create_compound_index = """
        CREATE INDEX IF NOT EXISTS idx_financial_reports_company_period 
        ON financial_reports(company_id, report_period, report_date DESC);
        """
        
        cursor.execute(create_compound_index)
        print("Created compound index")
        
        # Commit the changes
        conn.commit()
        cursor.close()
        
        return {
            'success': True,
            'message': 'Schema created successfully',
            'tables_created': ['companies', 'financial_reports'],
            'indexes_created': [
                'idx_companies_normalized_name',
                'idx_financial_reports_company_date', 
                'idx_financial_reports_company_period'
            ]
        }
        
    except Exception as e:
        conn.rollback()
        error_message = str(e)
        print(f"Schema creation failed: {error_message}")
        return {
            'success': False,
            'message': f'Schema creation failed: {error_message}'
        }

# For testing locally
if __name__ == "__main__":
    test_event = {}
    test_context = {}
    result = lambda_handler(test_event, test_context)
    print(json.dumps(result, indent=2)) 