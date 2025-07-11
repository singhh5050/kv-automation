import json
import os
import pg8000
import ssl

def lambda_handler(event, context):
    """
    AWS Lambda function to test PostgreSQL RDS connectivity using pg8000
    This uses the pg8000 library with SSL support for proper authentication
    """
    
    # Handle CORS
    headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
    
    # Handle OPTIONS request (CORS preflight)
    if event.get('httpMethod') == 'OPTIONS' or event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'message': 'CORS preflight handled'})
        }
    
    try:
        # Database configuration from environment variables
        db_config = {
            'host': os.environ.get('DB_HOST', 'database-1.cgr2i0s2iki4.us-east-1.rds.amazonaws.com'),
            'port': int(os.environ.get('DB_PORT', '5432')),
            'database': os.environ.get('DB_NAME', 'postgres'),
            'user': os.environ.get('DB_USER', 'postgres'),
            'password': os.environ.get('DB_PASSWORD', 'frontbackandbesideit')
        }
        
        # Test connection using pg8000 with SSL
        result = test_postgresql_connection_pg8000(db_config)
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({
                    'status': 'success',
                    'message': 'Successfully connected to PostgreSQL with SSL',
                    'connection_test': True,
                    'database_info': {
                        'host': db_config['host'],
                        'database': db_config['database'],
                        'connection_method': 'pg8000 with SSL/TLS',
                        'server_version': result.get('server_version', 'Unknown')
                    },
                    'driver_info': {
                        'driver': 'pg8000 (pure Python PostgreSQL driver)',
                        'method': 'Native PostgreSQL protocol with SSL',
                        'ssl_enabled': True
                    },
                    'function_info': {
                        'function_name': context.function_name,
                        'request_id': context.aws_request_id
                    },
                    'test_results': result.get('test_results', {})
                })
            }
        else:
            return {
                'statusCode': 500,
                'headers': headers,
                'body': json.dumps({
                    'status': 'connection_failed',
                    'message': f'Failed to connect to database: {result["error"]}',
                    'connection_test': False,
                    'troubleshooting': {
                        'check_layer': 'Ensure pg8000 Lambda layer is attached',
                        'check_vpc_config': 'Ensure Lambda is in same VPC as RDS',
                        'check_security_groups': 'Verify security group allows Lambda→RDS on port 5432',
                        'check_subnets': 'Lambda needs private subnets with NAT gateway access',
                        'check_ssl': 'RDS PostgreSQL requires SSL/TLS connections',
                        'check_credentials': 'Verify database username and password'
                    },
                    'error_details': result.get('error_details', {})
                })
            }
            
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({
                'status': 'error',
                'message': f'Unexpected error: {str(e)}',
                'connection_test': False,
                'troubleshooting': {
                    'check_layer': 'Ensure pg8000 Lambda layer is attached to this function',
                    'check_import': 'Verify pg8000 can be imported (layer compatibility)'
                }
            })
        }

def test_postgresql_connection_pg8000(db_config):
    """
    Test PostgreSQL connection using pg8000 with SSL
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
        
        # Test basic functionality
        cursor = conn.cursor()
        
        # Test 1: Get PostgreSQL version
        cursor.execute("SELECT version();")
        version_result = cursor.fetchone()
        server_version = version_result[0] if version_result else "Unknown"
        
        # Test 2: Test basic query
        cursor.execute("SELECT current_timestamp, current_user;")
        timestamp_result = cursor.fetchone()
        current_time = timestamp_result[0] if timestamp_result else None
        current_user = timestamp_result[1] if timestamp_result else None
        
        # Test 3: Check if we can list databases (basic privilege test)
        try:
            cursor.execute("SELECT datname FROM pg_database WHERE datistemplate = false;")
            databases = cursor.fetchall()
            database_list = [row[0] for row in databases] if databases else []
        except Exception as e:
            database_list = f"Permission denied: {str(e)}"
        
        # Test 4: Check current database and schema
        cursor.execute("SELECT current_database(), current_schema();")
        db_schema_result = cursor.fetchone()
        current_db = db_schema_result[0] if db_schema_result else None
        current_schema = db_schema_result[1] if db_schema_result else None
        
        # Test 5: Check if we can create tables (for schema creation)
        try:
            cursor.execute("CREATE TABLE IF NOT EXISTS connection_test (id SERIAL PRIMARY KEY, test_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP);")
            cursor.execute("DROP TABLE IF EXISTS connection_test;")
            can_create_tables = True
        except Exception as e:
            can_create_tables = f"Cannot create tables: {str(e)}"
        
        cursor.close()
        conn.close()
        
        return {
            'success': True,
            'server_version': server_version,
            'test_results': {
                'connection_time': str(current_time),
                'connected_user': current_user,
                'current_database': current_db,
                'current_schema': current_schema,
                'available_databases': database_list,
                'can_create_tables': can_create_tables,
                'ssl_enabled': True,
                'driver': 'pg8000'
            }
        }
        
    except Exception as e:
        error_type = type(e).__name__
        error_message = str(e)
        
        # Provide specific troubleshooting based on error type
        if "authentication failed" in error_message.lower():
            suggestion = "Check database credentials (username/password)"
        elif "no route to host" in error_message.lower():
            suggestion = "Check VPC configuration and security groups"
        elif "connection refused" in error_message.lower():
            suggestion = "Check security group allows port 5432"
        elif "timeout" in error_message.lower():
            suggestion = "Check VPC/subnet configuration and NAT gateway"
        elif "ssl" in error_message.lower():
            suggestion = "SSL configuration issue - check SSL context"
        elif "no module named" in error_message.lower():
            suggestion = "pg8000 layer not attached or incompatible runtime"
        else:
            suggestion = "Check Lambda VPC configuration and RDS accessibility"
        
        return {
            'success': False,
            'error': f'{error_type}: {error_message}',
            'error_details': {
                'error_type': error_type,
                'error_message': error_message,
                'suggestion': suggestion,
                'config_check': {
                    'host': db_config['host'],
                    'port': db_config['port'],
                    'database': db_config['database'],
                    'user': db_config['user']
                }
            }
        }

# For local testing
if __name__ == "__main__":
    test_event = {}
    test_context = type('Context', (), {
        'function_name': 'local_test',
        'aws_request_id': 'local_test_id'
    })()
    
    result = lambda_handler(test_event, test_context)
    print(json.dumps(result, indent=2)) 