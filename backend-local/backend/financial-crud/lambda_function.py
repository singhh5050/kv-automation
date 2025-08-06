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
    elif operation == "update_financial_metrics":
        result = update_financial_metrics(db_config, body)
    elif operation == "update_company":
        result = update_company(db_config, body)
    elif operation == "update_cap_table_round":
        result = update_cap_table_round(db_config, body)
    elif operation == "update_cap_table_investor":
        result = update_cap_table_investor(db_config, body)
    elif operation == "get_all_company_data":
        result = get_all_company_data(db_config, body.get("company_id"))
    elif operation == "get_company_enrichment":
        result = get_company_enrichment(db_config, body.get("company_id"))
    elif operation == "delete_company_enrichment":
        result = delete_company_enrichment(db_config, body.get("company_id"))
    elif operation == "get_person_enrichment":
        result = get_person_enrichment(db_config, body.get("person_urn"))
    elif operation == "get_company_people":
        result = get_company_people(db_config, body.get("company_id"))
    elif operation == "delete_person_enrichment":
        result = delete_person_enrichment(db_config, body.get("person_urn"))
    elif operation == "delete_company":
        result = delete_company(db_config, body.get("company_id"))
    elif operation == "get_company_names":
        result = get_company_names(db_config)
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

def update_financial_metrics(db_config: Dict, data: Dict) -> Dict[str, Any]:
    """
    Update specific financial metrics for a report.
    Expected data format:
    {
        "report_id": 123,
        "updates": {
            "cash_on_hand": 2500000,
            "monthly_burn_rate": 180000,
            "runway": 14
        }
    }
    """
    
    if not data.get("report_id"):
        return {
            'success': False,
            'error': 'report_id is required'
        }
    
    updates = data.get("updates", {})
    if not updates:
        return {
            'success': False,
            'error': 'updates are required'
        }
    
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Verify report exists
        cursor.execute("SELECT id, company_id FROM financial_reports WHERE id = %s", [data['report_id']])
        report_row = cursor.fetchone()
        
        if not report_row:
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': 'Report not found'
            }
        
        report_id, company_id = report_row
        
        # Build dynamic update query
        set_clauses = []
        params = []
        
        for field, value in updates.items():
            if field in ['cash_on_hand', 'monthly_burn_rate']:
                set_clauses.append(f"{field} = %s")
                params.append(float(value) if value is not None else None)
            elif field == 'runway':
                set_clauses.append("runway = %s")
                params.append(int(value) if value is not None else None)
            elif field in ['cash_out_date', 'budget_vs_actual', 'financial_summary', 'sector_highlight_a', 'sector_highlight_b', 'key_risks', 'personnel_updates', 'next_milestones', 'sector']:
                set_clauses.append(f"{field} = %s")
                params.append(str(value) if value is not None else None)
        
        if not set_clauses:
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': 'No valid fields to update'
            }
        
        # Add manually_edited flag and timestamp
        set_clauses.append("manually_edited = %s")
        set_clauses.append("updated_at = CURRENT_TIMESTAMP")
        params.append(True)
        params.append(report_id)
        
        update_query = f"UPDATE financial_reports SET {', '.join(set_clauses)} WHERE id = %s"
        cursor.execute(update_query, params)
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': {
                'report_id': report_id,
                'company_id': company_id,
                'updated_fields': list(updates.keys()),
                'manually_edited': True
            }
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to update financial metrics: {str(e)}'
        }

def parse_financial_value(value):
    """
    Convert cash / burn values to float.
    Accepts numbers, '$2.3M', '1 234 567', 'N/A', etc.
    """
    # -------- 1. easy cases ----------
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)

    # -------- 2. string handling -----
    value_str = str(value).strip()
    if value_str.upper() in ('N/A', 'UNKNOWN', ''):
        return None

    value_str = value_str.replace('$', '').replace(',', '').upper()

    try:
        if value_str.endswith('M'):
            return float(value_str[:-1]) * 1_000_000
        if value_str.endswith('K'):
            return float(value_str[:-1]) * 1_000
        return float(value_str)
    except ValueError:
        return None

def parse_runway_value(value):
    """
    Convert runway to integer months.
    Accepts numbers, '14 months', 'N/A', etc.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)

    value_str = str(value).lower().replace('months', '').replace('month', '').strip()
    if value_str.upper() in ('N/A', 'UNKNOWN', ''):
        return None

    try:
        return int(float(value_str))
    except ValueError:
        return None

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
        
        # Skip normalization for user-provided names
        user_provided = data.get('user_provided_name', False)
        if user_provided:
            # For user-provided names, use lowercase for case-insensitive matching
            normalized_name = data['companyName'].lower().strip()
            manually_edited = True
            edited_by = "user_provided"
        else:
            # For auto-detected names, use normalization
            normalized_name = normalize_company_name(data['companyName'])
            manually_edited = False
            edited_by = "system_import"
        
        # Insert company if it doesn't exist
        company_insert = """
            INSERT INTO companies (name, normalized_name, manually_edited, edited_by, edited_at, created_at, updated_at)
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (normalized_name) DO NOTHING
        """
        
        cursor.execute(company_insert, [data['companyName'], normalized_name, manually_edited, edited_by])
        
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
                company_id, file_name, report_date, report_period, sector,
                cash_on_hand, monthly_burn_rate, cash_out_date, runway, budget_vs_actual,
                financial_summary, sector_highlight_a, sector_highlight_b,
                key_risks, personnel_updates, next_milestones,
                manually_edited, edited_by, edited_at,
                upload_date, processed_at, processing_status
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'completed'
            )
        """
        
        report_data = [
            company_id,
            data['filename'],
            report_date,
            data['reportPeriod'],
            data.get('sector', 'healthcare'),  # Default to healthcare if not provided
            parse_financial_value(data.get('cashOnHand')),
            parse_financial_value(data.get('monthlyBurnRate')),
            data.get('cashOutDate'),
            parse_runway_value(data.get('runway')),
            data.get('budgetVsActual'),
            data.get('financialSummary'),
            data.get('sectorHighlightA'),
            data.get('sectorHighlightB'),
            data.get('keyRisks'),
            data.get('personnelUpdates'),
            data.get('nextMilestones'),
            False,  # manually_edited
            "system_import"  # edited_by (edited_at will be set to CURRENT_TIMESTAMP)
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
                c.manually_edited,
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
            SELECT fr.id, fr.file_name, fr.report_date, fr.report_period, fr.sector,
                   fr.cash_on_hand, fr.monthly_burn_rate, fr.cash_out_date,
                   fr.runway, fr.budget_vs_actual, fr.financial_summary,
                   fr.sector_highlight_a, fr.sector_highlight_b, fr.key_risks,
                   fr.personnel_updates, fr.next_milestones, fr.processed_at,
                   fr.manually_edited, c.name as company_name
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
                company_name = row[18]  # Updated index for company_name
                
            report_list.append({
                'id': row[0],
                'file_name': row[1],
                'report_date': row[2].isoformat() if row[2] else None,
                'report_period': row[3],
                'sector': row[4],
                'cash_on_hand': float(row[5]) if row[5] is not None else None,
                'monthly_burn_rate': float(row[6]) if row[6] is not None else None,
                'cash_out_date': row[7],
                'runway': int(row[8]) if row[8] is not None else None,
                'budget_vs_actual': row[9],
                'financial_summary': row[10],
                'sector_highlight_a': row[11],
                'sector_highlight_b': row[12],
                'key_risks': row[13],
                'personnel_updates': row[14],
                'next_milestones': row[15],
                'processed_at': row[16].isoformat() if row[16] else None,
                'manually_edited': row[17] if row[17] is not None else False
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
        
        # Check company_enrichments table
        if 'company_enrichments' in tables:
            cursor.execute("SELECT COUNT(*) FROM company_enrichments")
            enrichments_count = cursor.fetchone()[0]
            debug_info['company_enrichments_count'] = enrichments_count
            
            if enrichments_count > 0:
                cursor.execute("SELECT id, company_id, enrichment_status FROM company_enrichments LIMIT 5")
                enrichments = _cursor_to_dict(cursor)
                debug_info['sample_enrichments'] = enrichments
        
        # Check person_enrichments table
        if 'person_enrichments' in tables:
            cursor.execute("SELECT COUNT(*) FROM person_enrichments")
            person_enrichments_count = cursor.fetchone()[0]
            debug_info['person_enrichments_count'] = person_enrichments_count
            
            if person_enrichments_count > 0:
                cursor.execute("SELECT id, person_urn, full_name, title FROM person_enrichments LIMIT 5")
                person_enrichments = _cursor_to_dict(cursor)
                debug_info['sample_person_enrichments'] = person_enrichments
        
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
        enrichments_count = 0
        person_enrichments_count = 0
        
        try:
            cursor.execute("SELECT COUNT(*) FROM cap_table_investors")
            cap_investors_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM cap_table_rounds")
            cap_rounds_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM cap_table_current")
            cap_current_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM company_enrichments")
            enrichments_count = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM person_enrichments")
            person_enrichments_count = cursor.fetchone()[0]
        except Exception:
            # Tables might not exist yet
            pass
        
        # Delete in correct order (child tables first due to foreign keys)
        cursor.execute("DELETE FROM cap_table_investors")
        cursor.execute("DELETE FROM cap_table_current")
        cursor.execute("DELETE FROM cap_table_rounds")
        cursor.execute("DELETE FROM person_enrichments")
        cursor.execute("DELETE FROM company_enrichments")
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
                'deleted_company_enrichments': enrichments_count,
                'deleted_person_enrichments': person_enrichments_count,
                'message': f'Successfully deleted {reports_count} reports, {companies_count} companies, {cap_rounds_count} cap table rounds, {cap_investors_count} investors, {enrichments_count} company enrichments, and {person_enrichments_count} person enrichments'
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
        
        # Skip normalization for user-provided names
        user_provided = data.get('user_provided_name', False)
        if user_provided:
            # For user-provided names, use lowercase for case-insensitive matching
            normalized_name = data['company_name'].lower().strip()
            manually_edited = True
            edited_by = "user_provided"
        else:
            # For auto-detected names, use normalization
            normalized_name = normalize_company_name(data['company_name'])
            manually_edited = False
            edited_by = "system_import"
        
        # Insert company if it doesn't exist
        company_insert = """
            INSERT INTO companies (name, normalized_name, manually_edited, edited_by, edited_at, created_at, updated_at)
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (normalized_name) DO NOTHING
        """
        
        cursor.execute(company_insert, [data['company_name'], normalized_name, manually_edited, edited_by])
        
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
                total_pool_size, pool_available, manually_edited, edited_by, edited_at, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (company_id, round_name) DO UPDATE SET
                valuation = EXCLUDED.valuation,
                amount_raised = EXCLUDED.amount_raised,
                round_date = EXCLUDED.round_date,
                total_pool_size = EXCLUDED.total_pool_size,
                pool_available = EXCLUDED.pool_available,
                manually_edited = EXCLUDED.manually_edited,
                edited_by = EXCLUDED.edited_by,
                edited_at = CURRENT_TIMESTAMP,
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
            round_data.get('pool_available'),
            False,  # manually_edited
            "system_import"  # edited_by
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
                    final_fds, final_round_investment, manually_edited, edited_by, edited_at, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
            
            for investor in investors:
                investor_params = [
                    round_id,
                    investor.get('investor_name'),
                    investor.get('total_invested'),
                    investor.get('final_fds'),
                    investor.get('final_round_investment'),
                    False,  # manually_edited
                    "system_import"  # edited_by
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
            SELECT id, name, normalized_name, sector, created_at, updated_at
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
            'sector': company_row[3],
            'created_at': company_row[4].isoformat() if company_row[4] else None,
            'updated_at': company_row[5].isoformat() if company_row[5] else None
        }
        
        # Get current cap table data
        current_cap_table = None
        try:
            # Try to fetch with new option pool columns first
            cursor.execute("""
                SELECT ctr.id, ctr.round_name, ctr.valuation, ctr.amount_raised, 
                       ctr.round_date, ctr.total_pool_size, ctr.pool_available,
                       ctr.pool_utilization, ctr.options_outstanding
                FROM cap_table_current ctc
                JOIN cap_table_rounds ctr ON ctc.cap_table_round_id = ctr.id
                WHERE ctc.company_id = %s
            """, [company_id])
            
            round_row = cursor.fetchone()
        except Exception as e:
            print(f"Warning: Cap table query with new columns failed, trying fallback: {str(e)}")
            # Fallback to old query for backwards compatibility
            try:
                cursor.execute("""
                    SELECT ctr.id, ctr.round_name, ctr.valuation, ctr.amount_raised, 
                           ctr.round_date, ctr.total_pool_size, ctr.pool_available
                    FROM cap_table_current ctc
                    JOIN cap_table_rounds ctr ON ctc.cap_table_round_id = ctr.id
                    WHERE ctc.company_id = %s
                """, [company_id])
                
                old_round_row = cursor.fetchone()
                # Extend with None values for new columns
                round_row = old_round_row + (None, None) if old_round_row else None
            except Exception as e2:
                print(f"Warning: Cap table query failed (table may not exist): {str(e2)}")
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
                'pool_utilization': float(round_row[7]) if round_row[7] is not None else None,
                'options_outstanding': float(round_row[8]) if round_row[8] is not None else None,
                'kv_stake': kv_stake,
                'investors': investors
            }
        
        # Get financial reports
        cursor.execute("""
            SELECT id, file_name, report_date, report_period, sector, cash_on_hand,
                   monthly_burn_rate, cash_out_date, runway, budget_vs_actual,
                   financial_summary, sector_highlight_a, sector_highlight_b,
                   key_risks, personnel_updates, next_milestones,
                   processed_at, manually_edited
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
                'sector': report_row[4],
                'cash_on_hand': float(report_row[5]) if report_row[5] is not None else None,
                'monthly_burn_rate': float(report_row[6]) if report_row[6] is not None else None,
                'cash_out_date': report_row[7],
                'runway': int(report_row[8]) if report_row[8] is not None else None,
                'budget_vs_actual': report_row[9],
                'financial_summary': report_row[10],
                'sector_highlight_a': report_row[11],
                'sector_highlight_b': report_row[12],
                'key_risks': report_row[13],
                'personnel_updates': report_row[14],
                'next_milestones': report_row[15],
                'processed_at': report_row[16].isoformat() if report_row[16] else None,
                'manually_edited': bool(report_row[17]) if report_row[17] is not None else False
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

def update_company(db_config: Dict, data: Dict) -> Dict[str, Any]:
    """
    Update company information.
    Expected data format:
    {
        "company_id": 123,
        "updates": {
            "name": "New Company Name",
            "normalized_name": "newcompanyname"
        }
    }
    """
    
    if not data.get("company_id"):
        return {
            'success': False,
            'error': 'company_id is required'
        }
    
    updates = data.get("updates", {})
    if not updates:
        return {
            'success': False,
            'error': 'updates are required'
        }
    
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Verify company exists
        cursor.execute("SELECT id, name FROM companies WHERE id = %s", [data['company_id']])
        company_row = cursor.fetchone()
        
        if not company_row:
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': 'Company not found'
            }
        
        company_id, original_name = company_row
        
        # Build dynamic update query
        set_clauses = []
        params = []
        
        allowed_fields = ['name', 'normalized_name']
        for field, value in updates.items():
            if field in allowed_fields:
                set_clauses.append(f"{field} = %s")
                params.append(str(value) if value is not None else None)
        
        if not set_clauses:
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': 'No valid fields to update'
            }
        
        # Add audit fields
        set_clauses.extend([
            "manually_edited = %s",
            "edited_by = %s", 
            "edited_at = CURRENT_TIMESTAMP",
            "updated_at = CURRENT_TIMESTAMP"
        ])
        params.extend([True, "system", company_id])
        
        update_query = f"UPDATE companies SET {', '.join(set_clauses)} WHERE id = %s"
        cursor.execute(update_query, params)
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': {
                'company_id': company_id,
                'original_name': original_name,
                'updated_fields': list(updates.keys()),
                'manually_edited': True
            }
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to update company: {str(e)}'
        }

def update_cap_table_round(db_config: Dict, data: Dict) -> Dict[str, Any]:
    """
    Update cap table round information.
    Expected data format:
    {
        "round_id": 123,
        "updates": {
            "valuation": 50000000,
            "amount_raised": 10000000,
            "round_date": "2025-01-15"
        }
    }
    """
    
    if not data.get("round_id"):
        return {
            'success': False,
            'error': 'round_id is required'
        }
    
    updates = data.get("updates", {})
    if not updates:
        return {
            'success': False,
            'error': 'updates are required'
        }
    
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Verify round exists
        cursor.execute("SELECT id, company_id, round_name FROM cap_table_rounds WHERE id = %s", [data['round_id']])
        round_row = cursor.fetchone()
        
        if not round_row:
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': 'Cap table round not found'
            }
        
        round_id, company_id, round_name = round_row
        
        # Build dynamic update query
        set_clauses = []
        params = []
        
        numeric_fields = ['valuation', 'amount_raised', 'total_pool_size', 'pool_available']
        text_fields = ['round_name']
        date_fields = ['round_date']
        
        for field, value in updates.items():
            if field in numeric_fields:
                set_clauses.append(f"{field} = %s")
                params.append(float(value) if value is not None else None)
            elif field in text_fields:
                set_clauses.append(f"{field} = %s")
                params.append(str(value) if value is not None else None)
            elif field in date_fields:
                set_clauses.append(f"{field} = %s")
                if value:
                    try:
                        date_obj = datetime.strptime(str(value), '%Y-%m-%d').date()
                        params.append(date_obj)
                    except ValueError:
                        params.append(None)
                else:
                    params.append(None)
        
        if not set_clauses:
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': 'No valid fields to update'
            }
        
        # Add audit fields
        set_clauses.extend([
            "manually_edited = %s",
            "edited_by = %s",
            "edited_at = CURRENT_TIMESTAMP", 
            "updated_at = CURRENT_TIMESTAMP"
        ])
        params.extend([True, "system", round_id])
        
        update_query = f"UPDATE cap_table_rounds SET {', '.join(set_clauses)} WHERE id = %s"
        cursor.execute(update_query, params)
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': {
                'round_id': round_id,
                'company_id': company_id,
                'round_name': round_name,
                'updated_fields': list(updates.keys()),
                'manually_edited': True
            }
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to update cap table round: {str(e)}'
        }

def update_cap_table_investor(db_config: Dict, data: Dict) -> Dict[str, Any]:
    """
    Update cap table investor information.
    Expected data format:
    {
        "investor_id": 123,
        "updates": {
            "total_invested": 5000000,
            "final_fds": 0.2,
            "final_round_investment": 2000000
        }
    }
    """
    
    if not data.get("investor_id"):
        return {
            'success': False,
            'error': 'investor_id is required'
        }
    
    updates = data.get("updates", {})
    if not updates:
        return {
            'success': False,
            'error': 'updates are required'
        }
    
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Verify investor exists
        cursor.execute("SELECT id, cap_table_round_id, investor_name FROM cap_table_investors WHERE id = %s", [data['investor_id']])
        investor_row = cursor.fetchone()
        
        if not investor_row:
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': 'Investor not found'
            }
        
        investor_id, round_id, investor_name = investor_row
        
        # Build dynamic update query
        set_clauses = []
        params = []
        
        numeric_fields = ['total_invested', 'final_round_investment']
        percentage_fields = ['final_fds']
        text_fields = ['investor_name']
        
        for field, value in updates.items():
            if field in numeric_fields:
                set_clauses.append(f"{field} = %s")
                params.append(float(value) if value is not None else None)
            elif field in percentage_fields:
                set_clauses.append(f"{field} = %s")
                params.append(float(value) if value is not None else None)
            elif field in text_fields:
                set_clauses.append(f"{field} = %s")
                params.append(str(value) if value is not None else None)
        
        if not set_clauses:
            cursor.close()
            conn.close()
            return {
                'success': False,
                'error': 'No valid fields to update'
            }
        
        # Add audit fields
        set_clauses.extend([
            "manually_edited = %s",
            "edited_by = %s",
            "edited_at = CURRENT_TIMESTAMP"
        ])
        params.extend([True, "system", investor_id])
        
        update_query = f"UPDATE cap_table_investors SET {', '.join(set_clauses)} WHERE id = %s"
        cursor.execute(update_query, params)
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': {
                'investor_id': investor_id,
                'round_id': round_id,
                'investor_name': investor_name,
                'updated_fields': list(updates.keys()),
                'manually_edited': True
            }
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to update investor: {str(e)}'
        }

def get_all_company_data(db_config: Dict, company_id: str) -> Dict[str, Any]:
    """
    Get all database data for a company for comprehensive editing view.
    Returns raw database records with full field information.
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
        
        # Get company data
        cursor.execute("""
            SELECT id, name, normalized_name, manually_edited, edited_by, edited_at, created_at, updated_at
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
            'manually_edited': company_row[3],
            'edited_by': company_row[4],
            'edited_at': company_row[5].isoformat() if company_row[5] else None,
            'created_at': company_row[6].isoformat() if company_row[6] else None,
            'updated_at': company_row[7].isoformat() if company_row[7] else None
        }
        
        # Get all financial reports (not just latest)
        cursor.execute("""
            SELECT id, file_name, report_date, report_period, sector, cash_on_hand,
                   monthly_burn_rate, cash_out_date, runway, budget_vs_actual,
                   financial_summary, sector_highlight_a, sector_highlight_b,
                   key_risks, personnel_updates, next_milestones,
                   manually_edited, edited_by, edited_at, upload_date, processed_at, processing_status
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
                'sector': report_row[4],
                'cash_on_hand': float(report_row[5]) if report_row[5] is not None else None,
                'monthly_burn_rate': float(report_row[6]) if report_row[6] is not None else None,
                'cash_out_date': report_row[7],
                'runway': int(report_row[8]) if report_row[8] is not None else None,
                'budget_vs_actual': report_row[9],
                'financial_summary': report_row[10],
                'sector_highlight_a': report_row[11],
                'sector_highlight_b': report_row[12],
                'key_risks': report_row[13],
                'personnel_updates': report_row[14],
                'next_milestones': report_row[15],
                'manually_edited': bool(report_row[16]) if report_row[16] is not None else False,
                'edited_by': report_row[17],
                'edited_at': report_row[18].isoformat() if report_row[18] else None,
                'upload_date': report_row[19].isoformat() if report_row[19] else None,
                'processed_at': report_row[20].isoformat() if report_row[20] else None,
                'processing_status': report_row[21]
            })
        
        # Get cap table rounds
        cap_table_rounds = []
        try:
            # Try to fetch with new option pool columns first
            cursor.execute("""
                SELECT id, round_name, valuation, amount_raised, round_date,
                       total_pool_size, pool_available, pool_utilization, options_outstanding,
                       manually_edited, edited_by, edited_at, created_at, updated_at
                FROM cap_table_rounds
                WHERE company_id = %s
                ORDER BY round_date DESC, created_at DESC
            """, [company_id])
            
            for round_row in cursor.fetchall():
                cap_table_rounds.append({
                    'id': round_row[0],
                    'round_name': round_row[1],
                    'valuation': float(round_row[2]) if round_row[2] is not None else None,
                    'amount_raised': float(round_row[3]) if round_row[3] is not None else None,
                    'round_date': round_row[4].isoformat() if round_row[4] else None,
                    'total_pool_size': float(round_row[5]) if round_row[5] is not None else None,
                    'pool_available': float(round_row[6]) if round_row[6] is not None else None,
                    'pool_utilization': float(round_row[7]) if round_row[7] is not None else None,
                    'options_outstanding': float(round_row[8]) if round_row[8] is not None else None,
                    'manually_edited': bool(round_row[9]) if round_row[9] is not None else False,
                    'edited_by': round_row[10],
                    'edited_at': round_row[11].isoformat() if round_row[11] else None,
                    'created_at': round_row[12].isoformat() if round_row[12] else None,
                    'updated_at': round_row[13].isoformat() if round_row[13] else None
                })
        except Exception as e:
            print(f"Warning: Could not fetch cap table rounds with new columns, trying fallback: {str(e)}")
            # Fallback to old query for backwards compatibility
            try:
                cursor.execute("""
                    SELECT id, round_name, valuation, amount_raised, round_date,
                           total_pool_size, pool_available, manually_edited, edited_by, edited_at, created_at, updated_at
                    FROM cap_table_rounds
                    WHERE company_id = %s
                    ORDER BY round_date DESC, created_at DESC
                """, [company_id])
                
                for round_row in cursor.fetchall():
                    cap_table_rounds.append({
                        'id': round_row[0],
                        'round_name': round_row[1],
                        'valuation': float(round_row[2]) if round_row[2] is not None else None,
                        'amount_raised': float(round_row[3]) if round_row[3] is not None else None,
                        'round_date': round_row[4].isoformat() if round_row[4] else None,
                        'total_pool_size': float(round_row[5]) if round_row[5] is not None else None,
                        'pool_available': float(round_row[6]) if round_row[6] is not None else None,
                        'pool_utilization': None,  # New field, set to None for backwards compatibility
                        'options_outstanding': None,  # New field, set to None for backwards compatibility
                        'manually_edited': bool(round_row[7]) if round_row[7] is not None else False,
                        'edited_by': round_row[8],
                        'edited_at': round_row[9].isoformat() if round_row[9] else None,
                        'created_at': round_row[10].isoformat() if round_row[10] else None,
                        'updated_at': round_row[11].isoformat() if round_row[11] else None
                    })
            except Exception as e2:
                print(f"Warning: Could not fetch cap table rounds: {str(e2)}")
        
        # Get cap table investors for all rounds
        cap_table_investors = []
        if cap_table_rounds:
            round_ids = [r['id'] for r in cap_table_rounds]
            placeholders = ','.join(['%s'] * len(round_ids))
            
            try:
                cursor.execute(f"""
                    SELECT id, cap_table_round_id, investor_name, total_invested, final_fds,
                           final_round_investment, manually_edited, edited_by, edited_at, created_at
                    FROM cap_table_investors
                    WHERE cap_table_round_id IN ({placeholders})
                    ORDER BY total_invested DESC
                """, round_ids)
                
                for investor_row in cursor.fetchall():
                    cap_table_investors.append({
                        'id': investor_row[0],
                        'cap_table_round_id': investor_row[1],
                        'investor_name': investor_row[2],
                        'total_invested': float(investor_row[3]) if investor_row[3] is not None else None,
                        'final_fds': float(investor_row[4]) if investor_row[4] is not None else None,
                        'final_round_investment': float(investor_row[5]) if investor_row[5] is not None else None,
                        'manually_edited': bool(investor_row[6]) if investor_row[6] is not None else False,
                        'edited_by': investor_row[7],
                        'edited_at': investor_row[8].isoformat() if investor_row[8] else None,
                        'created_at': investor_row[9].isoformat() if investor_row[9] else None
                    })
            except Exception as e:
                print(f"Warning: Could not fetch cap table investors: {str(e)}")
        
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': {
                'company': company_data,
                'financial_reports': financial_reports,
                'cap_table_rounds': cap_table_rounds,
                'cap_table_investors': cap_table_investors,
                'summary': {
                    'financial_reports_count': len(financial_reports),
                    'cap_table_rounds_count': len(cap_table_rounds),
                    'cap_table_investors_count': len(cap_table_investors)
                }
            }
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to get all company data: {str(e)}'
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

def get_company_enrichment(db_config: Dict, company_id: int) -> Dict[str, Any]:
    """
    Retrieve enrichment data for a company
    """
    if not company_id:
        return {
            'success': False,
            'error': 'Company ID is required'
        }
    
    try:
        # Get database connection
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
            
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Query enrichment data
        cursor.execute("""
            SELECT id, company_id, harmonic_entity_urn, harmonic_data, 
                   extracted_data, enrichment_status, enriched_at, 
                   created_at, updated_at
            FROM company_enrichments 
            WHERE company_id = %s 
            ORDER BY enriched_at DESC 
            LIMIT 1
        """, [company_id])
        
        result = cursor.fetchone()
        
        if result:
            # Get the extracted data and enhance it with person enrichments
            extracted_data = result[4]
            if extracted_data:
                # Enhance CEO data with person enrichment
                if extracted_data.get('ceo') and extracted_data['ceo'].get('person_urn'):
                    person_urn = extracted_data['ceo']['person_urn']
                    cursor.execute("""
                        SELECT full_name, first_name, last_name, title, extracted_data
                        FROM person_enrichments 
                        WHERE person_urn = %s 
                        ORDER BY enriched_at DESC 
                        LIMIT 1
                    """, [person_urn])
                    
                    person_result = cursor.fetchone()
                    if person_result:
                        extracted_data['ceo']['enriched_person'] = {
                            'full_name': person_result[0],
                            'first_name': person_result[1],
                            'last_name': person_result[2],
                            'title': person_result[3],
                            'extracted_data': person_result[4]
                        }
                
                # Enhance leadership data with person enrichments
                if extracted_data.get('leadership'):
                    for leader in extracted_data['leadership']:
                        if leader.get('person_urn'):
                            person_urn = leader['person_urn']
                            cursor.execute("""
                                SELECT full_name, first_name, last_name, title, extracted_data
                                FROM person_enrichments 
                                WHERE person_urn = %s 
                                ORDER BY enriched_at DESC 
                                LIMIT 1
                            """, [person_urn])
                            
                            person_result = cursor.fetchone()
                            if person_result:
                                leader['enriched_person'] = {
                                    'full_name': person_result[0],
                                    'first_name': person_result[1],
                                    'last_name': person_result[2],
                                    'title': person_result[3],
                                    'extracted_data': person_result[4]
                                }
        
        cursor.close()
        conn.close()
        
        if result:
            return {
                'success': True,
                'data': {
                    'id': result[0],
                    'company_id': result[1], 
                    'harmonic_entity_urn': result[2],
                    'harmonic_data': result[3],
                    'extracted_data': extracted_data,
                    'enrichment_status': result[5],
                    'enriched_at': result[6].isoformat() if result[6] else None,
                    'created_at': result[7].isoformat() if result[7] else None,
                    'updated_at': result[8].isoformat() if result[8] else None
                }
            }
        else:
            return {
                'success': True,
                'data': None
            }
            
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to retrieve enrichment data: {str(e)}'
        }

def delete_company_enrichment(db_config: Dict, company_id: int) -> Dict[str, Any]:
    """
    Delete enrichment data for a company
    """
    if not company_id:
        return {
            'success': False,
            'error': 'Company ID is required'
        }
    
    try:
        # Get database connection
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
            
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Delete enrichment data
        cursor.execute("""
            DELETE FROM company_enrichments 
            WHERE company_id = %s
            RETURNING id
        """, [company_id])
        
        deleted_id = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
        
        if deleted_id:
            return {
                'success': True,
                'data': {
                    'deleted_id': deleted_id[0],
                    'company_id': company_id
                }
            }
        else:
            return {
                'success': True,
                'data': None,
                'message': 'No enrichment data found to delete'
            }
            
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to delete enrichment data: {str(e)}'
        }

def get_person_enrichment(db_config: Dict, person_urn: str) -> Dict[str, Any]:
    """
    Retrieve person enrichment data by person URN
    """
    if not person_urn:
        return {
            'success': False,
            'error': 'person_urn is required'
        }
    
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
            
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, person_urn, company_id, full_name, first_name, last_name,
                   title, harmonic_data, extracted_data, enrichment_status, 
                   enriched_at, created_at, updated_at
            FROM person_enrichments 
            WHERE person_urn = %s 
            ORDER BY enriched_at DESC 
            LIMIT 1
        """, [person_urn])
        
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if result:
            return {
                'success': True,
                'data': {
                    'id': result[0],
                    'person_urn': result[1],
                    'company_id': result[2],
                    'full_name': result[3],
                    'first_name': result[4],
                    'last_name': result[5],
                    'title': result[6],
                    'harmonic_data': result[7],
                    'extracted_data': result[8],
                    'enrichment_status': result[9],
                    'enriched_at': result[10].isoformat() if result[10] else None,
                    'created_at': result[11].isoformat() if result[11] else None,
                    'updated_at': result[12].isoformat() if result[12] else None
                }
            }
        else:
            return {
                'success': True,
                'data': None
            }
            
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to retrieve person enrichment data: {str(e)}'
        }

def get_company_people(db_config: Dict, company_id: int) -> Dict[str, Any]:
    """
    Get all enriched people for a company
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
        
        cursor.execute("""
            SELECT id, person_urn, full_name, first_name, last_name,
                   title, extracted_data, enrichment_status, enriched_at
            FROM person_enrichments 
            WHERE company_id = %s 
            ORDER BY enriched_at DESC
        """, [company_id])
        
        results = cursor.fetchall()
        cursor.close()
        conn.close()
        
        people = []
        for result in results:
            people.append({
                'id': result[0],
                'person_urn': result[1],
                'full_name': result[2],
                'first_name': result[3],
                'last_name': result[4],
                'title': result[5],
                'extracted_data': result[6],
                'enrichment_status': result[7],
                'enriched_at': result[8].isoformat() if result[8] else None
            })
        
        return {
            'success': True,
            'data': {
                'company_id': company_id,
                'people': people,
                'total_count': len(people)
            }
        }
            
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to retrieve company people: {str(e)}'
        }

def delete_person_enrichment(db_config: Dict, person_urn: str) -> Dict[str, Any]:
    """
    Delete person enrichment data by person URN
    """
    if not person_urn:
        return {
            'success': False,
            'error': 'person_urn is required'
        }
    
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
            
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        cursor.execute("""
            DELETE FROM person_enrichments 
            WHERE person_urn = %s
            RETURNING id, company_id
        """, [person_urn])
        
        deleted_result = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
        
        if deleted_result:
            return {
                'success': True,
                'data': {
                    'deleted_id': deleted_result[0],
                    'company_id': deleted_result[1],
                    'person_urn': person_urn
                }
            }
        else:
            return {
                'success': True,
                'data': None,
                'message': 'No person enrichment data found to delete'
            }
            
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to delete person enrichment data: {str(e)}'
        }

def delete_company(db_config: Dict, company_id: int) -> Dict[str, Any]:
    """
    Delete a company and all its associated data using CASCADE deletes.
    Returns summary of what was deleted.
    """
    if not company_id:
        return {
            'success': False,
            'error': 'company_id is required'
        }
    
    conn_result = get_database_connection(db_config)
    if not conn_result['success']:
        return conn_result
    
    conn = conn_result['connection']
    
    try:
        conn.autocommit = False
        cur = conn.cursor()
        
        # First, get preview of what will be deleted (for logging/audit)
        cur.execute("""
            SELECT 
                c.name as company_name,
                (SELECT count(*) FROM financial_reports WHERE company_id = %s) as reports_count,
                (SELECT count(*) FROM cap_table_rounds WHERE company_id = %s) as rounds_count,
                (SELECT count(*) FROM cap_table_investors ci 
                 JOIN cap_table_rounds ctr ON ci.cap_table_round_id = ctr.id 
                 WHERE ctr.company_id = %s) as investors_count,
                (SELECT count(*) FROM person_enrichments WHERE company_id = %s) as people_count,
                (SELECT count(*) FROM company_enrichments WHERE company_id = %s) as enrichments_count
            FROM companies c 
            WHERE c.id = %s
        """, (company_id, company_id, company_id, company_id, company_id, company_id))
        
        preview = cur.fetchone()
        if not preview:
            return {
                'success': False,
                'error': f'Company with id {company_id} not found'
            }
        
        company_name = preview[0]
        cascaded_counts = {
            'financial_reports': preview[1],
            'cap_table_rounds': preview[2], 
            'cap_table_investors': preview[3],
            'person_enrichments': preview[4],
            'company_enrichments': preview[5]
        }
        
        # Delete the company - CASCADE will handle all related data
        cur.execute("DELETE FROM companies WHERE id = %s", (company_id,))
        deleted_companies = cur.rowcount
        
        if deleted_companies == 0:
            conn.rollback()
            return {
                'success': False,
                'error': f'Failed to delete company {company_id}'
            }
        
        conn.commit()
        
        return {
            'success': True,
            'data': {
                'deleted_company_id': company_id,
                'company_name': company_name,
                'cascaded_deletions': cascaded_counts,
                'total_records_deleted': sum(cascaded_counts.values()) + deleted_companies
            }
        }
        
    except Exception as e:
        conn.rollback()
        return {
            'success': False,
            'error': f'Failed to delete company: {str(e)}'
        }
    finally:
        conn.close()

def get_company_names(db_config: Dict) -> Dict[str, Any]:
    """
    Get all company names for dropdown selection
    """
    try:
        conn_result = get_database_connection(db_config)
        if not conn_result['success']:
            return conn_result
        
        conn = conn_result['connection']
        cursor = conn.cursor()
        
        # Get all company names sorted alphabetically
        query = """
            SELECT id, name, manually_edited
            FROM companies
            ORDER BY LOWER(name) ASC
        """
        
        cursor.execute(query)
        companies = _cursor_to_dict(cursor)
        
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'data': companies
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': f'Failed to get company names: {str(e)}'
        } 