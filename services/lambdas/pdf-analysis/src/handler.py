import json
import base64
import tempfile
import os
import sys
import traceback
import pg8000
from datetime import datetime


# Add the Lambda layer path for dependencies
sys.path.insert(0, '/opt/python')

def lambda_handler(event, context):
    """
    Lambda function for PDF extraction and OpenAI analysis
    Supports both S3 events (new), API Gateway requests (legacy), and KPI analysis requests
    """
    
    # Log the incoming event for debugging
    print(f"Lambda invoked with event: {json.dumps(event)[:500]}...")
    
    # Enhanced event type detection
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
    elif event.get('action') == 'analyze_kpis':
        print("📊 Processing KPI analysis request")
        return handle_kpi_analysis_request(event, context)
    else:
        print("📡 Processing API Gateway event (legacy architecture)")
        return handle_api_gateway_event(event, context)


def handle_kpi_analysis_request(event, context):
    """
    Handle KPI analysis requests for multiple PDFs
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
        
        print(f"🔍 KPI analysis requested for company {company_id}, stage: {stage}")
        
        # Perform the analysis
        result = analyze_recent_pdfs_for_kpis(company_id, stage)
        
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


def handle_api_gateway_event(event, context):
    """
    Legacy handler for API Gateway requests with base64 PDFs
    """
    # CORS headers for all responses
    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    # Handle CORS preflight requests (check multiple possible fields)
    http_method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method')
    if http_method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({'message': 'CORS preflight OK'})
        }
    
    # Parse the request
    try:
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
            
        # Handle direct Lambda invoke (no HTTP wrapper)
        if not body and 'pdf_b64' in event:
            body = event
            
    except json.JSONDecodeError:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': 'Invalid JSON in request body'})
        }
    
    # Get PDF data (support both parameter names)
    pdf_base64 = body.get('pdf_data') or body.get('pdf_b64')
    filename = body.get('filename', 'document.pdf')
    company_name_override = body.get('company_name_override')
    user_provided_name = body.get('user_provided_name', False)  # NEW: Flag for user-provided names
    compressed = body.get('compressed', False)
    
    if not pdf_base64:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': 'No PDF data provided'})
        }
    
    try:
        print(f"Starting PDF processing for: {filename}")
        
        # Decode base64 PDF with optional gzip decompression
        if compressed:
            import gzip
            pdf_bytes = gzip.decompress(base64.b64decode(pdf_base64))
            print(f"Decompressed PDF, size: {len(pdf_bytes)} bytes")
        else:
            pdf_bytes = base64.b64decode(pdf_base64)
            print(f"Decoded PDF, size: {len(pdf_bytes)} bytes")
        
        # Analyze with GPT-5 Responses API (direct PDF upload)
        analysis_result = analyze_with_gpt5_responses_api(pdf_bytes, filename, is_text_only=False, company_name_override=company_name_override, user_provided_name=user_provided_name)
        
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps(analysis_result)
        }
        
    except Exception as e:
        print(f"Error processing PDF: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({'error': f'Error processing PDF: {str(e)}'})
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

    # Force string-ish fields to strings
    for k in ['companyName','reportDate','reportPeriod','cashOutDate','sector',
              'budgetVsActual','financialSummary','sectorHighlightA','sectorHighlightB',
              'keyRisks','personnelUpdates','nextMilestones','filename']:
        if d[k] is not None and not isinstance(d[k], str):
            d[k] = str(d[k])

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

        # --- Instructions + JSON Schema ---
        system_prompt = (
            "Return ONLY one JSON object that validates the provided JSON Schema. "
            "No code fences; no prose outside the JSON. Escape quotes correctly. "
            "You are an expert financial analyst for VC board decks. Numeric fields must be raw numbers."
        )

        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "companyName": {"type": ["string", "null"]},
                "reportDate": {"type": ["string", "null"], "format": "date"},
                "reportPeriod": {"type": ["string", "null"]},
                "sector": {"type": ["string", "null"], "enum": ["healthcare", "consumer", "enterprise", "manufacturing"]},
                "cashOnHand": {"type": ["number", "null"]},
                "monthlyBurnRate": {"type": ["number", "null"]},
                "cashOutDate": {"type": ["string", "null"]},
                "runway": {"type": ["integer", "null"]},
                "budgetVsActual": {"type": ["string", "null"]},
                "financialSummary": {"type": ["string", "null"]},
                "sectorHighlightA": {"type": ["string", "null"]},
                "sectorHighlightB": {"type": ["string", "null"]},
                "keyRisks": {"type": ["string", "null"]},
                "personnelUpdates": {"type": ["string", "null"]},
                "nextMilestones": {"type": ["string", "null"]},
                "evidence": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "companyName": {"type": ["object", "null"], "additionalProperties": False,
                                        "properties": {"page": {"type": ["integer", "null"]},
                                                       "quote": {"type": ["string", "null"], "maxLength": 200}},
                                        "required": ["page", "quote"]},
                        "reportDate": {"type": ["object", "null"], "additionalProperties": False,
                                       "properties": {"page": {"type": ["integer", "null"]},
                                                      "quote": {"type": ["string", "null"], "maxLength": 120}},
                                       "required": ["page", "quote"]},
                        "reportPeriod": {"type": ["object", "null"], "additionalProperties": False,
                                         "properties": {"page": {"type": ["integer", "null"]},
                                                        "quote": {"type": ["string", "null"], "maxLength": 120}},
                                         "required": ["page", "quote"]},
                        "sector": {"type": ["object", "null"], "additionalProperties": False,
                                   "properties": {"page": {"type": ["integer", "null"]},
                                                  "quote": {"type": ["string", "null"], "maxLength": 120}},
                                   "required": ["page", "quote"]},
                        "cashOnHand": {"type": ["object", "null"], "additionalProperties": False,
                                       "properties": {"page": {"type": ["integer", "null"]},
                                                      "quote": {"type": ["string", "null"], "maxLength": 120}},
                                       "required": ["page", "quote"]},
                        "monthlyBurnRate": {"type": ["object", "null"], "additionalProperties": False,
                                            "properties": {"page": {"type": ["integer", "null"]},
                                                           "quote": {"type": ["string", "null"], "maxLength": 120}},
                                            "required": ["page", "quote"]},
                        "cashOutDate": {"type": ["object", "null"], "additionalProperties": False,
                                        "properties": {"page": {"type": ["integer", "null"]},
                                                       "quote": {"type": ["string", "null"], "maxLength": 120}},
                                        "required": ["page", "quote"]},
                        "runway": {"type": ["object", "null"], "additionalProperties": False,
                                   "properties": {"page": {"type": ["integer", "null"]},
                                                  "quote": {"type": ["string", "null"], "maxLength": 120}},
                                   "required": ["page", "quote"]},
                        "budgetVsActual": {"type": ["object", "null"], "additionalProperties": False,
                                           "properties": {"page": {"type": ["integer", "null"]},
                                                          "quote": {"type": ["string", "null"], "maxLength": 200}},
                                           "required": ["page", "quote"]},
                        "financialSummary": {"type": ["object", "null"], "additionalProperties": False,
                                             "properties": {"page": {"type": ["integer", "null"]},
                                                            "quote": {"type": ["string", "null"], "maxLength": 200}},
                                             "required": ["page", "quote"]},
                        "sectorHighlightA": {"type": ["object", "null"], "additionalProperties": False,
                                             "properties": {"page": {"type": ["integer", "null"]},
                                                            "quote": {"type": ["string", "null"], "maxLength": 200}},
                                             "required": ["page", "quote"]},
                        "sectorHighlightB": {"type": ["object", "null"], "additionalProperties": False,
                                             "properties": {"page": {"type": ["integer", "null"]},
                                                            "quote": {"type": ["string", "null"], "maxLength": 200}},
                                             "required": ["page", "quote"]},
                        "keyRisks": {"type": ["object", "null"], "additionalProperties": False,
                                     "properties": {"page": {"type": ["integer", "null"]},
                                                    "quote": {"type": ["string", "null"], "maxLength": 200}},
                                     "required": ["page", "quote"]},
                        "personnelUpdates": {"type": ["object", "null"], "additionalProperties": False,
                                             "properties": {"page": {"type": ["integer", "null"]},
                                                            "quote": {"type": ["string", "null"], "maxLength": 200}},
                                             "required": ["page", "quote"]},
                        "nextMilestones": {"type": ["object", "null"], "additionalProperties": False,
                                           "properties": {"page": {"type": ["integer", "null"]},
                                                          "quote": {"type": ["string", "null"], "maxLength": 200}},
                                           "required": ["page", "quote"]}
                    },
                    "required": ["companyName","reportDate","reportPeriod","sector","cashOnHand","monthlyBurnRate","cashOutDate","runway","budgetVsActual","financialSummary","sectorHighlightA","sectorHighlightB","keyRisks","personnelUpdates","nextMilestones"]
                }
            },
            "required": ["companyName","reportDate","reportPeriod","sector","cashOnHand","monthlyBurnRate","cashOutDate","runway","budgetVsActual","financialSummary","sectorHighlightA","sectorHighlightB","keyRisks","personnelUpdates","nextMilestones","evidence"]
        }

        structured_format = {
            "type": "json_schema",
            "name": "financial_kpis_with_evidence",
            "schema": schema,
            "strict": True
        }

        # --- Build single-user message: first part is instructions, then data/file ---
        content_parts = [{"type": "input_text", "text": system_prompt}]
        if is_text_only:
            content_parts.append({"type": "input_text", "text": f"ANALYZE THIS TEXT (from {filename}):\n\n{text_content}"})
        else:
            content_parts.append({"type": "input_text", "text": "Analyze the attached PDF for the required fields using the schema."})
            content_parts.append({"type": "input_file", "file_id": file_response.id})

        print("🚀 Calling Responses API with Structured Outputs...")
        response = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-5"),
            input=[{"role": "user", "content": content_parts}],
            text={"format": structured_format},
            max_output_tokens=12000
        )

        raw = response.output_text or ""
        if not raw.strip():
            raise ValueError("Empty output_text from model")

        # --- Parse JSON (with tiny fallback extractor) ---
        def _extract_json(s: str) -> dict:
            s = (s or "").strip().replace('\ufeff', '')
            # strip triple-fence blocks if present
            if s.startswith("```"):
                s = s.split("```", 1)[-1]
                if "```" in s:
                    s = s.rsplit("```", 1)[0]
            # normalize smart quotes
            s = (s.replace('“','"').replace('”','"')
                   .replace('’',"'").replace('`', "'"))
            start, end = s.find('{'), s.rfind('}')
            if start == -1 or end == -1 or end <= start:
                raise ValueError("No JSON object found")
            return _json.loads(s[start:end+1])

        try:
            data = _json.loads(raw)
            print("✅ Valid JSON from model")
        except Exception as e:
            print(f"❌ JSON parse failed: {e}; preview: {raw[:300]}")
            data = _extract_json(raw)
            print("✅ Fallback JSON extraction succeeded")

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



def analyze_recent_pdfs_for_kpis(company_id: int, stage: str) -> dict:
    """
    Analyze the 4 most recent PDFs for a company to extract KPIs based on sector and stage
    
    Args:
        company_id: Database company ID
        stage: Company stage from frontend ('Growth Stage', 'Main Stage', 'Early Stage')
    
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
        
        # Extract company info and sector from first report
        company_name = reports[0][8]
        sector = reports[0][4] or 'healthcare'
        
        print(f"🏢 Company: {company_name}")
        print(f"🎯 Sector: {sector}")
        print(f"📈 Stage: {stage}")
        
        # Download PDFs from S3
        import boto3
        s3_client = boto3.client('s3')
        bucket_name = os.environ.get('S3_BUCKET_NAME', 'kv-board-decks-prod')
        
        pdf_contents = []
        report_metadata = []
        
        for report in reports:
            report_id, file_name, report_date, report_period = report[0], report[1], report[2], report[3]
            
            # Construct S3 key - try both with and without company prefix
            possible_keys = [
                f"company-{company_id}/{file_name}",
                file_name
            ]
            
            pdf_bytes = None
            actual_key = None
            
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
        
        if len(pdf_contents) < 2:
            return {
                'success': False,
                'error': f'Could only retrieve {len(pdf_contents)} PDFs from S3'
            }
        
        print(f"📋 Successfully retrieved {len(pdf_contents)} PDFs for analysis")
        
        # Perform multi-PDF KPI analysis - returns markdown
        markdown_analysis = analyze_multi_pdf_kpis(pdf_contents, company_name, sector, stage)
        
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


def analyze_multi_pdf_kpis(pdf_contents: list, company_name: str, sector: str, stage: str) -> str:
    """
    Use OpenAI to analyze multiple PDFs and extract KPIs based on sector and stage
    Returns detailed markdown analysis
    """
    import os, tempfile
    
    # Check for API key
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise Exception("OpenAI API key not configured")
    
    uploaded_files = []
    tmp_paths = []
    
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        
        print(f"🤖 Starting OpenAI multi-PDF KPI analysis...")
        print(f"📁 Uploading {len(pdf_contents)} PDFs to OpenAI...")
        
        # Upload all PDFs to OpenAI
        for pdf_data in pdf_contents:
            # Create temporary file
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(pdf_data['pdf_bytes'])
                tmp_path = tmp.name
                tmp_paths.append(tmp_path)
            
            # Upload to OpenAI
            with open(tmp_path, "rb") as f:
                file_response = client.files.create(file=f, purpose="user_data")
                uploaded_files.append({
                    'file_id': file_response.id,
                    'file_name': pdf_data['file_name'],
                    'report_period': pdf_data['report_period'],
                    'report_date': pdf_data['report_date']
                })
                print(f"✅ Uploaded {pdf_data['file_name']}: {file_response.id}")
        
        # Define KPI requirements based on sector and stage
        kpi_requirements = get_kpi_requirements(sector, stage)
        
        # Create the analysis prompt for markdown output
        system_prompt = f"""You are an expert financial analyst specializing in board deck analysis for venture capital portfolio companies.

You will analyze {len(pdf_contents)} board deck PDFs from {company_name} (a {sector} company in {stage}) to extract and track key performance indicators over time.

## COMPANY CONTEXT
- **Company**: {company_name}
- **Sector**: {sector}
- **Stage**: {stage}
- **Reports to analyze**: {len(pdf_contents)}

## KPI REQUIREMENTS FOR THIS ANALYSIS
Based on the sector and stage, focus on these KPIs:

{kpi_requirements}

## ANALYSIS INSTRUCTIONS
1. **Temporal Analysis**: Track how each KPI has changed across the time periods
2. **Trend Identification**: Identify improving, declining, or stable trends  
3. **Context Understanding**: Explain the business context behind changes
4. **Stage-Appropriate Focus**: Emphasize the KPIs most relevant to this stage

## OUTPUT FORMAT
Return a detailed markdown analysis with:
- Executive summary with key trends
- KPI trend analysis with tables and bullet points
- Strategic insights and recommendations
- Data quality observations

Use headers, tables, bullet points, and emphasis for readability."""

        # Build content parts for Responses API
        content_parts = [{"type": "input_text", "text": system_prompt}]
        
        # Add instruction text
        file_list = "\n".join([f"- {f['file_name']} ({f['report_period']}, {f['report_date']})" for f in uploaded_files])
        
        content_parts.append({
            "type": "input_text", 
            "text": f"""Analyze these {len(uploaded_files)} board deck reports for {company_name} and provide a comprehensive KPI trend analysis:

**Files to analyze:**
{file_list}

Focus on the KPIs specified for {sector} companies in {stage}, and provide detailed markdown analysis with trends, insights, and recommendations."""
        })
        
        # Add all uploaded PDF files
        for file_info in uploaded_files:
            content_parts.append({
                "type": "input_file",
                "file_id": file_info['file_id']
            })
        
        print("🚀 Calling Responses API for multi-PDF KPI analysis...")
        
        response = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o"),
            input=[{"role": "user", "content": content_parts}],
            max_output_tokens=6000
        )
        
        markdown_analysis = response.output_text or ""
        
        if not markdown_analysis.strip():
            raise ValueError("Empty output from OpenAI model")
        
        print(f"✅ Received {len(markdown_analysis)} characters of markdown analysis")
        return markdown_analysis
        
    except Exception as e:
        print(f"❌ OpenAI KPI analysis failed: {str(e)}")
        raise e
    finally:
        # Cleanup uploaded files from OpenAI
        for file_info in uploaded_files:
            try:
                client.files.delete(file_info['file_id'])
                print(f"🗑️ Deleted {file_info['file_name']} from OpenAI storage")
            except Exception as cleanup_error:
                print(f"⚠️ File cleanup failed for {file_info['file_name']}: {cleanup_error}")
        
        # Cleanup local temp files
        for tmp_path in tmp_paths:
            try:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            except Exception as cleanup_error:
                print(f"⚠️ Local file cleanup failed: {cleanup_error}")


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
        
        # Same INSERT pattern as financial-crud, but WITH evidence field
        report_insert = """
            INSERT INTO financial_reports (
                company_id, file_name, report_date, report_period, sector,
                cash_on_hand, monthly_burn_rate, cash_out_date, runway, budget_vs_actual,
                financial_summary, sector_highlight_a, sector_highlight_b,
                key_risks, personnel_updates, next_milestones,
                manually_edited, edited_by, edited_at,
                upload_date, processed_at, processing_status, evidence
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'completed', %s
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
        
        # Handle evidence field for database storage
        evidence_value = analysis_result.get('evidence')
        if not isinstance(evidence_value, (dict, list, type(None))):
            evidence_value = None
        # Evidence column is JSONB, so pass dict/list directly
        
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
            "s3_gpt5_import",  # edited_by - distinguish from API Gateway imports
            evidence_value  # NEW: evidence field with page citations (JSONB)
        ]
        
        # Debug parameter mapping (remove after confirming fix)
        print("🔍 Database parameters being inserted:")
        for i, v in enumerate(report_data, 1):
            print(f"  ${i}: {type(v).__name__} -> {v!r}")
        
        cursor.execute(report_insert, report_data)
        conn.commit()
        
        print(f"✅ Successfully stored financial report for company {company_id}")
        
        # Safe formatting with None checks
        cash_value = analysis_result.get('cashOnHand') or 0
        burn_value = analysis_result.get('monthlyBurnRate') or 0
        runway_value = analysis_result.get('runway') or 0
        evidence_count = len(analysis_result.get('evidence', {}))
        
        print(f"💰 Cash: ${cash_value:,.0f}" if cash_value else "💰 Cash: N/A")
        print(f"🔥 Monthly burn: ${burn_value:,.0f}" if burn_value else "🔥 Monthly burn: N/A")
        print(f"📈 Runway: {runway_value:.1f} months" if runway_value else "📈 Runway: N/A")
        print(f"📋 Evidence entries: {evidence_count}")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Database storage failed: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        raise e