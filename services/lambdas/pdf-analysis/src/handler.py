import json
import base64
import tempfile
import os
import sys
import traceback
import pg8000
import boto3
import concurrent.futures
import threading
from datetime import datetime


# Add the Lambda layer path for dependencies
sys.path.insert(0, '/opt/python')

def debug_object_recursively(obj, path="", max_depth=5, current_depth=0):
    """Recursively debug an object to find all fields and their values"""
    if current_depth >= max_depth:
        print(f"🔍 {path}: <max_depth_reached>")
        return
    
    try:
        obj_type = type(obj).__name__
        
        if isinstance(obj, str):
            snippet = (obj[:100] + "...") if len(obj) > 100 else obj
            print(f"🔍 {path}: str[{len(obj)}] = '{snippet}'")
        elif isinstance(obj, (int, float, bool, type(None))):
            print(f"🔍 {path}: {obj_type} = {obj}")
        elif isinstance(obj, (list, tuple)):
            print(f"🔍 {path}: {obj_type}[{len(obj)}]")
            for i, item in enumerate(obj[:5]):  # Only show first 5 items
                debug_object_recursively(item, f"{path}[{i}]", max_depth, current_depth + 1)
            if len(obj) > 5:
                print(f"🔍 {path}: ... and {len(obj) - 5} more items")
        elif isinstance(obj, dict):
            print(f"🔍 {path}: dict with keys: {list(obj.keys())}")
            for key, value in obj.items():
                debug_object_recursively(value, f"{path}.{key}", max_depth, current_depth + 1)
        elif hasattr(obj, '__dict__'):
            attrs = [attr for attr in dir(obj) if not attr.startswith('_')]
            print(f"🔍 {path}: {obj_type} with attrs: {attrs}")
            for attr in attrs[:10]:  # Only show first 10 attributes
                try:
                    value = getattr(obj, attr)
                    if not callable(value):  # Skip methods
                        debug_object_recursively(value, f"{path}.{attr}", max_depth, current_depth + 1)
                except Exception as e:
                    print(f"🔍 {path}.{attr}: <error accessing: {e}>")
        else:
            print(f"🔍 {path}: {obj_type} = {str(obj)[:100]}")
    except Exception as e:
        print(f"🔍 {path}: <error debugging: {e}>")

def extract_output_text(resp) -> str:
    """
    Robustly extract plain text from Responses API objects.
    Prefers the SDK helper .output_text, then falls back to flattening content parts.
    """
    print(f"🔍 extract_output_text called with resp type: {type(resp)}")
    
    # 1) Preferred: SDK helper (handles multiple parts automatically)
    txt = getattr(resp, "output_text", None)
    print(f"🔍 resp.output_text = {txt} (type: {type(txt)})")
    if isinstance(txt, str) and txt.strip():
        print(f"🔍 Using SDK helper output_text: {len(txt)} chars")
        return txt.strip()

    # 2) Fallback: flatten output → content → text.value
    print(f"🔍 Falling back to manual extraction")
    out = []
    output = getattr(resp, "output", None)
    print(f"🔍 resp.output = {output} (type: {type(output)})")
    
    if output:
        # resp.output is typically a list of "message" objects
        items = output if isinstance(output, list) else [output]
        print(f"🔍 Processing {len(items)} output items")
        
        for i, item in enumerate(items):
            print(f"🔍 Item {i}: type={type(item)}, dir={[attr for attr in dir(item) if not attr.startswith('_')]}")
            
            content = getattr(item, "content", None)
            if not content and isinstance(item, dict):
                content = item.get("content")
            print(f"🔍 Item {i} content: {content} (type: {type(content)})")
            
            if not content:
                continue

            content_items = content if isinstance(content, list) else [content]
            print(f"🔍 Processing {len(content_items)} content items for item {i}")
            
            for j, c in enumerate(content_items):
                print(f"🔍 Content {j}: type={type(c)}, dir={[attr for attr in dir(c) if not attr.startswith('_')]}")
                
                # pydantic object or dict; look for .type and .text.value
                ctype = getattr(c, "type", None) or (c.get("type") if isinstance(c, dict) else None)
                print(f"🔍 Content {j} type: {ctype}")
                
                if ctype in ("output_text", "text"):
                    # pydantic-style
                    text_obj = getattr(c, "text", None)
                    print(f"🔍 Content {j} text_obj: {text_obj} (type: {type(text_obj)})")
                    
                    if text_obj and hasattr(text_obj, "value"):
                        val = text_obj.value or ""
                        print(f"🔍 Found pydantic text.value: {len(val)} chars")
                        if val:
                            out.append(val)
                    # dict-style
                    elif isinstance(c, dict):
                        t = c.get("text")
                        print(f"🔍 Dict-style text: {t} (type: {type(t)})")
                        if isinstance(t, dict) and t.get("value"):
                            print(f"🔍 Found dict text.value: {len(t['value'])} chars")
                            out.append(t["value"])
                        elif isinstance(t, str):
                            print(f"🔍 Found direct text string: {len(t)} chars")
                            out.append(t)

    result = "\n".join(s for s in out if s).strip()
    print(f"🔍 extract_output_text returning: {len(result)} chars")
    return result

def delete_placeholder_pdfs_direct(company_id: int) -> int:
    """
    Directly delete placeholder PDFs from the database for a specific company
    Returns the number of deleted placeholder reports
    """
    import ssl
    
    try:
        print(f"🗑️ Checking for placeholder PDFs for company_id={company_id}")
        
        # Database configuration (same pattern as other functions)
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect to database
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # First check if placeholder PDFs exist
        cursor.execute("""
            SELECT id, file_name FROM financial_reports 
            WHERE company_id = %s AND file_name = %s
        """, [company_id, '_company_creation_placeholder.pdf'])
        
        placeholder_reports = cursor.fetchall()
        print(f"🔍 Found {len(placeholder_reports)} placeholder report(s)")
        
        if not placeholder_reports:
            cursor.close()
            conn.close()
            return 0
        
        # Delete placeholder reports
        cursor.execute("""
            DELETE FROM financial_reports 
            WHERE company_id = %s AND file_name = %s
        """, [company_id, '_company_creation_placeholder.pdf'])
        
        deleted_count = cursor.rowcount
        print(f"🗑️ Deleted {deleted_count} placeholder report(s) from database")
        
        # Commit the transaction
        conn.commit()
        cursor.close()
        conn.close()
        
        return deleted_count
        
    except Exception as e:
        print(f"❌ Failed to delete placeholder PDFs: {str(e)}")
        raise e


def lambda_handler(event, context):
    """
    Lambda function for PDF extraction and OpenAI analysis
    Supports S3 events, KPI analysis requests, and health check requests
    """
    
    # Log the incoming event for debugging
    print(f"Lambda invoked with event: {json.dumps(event)[:500]}...")
    
    # Enhanced event type detection - S3 events first
    if 'Records' in event and event['Records'][0].get('eventSource') == 'aws:s3':
        print("🔄 Processing S3 event (new architecture)")
        return handle_s3_event(event, context)
    elif 'requestContext' in event and 'elb' in event['requestContext']:
        print("⚠️  WARNING: Received ELB event - S3 trigger not configured!")
        print(f"🔍 Event source: {event.get('requestContext', {})}")
        print("💡 Configure S3 bucket notification to trigger this Lambda on .pdf uploads")
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'S3 trigger not configured',
                'message': 'Configure S3 bucket notification to trigger this Lambda',
                'received_event_type': 'ELB'
            })
        }
    
    # Robust body parsing for API Gateway/Lambda invocations
    payload = {}
    raw = event.get("body")
    if raw:
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode("utf-8")
        if event.get("isBase64Encoded"):
            import base64
            raw = base64.b64decode(raw or "").decode("utf-8")
        try:
            payload = json.loads(raw) if raw else {}
        except Exception as e:
            print(f"⚠️ Failed to parse body as JSON: {e}")
            payload = {}
    
    # Also check direct event fields (for direct Lambda invocations)
    if not payload:
        payload = event
    
    # Unify access to action parameter
    qs = event.get("queryStringParameters") or {}
    action = payload.get("action") or qs.get("action") or event.get("action")
    
    print(f"🎯 Detected action: {action}")
    print(f"🔍 Payload keys: {list(payload.keys())}")
    
    # Handle CORS preflight
    if event.get("httpMethod") == "OPTIONS":
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            'body': ''
        }
    
    # Route based on action
    if action == 'list_pdfs':
        print("📁 Processing PDF listing request")
        return handle_kpi_analysis_request(payload, context)
    elif action == 'analyze_kpis':
        print("📊 Processing KPI analysis request")
        return handle_kpi_analysis_request(payload, context)
    elif action == 'create_async_kpi_job':
        print("🚀 Creating async KPI analysis job")
        return handle_create_async_job(payload, context)
    elif action == 'get_job_status':
        print("🔍 Getting job status")
        return handle_get_job_status(payload, context)
    elif action == 'get_latest_completed_job':
        print("🔍 Getting latest completed job")
        return handle_get_latest_completed_job(payload, context)
    elif action == 'process_async_kpi_job':
        print("⚡ Processing async KPI analysis job")
        return handle_process_async_job(payload, context)
    elif action == 'health_check':
        print("🏥 Processing health check request")
        return handle_health_check_request(payload, context)
    elif action == 'get_health_check':
        print("🔍 Getting latest health check")
        return handle_get_health_check_request(payload, context)
    elif action == 'generate_internal_summary':
        print("📝 Generating internal summary")
        return handle_generate_internal_summary_request(payload, context)
    elif action == 'competition_analysis':
        print("🔍 Processing competition analysis request")
        return handle_competition_analysis_request(payload, context)
    elif action == 'get_competition_analysis':
        print("🔍 Getting latest competition analysis")
        return handle_get_competition_analysis_request(payload, context)
    else:
        print(f"❌ Unknown action: {action}")
        return {
            'statusCode': 400,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
            },
            'body': json.dumps({'error': f'Unknown action: {action}. Supported actions: list_pdfs, analyze_kpis, create_async_kpi_job, get_job_status, get_latest_completed_job, process_async_kpi_job, health_check, get_health_check, generate_internal_summary, competition_analysis, get_competition_analysis'})
        }


def list_company_pdfs(company_id: int) -> dict:
    """
    List available PDF files for a company in S3
    """
    try:
        import boto3
        s3_client = boto3.client('s3')
        bucket_name = os.environ.get('S3_BUCKET_NAME', 'kv-board-decks')
        
        print(f"📁 Listing PDFs for company {company_id}")
        
        # List objects in the company folder
        prefix = f"company-{company_id}/"
        response = s3_client.list_objects_v2(
            Bucket=bucket_name,
            Prefix=prefix,
            MaxKeys=1000
        )
        
        pdf_files = []
        if 'Contents' in response:
            for obj in response['Contents']:
                key = obj['Key']
                if key.lower().endswith('.pdf') and key != prefix:  # Exclude folder itself
                    file_name = key.replace(prefix, '')  # Remove prefix to get just filename
                    
                    # Try to extract report period from filename if it follows timestamp pattern
                    # Format: YYYY-MM-DDTHH-MM-SS-sssZ-originalname.pdf
                    import re
                    timestamp_match = re.match(r'^(\d{4}-\d{2}-\d{2})T\d{2}-\d{2}-\d{2}-\d{3}Z-(.+)\.pdf$', file_name)
                    if timestamp_match:
                        upload_date = timestamp_match.group(1)
                        original_name = timestamp_match.group(2)
                        # Try to extract period from original name (e.g., "Q1-2024", "2024-Q2", etc.)
                        period_match = re.search(r'(Q[1-4][-\s]*20\d{2}|20\d{2}[-\s]*Q[1-4]|20\d{2})', original_name, re.IGNORECASE)
                        report_period = period_match.group(0) if period_match else 'Unknown Period'
                    else:
                        upload_date = obj['LastModified'].strftime('%Y-%m-%d')
                        report_period = 'Unknown Period'
                    
                    pdf_files.append({
                        's3_key': key,  # Frontend expects 's3_key'
                        'file_name': file_name,  # Frontend expects 'file_name'
                        'report_period': report_period,  # Frontend expects 'report_period'
                        'upload_date': obj['LastModified'].isoformat(),  # Frontend expects 'upload_date'
                        'size': obj['Size'],
                        'last_modified': obj['LastModified'].isoformat()
                    })
        
        # Sort by last modified (newest first)
        pdf_files.sort(key=lambda x: x['last_modified'], reverse=True)
        
        print(f"✅ Found {len(pdf_files)} PDF files for company {company_id}")
        return {
            'success': True,
            'files': pdf_files
        }
        
    except Exception as e:
        print(f"❌ Failed to list PDFs for company {company_id}: {str(e)}")
        return {
            'success': False,
            'error': str(e),
            'files': []
        }


def handle_kpi_analysis_request(event, context):
    """
    Handle KPI analysis requests for multiple PDFs and PDF listing
    """
    # CORS headers for all responses
    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    try:
        # Check if this is a request to list PDFs
        if event.get('action') == 'list_pdfs':
            company_id = event.get('company_id')
            if not company_id:
                return {
                    'statusCode': 400,
                    'headers': cors_headers,
                    'body': json.dumps({'error': 'company_id is required'})
                }
            
            result = list_company_pdfs(company_id)
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps(result)
            }
        
        # Otherwise, handle KPI analysis request
        company_id = event.get('company_id')
        stage = event.get('stage')
        custom_config = event.get('custom_config')
        
        if not company_id:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'company_id is required'})
            }
        
        if not stage:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'stage is required (Early Stage, Main Stage, or Growth Stage)'})
            }
        
        print(f"🔍 KPI analysis requested for company {company_id}, stage: {stage}", '(custom)' if custom_config else '(standard)')
        
        # Perform the analysis
        selected_files = custom_config.get('selected_files') if custom_config else None
        result = analyze_recent_pdfs_for_kpis(company_id, stage, custom_config, selected_files)
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps(result)
            }
        else:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps(result)
            }
            
    except Exception as e:
        print(f"❌ KPI analysis request failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': f'KPI analysis failed: {str(e)}'
            })
        }

def handle_s3_event(event, context):
    """
    New S3 event handler using GPT-5 + Responses API + evidence tracking
    """
    try:
        import boto3
        
        # Process each S3 record (usually just one)
        for record in event['Records']:
            bucket = record['s3']['bucket']['name']
            key = record['s3']['object']['key']
            
            print(f"📄 Processing S3 object: s3://{bucket}/{key}")
            
            # CRITICAL: URL decode the S3 key (S3 events come URL-encoded)
            import urllib.parse
            decoded_key = urllib.parse.unquote_plus(key)
            print(f"🔓 Decoded S3 key: {decoded_key}")
            
            # Download PDF from S3 using the decoded key
            s3_client = boto3.client('s3')
            pdf_object = s3_client.get_object(Bucket=bucket, Key=decoded_key)
            pdf_bytes = pdf_object['Body'].read()
            
            print(f"✅ Downloaded PDF: {len(pdf_bytes)} bytes")
            
            # Extract filename and company_id from decoded S3 key
            filename = decoded_key.split('/')[-1] if '/' in decoded_key else decoded_key
            
            # Extract company_id from S3 key path (e.g., "company-123/report.pdf" -> 123)
            company_id = None
            if '/' in decoded_key:
                path_parts = decoded_key.split('/')
                for part in path_parts:
                    if part.startswith('company-'):
                        try:
                            company_id = int(part.replace('company-', ''))
                            print(f"📋 Extracted company_id: {company_id}")
                            break
                        except ValueError:
                            pass
            
            if not company_id:
                print("⚠️ No company_id found in S3 key path, checking object metadata...")
                # Try to get company_id from S3 object metadata
                try:
                    metadata = pdf_object.get('Metadata', {})
                    if 'company-id' in metadata:
                        company_id = int(metadata['company-id'])
                        print(f"📋 Extracted company_id from metadata: {company_id}")
                except (ValueError, TypeError):
                    print("❌ Could not extract company_id from metadata")
            
            # Analyze with GPT-5 + Responses API + evidence
            analysis_result = analyze_with_gpt5_responses_api(pdf_bytes, filename)
            
            # Add company_id to analysis result
            if company_id:
                analysis_result['company_id'] = company_id
                print(f"✅ Added company_id {company_id} to analysis result")
            
            # Store results in database with evidence
            stored = False
            if company_id:
                try:
                    print("💾 Storing analysis results in database...")
                    store_result_in_db(analysis_result, company_id)
                    stored = True
                    print("✅ Analysis results stored successfully")
                    
                    # Direct cleanup: Delete placeholder PDFs after successful processing
                    try:
                        print("🧹 Checking for placeholder PDFs to delete...")
                        deleted_count = delete_placeholder_pdfs_direct(company_id)
                        if deleted_count > 0:
                            print(f"✅ Deleted {deleted_count} placeholder PDF(s)")
                        else:
                            print("✅ No placeholder PDFs found to delete")
                    except Exception as cleanup_error:
                        print(f"⚠️ Placeholder cleanup failed (non-critical): {str(cleanup_error)}")
                        # Don't fail the main workflow for cleanup issues
                    
                except Exception as db_error:
                    print(f"❌ Database storage failed: {str(db_error)}")
                    # Continue processing - don't fail the entire workflow for DB issues
            else:
                print("⚠️ Skipping database storage - no company_id available")
            
            print(f"{'🎉' if stored else '⚠️'} Processed {filename}{'' if stored else ' (DB write failed)'}")
            
        return {
            'statusCode': 200,
            'body': json.dumps({'status': 'success', 'message': 'S3 event processed'})
        }
        
    except Exception as e:
        print(f"❌ Error processing S3 event: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'body': json.dumps({'status': 'error', 'message': str(e)})
        }


def normalize_analysis_for_db(d: dict) -> dict:
    """Normalize analysis result for database compatibility."""
    # Ensure required fields exist
    req = [
        'companyName','reportDate','reportPeriod','filename','sector',
        'cashOnHand','monthlyBurnRate','cashOutDate','runway',
        'budgetVsActual','financialSummary','sectorHighlightA','sectorHighlightB',
        'keyRisks','personnelUpdates','nextMilestones'
    ]
    for k in req:
        d.setdefault(k, None)

    # Force string-ish fields to strings (except nextMilestones which can be JSON array)
    for k in ['companyName','reportDate','reportPeriod','cashOutDate','sector',
              'budgetVsActual','financialSummary','sectorHighlightA','sectorHighlightB',
              'keyRisks','personnelUpdates','filename']:
        if d[k] is not None and not isinstance(d[k], str):
            d[k] = str(d[k])
    
    # Handle nextMilestones - can be either string (legacy) or JSON array (new format)
    milestones = d.get('nextMilestones')
    if milestones is not None:
        if isinstance(milestones, list):
            # New JSON format - validate structure and convert to JSON string for storage
            try:
                import json
                # Validate each milestone has required fields
                for milestone in milestones:
                    if not isinstance(milestone, dict):
                        raise ValueError("Each milestone must be an object")
                    if 'date' not in milestone or 'description' not in milestone or 'priority' not in milestone:
                        raise ValueError("Each milestone must have date, description, and priority fields")
                    # Validate priority values
                    if milestone['priority'] not in ['critical', 'high', 'medium', 'low']:
                        milestone['priority'] = 'medium'  # Default fallback
                d['nextMilestones'] = json.dumps(milestones)
            except Exception as e:
                print(f"⚠️ Invalid milestone JSON structure: {e}, converting to string")
                d['nextMilestones'] = str(milestones)
        elif not isinstance(milestones, str):
            # Convert other types to string
            d['nextMilestones'] = str(milestones)

    # Force numeric fields to None or number
    for k in ['cashOnHand','monthlyBurnRate']:
        v = d[k]
        if isinstance(v, (int, float)) or v is None:
            continue
        # Try to coerce strings like "3.1e6" or "$3.1M"
        try:
            d[k] = float(str(v).replace(',', '').replace('$','').lower().replace('m','e6').replace('k','e3'))
        except Exception:
            d[k] = None
    
    # Force runway to integer (DB column is INTEGER)
    v = d.get('runway')
    if v is not None:
        try:
            from decimal import Decimal, ROUND_HALF_UP
            d['runway'] = int(Decimal(str(v)).to_integral_value(rounding=ROUND_HALF_UP))
        except Exception:
            d['runway'] = None

    return d

def analyze_with_gpt5_responses_api(pdf_bytes: bytes, filename: str, is_text_only: bool = False,
                                    company_name_override: str = None, user_provided_name: bool = False):
    """
    GPT-5 (and later) via Responses API with Structured Outputs (json_schema) and file inputs.
    """
    import os, json as _json, traceback

    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        print("OPENAI_API_KEY not configured")
        raise Exception("OpenAI API key not configured")

    file_response = None
    tmp_path = None
    client = None

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)

        print(f"🤖 Starting GPT-5 analysis of {filename} ({len(pdf_bytes)} bytes)")

        # --- Prepare inputs (either text-only or uploaded PDF) ---
        if is_text_only:
            text_content = pdf_bytes.decode("utf-8", errors="ignore")
            print("📝 Processing text-only input")
        else:
            print("📤 Uploading PDF to OpenAI Files API...")
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(pdf_bytes)
                tmp_path = tmp.name
            with open(tmp_path, "rb") as f:
                file_response = client.files.create(file=f, purpose="user_data")
            print(f"✅ File uploaded: {file_response.id}")
            text_content = None

        # --- Enhanced Financial Analysis Prompt ---
        system_prompt = """
## SECTOR DETECTION
Could you first determine the company's primary sector from these categories:
- **healthcare**
- **consumer**
- **enterprise**
- **manufacturing**

## SECTOR-SPECIFIC ANALYSIS
Based on the sector you identify, please provide detailed analysis for these two areas:

### Health
- **sectorHighlightA** ("Clinical Progress"): Study phases, participant enrollment, safety and effectiveness data, regulatory updates, agency interactions, enrollment rates, study outcomes, key endpoints, submission progress, site performance
- **sectorHighlightB** ("R&D Updates"): Early-stage studies, manufacturing scale-up, IP developments, partnership activities, competitive landscape, production optimization, product improvements, patent activities, submission preparation, pipeline expansion

### Consumer  
- **sectorHighlightA** ("Customer & Unit Economics"): User acquisition metrics, CAC/LTV trends, retention rates, policies-in-force, conversion rates, churn analysis, customer lifetime value, acquisition channels, pricing optimization, cohort analysis
- **sectorHighlightB** ("Growth Efficiency Initiatives"): Market expansion, AI-driven productivity, channel optimization, operational improvements, automation initiatives, cost reduction programs, geographic expansion, product development velocity, team scaling

### Enterprise
- **sectorHighlightA** ("Product Roadmap & Adoption"): Feature launches, usage metrics, customer engagement, platform development, product velocity, feature adoption rates, customer feedback integration, technical debt management, scalability improvements
- **sectorHighlightB** ("Go-to-Market Performance"): Sales pipeline, bookings by region, partnership channels, customer success metrics, sales efficiency, market penetration, competitive wins/losses, channel performance, customer expansion rates

### Manufacturing
- **sectorHighlightA** ("Operational Performance"): Units produced/shipped, manufacturing efficiency, quality metrics, capacity utilization, yield improvements, cost per unit, production bottlenecks, quality control results, equipment performance
- **sectorHighlightB** ("Supply Chain & Commercial Pipeline"): Supplier relationships, inventory management, customer contracts, regulatory approvals, supply chain optimization, vendor performance, logistics improvements, customer delivery metrics, regulatory compliance

## FORMATTING REQUIREMENTS
Please use **Markdown formatting** in text fields for better readability:

### For budgetVsActual - Use a markdown table:
```
| Metric | Budget | Actual | Variance |
|--------|--------|--------|----------|
| Revenue | $X.XM | $X.XM | +X% |
| Burn Rate | $X.XM | $X.XM | +X% |
| CPA | $XXX | $XXX | -X% |
```

### For nextMilestones - Use structured JSON array:
```json
[
  {
    "date": "2024-09-30",
    "description": "Close Keen Insurance acquisition and integrate 50-state footprint for strategic expansion to capture national market",
    "priority": "high"
  },
  {
    "date": "2024-07-31", 
    "description": "Launch ML Bidder v2 and AI Sales Rep with target CPA of $550 entering AEP for performance optimization",
    "priority": "critical"
  },
  {
    "date": "2024-12-15",
    "description": "Deploy automated commission management system before AEP due to timeline pressure from agent scaling needs",
    "priority": "medium"
  }
]
```

**Date Format**: Use YYYY-MM-DD for exact dates, or YYYY-MM-01 for month estimates, or YYYY-03-01/YYYY-06-01/YYYY-09-01/YYYY-12-01 for quarters
**Priority Levels**: "critical", "high", "medium", "low"

### For other lists (keyRisks, personnelUpdates) - Use markdown bullets with context:
```
- ⚠️ **Risk**: Description with context and impact
- 👤 **Personnel**: Team changes with strategic implications
```

### For sector highlights - Use structured format with narrative + metrics:
```
**Overview**: Policies in force crossed 15k in Q2, up 2.3x YoY with management guiding to 25k by year-end. *The growth acceleration reflects successful ACA launch execution and expanded agent network.*

**Key Metrics**:
- CPA **$705** vs $775 LY (-9%) and $805 budget (-12%) *↺ building on Q1 optimization efforts*
- Retention by cohort: **89.6%** (2023), **88.4%** (2022), **89.2%** (2021) *consistent with historical 90% target*
- Lead-to-sale rate **4.6%** on media-partner channels vs **3.7%** Q2-23 *improved conversion efficiency*

**Strategic Implications**: *The CPA improvement and retention stability provide confidence for scaling to 25k policies while maintaining unit economics. The enhanced lead-to-sale rate suggests our media partner optimization is working.*
```

### For financialSummary - Board Deck Summary (PRIMARY FOCUS):
Please provide exactly 7-10 bullet points that summarize the entire board deck presentation in an easy-to-read format. Cover all key aspects including performance, operational updates, strategic initiatives, risks, and milestones. Use **bold** for key metrics and include brief context for each point. This should be a comprehensive executive summary of the entire board deck.

## WRITING STYLE
Please write comprehensive analysis in the style of an objective executive summary:
- Use markdown formatting: **bold** for metrics, *italics* for emphasis
- Include specific percentages, dollar amounts, and timeline references
- Focus on narrative developments, personnel changes, strategic decisions, and risk factors
- Ask strategic questions when appropriate ("How sustainable is current pricing model?")
- Keep sentences concise but information-dense
- Note runway implications and funding considerations
- Provide substantial detail with specific metrics, dates, and context
- Include both quantitative data and qualitative insights
- Reference specific milestones, partnerships, or competitive developments
- If a figure ties back to previous board discussions, briefly reference it (e.g., "*↺ revisits the Q1 push to lower CAC*")
- Use *italics* for context and narrative elements, keep metrics **bold**
- Connect dots between different metrics to tell a cohesive story
- Explain the "why" behind the "what" - don't just report numbers

## NUMERIC FIELDS
Please return exact numbers only (no currency symbols, no units, no text):
1. cashOnHand: Raw number in USD (e.g., 3100000 for $3.1M)
2. monthlyBurnRate: Raw number in USD per month (e.g., 1200000 for $1.2M/month)  
3. runway: Integer months only (e.g., 18 for 18 months)

## JSON OUTPUT:
{
  "companyName": "Company name only",
  "reportDate": "YYYY-MM-DD format only", 
  "reportPeriod": "Q1 2025 or 2024 Annual Report format only",
  "sector": "healthcare|consumer|enterprise|manufacturing",
  "cashOnHand": 3100000,
  "monthlyBurnRate": 1200000,
  "cashOutDate": "April 2025",
  "runway": 18,
  "budgetVsActual": "Markdown table with Budget vs Actual metrics and narrative context",
  "financialSummary": "PRIMARY FOCUS: Exactly 7-10 bullet points precisely summarizing the entire board deck (business performance, operations, strategy, risks, milestones) with **bold metrics** and brief context",
  "sectorHighlightA": "Structured markdown with **Overview** narrative + **Key Metrics** with context + **Strategic Implications**",
  "sectorHighlightB": "Structured markdown with **Overview** narrative + **Key Metrics** with context + **Strategic Implications**", 
  "keyRisks": "Markdown bullet list with emoji status (⚠️) and strategic risk context",
  "personnelUpdates": "Markdown bullet list with team changes and strategic impact",
  "nextMilestones": [{"date": "YYYY-MM-DD", "description": "Detailed milestone description with context", "priority": "critical|high|medium|low"}]
}

EXAMPLES:
- If document shows "$3.1M cash" → cashOnHand: 3100000
- If document shows "$1.2M monthly burn" → monthlyBurnRate: 1200000  
- If document shows "18 month runway" → runway: 18

Note: Please use null (no quotes) for missing numeric values, and "N/A" for missing text fields. 

One more thing - your response should be ONLY the raw JSON object. Please don't wrap it in markdown code blocks or add any explanatory text before or after the JSON.

Wrong way: ```json {{ ... }}```
Right way: {{ ... }}

Just start with the opening brace {{ and end with the closing brace }}."""

        # Add the user prompt with document analysis instructions
        user_prompt = f"""Hello! Please follow the instructions in the system prompt to analyze my document. Thank you!"""

        # --- Build single-user message: system prompt + user prompt + file ---
        content_parts = [{"type": "input_text", "text": system_prompt}]
        content_parts.append({"type": "input_text", "text": user_prompt})
        
        if is_text_only:
            content_parts.append({"type": "input_text", "text": f"DOCUMENT TEXT:\n\n{text_content}"})
        else:
            content_parts.append({"type": "input_file", "file_id": file_response.id})

        print("🚀 Calling Responses API with enhanced narrative prompt...")
        response = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o"),
            input=[{"role": "user", "content": content_parts}],
            max_output_tokens=12000
        )

        raw = response.output_text or ""
        if not raw.strip():
            raise ValueError("Empty output_text from model")

        # --- Parse JSON (strict - no fallback) ---
        print(f"📥 Raw output preview (first 300 chars): {raw[:300]}")
        
        try:
            data = _json.loads(raw.strip())
            print("✅ Valid JSON from model")
        except Exception as e:
            print(f"❌ JSON parse failed: {e}")
            print(f"❌ Full raw output: {raw}")
            raise ValueError(f"Model did not return valid JSON. Error: {e}. Output started with: {raw[:200]}")

        # Attach filename & override company name (if flagged as user-provided)
        data["filename"] = filename
        if company_name_override and user_provided_name:
            data["companyName"] = company_name_override

        normalized = normalize_analysis_for_db(data)
        print(f"🎉 Completed analysis for {filename}")
        return normalized

    except Exception as e:
        err = f"GPT-5 analysis failed: {str(e)}"
        print(err)
        print(f"Full traceback: {traceback.format_exc()}")
        raise Exception(err)
    finally:
        # Remote file cleanup
        try:
            if file_response and getattr(file_response, "id", None) and client:
                print("🗑️ Deleting uploaded file from OpenAI storage...")
                client.files.delete(file_response.id)
                print("✅ File deleted")
        except Exception as cleanup_error:
            print(f"⚠️ File cleanup failed: {cleanup_error}")
        # Local temp cleanup
        try:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
                print("🗑️ Local temp file cleaned up")
        except Exception as cleanup_error:
            print(f"⚠️ Local file cleanup failed: {cleanup_error}")



def analyze_recent_pdfs_for_kpis(company_id: int, stage: str, custom_config: dict = None, selected_files: list = None) -> dict:
    """
    Analyze PDFs for a company to extract KPIs based on sector and stage
    
    Args:
        company_id: Database company ID
        stage: Company stage from frontend ('Growth Stage', 'Main Stage', 'Early Stage')
        custom_config: Custom analysis configuration
        selected_files: List of specific S3 keys to analyze (if None, uses 4 most recent)
    
    Returns:
        Dict with KPI analysis results
    """
    import ssl
    
    try:
        print(f"🔍 Starting multi-PDF KPI analysis for company {company_id}, stage: {stage}")
        
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect to database
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # Get company info
        company_query = "SELECT name FROM companies WHERE id = %s"
        cursor.execute(company_query, [company_id])
        company_result = cursor.fetchone()
        company_name = company_result[0] if company_result else f"Company {company_id}"
        
        # Get sector from any recent report (fallback)
        sector_query = """
            SELECT sector FROM financial_reports 
            WHERE company_id = %s AND sector IS NOT NULL 
            ORDER BY report_date DESC LIMIT 1
        """
        cursor.execute(sector_query, [company_id])
        sector_result = cursor.fetchone()
        sector = sector_result[0] if sector_result else 'healthcare'
        
        print(f"🏢 Company: {company_name}")
        print(f"🎯 Sector: {sector}")
        print(f"📈 Stage: {stage}")
        
        # Download PDFs from S3
        import boto3
        s3_client = boto3.client('s3')
        bucket_name = os.environ.get('S3_BUCKET_NAME', 'kv-board-decks')
        
        pdf_contents = []
        report_metadata = []
        
        if selected_files:
            # Use selected files
            print(f"📁 Using {len(selected_files)} selected files")
            for s3_key in selected_files:
                try:
                    print(f"📥 Downloading selected file: s3://{bucket_name}/{s3_key}")
                    pdf_object = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
                    pdf_bytes = pdf_object['Body'].read()
                    
                    # Extract filename from key
                    file_name = s3_key.split('/')[-1] if '/' in s3_key else s3_key
                    
                    print(f"✅ Downloaded {len(pdf_bytes)} bytes from {s3_key}")
                    
                    # Store PDF bytes directly for upload to OpenAI
                    pdf_contents.append({
                        'report_id': None,  # No DB report for selected files
                        'file_name': file_name,
                        'report_date': 'Selected File',
                        'report_period': 'User Selected',
                        'pdf_bytes': pdf_bytes,
                        's3_key': s3_key
                    })
                    
                    report_metadata.append({
                        'report_id': None,
                        'file_name': file_name,
                        'report_date': 'Selected File',
                        'report_period': 'User Selected'
                    })
                    
                except Exception as e:
                    print(f"❌ Failed to download selected file {s3_key}: {str(e)}")
                    continue
        else:
            # Use database reports (existing logic)
            # Get 4 most recent financial reports with their S3 keys
            query = """
                SELECT fr.id, fr.file_name, fr.report_date, fr.report_period, fr.sector,
                       fr.cash_on_hand, fr.monthly_burn_rate, fr.runway,
                       c.name as company_name
                FROM financial_reports fr
                JOIN companies c ON fr.company_id = c.id
                WHERE fr.company_id = %s AND fr.file_name IS NOT NULL
                ORDER BY fr.report_date DESC, fr.processed_at DESC
                LIMIT 4
            """
            
            cursor.execute(query, [company_id])
            reports = cursor.fetchall()
            
            if len(reports) < 2:
                return {
                    'success': False,
                    'error': f'Need at least 2 reports for trend analysis, found {len(reports)}'
                }
            
            print(f"📊 Found {len(reports)} reports for analysis")
            
            for report in reports:
                report_id, file_name, report_date, report_period = report[0], report[1], report[2], report[3]
                
                # Search for files that end with the original filename (to handle timestamp prefixes)
                pdf_bytes = None
                actual_key = None
                
                # First try exact matches
                possible_keys = [
                    f"company-{company_id}/{file_name}",
                    file_name
                ]
                
                for s3_key in possible_keys:
                    try:
                        print(f"📥 Attempting to download: s3://{bucket_name}/{s3_key}")
                        pdf_object = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
                        pdf_bytes = pdf_object['Body'].read()
                        actual_key = s3_key
                        print(f"✅ Downloaded {len(pdf_bytes)} bytes from {s3_key}")
                        break
                    except Exception as e:
                        print(f"❌ Failed to download {s3_key}: {str(e)}")
                        continue
                
                # If exact match failed, search for files ending with the original filename
                if not pdf_bytes:
                    try:
                        print(f"🔍 Searching for files ending with: {file_name}")
                        
                        # List objects in the company folder
                        prefix = f"company-{company_id}/"
                        response = s3_client.list_objects_v2(
                            Bucket=bucket_name,
                            Prefix=prefix,
                            MaxKeys=1000
                        )
                        
                        if 'Contents' in response:
                            for obj in response['Contents']:
                                key = obj['Key']
                                if key.endswith(file_name):
                                    try:
                                        print(f"📥 Found matching file: {key}")
                                        pdf_object = s3_client.get_object(Bucket=bucket_name, Key=key)
                                        pdf_bytes = pdf_object['Body'].read()
                                        actual_key = key
                                        print(f"✅ Downloaded {len(pdf_bytes)} bytes from {key}")
                                        break
                                    except Exception as e:
                                        print(f"❌ Failed to download {key}: {str(e)}")
                                        continue
                        
                        # If not found in company folder, search root bucket
                        if not pdf_bytes:
                            response = s3_client.list_objects_v2(
                                Bucket=bucket_name,
                                MaxKeys=1000
                            )
                            
                            if 'Contents' in response:
                                for obj in response['Contents']:
                                    key = obj['Key']
                                    if key.endswith(file_name):
                                        try:
                                            print(f"📥 Found matching file in root: {key}")
                                            pdf_object = s3_client.get_object(Bucket=bucket_name, Key=key)
                                            pdf_bytes = pdf_object['Body'].read()
                                            actual_key = key
                                            print(f"✅ Downloaded {len(pdf_bytes)} bytes from {key}")
                                            break
                                        except Exception as e:
                                            print(f"❌ Failed to download {key}: {str(e)}")
                                            continue
                                            
                    except Exception as e:
                        print(f"❌ Error searching for files ending with {file_name}: {str(e)}")
                
                if pdf_bytes:
                    # Store PDF bytes directly for upload to OpenAI
                    pdf_contents.append({
                        'report_id': report_id,
                        'file_name': file_name,
                        'report_date': str(report_date),
                        'report_period': report_period,
                        'pdf_bytes': pdf_bytes,
                        's3_key': actual_key
                    })
                    
                    report_metadata.append({
                        'report_id': report_id,
                        'file_name': file_name,
                        'report_date': str(report_date),
                        'report_period': report_period
                    })
                else:
                    print(f"⚠️ Could not download PDF for report {report_id}: {file_name}")
        
        cursor.close()
        conn.close()
        
        # Check minimum file requirements
        min_files = 1 if selected_files else 2  # Allow single file for selected files
        if len(pdf_contents) < min_files:
            return {
                'success': False,
                'error': f'Could only retrieve {len(pdf_contents)} PDFs from S3 (minimum {min_files} required)'
            }
        
        print(f"📋 Successfully retrieved {len(pdf_contents)} PDFs for analysis")
        
        # Perform multi-PDF KPI analysis - returns markdown
        if custom_config:
            print(f"🎯 Using custom analysis configuration")
            markdown_analysis = analyze_multi_pdf_kpis_custom(pdf_contents, company_name, sector, stage, custom_config)
        else:
            print(f"📊 Using standard analysis configuration")
            markdown_analysis = analyze_multi_pdf_kpis(pdf_contents, company_name, sector, stage)
        
        # Store the KPI analysis results in the database
        try:
            store_kpi_analysis_in_db(company_id, markdown_analysis, stage, len(pdf_contents))
            print(f"✅ KPI analysis stored in database for company {company_id}")
        except Exception as storage_error:
            print(f"⚠️ Failed to store KPI analysis: {storage_error}")
            # Continue without failing the entire operation
        
        return {
            'success': True,
            'company_id': company_id,
            'company_name': company_name,
            'sector': sector,
            'stage': stage,
            'reports_analyzed': report_metadata,
            'analysis': markdown_analysis
        }
        
    except Exception as e:
        print(f"❌ Multi-PDF KPI analysis failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        return {
            'success': False,
            'error': f'Multi-PDF KPI analysis failed: {str(e)}'
        }


def analyze_multi_pdf_kpis_custom(pdf_contents: list, company_name: str, sector: str, stage: str, custom_config: dict) -> str:
    """
    Use OpenAI to analyze multiple PDFs with simplified user-defined requirements
    Returns analysis based on what user wants to look for and how they want it structured
    """
    import os, tempfile, concurrent.futures
    
    # Check for API key
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise Exception("OpenAI API key not configured")
    
    client = None
    uploaded_files = []
    tmp_paths = []
    
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        
        print(f"🤖 Starting custom OpenAI multi-PDF KPI analysis...")
        print(f"📁 Uploading {len(pdf_contents)} PDFs to OpenAI in parallel...")
        
        def upload_single_pdf(pdf_data):
            """Upload a single PDF to OpenAI"""
            try:
                # Create temporary file
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                    tmp.write(pdf_data['pdf_bytes'])
                    tmp_path = tmp.name
                
                # Upload to OpenAI
                with open(tmp_path, "rb") as f:
                    file_response = client.files.create(file=f, purpose="user_data")
                    result = {
                        'file_id': file_response.id,
                        'file_name': pdf_data['file_name'],
                        'report_period': pdf_data['report_period'],
                        'report_date': pdf_data['report_date'],
                        'tmp_path': tmp_path
                    }
                    print(f"✅ Uploaded {pdf_data['file_name']}: {file_response.id}")
                    return result
            except Exception as e:
                print(f"❌ Failed to upload {pdf_data['file_name']}: {str(e)}")
                raise e
        
        # Upload all PDFs in parallel using ThreadPoolExecutor
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_to_pdf = {executor.submit(upload_single_pdf, pdf_data): pdf_data for pdf_data in pdf_contents}
            
            for future in concurrent.futures.as_completed(future_to_pdf):
                pdf_data = future_to_pdf[future]
                try:
                    result = future.result()
                    uploaded_files.append(result)
                    tmp_paths.append(result['tmp_path'])
                except Exception as e:
                    print(f"❌ Upload failed for {pdf_data['file_name']}: {str(e)}")
                    raise e
        
        # Create file list for the prompt
        file_list = "\n".join([f"- {f['file_name']} ({f['report_period']}, {f['report_date']})" for f in uploaded_files])
        
        # Extract the simplified configuration
        what_to_look_for = custom_config.get('whatToLookFor', '').strip()
        response_structure = custom_config.get('responseStructure', '').strip()
        use_bullet_points = custom_config.get('useBulletPoints', True)
        
        # Build the simplified system prompt
        system_prompt = f"""You are a financial data analyst helping with document analysis for {company_name} ({sector}, {stage}).

## WHAT TO ANALYZE
{what_to_look_for if what_to_look_for else "Extract key financial metrics and trends from the provided documents."}

## HOW TO STRUCTURE YOUR RESPONSE
{response_structure if response_structure else "Provide a clear summary of the key findings with supporting data."}

## FORMAT REQUIREMENTS
{"- Use bullet points and lists for clarity and easy scanning" if use_bullet_points else "- Use prose format with clear paragraphs and flowing narrative"}
- Include specific numbers and data points from the documents
- Reference which document each piece of information comes from
- Be precise and factual

## FILES TO ANALYZE
{file_list}

Focus on extracting accurate information that directly addresses what the user is looking for, structured exactly as they requested."""

        # Build a simple user message
        user_text = f"Please analyze these {len(uploaded_files)} financial documents for {company_name} according to the requirements specified in the system prompt."
        
        user_content = [
            {"type": "input_text", "text": user_text}
        ] + [
            {"type": "input_file", "file_id": f["file_id"]} for f in uploaded_files
        ]

        # Create the completion
        print(f"🤖 Sending custom analysis request to GPT-5 (Responses API)...")
        
        try:
            print(f"🔍 About to call client.responses.create with:")
            print(f"🔍 - model: gpt-5")
            print(f"🔍 - instructions length: {len(system_prompt)} chars")
            print(f"🔍 - input length: {len(user_content)} items")
            print(f"🔍 - reasoning: {{'effort': 'medium'}}")
            print(f"🔍 - max_output_tokens: unlimited")
            
            resp = client.responses.create(
                model="gpt-5",
                instructions=system_prompt,   # system/developer guidance
                input=[{"role": "user", "content": user_content}],
                reasoning={"effort": "medium"}, # reduced to leave room for content
                # removed max_output_tokens to allow full response
            )
            
            print(f"🔍 API call completed successfully, got response type: {type(resp)}")
            
        except Exception as api_error:
            print(f"🚨 API call failed with error: {str(api_error)}")
            print(f"🚨 Error type: {type(api_error)}")
            raise api_error
        
        # Debug the entire response object recursively
        print(f"🔍 ========== FULL RESPONSE DEBUG ==========")
        debug_object_recursively(resp, "resp", max_depth=4)
        print(f"🔍 ========== END RESPONSE DEBUG ==========")
        
        analysis_result = extract_output_text(resp)
        print(f"🔍 extract_output_text returned: {len(analysis_result)} chars")
        
        # Guard: don't clobber DB with empty output
        if not analysis_result:
            # Optional: include usage to help debug partial/empty responses
            usage = getattr(resp, "usage", None)
            out_toks = getattr(usage, "output_tokens", None) if usage else None
            print(f"🚨 EMPTY OUTPUT DETECTED - failing job instead of persisting")
            print(f"🔍 usage object: {usage}")
            print(f"🔍 output_tokens: {out_toks}")
            raise RuntimeError(f"Empty model output (output_tokens={out_toks}). Failing job instead of persisting.")
        
        # Log a short preview + token usage for observability
        usage = getattr(resp, "usage", None)
        preview = (analysis_result[:120] + "…") if len(analysis_result) > 120 else analysis_result
        print(f"🧾 usage: input={getattr(usage,'input_tokens',None)}, "
              f"output={getattr(usage,'output_tokens',None)} | preview: {preview}")
        
        print(f"✅ Custom GPT-5 (Responses API) analysis completed successfully")
        print(f"📄 Analysis length: {len(analysis_result)} characters")
        
        return analysis_result
        
    except Exception as e:
        print(f"❌ Custom OpenAI analysis failed: {str(e)}")
        raise e
    finally:
        # Best-effort remote cleanup
        if client is not None:
            for f in uploaded_files:
                try:
                    client.files.delete(f["file_id"])
                    print(f"🗑️ Deleted {f.get('file_name','(unknown)')} from OpenAI storage")
                except Exception as ce:
                    print(f"⚠️ File cleanup failed for {f.get('file_name','(unknown)')}: {ce}")
        # Local temp files
        for p in tmp_paths:
            try:
                if os.path.exists(p):
                    os.unlink(p)
            except Exception as ce:
                print(f"⚠️ Local file cleanup failed: {ce}")


def analyze_multi_pdf_kpis(pdf_contents: list, company_name: str, sector: str, stage: str) -> str:
    """
    Use OpenAI to analyze multiple PDFs and extract KPIs based on sector and stage
    Returns detailed markdown analysis
    """
    import os, tempfile, concurrent.futures
    
    # Check for API key
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise Exception("OpenAI API key not configured")
    
    client = None
    uploaded_files = []
    tmp_paths = []
    
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        
        print(f"🤖 Starting OpenAI multi-PDF KPI analysis...")
        print(f"📁 Uploading {len(pdf_contents)} PDFs to OpenAI in parallel...")
        
        def upload_single_pdf(pdf_data):
            """Upload a single PDF to OpenAI"""
            try:
                # Create temporary file
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                    tmp.write(pdf_data['pdf_bytes'])
                    tmp_path = tmp.name
                
                # Upload to OpenAI
                with open(tmp_path, "rb") as f:
                    file_response = client.files.create(file=f, purpose="user_data")
                    result = {
                        'file_id': file_response.id,
                        'file_name': pdf_data['file_name'],
                        'report_period': pdf_data['report_period'],
                        'report_date': pdf_data['report_date'],
                        'tmp_path': tmp_path
                    }
                    print(f"✅ Uploaded {pdf_data['file_name']}: {file_response.id}")
                    return result
            except Exception as e:
                print(f"❌ Failed to upload {pdf_data['file_name']}: {str(e)}")
                raise e
        
        # Upload all PDFs in parallel using ThreadPoolExecutor
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_to_pdf = {executor.submit(upload_single_pdf, pdf_data): pdf_data for pdf_data in pdf_contents}
            
            for future in concurrent.futures.as_completed(future_to_pdf):
                pdf_data = future_to_pdf[future]
                try:
                    result = future.result()
                    uploaded_files.append(result)
                    tmp_paths.append(result['tmp_path'])
                except Exception as e:
                    print(f"❌ Upload failed for {pdf_data['file_name']}: {str(e)}")
                    raise e
        
        # Define KPI requirements based on sector and stage
        kpi_requirements = get_kpi_requirements(sector, stage)
        
        # Create file list for the prompt
        file_list = "\n".join([f"- {f['file_name']} ({f['report_period']}, {f['report_date']})" for f in uploaded_files])
        
        # Create the analysis prompt for markdown output
        system_prompt = f"""You are a financial analyst specializing in venture capital board deck analysis and KPI extraction.  
Your role is to (1) extract structured, time-series KPI data, and (2) provide interpretive analysis with quantified trends and insights.

## ANALYSIS SCOPE
You will analyze the provided financial documents to extract KPI data and trends for investment analysis purposes. Focus on standard financial metrics, operational performance indicators, and strategic information typically found in board presentations.

## COMPANY CONTEXT
- Company: {company_name}
- Sector: {sector}
- Stage: {stage}
- Reports to analyze: {len(pdf_contents)}

## KPI FOCUS
Based on sector and stage, analyze the following KPIs:
{kpi_requirements}

## ANALYSIS REQUIREMENTS
### Phase 1: Extraction
- Extract chronological KPI datasets across all reports
- Include exact values, periods, and units
- Build historical tables for every KPI

### Phase 2: Quantified Trend Analysis
For each KPI, calculate:
- **MoM, QoQ, YoY, YTD % changes**
- **Growth Rate (CAGR if possible)**
- **Trend Direction** (📈📉➡️)
Do not omit metrics if data exists.

### Phase 3: Interpretation
- Tie every insight to a quantified metric
- Identify acceleration/deceleration, seasonality, anomalies
- Explain underlying business drivers
- Provide forward-looking implications

## OUTPUT FORMAT (include all sections)
1. 📊 **Executive Summary** – 3–4 key quantified highlights, trajectory, inflection points
2. 📈 **Per KPI Analysis** – For each KPI: Current value, trend indicators, metrics, context, implications
3. 🎯 **Strategic Insights** – Benchmarks, sustainability, recommendations
4. ⚠️ **Data Quality Notes** – Missing data, inconsistencies, confidence levels

## TABLES REQUIREMENT
For each KPI, include a structured **markdown table** showing:
- **Historical Values** (all available periods)
- **MoM (Month-over-Month) % change**
- **QoQ (Quarter-over-Quarter) % change** 
- **YoY (Year-over-Year) % change**
- **YTD (Year-to-Date) % change**
- **Trend Direction** (📈📉➡️)

**CRITICAL: Use proper markdown table syntax with | separators and header row**

Example markdown table format:
```markdown
| Period | Value | MoM % | QoQ % | YoY % | YTD % | Trend |
|--------|-------|-------|-------|-------|-------|-------|
| Jan 2025 | $1.2M | - | - | +15% | +15% | 📈 |
| Feb 2025 | $1.3M | +8.3% | - | +12% | +13.5% | 📈 |
```

**IMPORTANT: Always use markdown table format with | separators, not plain text or other formats.**

## FILES TO ANALYZE
Use the following as the complete source of truth (chronologically order them):
{file_list}

## STYLE
- Use **bold** for metrics, *italics* for emphasis, 📈📉➡️ emojis for clarity
- Include structured **markdown tables** for every KPI with historical data
- Use proper markdown table syntax with | separators (please include a table!!)
- Write for a board-level audience
- Avoid vague statements without quantified support
- Do NOT include any "KPI Trend Analysis" headers in the output"""

        # Build a single user message with text + N input_file parts (Responses API)
        user_content = [
            {"type": "input_text", "text": f"Analyze these {len(uploaded_files)} reports for {company_name}. Provide comprehensive KPI analysis with structured tables, exactly per the instructions."}
        ] + [
            {"type": "input_file", "file_id": f["file_id"]} for f in uploaded_files
        ]

        print("🚀 Calling GPT-5 (Responses API) for multi-PDF KPI analysis...")
        resp = client.responses.create(
            model="gpt-5",
            instructions=system_prompt,   # system/developer guidance
            input=[{"role": "user", "content": user_content}],
            reasoning={"effort": "medium"}, # reduced to leave room for content
            # removed max_output_tokens to allow full response
        )

        markdown_analysis = extract_output_text(resp)
        
        # Guard: don't clobber DB with empty output
        if not markdown_analysis:
            # Optional: include usage to help debug partial/empty responses
            usage = getattr(resp, "usage", None)
            out_toks = getattr(usage, "output_tokens", None) if usage else None
            raise RuntimeError(f"Empty model output (output_tokens={out_toks}). Failing job instead of persisting.")
        
        # Log a short preview + token usage for observability
        usage = getattr(resp, "usage", None)
        preview = (markdown_analysis[:120] + "…") if len(markdown_analysis) > 120 else markdown_analysis
        print(f"🧾 usage: input={getattr(usage,'input_tokens',None)}, "
              f"output={getattr(usage,'output_tokens',None)} | preview: {preview}")
        
        print(f"✅ Received {len(markdown_analysis)} characters of markdown analysis")
        return markdown_analysis
        
    except Exception as e:
        print(f"❌ OpenAI KPI analysis failed: {str(e)}")
        raise e
    finally:
        # Best-effort remote cleanup
        if client is not None:
            for f in uploaded_files:
                try:
                    client.files.delete(f["file_id"])
                    print(f"🗑️ Deleted {f.get('file_name','(unknown)')} from OpenAI storage")
                except Exception as ce:
                    print(f"⚠️ File cleanup failed for {f.get('file_name','(unknown)')}: {ce}")
        # Local temp files
        for p in tmp_paths:
            try:
                if os.path.exists(p):
                    os.unlink(p)
            except Exception as ce:
                print(f"⚠️ Local file cleanup failed: {ce}")


def get_mood_instructions(mood: str) -> str:
    """
    Get analysis tone and style instructions based on selected mood
    """
    mood_map = {
        'cheerleader': "## TONE: CHEERLEADER 📣\nBe optimistic and encouraging. Highlight wins, frame challenges as opportunities.",
        'balanced': "## TONE: BALANCED ⚖️\nUse neutral, professional language. Present facts objectively.",
        'skeptical': "## TONE: WALL STREET SKEPTIC 🤨\nApply rigorous scrutiny. Question assumptions, highlight risks.",
        'roast': "## TONE: ROAST MODE 🔥\nBe direct and brutally honest (but professional). Call out issues without sugar-coating."
    }
    
    return mood_map.get(mood, mood_map['balanced'])


def get_kpi_requirements(sector: str, stage: str) -> str:
    """
    Get KPI requirements based on sector and stage
    """
    # Normalize stage input from frontend
    stage_map = {
        'Growth Stage': 'growth_stage',
        'Main Stage': 'main', 
        'Early Stage': 'early_stage'
    }
    
    normalized_stage = stage_map.get(stage, 'main')
    
    # Normalize sector input
    sector_map = {
        'healthcare': 'Healthcare',
        'consumer': 'Consumer',
        'enterprise': 'Enterprise', 
        'manufacturing': 'Sustainability/Manufacturing/Robotics'
    }
    
    normalized_sector = sector_map.get(sector.lower(), 'Healthcare')
    
    # KPI requirements from user specification
    kpi_matrix = {
        "Sustainability/Manufacturing/Robotics": {
            "early_stage": ["Pilots timeline", "Capacity"],
            "main": ["Revenue", "Bookings", "Unit economics", "Gross margin (GM)", "EBITDA", "Pipeline", "Pipeline coverage ratio", "Regulatory timelines", "Production capacity", "Cost per unit"],
            "growth_stage": ["Revenue", "Bookings", "Unit economics", "Gross margin (GM)", "EBITDA", "Pipeline", "Pipeline coverage ratio", "Regulatory timelines", "Production capacity", "Cost per unit"]
        },
        "Consumer": {
            "early_stage": ["Revenue", "Gross margin", "Contribution margin", "Opex", "EBITDA", "CPA", "LTV", "CAC", "LTV:CAC ratio", "User growth", "DAU/MAU", "Retention", "Churn", "ARPU"],
            "main": ["Revenue", "Gross margin", "Contribution margin", "Opex", "EBITDA", "CPA", "LTV", "CAC", "LTV:CAC ratio", "User growth", "DAU/MAU", "Retention", "Churn", "ARPU"],
            "growth_stage": ["Revenue", "Gross margin", "Contribution margin", "Opex", "EBITDA", "CPA", "LTV", "CAC", "LTV:CAC ratio", "User growth", "DAU/MAU", "Retention", "Churn", "ARPU"]
        },
        "Enterprise": {
            "early_stage": ["ARR/MRR", "Sales pipeline"],
            "main": ["ARR/MRR", "Growth", "Retention", "Gross margin", "Contribution margin", "ACV", "Key clients"],
            "growth_stage": ["ARR/MRR", "Growth", "Retention", "Gross margin", "Contribution margin", "ACV", "Key clients"]
        },
        "Healthcare": {
            "early_stage": ["Timelines: enrollment progress", "Treatment progress", "(Interim) data readout", "IND", "IDE"],
            "main": ["Timelines: enrollment progress", "Treatment progress", "(Interim) data readout", "IND", "IDE", "Commercial pilots"],
            "growth_stage": ["Revenue", "Growth margin", "Partnerships", "FDA approval timeline"]
        },
        "All": {
            "early_stage": ["Headcount", "Monthly burn", "Cash on hand", "Runway (months of funding left)", "All financial metrics against plan + forward projections"],
            "main": ["Headcount", "Monthly burn", "Cash on hand", "Runway (months of funding left)", "All financial metrics against plan + forward projections", "(Rarely) revenue"],
            "growth_stage": ["Headcount", "Monthly burn", "Cash on hand", "Runway (months of funding left)", "All financial metrics against plan"]
        }
    }
    
    # Get sector-specific KPIs
    sector_kpis = kpi_matrix.get(normalized_sector, {}).get(normalized_stage, [])
    
    # Always include universal KPIs
    universal_kpis = kpi_matrix["All"].get(normalized_stage, [])
    
    # Combine and deduplicate
    all_kpis = list(set(sector_kpis + universal_kpis))
    
    requirements_text = f"""
**Sector-Specific KPIs for {normalized_sector} - {stage}:**
{chr(10).join(f"- {kpi}" for kpi in sector_kpis)}

**Universal KPIs for {stage}:**
{chr(10).join(f"- {kpi}" for kpi in universal_kpis)}

**FOCUS**: Prioritize these {len(all_kpis)} KPIs, but also extract any other relevant financial or operational metrics you find.
"""
    
    return requirements_text


def store_result_in_db(analysis_result: dict, company_id: int):
    """
    Store analysis results in database using the same pattern as financial-crud Lambda
    """
    import ssl
    
    try:
        print(f"📊 Storing analysis result for company {company_id}: {analysis_result.get('companyName', 'Unknown')}")
        
        # Same database configuration pattern as other Lambdas
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect using same pattern as process-cap-table
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # Parse report date
        report_date = analysis_result.get('reportDate')
        if report_date:
            try:
                from datetime import datetime
                report_date_obj = datetime.strptime(report_date, '%Y-%m-%d').date()
                report_date = report_date_obj
            except ValueError:
                # Use current date if parsing fails
                report_date = datetime.now().date()
        else:
            report_date = datetime.now().date()
        
        # Same INSERT pattern as financial-crud
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
        
        # Helper functions for parsing (same as financial-crud)
        def parse_financial_value(value):
            if value is None or value == '':
                return None
            try:
                if isinstance(value, str):
                    # Remove currency symbols and commas
                    cleaned = value.replace('$', '').replace(',', '').strip()
                    return float(cleaned) if cleaned else None
                return float(value)
            except (ValueError, TypeError):
                return None
        
        def parse_runway_value(value):
            if value is None or value == '':
                return None
            try:
                # Round to nearest whole month for INTEGER column
                from decimal import Decimal, ROUND_HALF_UP
                return int(Decimal(str(value)).to_integral_value(rounding=ROUND_HALF_UP))
            except (ValueError, TypeError):
                return None
        
        # Prepare data array (same order as financial-crud)
        report_data = [
            company_id,
            analysis_result.get('filename', 'unknown.pdf'),
            report_date,
            analysis_result.get('reportPeriod'),
            analysis_result.get('sector', 'healthcare'),  # Default to healthcare if not provided
            parse_financial_value(analysis_result.get('cashOnHand')),
            parse_financial_value(analysis_result.get('monthlyBurnRate')),
            analysis_result.get('cashOutDate'),
            parse_runway_value(analysis_result.get('runway')),
            analysis_result.get('budgetVsActual'),
            analysis_result.get('financialSummary'),
            analysis_result.get('sectorHighlightA'),
            analysis_result.get('sectorHighlightB'),
            analysis_result.get('keyRisks'),
            analysis_result.get('personnelUpdates'),
            analysis_result.get('nextMilestones'),
            False,  # manually_edited
            "s3_gpt5_import"  # edited_by - distinguish from API Gateway imports
        ]
        
        # Debug parameter mapping (remove after confirming fix)
        print("🔍 Database parameters being inserted:")
        for i, v in enumerate(report_data, 1):
            print(f"  ${i}: {type(v).__name__} -> {v!r}")
        
        cursor.execute(report_insert, report_data)
        
        # Get the ID of the inserted report
        cursor.execute("SELECT lastval()")
        report_id = cursor.fetchone()[0]
        
        conn.commit()
        
        print(f"✅ Successfully stored financial report for company {company_id} (report_id: {report_id})")
        
        # Safe formatting with None checks
        cash_value = analysis_result.get('cashOnHand') or 0
        burn_value = analysis_result.get('monthlyBurnRate') or 0
        runway_value = analysis_result.get('runway') or 0
        
        print(f"💰 Cash: ${cash_value:,.0f}" if cash_value else "💰 Cash: N/A")
        print(f"🔥 Monthly burn: ${burn_value:,.0f}" if burn_value else "🔥 Monthly burn: N/A")
        print(f"📈 Runway: {runway_value:.1f} months" if runway_value else "📈 Runway: N/A")
        
        # Store milestones in separate table
        try:
            store_milestones_in_db(company_id, report_id, analysis_result.get('nextMilestones'), cursor, conn)
        except Exception as milestone_error:
            print(f"⚠️ Failed to store milestones: {milestone_error}")
            # Continue without failing the entire operation
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Database storage failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        raise e


def store_milestones_in_db(company_id: int, report_id: int, milestones_json_str: str, cursor, conn):
    """
    Store milestones from a financial report into the company_milestones table.
    Only processes valid JSON arrays - skips malformed data.
    """
    if not milestones_json_str:
        print("ℹ️ No milestones to store")
        return
    
    try:
        # Try to parse the JSON
        milestones = json.loads(milestones_json_str)
        
        # Validate it's a list
        if not isinstance(milestones, list):
            print(f"⚠️ Milestones is not a JSON array, skipping storage: {type(milestones)}")
            return
        
        if len(milestones) == 0:
            print("ℹ️ Empty milestones array, nothing to store")
            return
        
        # Insert each milestone
        milestone_insert = """
            INSERT INTO company_milestones (
                company_id, financial_report_id, milestone_date, description, priority
            ) VALUES (%s, %s, %s, %s, %s)
        """
        
        stored_count = 0
        for milestone in milestones:
            # Validate milestone structure
            if not isinstance(milestone, dict):
                print(f"⚠️ Skipping invalid milestone (not a dict): {milestone}")
                continue
            
            if 'date' not in milestone or 'description' not in milestone or 'priority' not in milestone:
                print(f"⚠️ Skipping milestone missing required fields: {milestone}")
                continue
            
            # Extract fields
            milestone_date = milestone.get('date')
            description = milestone.get('description')
            priority = milestone.get('priority')
            
            # Validate priority
            if priority not in ['critical', 'high', 'medium', 'low']:
                print(f"⚠️ Invalid priority '{priority}', defaulting to 'medium'")
                priority = 'medium'
            
            # Insert milestone
            try:
                cursor.execute(milestone_insert, [company_id, report_id, milestone_date, description, priority])
                stored_count += 1
            except Exception as insert_error:
                print(f"⚠️ Failed to insert milestone: {insert_error}")
                print(f"   Milestone data: {milestone}")
                continue
        
        conn.commit()
        print(f"✅ Stored {stored_count} milestone(s) for company {company_id}, report {report_id}")
        
    except json.JSONDecodeError as e:
        print(f"⚠️ Milestones JSON is malformed, skipping storage: {e}")
        return
    except Exception as e:
        print(f"❌ Failed to store milestones: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        raise e


def store_kpi_analysis_in_db(company_id: int, analysis_content: str, stage: str, reports_count: int):
    """
    Store KPI analysis results in the company_kpi_analysis table
    """
    import ssl
    
    try:
        print(f"📊 Storing KPI analysis for company {company_id}")
        
        # Same database configuration pattern as other Lambdas
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect using same pattern as process-cap-table
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # Check if analysis already exists for this company
        cursor.execute("""
            SELECT id FROM company_kpi_analysis 
            WHERE company_id = %s
        """, [company_id])
        
        existing_analysis = cursor.fetchone()
        
        if existing_analysis:
            # Update existing analysis
            cursor.execute("""
                UPDATE company_kpi_analysis 
                SET analysis_content = %s, 
                    stage = %s, 
                    reports_analyzed = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE company_id = %s
            """, [analysis_content, stage, reports_count, company_id])
            print(f"✅ Updated existing KPI analysis for company {company_id}")
        else:
            # Create new analysis
            cursor.execute("""
                INSERT INTO company_kpi_analysis 
                (company_id, analysis_content, stage, reports_analyzed, generated_at, created_by)
                VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP, 'system')
            """, [company_id, analysis_content, stage, reports_count])
            print(f"✅ Created new KPI analysis for company {company_id}")
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"💾 Successfully stored KPI analysis ({len(analysis_content)} chars)")
        
    except Exception as e:
        print(f"❌ Failed to store KPI analysis: {str(e)}")
        raise e


def store_health_check_in_db(company_id: int, health_score: str, justification: str, criticality_level: int = None, manual_override: bool = False):
    """
    Store health check results in the company_health_check table
    """
    import ssl
    from datetime import datetime
    
    try:
        print(f"🏥 Storing health check for company {company_id}")
        
        # Same database configuration pattern as other functions
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect to database
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # Check if there's an existing health check for this company (keep only the latest)
        cursor.execute("""
            SELECT id FROM company_health_check 
            WHERE company_id = %s
            ORDER BY analysis_timestamp DESC
            LIMIT 1
        """, [company_id])
        
        existing_row = cursor.fetchone()
        
        if existing_row:
            # Update the existing record
            cursor.execute("""
                UPDATE company_health_check 
                SET health_score = %s, justification = %s, criticality_level = %s, 
                    manual_override = %s, analysis_timestamp = CURRENT_TIMESTAMP, 
                    updated_at = CURRENT_TIMESTAMP
                WHERE company_id = %s
            """, [health_score, justification, criticality_level, manual_override, company_id])
            print(f"✅ Updated existing health check for company {company_id}")
        else:
            # Create new health check record
            cursor.execute("""
                INSERT INTO company_health_check 
                (company_id, health_score, justification, criticality_level, manual_override, 
                 analysis_timestamp, created_by)
                VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP, 'system')
            """, [company_id, health_score, justification, criticality_level, manual_override])
            print(f"✅ Created new health check for company {company_id}")
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"💾 Successfully stored health check ({health_score}) for company {company_id}")
        
    except Exception as e:
        print(f"❌ Failed to store health check: {str(e)}")
        raise e


def get_latest_health_check(company_id: int) -> dict:
    """
    Get the latest health check for a company from the database
    """
    import ssl
    
    try:
        print(f"🔍 Getting latest health check for company {company_id}")
        
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect to database
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # Get latest health check
        cursor.execute("""
            SELECT health_score, justification, criticality_level, manual_override, 
                   analysis_timestamp, created_at
            FROM company_health_check 
            WHERE company_id = %s
            ORDER BY analysis_timestamp DESC
            LIMIT 1
        """, [company_id])
        
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row:
            return {'success': True, 'data': None}
        
        health_score, justification, criticality_level, manual_override, analysis_timestamp, created_at = row
        
        return {
            'success': True,
            'data': {
                'success': True,
                'score': health_score,
                'justification': justification,
                'criticality_level': criticality_level,
                'manual_override': manual_override,
                'analysis_timestamp': analysis_timestamp.isoformat() + 'Z' if analysis_timestamp else None
            }
        }
        
    except Exception as e:
        print(f"❌ Failed to get health check: {str(e)}")
        return {'success': False, 'error': f'Failed to retrieve health check: {str(e)}'}


# ──────────────────────────────────────────────────────────────────────────
# Async Job Handling Functions
# ──────────────────────────────────────────────────────────────────────────

def handle_create_async_job(event, context):
    """
    Create an async KPI analysis job and return job ID immediately
    """
    # CORS headers for all responses
    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    try:
        # Extract parameters from event
        company_id = event.get('company_id')
        stage = event.get('stage')
        custom_config = event.get('custom_config')
        
        if not company_id:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'company_id is required'})
            }
        
        if not stage:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'stage is required (Early Stage, Main Stage, or Growth Stage)'})
            }
        
        print(f"🚀 Creating async KPI analysis job for company {company_id}, stage: {stage}", '(custom)' if custom_config else '(standard)')
        
        # Create job in database
        job_id = create_async_job_in_db(company_id, stage, custom_config)
        
        print(f"✅ Created job {job_id}")
        
        # Trigger async processing
        trigger_async_processing(job_id, company_id, stage, custom_config)
        
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({
                'success': True,
                'job_id': job_id,
                'status': 'queued',
                'message': 'Analysis job created and queued for processing'
            })
        }
        
    except Exception as e:
        print(f"❌ Failed to create async job: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': f'Failed to create job: {str(e)}'
            })
        }


def handle_get_job_status(event, context):
    """
    Get the status of an async analysis job
    """
    # CORS headers for all responses
    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    try:
        job_id = event.get('job_id')
        
        if not job_id:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'job_id is required'})
            }
        
        print(f"🔍 Getting status for job {job_id}")
        
        # Get job status from database
        job_status = get_job_status_from_db(job_id)
        
        if not job_status:
            return {
                'statusCode': 404,
                'headers': cors_headers,
                'body': json.dumps({'error': 'Job not found'})
            }
        
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps(job_status)
        }
        
    except Exception as e:
        print(f"❌ Failed to get job status: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'error': f'Failed to get job status: {str(e)}'
            })
        }


def handle_get_latest_completed_job(event, context):
    """
    Get the latest completed async analysis job for a company
    """
    # CORS headers for all responses
    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Api-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    try:
        company_id = event.get('company_id')
        
        if not company_id:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'company_id is required'})
            }
        
        print(f"🔍 Getting latest completed job for company {company_id}")
        
        # Get latest completed job from database
        latest_job = get_latest_completed_job_from_db(company_id)
        
        if not latest_job:
            return {
                'statusCode': 404,
                'headers': cors_headers,
                'body': json.dumps({'error': 'No completed analysis found for this company'})
            }
        
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps(latest_job)
        }
        
    except Exception as e:
        print(f"❌ Failed to get latest completed job: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'error': f'Failed to get latest completed job: {str(e)}'
            })
        }


def handle_process_async_job(event, context):
    """
    Process an async analysis job (triggered asynchronously)
    """
    try:
        job_id = event.get('job_id')
        company_id = event.get('company_id')
        stage = event.get('stage')
        custom_config = event.get('custom_config')
        
        if not all([job_id, company_id, stage]):
            print(f"❌ Missing required parameters: job_id={job_id}, company_id={company_id}, stage={stage}")
            return {'success': False, 'error': 'Missing required parameters'}
        
        print(f"⚡ Processing async job {job_id} for company {company_id}, stage: {stage}", '(custom)' if custom_config else '(standard)')
        
        # Update job status to processing
        update_job_status(job_id, 'processing', 0)
        
        # Perform the analysis (this is the heavy work that was timing out)
        try:
            # Extract selected_files from custom_config if provided
            selected_files = custom_config.get('selected_files') if custom_config else None
            result = analyze_recent_pdfs_for_kpis(company_id, stage, custom_config, selected_files)
            
            if result['success']:
                # Store results and mark job as completed
                update_job_status(job_id, 'completed', 0, results=result['analysis'])
                print(f"✅ Job {job_id} completed successfully")
                return {'success': True, 'job_id': job_id}
            else:
                # Mark job as failed
                error_msg = result.get('error', 'Analysis failed')
                update_job_status(job_id, 'failed', 0, error_message=error_msg)
                print(f"❌ Job {job_id} failed: {error_msg}")
                return {'success': False, 'error': error_msg}
        
        except Exception as analysis_error:
            # Mark job as failed
            error_msg = f"Analysis failed: {str(analysis_error)}"
            update_job_status(job_id, 'failed', 0, error_message=error_msg)
            print(f"❌ Job {job_id} failed with exception: {error_msg}")
            print(f"Full traceback: {traceback.format_exc()}")
            return {'success': False, 'error': error_msg}
        
    except Exception as e:
        print(f"❌ Async job processing failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        return {'success': False, 'error': str(e)}


def handle_health_check_request(event, context):
    """
    Handle health check analysis requests
    """
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    try:
        # Extract parameters from event
        company_id = event.get('company_id')
        criticality_level = event.get('criticality_level', 5)  # Default to balanced
        manual_score = event.get('manual_score')
        
        if not company_id:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'company_id is required'})
            }
        
        # Validate criticality level
        if criticality_level is not None and (criticality_level < 1 or criticality_level > 10):
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'criticality_level must be between 1 and 10'})
            }
        
        # Validate manual score
        if manual_score and manual_score not in ['GREEN', 'YELLOW', 'RED']:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'manual_score must be GREEN, YELLOW, or RED'})
            }
        
        print(f"🏥 Health check for company {company_id}, criticality: {criticality_level}, manual: {manual_score or 'none'}")
        
        # Perform health check analysis
        result = analyze_company_health(company_id, criticality_level, manual_score)
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps(result['data'])
            }
        else:
            return {
                'statusCode': 500,
                'headers': cors_headers,
                'body': json.dumps({'error': result['error']})
            }
            
    except Exception as e:
        print(f"❌ Health check failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': f'Health check failed: {str(e)}'
            })
        }


def handle_get_health_check_request(event, context):
    """
    Handle requests to get the latest health check for a company
    """
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    try:
        # Extract parameters from event
        company_id = event.get('company_id')
        
        if not company_id:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'company_id is required'})
            }
        
        print(f"🔍 Getting latest health check for company {company_id}")
        
        # Get the latest health check
        result = get_latest_health_check(company_id)
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps(result['data'] or {'success': True, 'data': None})
            }
        else:
            return {
                'statusCode': 500,
                'headers': cors_headers,
                'body': json.dumps({'error': result['error']})
            }
            
    except Exception as e:
        print(f"❌ Get health check failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': f'Get health check failed: {str(e)}'
            })
        }


def handle_generate_internal_summary_request(event, context):
    """
    Handle requests to generate an internal summary for a company
    """
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    try:
        # Extract parameters from event
        company_id = event.get('company_id')
        company_data = event.get('company_data', {})
        
        if not company_id:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'company_id is required'})
            }
        
        print(f"📝 Generating internal summary for company {company_id}")
        
        # Generate the summary
        result = generate_internal_summary(event)
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps(result)
            }
        else:
            return {
                'statusCode': 500,
                'headers': cors_headers,
                'body': json.dumps({'error': result['error']})
            }
            
    except Exception as e:
        print(f"❌ Generate internal summary failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': f'Generate internal summary failed: {str(e)}'
            })
        }


def create_async_job_in_db(company_id: int, stage: str, custom_config: dict = None) -> str:
    """
    Create a new async analysis job in the database
    Returns the job ID
    """
    import ssl
    
    try:
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect to database
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # Insert new job
        cursor.execute("""
            INSERT INTO async_analysis_jobs (company_id, stage, status, progress, created_by)
            VALUES (%s, %s, 'queued', 0, 'system')
            RETURNING id
        """, [company_id, stage])
        
        job_id = cursor.fetchone()[0]
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"💾 Created async job {job_id} in database")
        return str(job_id)
        
    except Exception as e:
        print(f"❌ Failed to create job in database: {str(e)}")
        raise e


def get_job_status_from_db(job_id: str) -> dict:
    """
    Get job status from database
    """
    import ssl
    
    try:
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect to database
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # Get job status
        cursor.execute("""
            SELECT id, company_id, stage, status, progress, results, error_message, 
                   reports_analyzed, started_at, completed_at, created_at
            FROM async_analysis_jobs 
            WHERE id = %s
        """, [job_id])
        
        row = cursor.fetchone()
        
        if not row:
            cursor.close()
            conn.close()
            return None
        
        # Convert to dict
        job_status = {
            'job_id': str(row[0]),
            'company_id': row[1],
            'stage': row[2],
            'status': row[3],
            'progress': row[4],
            'results': row[5],
            'error_message': row[6],
            'reports_analyzed': row[7],
            'started_at': row[8].isoformat() if row[8] else None,
            'completed_at': row[9].isoformat() if row[9] else None,
            'created_at': row[10].isoformat() if row[10] else None
        }
        
        cursor.close()
        conn.close()
        
        return job_status
        
    except Exception as e:
        print(f"❌ Failed to get job status from database: {str(e)}")
        raise e


def update_job_status(job_id: str, status: str, progress: int, results: str = None, error_message: str = None):
    """
    Update job status in database
    """
    import ssl
    
    try:
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect to database
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # Update fields based on status
        update_fields = ['status = %s', 'progress = %s', 'updated_at = CURRENT_TIMESTAMP']
        update_values = [status, progress]
        
        if status == 'processing' and not error_message:
            update_fields.append('started_at = CURRENT_TIMESTAMP')
        elif status == 'completed':
            update_fields.append('completed_at = CURRENT_TIMESTAMP')
            if results:
                update_fields.append('results = %s')
                update_values.append(results)
        elif status == 'failed' and error_message:
            update_fields.append('error_message = %s')
            update_values.append(error_message)
        
        # Build query
        query = f"""
            UPDATE async_analysis_jobs 
            SET {', '.join(update_fields)}
            WHERE id = %s
        """
        update_values.append(job_id)
        
        cursor.execute(query, update_values)
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"📝 Updated job {job_id} status to {status} (progress: {progress}%)")
        
    except Exception as e:
        print(f"❌ Failed to update job status: {str(e)}")
        raise e


def get_latest_completed_job_from_db(company_id: int) -> dict:
    """
    Get the latest completed async analysis job for a company
    """
    import ssl
    
    try:
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect to database
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # Get latest completed job
        cursor.execute("""
            SELECT id, company_id, stage, status, progress, results, error_message, 
                   reports_analyzed, started_at, completed_at, created_at
            FROM async_analysis_jobs 
            WHERE company_id = %s AND status = 'completed'
            ORDER BY completed_at DESC
            LIMIT 1
        """, [company_id])
        
        row = cursor.fetchone()
        
        if not row:
            cursor.close()
            conn.close()
            return None
        
        # Convert to dict
        job_status = {
            'job_id': str(row[0]),
            'company_id': row[1],
            'stage': row[2],
            'status': row[3],
            'progress': row[4],
            'results': row[5],
            'error_message': row[6],
            'reports_analyzed': row[7],
            'started_at': row[8].isoformat() if row[8] else None,
            'completed_at': row[9].isoformat() if row[9] else None,
            'created_at': row[10].isoformat() if row[10] else None
        }
        
        cursor.close()
        conn.close()
        
        return job_status
        
    except Exception as e:
        print(f"❌ Failed to get latest completed job from database: {str(e)}")
        raise e


def trigger_async_processing(job_id: str, company_id: int, stage: str, custom_config: dict = None):
    """
    Trigger async processing of the analysis job
    """
    import boto3
    
    try:
        # Initialize Lambda client
        lambda_client = boto3.client('lambda', region_name=os.environ.get('AWS_REGION', 'us-west-2'))
        
        # Prepare payload for async processing
        payload = {
            'action': 'process_async_kpi_job',
            'job_id': job_id,
            'company_id': company_id,
            'stage': stage
        }
        
        # Add custom config if provided
        if custom_config:
            payload['custom_config'] = custom_config
        
        # Invoke Lambda asynchronously (fire and forget)
        lambda_client.invoke(
            FunctionName='kv-automation-pdf-analysis',  # Self-invoke
            InvocationType='Event',  # Async invocation
            Payload=json.dumps(payload)
        )
        
        print(f"🚀 Triggered async processing for job {job_id}")
        
    except Exception as e:
        print(f"❌ Failed to trigger async processing: {str(e)}")
        # Don't raise here - job is created, we can retry processing later


def analyze_company_health(company_id: int, criticality_level: int = 5, manual_score: str = None) -> dict:
    """
    Analyze company health using the most recent board deck and financial summaries
    Returns health score (GREEN/YELLOW/RED) with justification
    """
    import ssl
    import tempfile
    import concurrent.futures
    from datetime import datetime
    
    try:
        print(f"🏥 Starting health check analysis for company {company_id}")
        
        # If manual score is provided, store it and return immediately
        if manual_score:
            try:
                store_health_check_in_db(
                    company_id=company_id,
                    health_score=manual_score,
                    justification=f"Manual override: Health score set to {manual_score} by user.",
                    criticality_level=None,
                    manual_override=True
                )
                print(f"✅ Manual health check stored in database for company {company_id}")
            except Exception as storage_error:
                print(f"⚠️ Failed to store manual health check: {storage_error}")
                # Continue without failing
            
            return {
                'success': True,
                'data': {
                    'success': True,
                    'score': manual_score,
                    'justification': f"Manual override: Health score set to {manual_score} by user.",
                    'manual_override': True,
                    'analysis_timestamp': datetime.utcnow().isoformat() + 'Z'
                }
            }
        
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect to database and get company info + recent PDFs
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # Get company info
        cursor.execute("""
            SELECT name, sector, normalized_name 
            FROM companies 
            WHERE id = %s
        """, [company_id])
        
        company_row = cursor.fetchone()
        if not company_row:
            cursor.close()
            conn.close()
            return {'success': False, 'error': f'Company {company_id} not found'}
        
        company_name, sector, normalized_name = company_row
        print(f"🏢 Company: {company_name} (Sector: {sector or 'unknown'})")
        
        # Get the most recent board deck PDF
        cursor.execute("""
            SELECT id, file_name, report_date, report_period,
                   cash_on_hand, monthly_burn_rate, cash_out_date, runway,
                   budget_vs_actual, financial_summary, key_risks
            FROM financial_reports 
            WHERE company_id = %s 
            ORDER BY report_date DESC 
            LIMIT 1
        """, [company_id])
        
        report_row = cursor.fetchone()
        if not report_row:
            cursor.close()
            conn.close()
            return {'success': False, 'error': f'No financial reports found for company {company_id}'}
        
        report_id, file_name, report_date, report_period, cash_on_hand, monthly_burn_rate, cash_out_date, runway, budget_vs_actual, financial_summary, key_risks = report_row
        
        print(f"📄 Most recent report: {file_name} ({report_date})")
        
        # Get all financial data for comprehensive context (last 10 reports)
        cursor.execute("""
            SELECT file_name, report_date, report_period, sector, cash_on_hand, 
                   monthly_burn_rate, cash_out_date, runway, budget_vs_actual,
                   financial_summary, sector_highlight_a, sector_highlight_b,
                   key_risks, personnel_updates, next_milestones
            FROM financial_reports 
            WHERE company_id = %s 
            ORDER BY report_date DESC 
            LIMIT 10
        """, [company_id])
        
        historical_data = cursor.fetchall()
        cursor.close()
        conn.close()
        
        # Download the most recent PDF from S3
        import boto3
        s3_client = boto3.client('s3')
        bucket_name = os.environ.get('S3_BUCKET_NAME', 'kv-board-decks')
        
        # Try to find the PDF in S3 using common key patterns
        pdf_bytes = None
        possible_keys = [
            f"company-{company_id}/{file_name}",
            file_name
        ]
        
        for s3_key in possible_keys:
            try:
                print(f"📥 Attempting to download: s3://{bucket_name}/{s3_key}")
                pdf_object = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
                pdf_bytes = pdf_object['Body'].read()
                print(f"✅ Downloaded PDF: {len(pdf_bytes)} bytes from {s3_key}")
                break
            except Exception as s3_error:
                print(f"❌ Failed to download {s3_key}: {str(s3_error)}")
                continue
        
        if not pdf_bytes:
            print(f"⚠️ Could not download PDF from S3 for any key pattern")
        
        # Prepare comprehensive context data for AI analysis
        financial_context = []
        for row in historical_data:
            context_entry = {
                'file_name': row[0],
                'date': str(row[1]),
                'period': row[2],
                'sector': row[3],
                'cash_on_hand': row[4],
                'monthly_burn_rate': row[5],
                'cash_out_date': str(row[6]) if row[6] else None,
                'runway': row[7],
                'budget_vs_actual': row[8],
                'financial_summary': row[9],
                'sector_highlight_a': row[10],
                'sector_highlight_b': row[11],
                'key_risks': row[12],
                'personnel_updates': row[13],
                'next_milestones': row[14]
            }
            financial_context.append(context_entry)
        
        # Perform AI analysis using OpenAI
        api_key = os.environ.get('OPENAI_API_KEY')
        if not api_key:
            return {'success': False, 'error': 'OpenAI API key not configured'}
        
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        
        # Build the health check prompt based on criticality level
        criticality_descriptions = {
            1: "Very lenient analysis - focus heavily on positives, minimize concerns",
            2: "Lenient analysis - generally optimistic perspective",
            3: "Somewhat lenient - mild optimistic bias",
            4: "Slightly lenient - slight positive lean",
            5: "Balanced analysis - neutral, objective assessment",
            6: "Slightly critical - slight negative lean", 
            7: "Somewhat critical - mild pessimistic bias",
            8: "Critical analysis - generally pessimistic perspective",
            9: "Very critical - harsh but fair assessment",
            10: "Extremely critical - maximum scrutiny, find all issues"
        }
        
        system_prompt = f"""KV financial analyst health check for {company_name}.

**CRITICALITY**: {criticality_level}/10 - {criticality_descriptions[criticality_level]}

**ANALYSIS STYLE**:
• Level 1-3: Optimistic, focus on strengths
• Level 4-6: Balanced perspective  
• Level 7-10: Critical, emphasize risks

**DATA SOURCES**:
• Recent board deck (attached PDF)
• Historical financial data (10 reports)
• Cash/burn/runway trends
• Budget vs actual performance

**OUTPUT FORMAT**:

**HEALTH SCORE**: Choose exactly one and make it exactly the first word in the response: ex. "GREEN", "YELLOW", "RED"
- GREEN: Company is healthy with strong fundamentals
- YELLOW: Company has manageable concerns but is stable
- RED: Company faces significant challenges requiring attention

**JUSTIFICATION**: Concise bullet points covering:
• **Financial trends**: Key metrics, cash position, burn rate changes
• **Performance**: Budget vs actual, sector-specific indicators
• **Operations**: Personnel changes, milestone progress, risk factors
• **Outlook**: Overall trajectory and critical issues

**HISTORICAL CONTEXT**:
{financial_context}

Keep analysis concise, factual, and bullet-point focused."""

        # Create user content with PDF if available
        user_content = [
            {"type": "input_text", "text": f"Analyze {company_name} health. Start with GREEN/YELLOW/RED, then provide concise bullet-point justification."}
        ]
        
        # Upload PDF to OpenAI if available
        uploaded_file_id = None
        tmp_path = None
        
        if pdf_bytes:
            try:
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                    tmp.write(pdf_bytes)
                    tmp_path = tmp.name
                
                with open(tmp_path, "rb") as f:
                    file_response = client.files.create(file=f, purpose="user_data")
                    uploaded_file_id = file_response.id
                    print(f"✅ Uploaded PDF to OpenAI: {uploaded_file_id}")
                
                user_content.append({"type": "input_file", "file_id": uploaded_file_id})
            except Exception as upload_error:
                print(f"⚠️ Failed to upload PDF to OpenAI: {upload_error}")
        
        # Make the OpenAI API call
        try:
            print(f"🤖 Calling GPT-5 for health check analysis (criticality: {criticality_level})")
            
            resp = client.responses.create(
                model="gpt-5",
                instructions=system_prompt,
                input=[{"role": "user", "content": user_content}],
                reasoning={"effort": "medium"}
            )
            
            analysis_result = extract_output_text(resp)
            print(f"✅ Health check analysis completed: {len(analysis_result)} chars")
            
            # Parse the health score from the response
            health_score = 'YELLOW'  # Default fallback
            if 'GREEN' in analysis_result.upper():
                health_score = 'GREEN'
            elif 'RED' in analysis_result.upper():
                health_score = 'RED'
            elif 'YELLOW' in analysis_result.upper():
                health_score = 'YELLOW'
            
            # Clean up uploaded file
            if uploaded_file_id:
                try:
                    client.files.delete(uploaded_file_id)
                    print(f"🗑️ Cleaned up OpenAI file: {uploaded_file_id}")
                except:
                    pass
            
            # Clean up temp file
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except:
                    pass
            
            # Store the health check results in the database
            try:
                store_health_check_in_db(
                    company_id=company_id,
                    health_score=health_score,
                    justification=analysis_result,
                    criticality_level=criticality_level,
                    manual_override=False
                )
                print(f"✅ Health check stored in database for company {company_id}")
            except Exception as storage_error:
                print(f"⚠️ Failed to store health check: {storage_error}")
                # Continue without failing the entire operation
            
            return {
                'success': True,
                'data': {
                    'success': True,
                    'score': health_score,
                    'justification': analysis_result,
                    'criticality_level': criticality_level,
                    'manual_override': False,
                    'analysis_timestamp': datetime.utcnow().isoformat() + 'Z'
                }
            }
            
        except Exception as api_error:
            print(f"❌ OpenAI API call failed: {str(api_error)}")
            return {'success': False, 'error': f'AI analysis failed: {str(api_error)}'}
        
    except Exception as e:
        print(f"❌ Health check analysis failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        return {'success': False, 'error': f'Health check failed: {str(e)}'}


def generate_internal_summary(event_payload: dict) -> dict:
    """
    Generate a simple text-based internal summary for a portfolio company
    Uses 5 most recent financial reports from PostgresDB + frontend company data
    Returns plain markdown text with bullet points
    """
    try:
        import ssl
        
        # Extract data from payload
        company_id = event_payload.get('company_id')
        company_data = event_payload.get('company_data', {})
        
        if not company_id:
            return {'success': False, 'error': 'company_id is required'}
        
        print(f"📝 Generating internal summary for company {company_id}")
        
        # Database configuration
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        # Connect to database
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        # Get company name
        cursor.execute("SELECT name FROM companies WHERE id = %s", [company_id])
        company_row = cursor.fetchone()
        if not company_row:
            return {'success': False, 'error': f'Company {company_id} not found'}
        
        company_name = company_row[0]
        print(f"📊 Company: {company_name}")
        
        # Get 5 most recent financial reports
        cursor.execute("""
            SELECT 
                file_name, report_date, report_period, sector,
                cash_on_hand, monthly_burn_rate, cash_out_date, runway,
                budget_vs_actual, financial_summary,
                sector_highlight_a, sector_highlight_b,
                key_risks, personnel_updates, next_milestones
            FROM financial_reports
            WHERE company_id = %s
            ORDER BY report_date DESC, processed_at DESC
            LIMIT 5
        """, [company_id])
        
        financial_reports = cursor.fetchall()
        conn.close()
        
        print(f"📈 Found {len(financial_reports)} recent financial reports")
        
        # Format financial reports for the prompt
        reports_text = []
        for idx, row in enumerate(financial_reports, 1):
            report_entry = f"""
**Report {idx}** ({row[2] or 'N/A'} - {row[1] or 'N/A'}):
- Cash on Hand: {row[4] or 'N/A'}
- Monthly Burn: {row[5] or 'N/A'}
- Runway: {row[7] or 'N/A'}
- Cash Out Date: {row[6] or 'N/A'}
- Budget vs Actual: {row[8] or 'N/A'}
- Financial Summary: {row[9] or 'N/A'}
- Sector Highlight A: {row[10] or 'N/A'}
- Sector Highlight B: {row[11] or 'N/A'}
- Key Risks: {row[12] or 'N/A'}
- Personnel Updates: {row[13] or 'N/A'}
- Next Milestones: {row[14] or 'N/A'}
"""
            reports_text.append(report_entry)
        
        # Infer cadence from report frequency
        cadence = 'Unknown'
        if len(financial_reports) >= 2:
            try:
                from datetime import datetime
                date1 = datetime.strptime(str(financial_reports[0][1]), '%Y-%m-%d')
                date2 = datetime.strptime(str(financial_reports[1][1]), '%Y-%m-%d')
                days_diff = abs((date1 - date2).days)
                if days_diff < 40:
                    cadence = 'Monthly'
                elif days_diff < 70:
                    cadence = 'Bi-Monthly'
                else:
                    cadence = 'Quarterly'
            except:
                cadence = 'Unknown'
        
        # Build prompt with all data
        prompt = f"""You are generating an internal investor summary for KV Capital portfolio company monitoring.

**Company**: {company_name}
**Cadence**: {cadence}

**Snapshot**:
- Priority/Stage: {company_data.get('stage', 'N/A')}
- KV Fund(s): {company_data.get('kv_funds', 'N/A')}
- Total KV Invested: {company_data.get('total_kv_invested', 'N/A')}
- KV Ownership %: {company_data.get('kv_ownership', 'N/A')}
- Total Raised: {company_data.get('total_raised', 'N/A')}
- Date of Last Raise: {company_data.get('last_raise_date', 'N/A')}
- Last Round Raised: {company_data.get('last_round_amount', 'N/A')}
- Series: {company_data.get('series', 'N/A')}
- Last Post Money: {company_data.get('valuation', 'N/A')}

**Recent Financial Reports (5 most recent)**:
{''.join(reports_text)}

**Instructions**:
Generate a detailed, narrative-style internal summary using these EXACT headers (in this exact order). Expand on each point to provide full context. Avoid terse fragments; use complete sentences and short paragraphs to explain the significance of the data.

**{company_name} — {cadence}**

**Snapshot**:
• Priority/Stage: [stage]
• KV Fund: [funds]
• Total KV Invested: [amount]
• KV Ownership: [percentage]
• Total Raised: [amount]
• Last Raise Date: [date]
• Last Round Raised: [amount]
• Series: [series]
• Last Post Money: [valuation]

**One-line Description**: [Brief description of what the company does]

**Update Status**: [Brief note on update cadence and current status]

**Keys to the Next 12 Months' Success**:
• [Bullet point 1]
• [Bullet point 2]
• [Bullet point 3]

**Risks**:
• [Bullet point 1]
• [Bullet point 2]
• [Bullet point 3]

**Key Metrics**:
• [Bullet point 1]
• [Bullet point 2]
• [Bullet point 3]

**Financial Metrics (YTD vs Plan)**:
• [Bullet point 1]
• [Bullet point 2]

**Hiring**:
• [Bullet point on personnel updates]

**Runway/Burn/Cash**:
• [Bullet point summary of cash position]

**REQUIREMENTS**:
- Use bullet points (•) but write 2-4 full sentences per bullet to fully explain the context and implications.
- Be comprehensive and narrative. Do not use brief or clipped phrases.
- Extract insights from the financial reports provided and explain the 'why' behind the metrics.
- If data is not available, use "N/A" or skip that bullet
- NO fancy formatting, NO tables, NO graphics - just simple markdown text with bullet points
"""
        
        # Call OpenAI API
        api_key = os.environ.get('OPENAI_API_KEY')
        if not api_key:
            return {'success': False, 'error': 'OpenAI API key not configured'}
        
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        
        print(f"🤖 Calling OpenAI for summary generation...")
        
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a senior KV Capital investor-relations analyst who synthesizes private portfolio data into crisp, compliance-friendly one-pager summaries for partners."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=2000
        )
        
        summary_text = response.choices[0].message.content.strip()
        print(f"✅ Summary generated: {len(summary_text)} characters")
        
        return {
            'success': True,
            'summary': summary_text,
            'company_name': company_name,
            'report_count': len(financial_reports)
        }
        
    except Exception as e:
        print(f"❌ Summary generation failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        return {'success': False, 'error': f'Summary generation failed: {str(e)}'}


def handle_competition_analysis_request(event, context):
    """
    Handle competition analysis requests using OpenAI web search
    """
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    try:
        company_id = event.get('company_id')
        company_name = event.get('company_name')
        is_public = event.get('is_public', False)
        
        if not company_id:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'company_id is required'})
            }
        
        if not company_name:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'company_name is required'})
            }
        
        print(f"🔍 Competition analysis for: {company_name} (id={company_id}, public={is_public})")
        
        result = analyze_competition(company_id, company_name, is_public)
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps(result['data'])
            }
        else:
            return {
                'statusCode': 500,
                'headers': cors_headers,
                'body': json.dumps({
                    'error': result['error'],
                    'error_code': result.get('error_code', 'UNKNOWN_ERROR')
                })
            }
            
    except Exception as e:
        print(f"❌ Competition analysis failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'error': f'Competition analysis failed: {str(e)}',
                'error_code': 'INTERNAL_ERROR'
            })
        }


def handle_get_competition_analysis_request(event, context):
    """
    Handle requests to get the latest competition analysis for a company
    """
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    try:
        company_id = event.get('company_id')
        
        if not company_id:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'company_id is required'})
            }
        
        print(f"🔍 Getting latest competition analysis for company {company_id}")
        
        result = get_latest_competition_analysis(company_id)
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': json.dumps(result['data'])
            }
        else:
            return {
                'statusCode': 404 if 'not found' in result.get('error', '').lower() else 500,
                'headers': cors_headers,
                'body': json.dumps({'error': result['error']})
            }
            
    except Exception as e:
        print(f"❌ Get competition analysis failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'error': f'Get competition analysis failed: {str(e)}'
            })
        }


def analyze_competition(company_id: int, company_name: str, is_public: bool = False) -> dict:
    """
    Analyze competition using OpenAI's web search capabilities
    Returns competitor info, stock data (if public), and latest news
    Stores results in company_competition_analysis table
    """
    from datetime import datetime
    
    try:
        print(f"🔍 Starting competition analysis for {company_name} (id={company_id})")
        
        api_key = os.environ.get('OPENAI_API_KEY')
        if not api_key:
            return {'success': False, 'error': 'OpenAI API key not configured', 'error_code': 'AUTH_ERROR'}
        
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        
        # Build prompt based on company type
        if is_public:
            prompt = f"""Search the web for the latest information about {company_name} and its competitors. Provide:

1. **Stock Information** (if publicly traded):
   - Current stock price and ticker symbol
   - Market capitalization
   - Recent stock performance (1 week, 1 month trends)

2. **Key Competitors**:
   - List 3-5 main competitors with brief descriptions
   - Their market positions relative to {company_name}

3. **Latest News** (from the past 2-4 weeks):
   - 3-5 significant news items about {company_name}
   - Any major industry developments affecting competition

Format the response in clear sections with markdown. Be specific with numbers and dates. If exact data is not available, note that clearly."""
        else:
            prompt = f"""Search the web for the latest information about {company_name} (a private company) and its competitors. Provide:

1. **Funding & Valuation**:
   - Latest known funding round (amount, date, investors)
   - Total funding raised to date
   - Last known valuation (if available)

2. **Key Competitors**:
   - List 3-5 main competitors (both private and public)
   - Their funding stages and recent raises
   - Market positioning relative to {company_name}

3. **Latest News** (from the past 2-4 weeks):
   - 3-5 significant news items about {company_name}
   - Hiring announcements, product launches, partnerships
   - Any major industry developments

Format the response in clear sections with markdown. Be specific with numbers and dates. If exact data is not available, note that clearly."""

        print(f"🤖 Calling OpenAI with web_search tool...")
        
        # Use the Responses API with web_search tool
        resp = client.responses.create(
            model="gpt-4o",
            tools=[{"type": "web_search"}],
            input=prompt
        )
        
        # Extract text from response
        analysis_text = extract_output_text(resp)
        
        if not analysis_text:
            print(f"❌ No text extracted from OpenAI response")
            return {'success': False, 'error': 'Failed to extract analysis from OpenAI response', 'error_code': 'PARSE_ERROR'}
        
        print(f"✅ Competition analysis completed: {len(analysis_text)} chars")
        
        # Store the analysis in the database
        timestamp = datetime.utcnow()
        try:
            store_competition_analysis_in_db(
                company_id=company_id,
                analysis_content=analysis_text,
                is_public=is_public
            )
            print(f"✅ Competition analysis stored in database for company {company_id}")
        except Exception as storage_error:
            print(f"⚠️ Failed to store competition analysis: {storage_error}")
            # Continue without failing the operation
        
        return {
            'success': True,
            'data': {
                'success': True,
                'company_id': company_id,
                'company_name': company_name,
                'is_public': is_public,
                'analysis': analysis_text,
                'timestamp': timestamp.isoformat() + 'Z'
            }
        }
        
    except Exception as e:
        print(f"❌ Competition analysis failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        error_code = 'UNKNOWN_ERROR'
        if 'authentication' in str(e).lower() or 'api key' in str(e).lower():
            error_code = 'AUTH_ERROR'
        elif 'rate limit' in str(e).lower():
            error_code = 'RATE_LIMIT'
        elif 'invalid' in str(e).lower():
            error_code = 'BAD_REQUEST'
        
        return {'success': False, 'error': str(e), 'error_code': error_code}


def store_competition_analysis_in_db(company_id: int, analysis_content: str, is_public: bool = False):
    """
    Store competition analysis results in the company_competition_analysis table
    """
    import ssl
    from datetime import datetime
    
    try:
        print(f"💾 Storing competition analysis for company {company_id}")
        
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO company_competition_analysis 
            (company_id, analysis_content, is_public, analysis_timestamp, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, [
            company_id,
            analysis_content,
            is_public,
            datetime.utcnow(),
            datetime.utcnow(),
            datetime.utcnow()
        ])
        
        conn.commit()
        cursor.close()
        conn.close()
        
        print(f"💾 Successfully stored competition analysis ({len(analysis_content)} chars)")
        
    except Exception as e:
        print(f"❌ Failed to store competition analysis: {str(e)}")
        raise e


def get_latest_competition_analysis(company_id: int) -> dict:
    """
    Get the latest competition analysis for a company from the database
    """
    import ssl
    
    try:
        print(f"🔍 Getting latest competition analysis for company {company_id}")
        
        db_config = {
            'host': os.environ.get('DB_HOST'),
            'port': int(os.environ.get('DB_PORT', 5432)),
            'database': os.environ.get('DB_NAME'),
            'user': os.environ.get('DB_USER'),
            'password': os.environ.get('DB_PASSWORD')
        }
        
        ctx = ssl.create_default_context()
        conn = pg8000.connect(**db_config, ssl_context=ctx, timeout=30)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, analysis_content, is_public, analysis_timestamp
            FROM company_competition_analysis
            WHERE company_id = %s
            ORDER BY analysis_timestamp DESC
            LIMIT 1
        """, [company_id])
        
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not row:
            return {
                'success': False,
                'error': f'No competition analysis found for company {company_id}'
            }
        
        analysis_id, analysis_content, is_public, analysis_timestamp = row
        
        return {
            'success': True,
            'data': {
                'id': analysis_id,
                'company_id': company_id,
                'analysis': analysis_content,
                'is_public': is_public,
                'timestamp': analysis_timestamp.isoformat() + 'Z' if analysis_timestamp else None
            }
        }
        
    except Exception as e:
        print(f"❌ Failed to get competition analysis: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        return {'success': False, 'error': str(e)}