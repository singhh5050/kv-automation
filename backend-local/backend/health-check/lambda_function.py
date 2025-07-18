import json

def lambda_handler(event, context):
    """
    AWS Lambda function to handle health check requests
    This replaces the /health endpoint from the Flask app
    """
    
    # Handle CORS for browser requests
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
    
    # Health check logic
    try:
        # You can add more health checks here later (database connectivity, etc.)
        health_status = {
            'status': 'healthy',
            'timestamp': context.aws_request_id,  # Use request ID as timestamp reference
            'function_name': context.function_name,
            'function_version': context.function_version
        }
        
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(health_status)
        }
        
    except Exception as e:
        # Handle any errors
        error_response = {
            'status': 'unhealthy',
            'error': str(e)
        }
        
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps(error_response)
        } 