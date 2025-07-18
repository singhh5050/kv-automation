import json
import os
import pg8000
import ssl          # left in case you later supply a custom CA
import re          # for regex matching
from datetime import datetime, date
from typing import Dict, Any, List

# ────────────────────────────────────────────────────────────
def lambda_handler(event, context):
    """
    AWS Lambda router for all financial‑CRUD operations.
    """

    # ── CORS headers ──
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }

    # Pre‑flight
    if event.get("httpMethod") == "OPTIONS" or \
       event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return {"statusCode": 200, "headers": headers,
                "body": json.dumps({"message": "CORS preflight handled"})}

    # ── DB settings from env vars ──
    db_config = {
        "host":     os.environ.get("DB_HOST"),
        "port":     int(os.environ.get("DB_PORT")),
        "database": os.environ.get("DB_NAME"),
        "user":     os.environ.get("DB_USER"),
        "password": os.environ.get("DB_PASSWORD")          # ← provide via env var / Secrets Manager
    }

    # Parse JSON body (if any)
    body = {}
    if event.get("body"):
        try:
            body = json.loads(event["body"])
        except json.JSONDecodeError:
            return {"statusCode": 400, "headers": headers,
                    "body": json.dumps({"error": "Invalid JSON in request body"})}

    operation = event.get("operation") or body.get("operation")
    if not operation:
        return {"statusCode": 400, "headers": headers,
                "body": json.dumps({"error": "Operation not specified"})}

    # ── Dispatch ──
    if operation == "save_financial_report":
        result = save_financial_report(db_config, body)
    elif operation == "get_companies":
        result = get_companies(db_config)
    elif operation == "get_company_reports":
        result = get_company_reports(db_config, body.get("company_id"))
    elif operation == "get_company_by_name":
        result = get_company_by_name(db_config, body.get("company_name"))
    elif operation == "test_connection":
        result = test_database_connection(db_config)
    elif operation == "debug_database":
        result = debug_database_contents(db_config)
    elif operation == "clear_all_data":
        result = clear_all_data(db_config)
    elif operation == "save_cap_table_round":
        result = save_cap_table_round(db_config, body)
    elif operation == "get_company_overview":
        result = get_company_overview(db_config, body.get("company_id"))
    else:
        return {"statusCode": 400, "headers": headers,
                "body": json.dumps({"error": f"Unknown operation: {operation}"})}

    # ── Build HTTP response ──
    if result.get("success"):
        return {
            "statusCode": 200,
            "headers": headers,
            "body": json.dumps({
                "status": "success",
                "operation": operation,
                "data": result["data"],
                "function_info": {
                    "function_name": context.function_name,
                    "request_id": context.aws_request_id
                }
            })
        }
    else:
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps({
                "status": "failed",
                "operation": operation,
                "error": result.get("error")
            })
        }

# ────────────────────────────────────────────────────────────
def get_database_connection(db_config: Dict):
    """
    Return a pg8000 connection wrapped in success/error dict.
    Uses a validated SSL context.
    """
    try:
        ssl_ctx = ssl.create_default_context()          # validates RDS certs
        conn = pg8000.connect(
            host=db_config["host"],
            port=db_config["port"],
            database=db_config["database"],
            user=db_config["user"],
            password=db_config["password"],
            ssl_context=ssl_ctx,        # ← replace `ssl=True` with this
            timeout=30
        )
        return {"success": True, "connection": conn}
    except Exception as e:
        return {"success": False, "error": f"Database connection failed: {str(e)}"}

def test_database_connection(db_config: Dict) -> Dict[str, Any]:
    """
    Test database connection and return status
    """
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        
        # Test with a simple query
        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': {
                'connection_status': 'successful',
                'database_version': version[0] if version else 'Unknown',
                'driver': 'pg8000 with SSL'
            }
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Connection test failed: {str(e)}'
        }

def save_financial_report(db_config: Dict, data: Dict) -> Dict[str, Any]:
    """
    Save a financial report to the database
    Expected data format matches the AI extraction output
    """
    
    required_fields = ['companyName', 'reportDate', 'reportPeriod', 'filename']
    missing_fields = [field for field in required_fields if not data.get(field)]
    
    if missing_fields:
        return {
            'success': False,
            'error': f'Missing required fields: {", ".join(missing_fields)}'
        }
    
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Normalize company name for matching
        normalized_name = normalize_company_name(data['companyName'])
        
        # Insert company if it doesn't exist
        company_insert = """
            INSERT INTO companies (name, normalized_name, created_at, updated_at)
            VALUES (%s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (normalized_name) DO NOTHING
        """
        
        cursor.execute(company_insert, [data['companyName'], normalized_name])
        
        # Get company ID
        cursor.execute("SELECT id FROM companies WHERE normalized_name = %s", [normalized_name])
        company_row = cursor.fetchone()
        
        if not company_row:
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': 'Failed to get company ID after insert'
            }
        
        company_id = company_row[0]
        
        # Parse report date
        report_date = data['reportDate']
        if isinstance(report_date, str):
            try:
                # Try to parse date string
                report_date_obj = datetime.strptime(report_date, '%Y-%m-%d').date()
                report_date = report_date_obj
            except ValueError:
                # Use current date if parsing fails
                report_date = datetime.now().date()
        
        # Insert financial report
        report_insert = """
            INSERT INTO financial_reports (
                company_id, file_name, report_date, report_period,
                cash_on_hand, monthly_burn_rate, cash_out_date, runway, budget_vs_actual,
                financial_summary, clinical_progress, research_development,
                upload_date, processed_at, processing_status
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'completed'
            )
        """
        
        report_data = [
            company_id,
            data['filename'],
            report_date,
            data['reportPeriod'],
            data.get('cashOnHand', 'N/A'),
            data.get('monthlyBurnRate', 'N/A'),
            data.get('cashOutDate', 'N/A'),
            data.get('runway', 'N/A'),
            data.get('budgetVsActual', 'N/A'),
            data.get('financialSummary', 'Financial summary not available'),
            data.get('clinicalProgress', 'Clinical progress not available'),
            data.get('researchDevelopment', 'R&D information not available')
        ]
        
        cursor.execute(report_insert, report_data)
        conn.commit()
        
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': {
                'company_name': data['companyName'],
                'company_id': company_id,
                'report_period': data['reportPeriod'],
                'status': 'saved'
            }
        }
            
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to save financial report: {str(e)}'
        }

def _cursor_to_dict(cursor) -> List[Dict[str, Any]]:
    """
    Convert cursor results to a list of dictionaries with proper date serialization
    """
    columns = [desc[0] for desc in cursor.description]
    result = []
    
    for row in cursor.fetchall():
        row_dict = {}
        for i, value in enumerate(row):
            # Convert datetime/date objects to ISO format strings
            if isinstance(value, (datetime, date)):
                row_dict[columns[i]] = value.isoformat()
            else:
                row_dict[columns[i]] = value
        result.append(row_dict)
    
    return result

def get_companies(db_config: Dict) -> Dict[str, Any]:
    """
    Get all companies from the database, along with their latest report
    """
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # SQL to get companies and their most recent report date
        # This is a simplified query; a more robust solution might use a subquery
        # or window function to get the full latest report, not just the date.
        query = """
            SELECT 
                c.id, 
                c.name, 
                c.normalized_name, 
                c.created_at, 
                c.updated_at,
                (SELECT MAX(fr.report_date) FROM financial_reports fr WHERE fr.company_id = c.id) as latest_report_date
            FROM 
                companies c
            ORDER BY 
                c.name ASC;
        """
        
        cursor.execute(query)
        
        companies = _cursor_to_dict(cursor)
        
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': {'companies': companies}
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to get companies: {str(e)}'
        }

def get_company_reports(db_config: Dict, company_id: str) -> Dict[str, Any]:
    """
    Get all reports for a specific company
    """
    
    if not company_id:
        return {
            'success': False,
            'error': 'company_id is required'
        }
    
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Get company info and reports
        query = """
            SELECT fr.id, fr.file_name, fr.report_date, fr.report_period,
                   fr.cash_on_hand, fr.monthly_burn_rate, fr.cash_out_date,
                   fr.runway, fr.budget_vs_actual, fr.financial_summary,
                   fr.clinical_progress, fr.research_development, fr.processed_at,
                   c.name as company_name
            FROM financial_reports fr
            JOIN companies c ON fr.company_id = c.id
            WHERE fr.company_id = %s
            ORDER BY fr.report_date DESC, fr.processed_at DESC
        """
        
        cursor.execute(query, [company_id])
        reports = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        # Format results
        report_list = []
        company_name = None
        
        for row in reports:
            if not company_name:
                company_name = row[13]  # Updated index for company_name
                
            report_list.append({
                'id': row[0],
                'file_name': row[1],
                'report_date': row[2].isoformat() if row[2] else None,
                'report_period': row[3],
                'cash_on_hand': row[4],
                'monthly_burn_rate': row[5],
                'cash_out_date': row[6],
                'runway': row[7],
                'budget_vs_actual': row[8],
                'financial_summary': row[9],
                'clinical_progress': row[10],
                'research_development': row[11],
                'processed_at': row[12].isoformat() if row[12] else None
            })
        
        return {
            'success': True,
            'data': {
                'company_id': company_id,
                'company_name': company_name,
                'reports': report_list,
                'total_count': len(report_list)
            }
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to get company reports: {str(e)}'
        }

def get_company_by_name(db_config: Dict, company_name: str) -> Dict[str, Any]:
    """
    Find a company by name (with normalization)
    """
    
    if not company_name:
        return {
            'success': False,
            'error': 'company_name is required'
        }
    
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        normalized_name = normalize_company_name(company_name)
        
        query = """
            SELECT id, name, normalized_name, created_at,
                   (SELECT COUNT(*) FROM financial_reports WHERE company_id = companies.id) as report_count
            FROM companies 
            WHERE normalized_name = %s
        """
        
        cursor.execute(query, [normalized_name])
        company = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        if company:
            return {
                'success': True,
                'data': {
                    'id': company[0],
                    'name': company[1],
                    'normalized_name': company[2],
                    'created_at': company[3].isoformat() if company[3] else None,
                    'report_count': company[4],
                    'search_name': company_name
                }
            }
        else:
            return {
                'success': True,
                'data': {
                    'found': False,
                    'search_name': company_name,
                    'normalized_name': normalized_name,
                    'message': 'Company not found'
                }
            }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to find company: {str(e)}'
        }

def debug_database_contents(db_config: Dict) -> Dict[str, Any]:
    """
    Debug function to inspect database contents
    """
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        debug_info = {}
        
        # Check if tables exist
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        """)
        tables = [row[0] for row in cursor.fetchall()]
        debug_info['tables'] = tables
        
        # Check companies table
        if 'companies' in tables:
            cursor.execute("SELECT COUNT(*) FROM companies")
            company_count = cursor.fetchone()[0]
            debug_info['company_count'] = company_count
            
            if company_count > 0:
                cursor.execute("SELECT id, name, normalized_name, created_at FROM companies LIMIT 5")
                companies = _cursor_to_dict(cursor)
                debug_info['sample_companies'] = companies
        
        # Check financial_reports table
        if 'financial_reports' in tables:
            cursor.execute("SELECT COUNT(*) FROM financial_reports")
            report_count = cursor.fetchone()[0]
            debug_info['report_count'] = report_count
            
            if report_count > 0:
                cursor.execute("SELECT id, company_id, file_name, report_date FROM financial_reports LIMIT 5")
                reports = _cursor_to_dict(cursor)
                debug_info['sample_reports'] = reports
        
        # Check cap_table_rounds table
        if 'cap_table_rounds' in tables:
            cursor.execute("SELECT COUNT(*) FROM cap_table_rounds")
            cap_rounds_count = cursor.fetchone()[0]
            debug_info['cap_rounds_count'] = cap_rounds_count
            
            if cap_rounds_count > 0:
                cursor.execute("SELECT id, company_id, round_name, valuation FROM cap_table_rounds LIMIT 5")
                cap_rounds = _cursor_to_dict(cursor)
                debug_info['sample_cap_rounds'] = cap_rounds
        
        # Check cap_table_investors table
        if 'cap_table_investors' in tables:
            cursor.execute("SELECT COUNT(*) FROM cap_table_investors")
            investors_count = cursor.fetchone()[0]
            debug_info['investors_count'] = investors_count
            
            if investors_count > 0:
                cursor.execute("SELECT id, investor_name, total_invested FROM cap_table_investors LIMIT 5")
                investors = _cursor_to_dict(cursor)
                debug_info['sample_investors'] = investors
        
        # Check cap_table_current table
        if 'cap_table_current' in tables:
            cursor.execute("SELECT COUNT(*) FROM cap_table_current")
            current_count = cursor.fetchone()[0]
            debug_info['current_cap_tables_count'] = current_count
        
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': debug_info
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Debug failed: {str(e)}'
        }

def clear_all_data(db_config: Dict) -> Dict[str, Any]:
    """
    Clear all data from the database tables
    WARNING: This permanently deletes all companies and financial reports
    """
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Get counts before deletion
        cursor.execute("SELECT COUNT(*) FROM financial_reports")
        reports_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM companies")
        companies_count = cursor.fetchone()[0]
        
        # Get counts for cap table data
        cap_investors_count = 0
        cap_rounds_count = 0 
        cap_current_count = 0
        
        try:
            cursor.execute("SELECT COUNT(*) FROM cap_table_investors")
            cap_investors_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM cap_table_rounds")
            cap_rounds_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM cap_table_current")
            cap_current_count = cursor.fetchone()[0]
        except Exception:
            # Tables might not exist yet
            pass
        
        # Delete in correct order (child tables first due to foreign keys)
        cursor.execute("DELETE FROM cap_table_investors")
        cursor.execute("DELETE FROM cap_table_current")
        cursor.execute("DELETE FROM cap_table_rounds")
        cursor.execute("DELETE FROM financial_reports")
        cursor.execute("DELETE FROM companies")
        
        # Also clean up any orphaned data in financial_data table if it exists
        try:
            cursor.execute("DELETE FROM financial_data")
        except Exception:
            # Table might not exist, ignore
            pass
        
        # Commit the transaction
        conn.commit()
        
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': {
                'deleted_reports': reports_count,
                'deleted_companies': companies_count,
                'deleted_cap_rounds': cap_rounds_count,
                'deleted_investors': cap_investors_count,
                'deleted_current_cap_tables': cap_current_count,
                'message': f'Successfully deleted {reports_count} reports, {companies_count} companies, {cap_rounds_count} cap table rounds, and {cap_investors_count} investors'
            }
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to clear data: {str(e)}'
        }

def save_cap_table_round(db_config: Dict, data: Dict) -> Dict[str, Any]:
    """
    Save cap table round data with investors
    Expected data format:
    {
        "company_name": "TechCorp",
        "round_data": {
            "round_name": "Series A",
            "valuation": 25000000,
            "amount_raised": 5000000,
            "round_date": "2025-01-15",
            "total_pool_size": 0.15,
            "pool_available": 0.12
        },
        "investors": [
            {
                "investor_name": "Khosla Ventures",
                "total_invested": 2500000,
                "final_fds": 0.18,
                "final_round_investment": 2500000
            }
        ]
    }
    """
    
    required_fields = ['company_name', 'round_data']
    missing_fields = [field for field in required_fields if not data.get(field)]
    
    if missing_fields:
        return {
            'success': False,
            'error': f'Missing required fields: {", ".join(missing_fields)}'
        }
    
    round_data = data['round_data']
    if not round_data.get('round_name'):
        return {
            'success': False,
            'error': 'round_name is required in round_data'
        }
    
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Normalize company name for matching
        normalized_name = normalize_company_name(data['company_name'])
        
        # Insert company if it doesn't exist
        company_insert = """
            INSERT INTO companies (name, normalized_name, created_at, updated_at)
            VALUES (%s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (normalized_name) DO NOTHING
        """
        
        cursor.execute(company_insert, [data['company_name'], normalized_name])
        
        # Get company ID
        cursor.execute("SELECT id FROM companies WHERE normalized_name = %s", [normalized_name])
        company_row = cursor.fetchone()
        
        if not company_row:
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': 'Failed to get company ID after insert'
            }
        
        company_id = company_row[0]
        
        # Parse round date
        round_date = round_data.get('round_date')
        if isinstance(round_date, str):
            try:
                round_date_obj = datetime.strptime(round_date, '%Y-%m-%d').date()
                round_date = round_date_obj
            except ValueError:
                round_date = None
        
        # Insert cap table round
        round_insert = """
            INSERT INTO cap_table_rounds (
                company_id, round_name, valuation, amount_raised, round_date,
                total_pool_size, pool_available, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (company_id, round_name) DO UPDATE SET
                valuation = EXCLUDED.valuation,
                amount_raised = EXCLUDED.amount_raised,
                round_date = EXCLUDED.round_date,
                total_pool_size = EXCLUDED.total_pool_size,
                pool_available = EXCLUDED.pool_available,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id
        """
        
        round_params = [
            company_id,
            round_data['round_name'],
            round_data.get('valuation'),
            round_data.get('amount_raised'),
            round_date,
            round_data.get('total_pool_size'),
            round_data.get('pool_available')
        ]
        
        cursor.execute(round_insert, round_params)
        round_result = cursor.fetchone()
        round_id = round_result[0]
        
        # Insert investors if provided
        investors = data.get('investors', [])
        if investors:
            # Clear existing investors for this round
            cursor.execute("DELETE FROM cap_table_investors WHERE cap_table_round_id = %s", [round_id])
            
            # Insert new investors
            investor_insert = """
                INSERT INTO cap_table_investors (
                    cap_table_round_id, investor_name, total_invested, 
                    final_fds, final_round_investment, created_at
                ) VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            """
            
            for investor in investors:
                investor_params = [
                    round_id,
                    investor.get('investor_name'),
                    investor.get('total_invested'),
                    investor.get('final_fds'),
                    investor.get('final_round_investment')
                ]
                cursor.execute(investor_insert, investor_params)
        
        # Update current cap table pointer
        current_update = """
            INSERT INTO cap_table_current (company_id, cap_table_round_id, updated_at)
            VALUES (%s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (company_id) DO UPDATE SET
                cap_table_round_id = EXCLUDED.cap_table_round_id,
                updated_at = CURRENT_TIMESTAMP
        """
        
        cursor.execute(current_update, [company_id, round_id])
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': {
                'company_name': data['company_name'],
                'company_id': company_id,
                'round_id': round_id,
                'round_name': round_data['round_name'],
                'investors_count': len(investors),
                'status': 'saved'
            }
        }
            
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to save cap table round: {str(e)}'
        }

def get_company_overview(db_config: Dict, company_id: str) -> Dict[str, Any]:
    """
    Get complete company overview with current cap table and financial reports
    """
    
    if not company_id:
        return {
            'success': False,
            'error': 'company_id is required'
        }
    
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Get company details
        cursor.execute("""
            SELECT id, name, normalized_name, created_at, updated_at
            FROM companies 
            WHERE id = %s
        """, [company_id])
        
        company_row = cursor.fetchone()
        if not company_row:
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': 'Company not found'
            }
        
        company_data = {
            'id': company_row[0],
            'name': company_row[1],
            'normalized_name': company_row[2],
            'created_at': company_row[3].isoformat() if company_row[3] else None,
            'updated_at': company_row[4].isoformat() if company_row[4] else None
        }
        
        # Get current cap table data
        current_cap_table = None
        try:
            cursor.execute("""
                SELECT ctr.id, ctr.round_name, ctr.valuation, ctr.amount_raised, 
                       ctr.round_date, ctr.total_pool_size, ctr.pool_available
                FROM cap_table_current ctc
                JOIN cap_table_rounds ctr ON ctc.cap_table_round_id = ctr.id
                WHERE ctc.company_id = %s
            """, [company_id])
            
            round_row = cursor.fetchone()
        except Exception as e:
            print(f"Warning: Cap table query failed (table may not exist): {str(e)}")
            round_row = None
        
        if round_row:
            # Get investors for this round
            cursor.execute("""
                SELECT investor_name, total_invested, final_fds, final_round_investment
                FROM cap_table_investors
                WHERE cap_table_round_id = %s
                ORDER BY total_invested DESC
            """, [round_row[0]])
            
            investors = []
            kv_stake = 0  # Sum all KV-related investments
            for inv_row in cursor.fetchall():
                investor_name = inv_row[0] or ''
                
                # Check if this is a KV-related investor using regex patterns
                kv_patterns = [
                    r'^KV$',       # Matches exactly "KV" 
                    r'.*KV .*',    # Matches "KV V", "KV Seed II", etc.
                    r'.*Seed .*',  # Matches "KV Seed II", "Seed Fund", etc.
                    r'.*Opp .*'    # Matches "KV Opp Fund", "Opp II", etc.
                ]
                is_kv = any(re.match(pattern, investor_name) for pattern in kv_patterns)
                
                investor_data = {
                    'investor_name': investor_name,
                    'total_invested': float(inv_row[1]) if inv_row[1] else None,
                    'final_fds': float(inv_row[2]) if inv_row[2] else None,
                    'final_round_investment': float(inv_row[3]) if inv_row[3] else None,
                    'is_kv': is_kv
                }
                investors.append(investor_data)
                
                # Sum KV stakes from all KV-related entities
                if is_kv and investor_data['final_fds']:
                    kv_stake += investor_data['final_fds']
            
            current_cap_table = {
                'round_id': round_row[0],
                'round_name': round_row[1],
                'valuation': float(round_row[2]) if round_row[2] else None,
                'amount_raised': float(round_row[3]) if round_row[3] else None,
                'round_date': round_row[4].isoformat() if round_row[4] else None,
                'total_pool_size': float(round_row[5]) if round_row[5] else None,
                'pool_available': float(round_row[6]) if round_row[6] else None,
                'kv_stake': kv_stake,
                'investors': investors
            }
        
        # Get financial reports
        cursor.execute("""
            SELECT id, file_name, report_date, report_period, cash_on_hand,
                   monthly_burn_rate, cash_out_date, runway, budget_vs_actual,
                   financial_summary, clinical_progress, research_development,
                   processed_at
            FROM financial_reports
            WHERE company_id = %s
            ORDER BY report_date DESC, processed_at DESC
        """, [company_id])
        
        financial_reports = []
        for report_row in cursor.fetchall():
            financial_reports.append({
                'id': report_row[0],
                'file_name': report_row[1],
                'report_date': report_row[2].isoformat() if report_row[2] else None,
                'report_period': report_row[3],
                'cash_on_hand': report_row[4],
                'monthly_burn_rate': report_row[5],
                'cash_out_date': report_row[6],
                'runway': report_row[7],
                'budget_vs_actual': report_row[8],
                'financial_summary': report_row[9],
                'clinical_progress': report_row[10],
                'research_development': report_row[11],
                'processed_at': report_row[12].isoformat() if report_row[12] else None
            })
        
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': {
                'company': company_data,
                'current_cap_table': current_cap_table,
                'financial_reports': financial_reports,
                'summary': {
                    'has_cap_table': current_cap_table is not None,
                    'financial_reports_count': len(financial_reports),
                    'latest_financial_report': financial_reports[0] if financial_reports else None
                }
            }
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to get company overview: {str(e)}'
        }

def normalize_company_name(name: str) -> str:
    """
    Normalize company name for matching (matches backend/app/models.py)
    """
    if not name:
        return ""
    return (name.lower()
            .replace('corp', '').replace('corporation', '')
            .replace('inc', '').replace('incorporated', '')
            .replace('ltd', '').replace('limited', '')
            .replace('llc', '').replace('co.', '').replace('co', '')
            .strip()) 