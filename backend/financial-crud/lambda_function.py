import json
import os
import pg8000
import ssl
from datetime import datetime, date
from typing import Dict, Any, List, Optional

def lambda_handler(event, context):
    """
    AWS Lambda function for financial data CRUD operations using pg8000
    """
    
    # Handle CORS
    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
    
    # Handle OPTIONS request
    if event.get('httpMethod') == 'OPTIONS' or event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'message': 'CORS preflight handled'})
        }
    
    try:
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST', 'database-1.cgr2i0s2iki4.us-east-1.rds.amazonaws.com'),
            'port': int(os.environ.get('DB_PORT', '5432')),
            'database': os.environ.get('DB_NAME', 'postgres'),
            'user': os.environ.get('DB_USER', 'postgres'),
            'password': os.environ.get('DB_PASSWORD', 'frontbackandbesideit')
        }
        
        # Parse request body if present
        body = {}
        if event.get('body'):
            try:
                body = json.loads(event['body'])
            except json.JSONDecodeError:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({'error': 'Invalid JSON in request body'})
                }
        
        # Determine operation from event
        operation = event.get('operation') or body.get('operation')
        
        if not operation:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Operation not specified'})
            }
        
        # Route to appropriate handler
        if operation == 'save_financial_report':
            result = save_financial_report(db_config, body)
        elif operation == 'get_companies':
            result = get_companies(db_config)
        elif operation == 'get_company_reports':
            company_id = body.get('company_id')
            result = get_company_reports(db_config, company_id)
        elif operation == 'get_company_by_name':
            company_name = body.get('company_name')
            result = get_company_by_name(db_config, company_name)
        elif operation == 'test_connection':
            result = test_database_connection(db_config)
        elif operation == 'debug_database':
            result = debug_database_contents(db_config)
        elif operation == 'clear_all_data':
            result = clear_all_data(db_config)
        else:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': f'Unknown operation: {operation}'})
            }
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'status': 'success',
                    'operation': operation,
                    'data': result['data'],
                    'function_info': {
                        'function_name': context.function_name,
                        'request_id': context.aws_request_id
                    }
                })
            }
        else:
            return {
                'statusCode': 500,
                'headers': headers,
                'body': json.dumps({
                    'status': 'failed',
                    'operation': operation,
                    'error': result['error']
                })
            }
            
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'status': 'error',
                'message': f'Unexpected error: {str(e)}'
            })
        }

def get_database_connection(db_config: Dict):
    """
    Get a database connection with SSL support using pg8000
    """
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
        
        return {'success': True, 'connection': conn}
        
    except Exception as e:
        return {'success': False, 'error': f'Database connection failed: {str(e)}'}

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
        
        # Delete in correct order (child tables first due to foreign keys)
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
                'message': f'Successfully deleted {reports_count} reports and {companies_count} companies'
            }
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to clear data: {str(e)}'
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