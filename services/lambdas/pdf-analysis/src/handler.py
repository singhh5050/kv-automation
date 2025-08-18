import json
import base64
import tempfile
import os
import sys
import traceback
import pg8000
from datetime import datetime
from typing import Dict, Any

# Add the Lambda layer path for dependencies
sys.path.insert(0, '/opt/python')

def lambda_handler(event, context):
    """
    Lambda function for PDF extraction and OpenAI analysis
    Supports both S3 events (new) and API Gateway requests (legacy)
    """
    
    # Log the incoming event for debugging
    print(f"Lambda invoked with event: {json.dumps(event)[:500]}...")
    
    # Detect event type: S3 event vs API Gateway
    if 'Records' in event and event['Records'][0].get('eventSource') == 'aws:s3':
        print("🔄 Processing S3 event (new architecture)")
        return handle_s3_event(event, context)
    else:
        print("📡 Processing API Gateway event (legacy architecture)")
        return handle_api_gateway_event(event, context)


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
            if company_id:
                try:
                    print("💾 Storing analysis results in database...")
                    store_result_in_db(analysis_result, company_id)
                    print("✅ Analysis results stored successfully")
                except Exception as db_error:
                    print(f"❌ Database storage failed: {str(db_error)}")
                    # Continue processing - don't fail the entire workflow for DB issues
            else:
                print("⚠️ Skipping database storage - no company_id available")
            
            print(f"🎉 Successfully processed {filename}")
            
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
        
        # Extract text and tables from PDF (all pages)
        texts, tables = extract_text_and_tables(pdf_bytes, filename)

        # flatten prose
        prose = "\n\n".join(p["text"] for p in texts)

        # flatten tables into a simple text block
        table_str = ""
        for t in tables:
            table_str += f"Table on page {t['page']}:\n"
            for row in t["rows"]:
                table_str += "\t".join((cell or "") for cell in row) + "\n"
            table_str += "\n"

        extracted_text = prose + "\n\n" + table_str
        
        if not extracted_text:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'Failed to extract text from PDF'})
            }
        
        print(f"Extracted text length: {len(extracted_text)} characters")
        
        # Analyze with GPT-5 Responses API (unified behavior)
        text_bytes = extracted_text.encode('utf-8')
        analysis_result = analyze_with_gpt5_responses_api(text_bytes, filename, is_text_only=True, company_name_override=company_name_override, user_provided_name=user_provided_name)
        
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


def extract_text_and_tables(pdf_bytes: bytes, filename: str):
    """Return (texts, tables) where:
       - texts: list of {'page':N, 'text':"..."} for non‑table prose
       - tables: list of {'page':N, 'rows':[[...],[...],...]} for every detected table
    """
    import pdfplumber, tempfile, os

    # write PDF to disk
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        path = tmp.name

    texts, tables = [], []
    try:
        with pdfplumber.open(path) as pdf:
            for pg_no, page in enumerate(pdf.pages, start=1):
                # 1) detect tables once
                table_settings = {
                    "vertical_strategy": "lines",
                    "horizontal_strategy": "lines",
                    "intersection_tolerance": 3
                }
                table_objs = list(page.find_tables(table_settings))
                for tbl in table_objs:
                    rows = tbl.extract()
                    tables.append({"page": pg_no, "rows": rows})

                # 2) mask out those table bboxes, then extract the rest
                bboxes = [tbl.bbox for tbl in table_objs]

                non_table_page = page.filter(
                    lambda obj: obj["object_type"] != "char" or not any(
                        x0 <= obj["x0"] <= x1 and top <= obj["top"] <= bottom
                        for (x0, top, x1, bottom) in bboxes
                    )
                )
                non_table_text = non_table_page.extract_text() or ""

                texts.append({"page": pg_no, "text": non_table_text})
    finally:
        if os.path.exists(path):
            os.unlink(path)

    return texts, tables


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
    for k in ['cashOnHand','monthlyBurnRate','runway']:
        v = d[k]
        if isinstance(v, (int, float)) or v is None:
            continue
        # Try to coerce strings like "3.1e6" or "$3.1M"
        try:
            d[k] = float(str(v).replace(',', '').replace('$','').lower().replace('m','e6').replace('k','e3'))
        except Exception:
            d[k] = None

    return d

def analyze_pdf_with_override(pdf_data: str, filename: str, company_name_override: str = None, user_provided_name: bool = False) -> Dict[str, Any]:
    """
    Analyze PDF with company name override for mass import
    """
    try:
        # Decode base64 PDF
        pdf_bytes = base64.b64decode(pdf_data)
        
        # Extract text and tables from PDF
        texts, tables = extract_text_and_tables(pdf_bytes, filename)

        # flatten prose
        prose = "\n\n".join(p["text"] for p in texts)

        # flatten tables into a simple text block
        table_str = ""
        for t in tables:
            table_str += f"Table on page {t['page']}:\n"
            for row in t["rows"]:
                table_str += "\t".join((cell or "") for cell in row) + "\n"
            table_str += "\n"

        extracted_text = prose + "\n\n" + table_str
        
        if not extracted_text:
            return {
                "success": False,
                "error": "Failed to extract text from PDF"
            }
        
        # Analyze with GPT-5 Responses API (unified behavior)
        text_bytes = extracted_text.encode('utf-8')
        analysis_result = analyze_with_gpt5_responses_api(text_bytes, filename, is_text_only=True, company_name_override=company_name_override, user_provided_name=user_provided_name)
        
        return {
            "success": True,
            "data": analysis_result
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"PDF analysis failed: {str(e)}"
        }

# DEPRECATED: Legacy function replaced with analyze_with_gpt5_responses_api
def analyze_with_openai_DEPRECATED(text, filename, company_name_override: str = None, user_provided_name: bool = False):
    """Analyze PDF text with OpenAI using o3 model - simple approach"""
    
    # Check for API key
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        print("OPENAI_API_KEY not configured")
        return create_fallback_response(filename, text, "OpenAI API key not configured")
    
    print("✅ OpenAI API key configured")
    
    try:
        # Import and initialize OpenAI client
        print("Importing OpenAI library...")
        from openai import OpenAI
        print("OpenAI library imported successfully")
        
        # Initialize client with default settings
        client = OpenAI(api_key=api_key)
        print("OpenAI client initialized")
        
        print(f"Starting analysis of {filename} with {len(text)} characters...")
        
        # Sector-specific system prompt for board deck analysis
        system_prompt = """You are an expert financial analyst specializing in parsing board deck presentations for venture capital portfolio companies. You analyze board deck PDFs and extract key information in a structured JSON format.

CRITICAL: The extracted data will be stored in a PostgreSQL database with strict numeric types. You MUST return exact numeric values for financial metrics.

## SECTOR DETECTION
First, determine the company's primary sector from these categories:
- **healthcare**: Biotech, pharma, medical devices, digital health platforms
- **consumer**: D2C, marketplaces, consumer services, insurance brokerages  
- **enterprise**: B2B SaaS, platforms, workforce management, business tools
- **manufacturing**: Hardware, industrial equipment, energy systems, robotics

## SECTOR-SPECIFIC ANALYSIS
Based on the detected sector, provide detailed analysis for these two areas:

### Healthcare
- **sectorHighlightA** ("Clinical Progress"): Trial phases, patient enrollment, safety/efficacy data, regulatory milestones, FDA interactions, enrollment rates, adverse events, primary/secondary endpoints, regulatory submissions, trial site performance
- **sectorHighlightB** ("R&D Updates"): Preclinical studies, CMC scale-up, IP filings, partnership developments, competitive landscape, manufacturing optimization, formulation improvements, patent applications, IND/NDA preparation, pipeline expansion

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
ALL text fields must use **Markdown formatting** for better readability:

### For budgetVsActual - Use a markdown table:
```
| Metric | Budget | Actual | Variance |
|--------|--------|--------|----------|
| Revenue | $X.XM | $X.XM | +X% |
| Burn Rate | $X.XM | $X.XM | +X% |
| CPA | $XXX | $XXX | -X% |
```

### For lists (nextMilestones, keyRisks, personnelUpdates) - Use markdown bullets with context:
```
- ✅ **Q3-24**: Close Keen Insurance acquisition and integrate 50-state footprint *↺ strategic expansion to capture national market*
- 🚀 **Jul 31**: Launch ML Bidder v2 and AI Sales Rep; target CPA 550 entering AEP *critical for AEP performance optimization*
- ⚠️ **Q4-24**: Deploy automated commission management system before AEP *timeline pressure due to agent scaling needs*
```

**Emoji Guide**: ✅ committed/on-track, 🚀 growth initiatives, ⚠️ at-risk, 🎯 strategic milestones

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
**IMPORTANT**: This is the primary section of the analysis. Provide exactly 7-10 bullet points that precisely summarize the entire board deck presentation in an easy-to-read format. Cover all key aspects including financial performance, operational updates, strategic initiatives, risks, and milestones. Use **bold** for key metrics and include brief context for each point. This should be a comprehensive executive summary of the entire board deck.

## WRITING STYLE
Write analysis in the style of an executive summary for board members:
- Use markdown formatting: **bold** for metrics, *italics* for emphasis
- Include specific percentages, dollar amounts, and timeline references
- Focus on narrative developments, personnel changes, strategic decisions, and risk factors
- Ask strategic questions when appropriate ("How sustainable is current pricing model?")
- Keep sentences concise but information-dense
- Note cash runway implications and funding needs
- Provide substantial detail with specific metrics, dates, and context
- Include both quantitative data and qualitative insights
- Reference specific milestones, partnerships, or competitive developments

## STORYTELLING GUIDELINES
For every section that contains numbers, weave a compelling narrative that answers **"So what?"**:

### Narrative Structure
- **Context** – Explain why this metric moved (cause / event / decision / market condition)
- **Implication** – Connect to impact on runway, strategy, or next quarter's plan
- **Forward-looking** – What does this mean for upcoming decisions or milestones?

### Storytelling Techniques
- If a figure ties back to previous board discussions, briefly reference it (e.g., "*↺ revisits the Q1 push to lower CAC*")
- Use *italics* for context and narrative elements, keep metrics **bold**
- Connect dots between different metrics to tell a cohesive story
- Explain the "why" behind the "what" - don't just report numbers

### Example Narrative Flow
- **Q2 burn $3.6M (+50% vs plan)** – *Spike driven by ACA launch media blitz and expanded agent onboarding costs. This puts cash runway at two months, accelerating Series B timeline and requiring immediate burn reduction or bridge financing.*

## NUMERIC FIELDS (Return exact numbers only - NO currency symbols, NO units, NO text):
1. cashOnHand: Return raw number in USD (e.g., 3100000 for $3.1M)
2. monthlyBurnRate: Return raw number in USD per month (e.g., 1200000 for $1.2M/month)  
3. runway: Return integer months only (e.g., 18 for 18 months)

## REQUIRED JSON OUTPUT:
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
  "financialSummary": "PRIMARY FOCUS: Exactly 7-10 bullet points precisely summarizing the entire board deck (financial performance, operations, strategy, risks, milestones) with **bold metrics** and brief context",
  "sectorHighlightA": "Structured markdown with **Overview** narrative + **Key Metrics** with context + **Strategic Implications**",
  "sectorHighlightB": "Structured markdown with **Overview** narrative + **Key Metrics** with context + **Strategic Implications**", 
  "keyRisks": "Markdown bullet list with emoji status (⚠️) and strategic risk context",
  "personnelUpdates": "Markdown bullet list with team changes and strategic impact",
  "nextMilestones": "Markdown bullet list with emoji status (✅🚀⚠️) and milestone context"
}

EXAMPLES:
- If document shows "$3.1M cash" → cashOnHand: 3100000
- If document shows "$1.2M monthly burn" → monthlyBurnRate: 1200000  
- If document shows "18 month runway" → runway: 18

CRITICAL: Use null (no quotes) for missing numeric values, and "N/A" for missing text fields. NEVER include code blocks (```) in the JSON strings - just the raw markdown."""

        # User prompt with the full document  
        user_prompt = f"""Analyze this financial document and return valid JSON WITH STORY CONTEXT:

Filename: {filename}

IMPORTANT: Follow STORYTELLING GUIDELINES and FORMATTING REQUIREMENTS exactly—weave compelling narratives around metrics, use emojis for milestone status, and connect dots between different data points. No code blocks, only raw markdown.

Content:
{text}"""
        
        response = client.chat.completions.create(
            model="o3",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        )
        
        print("OpenAI analysis completed successfully")
        content = response.choices[0].message.content
        print(f"Received response from OpenAI: {len(content) if content else 0} characters")
        
        if not content:
            raise ValueError('No response from OpenAI')
        
        # Try to parse JSON response
        try:
            # Clean the response (remove code blocks if present)
            clean_content = content.strip()
            if clean_content.startswith('```'):
                # Extract JSON from code block
                lines = clean_content.split('\n')
                json_lines = []
                in_json = False
                for line in lines:
                    if line.strip().startswith('```'):
                        if in_json:
                            break
                        else:
                            in_json = True
                            continue
                    if in_json:
                        json_lines.append(line)
                clean_content = '\n'.join(json_lines)
            
            # Parse JSON
            analysis_result = json.loads(clean_content)
            
            # Add filename and override company name if provided
            analysis_result['filename'] = filename
            if company_name_override:
                analysis_result['companyName'] = company_name_override
                analysis_result['user_provided_name'] = user_provided_name
                print(f"{'User-provided' if user_provided_name else 'Overrode'} company name to: {company_name_override}")
            elif user_provided_name:
                # If user_provided_name flag is set but no override, preserve whatever was extracted
                analysis_result['user_provided_name'] = True

            # Normalize for database compatibility
            analysis_result = normalize_analysis_for_db(analysis_result)
            
            print(f"Successfully parsed JSON response for {analysis_result.get('companyName', filename)}")
            return analysis_result
            
        except json.JSONDecodeError as e:
            print(f"JSON parsing failed: {str(e)}")
            print(f"Raw response: {content[:500]}...")
            
            # Return fallback response with the raw content
            fallback_company_name = company_name_override if company_name_override else filename.replace('.pdf', '')
            fallback_result = {
                'companyName': fallback_company_name,
                'user_provided_name': user_provided_name,
                'reportDate': datetime.now().strftime('%Y-%m-%d'),
                'reportPeriod': 'Analysis Period',
                'filename': filename,
                'sector': 'healthcare',  # Default fallback sector
                'cashOnHand': None,
                'monthlyBurnRate': None,
                'cashOutDate': 'N/A',
                'runway': None,
                'budgetVsActual': 'N/A',
                'financialSummary': f'JSON parsing failed. Raw response: {content[:1000]}',
                'sectorHighlightA': 'Analysis not available',
                'sectorHighlightB': 'Analysis not available',
                'keyRisks': 'N/A',
                'personnelUpdates': 'N/A',
                'nextMilestones': 'N/A'
            }
            return normalize_analysis_for_db(fallback_result)
        
    except Exception as e:
        error_msg = f"OpenAI analysis failed: {str(e)}"
        print(error_msg)
        return create_fallback_response(filename, text, error_msg)


def create_fallback_response(filename, text, error_msg):
    """Create a fallback response when OpenAI analysis fails"""
    
    # Try to extract company name from filename or text
    company_name = filename.replace('.pdf', '').replace('_', ' ').replace('-', ' ')
    
    # Basic text analysis for company name
    if text:
        text_lower = text.lower()
        # Look for common patterns
        lines = text.split('\n')[:10]  # Check first 10 lines
        for line in lines:
            if any(word in line.lower() for word in ['inc.', 'corp.', 'company', 'ltd.', 'llc']):
                company_name = line.strip()
                break
    
    fallback_result = {
        'companyName': company_name,
        'reportDate': datetime.now().strftime('%Y-%m-%d'),
        'reportPeriod': 'Analysis Period',
        'filename': filename,
        'sector': 'healthcare',  # Default fallback sector
        'cashOnHand': None,
        'monthlyBurnRate': None,
        'cashOutDate': 'N/A',
        'runway': None,
        'budgetVsActual': 'N/A',
        'financialSummary': f'Text extraction successful ({len(text)} characters), but AI analysis failed: {error_msg}',
        'sectorHighlightA': 'Analysis not available due to API issues',
        'sectorHighlightB': 'Analysis not available due to API issues',
        'keyRisks': 'N/A',
        'personnelUpdates': 'N/A',
        'nextMilestones': 'N/A'
    } 
    return normalize_analysis_for_db(fallback_result)


def analyze_with_gpt5_responses_api(pdf_bytes: bytes, filename: str, is_text_only: bool = False, company_name_override: str = None, user_provided_name: bool = False):
    """
    New GPT-5 + Responses API + Files API with evidence tracking
    Based on our successful test implementation
    """
    import os  # Explicit import to avoid scoping issues
    
    # Check for API key
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        print("OPENAI_API_KEY not configured")
        return create_fallback_response(filename, "PDF content", "OpenAI API key not configured")
    
    # Initialize variables for cleanup
    file_response = None
    tmp_path = None
    client = None
    
    try:
        # Import and initialize OpenAI client
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        
        print(f"🤖 Starting GPT-5 analysis of {filename} ({len(pdf_bytes)} bytes)")
        
        # Handle text-only vs PDF input
        if is_text_only:
            print("📝 Processing text-only input (legacy API Gateway path)")
            # For text-only, we'll send the text directly without file upload
            text_content = pdf_bytes.decode('utf-8')
        else:
            print("📤 Uploading PDF to OpenAI Files API...")
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(pdf_bytes)
                tmp_path = tmp.name
            
            with open(tmp_path, 'rb') as f:
                file_response = client.files.create(
                    file=f,
                    purpose="user_data"
                )
            
            print(f"✅ File uploaded successfully! File ID: {file_response.id}")
            text_content = None
        
        # Updated system prompt with strict JSON requirements
        system_prompt = """Return ONLY one JSON object that validates the provided JSON Schema.
Do NOT include code fences or any text outside the JSON.
All string values must escape quotes correctly.

You are an expert financial analyst specializing in parsing board deck presentations for venture capital portfolio companies. You analyze board deck PDFs and extract key information in a structured JSON format.

CRITICAL: The extracted data will be stored in a PostgreSQL database with strict numeric types. You MUST return exact numeric values for financial metrics.

## SECTOR DETECTION
First, determine the company's primary sector from these categories:
- **healthcare**: Biotech, pharma, medical devices, digital health platforms
- **consumer**: D2C, marketplaces, consumer services, insurance brokerages  
- **enterprise**: B2B SaaS, platforms, workforce management, business tools
- **manufacturing**: Hardware, industrial equipment, energy systems, robotics

## SECTOR-SPECIFIC ANALYSIS
Based on the detected sector, provide detailed analysis for these two areas:

### Healthcare
- **sectorHighlightA** ("Clinical Progress"): Trial phases, patient enrollment, safety/efficacy data, regulatory milestones, FDA interactions, enrollment rates, adverse events, primary/secondary endpoints, regulatory submissions, trial site performance
- **sectorHighlightB** ("R&D Updates"): Preclinical studies, CMC scale-up, IP filings, partnership developments, competitive landscape, manufacturing optimization, formulation improvements, patent applications, IND/NDA preparation, pipeline expansion

### Consumer  
- **sectorHighlightA** ("Customer & Unit Economics"): User acquisition metrics, CAC/LTV trends, retention rates, policies-in-force, conversion rates, churn analysis, customer lifetime value, acquisition channels, pricing optimization, cohort analysis
- **sectorHighlightB** ("Growth Efficiency Initiatives"): Market expansion, AI-driven productivity, channel optimization, operational improvements, automation initiatives, cost reduction programs, geographic expansion, product development velocity, team scaling

### Enterprise
- **sectorHighlightA** ("Product Roadmap & Adoption"): Feature launches, usage metrics, customer engagement, platform development, product velocity, feature adoption rates, customer feedback integration, technical debt management, scalability improvements
- **sectorHighlightB** ("Go-to-Market Performance"): Sales pipeline, bookings by region, partnership channels, customer success metrics, sales efficiency, market penetration, competitive wins/losses, channel performance, customer expansion rates

### Manufacturing
- **sectorHighlightA** ("Operational Performance"): Units produced/shipped, manufacturing efficiency, quality metrics, capacity utilization, yield improvements, cost per unit, production bottlenecks, quality control results, equipment performance
- **sectorHighlightB** ("Supply Chain & Commercial Pipeline"): Supplier relationships, inventory management, customer contracts, regulatory approvals, supply chain optimization, vendor performance, logistics improvements, customer delivery metrics, regulatory compliance

EXTRACT ONLY these fields with evidence citations: companyName, reportDate, reportPeriod, sector, cashOnHand, monthlyBurnRate, cashOutDate, runway, budgetVsActual, financialSummary, sectorHighlightA, sectorHighlightB, keyRisks, personnelUpdates, nextMilestones.

For each field, provide evidence with compact structured format: {"page": integer, "quote": "short quote with escaped quotes"}. If not explicitly present, return null.
"""
        
        # Fixed JSON schema with length limits and proper evidence structure
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "companyName": {"type": ["string", "null"], "maxLength": 200},
                "reportDate": {"type": ["string", "null"], "format": "date"},
                "reportPeriod": {"type": ["string", "null"], "maxLength": 50},
                "sector": {"type": ["string", "null"], "enum": ["healthcare", "consumer", "enterprise", "manufacturing"]},
                "cashOnHand": {"type": ["number", "null"]},
                "monthlyBurnRate": {"type": ["number", "null"]},
                "cashOutDate": {"type": ["string", "null"], "maxLength": 40},
                "runway": {"type": ["number", "null"]},
                "budgetVsActual": {"type": ["string", "null"], "maxLength": 2000},
                "financialSummary": {"type": ["string", "null"], "maxLength": 2000},
                "sectorHighlightA": {"type": ["string", "null"], "maxLength": 1500},
                "sectorHighlightB": {"type": ["string", "null"], "maxLength": 1500},
                "keyRisks": {"type": ["string", "null"], "maxLength": 800},
                "personnelUpdates": {"type": ["string", "null"], "maxLength": 800},
                "nextMilestones": {"type": ["string", "null"], "maxLength": 800},
                "evidence": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "companyName": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 200}}, "required": ["page", "quote"]},
                        "reportDate": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 120}}, "required": ["page", "quote"]},
                        "reportPeriod": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 120}}, "required": ["page", "quote"]},
                        "sector": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 120}}, "required": ["page", "quote"]},
                        "cashOnHand": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 120}}, "required": ["page", "quote"]},
                        "monthlyBurnRate": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 120}}, "required": ["page", "quote"]},
                        "cashOutDate": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 120}}, "required": ["page", "quote"]},
                        "runway": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 120}}, "required": ["page", "quote"]},
                        "budgetVsActual": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 200}}, "required": ["page", "quote"]},
                        "financialSummary": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 200}}, "required": ["page", "quote"]},
                        "sectorHighlightA": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 200}}, "required": ["page", "quote"]},
                        "sectorHighlightB": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 200}}, "required": ["page", "quote"]},
                        "keyRisks": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 200}}, "required": ["page", "quote"]},
                        "personnelUpdates": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 200}}, "required": ["page", "quote"]},
                        "nextMilestones": {"type": ["object", "null"], "properties": {"page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"], "maxLength": 200}}, "required": ["page", "quote"]}
                    },
                    "required": ["companyName", "reportDate", "reportPeriod", "sector", "cashOnHand", "monthlyBurnRate", "cashOutDate", "runway", "budgetVsActual", "financialSummary", "sectorHighlightA", "sectorHighlightB", "keyRisks", "personnelUpdates", "nextMilestones"]
                }
            },
            "required": ["companyName", "reportDate", "reportPeriod", "sector", "cashOnHand", "monthlyBurnRate", "cashOutDate", "runway", "budgetVsActual", "financialSummary", "sectorHighlightA", "sectorHighlightB", "keyRisks", "personnelUpdates", "nextMilestones", "evidence"]
        }
        
        # Use GPT-5 Responses API with structured output (proven working!)
        print("🚀 Processing with GPT-5 Responses API...")
        
        # Build content based on input type
        if is_text_only:
            # Text-only input (legacy API Gateway path)
            content = [
                {
                    "type": "input_text",
                    "text": f"{system_prompt}\n\nCOMPANY DATA TO ANALYZE:\n{text_content}"
                }
            ]
        else:
            # PDF file input (new S3 path)
            content = [
                {
                    "type": "input_text",
                    "text": system_prompt
                },
                {
                    "type": "input_file", 
                    "file_id": file_response.id
                }
            ]
        
        response = client.responses.create(
            model="gpt-5",
            input=[{
                "role": "user",
                "content": content
            }],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "financial_kpis_with_evidence",
                    "schema": schema,
                    "strict": True
                }
            },
            temperature=0,
            max_output_tokens=12000
        )
        
        raw_response = response.output_text
        
        # Defensive JSON parsing with fallback extraction
        def extract_json(s: str) -> dict:
            """Extract JSON from potentially malformed response"""
            s = s.strip().replace('\ufeff', '')
            if s.startswith('```'):
                # strip leading/trailing fences only
                s = s.split('```', 1)[-1]
                if '```' in s:
                    s = s.rsplit('```', 1)[0]
            # normalize curly quotes/apostrophes to standard ASCII
            s = s.replace('\u201c', '"').replace('\u201d', '"')  # left/right double quotes
            s = s.replace('\u2018', "'").replace('\u2019', "'")  # left/right single quotes  
            s = s.replace('`', "'")
            start, end = s.find('{'), s.rfind('}')
            if start == -1 or end == -1 or end <= start:
                raise ValueError("No JSON object found")
            return json.loads(s[start:end+1])
        
        # Parse and validate the JSON with fallback
        import json
        try:
            data = json.loads(raw_response)  # should already be strict JSON
            print("✅ Valid JSON received from GPT-5")
            print(f"📊 Company: {data.get('companyName', 'Unknown')}")
            print(f"💰 Cash: ${data.get('cashOnHand', 0)/1000000:.1f}M" if data.get('cashOnHand') else "💰 Cash: Not specified")
        except json.JSONDecodeError as e:
            print(f"❌ Primary JSON parsing failed: {e}")
            print(f"🔄 Attempting fallback extraction...")
            try:
                data = extract_json(raw_response)
                print("✅ Fallback extraction successful")
                print(f"📊 Company: {data.get('companyName', 'Unknown')}")
            except Exception as fallback_error:
                print(f"❌ Fallback extraction also failed: {fallback_error}")
                print(f"📄 Raw response preview: {raw_response[:500]}...")
                # Save debug info for postmortem
                print(f"🐛 Full response length: {len(raw_response)} characters")
                
                # Save raw response to S3 for debugging
                try:
                    import boto3, time
                    dbg_bucket = os.environ.get('S3_DEBUG_BUCKET')
                    if dbg_bucket:
                        key = f"debug/gpt5_raw/{int(time.time())}-{filename}.txt"
                        boto3.client('s3').put_object(Bucket=dbg_bucket, Key=key, Body=raw_response.encode('utf-8'))
                        print(f"🪵 Saved raw response to s3://{dbg_bucket}/{key}")
                except Exception as _:
                    pass
                    
                raise e
        
        # This block is now in finally clause below
        
        # Add filename for database storage
        data['filename'] = filename
        
        # Handle company name override (legacy API Gateway behavior)
        if company_name_override and user_provided_name:
            print(f"🏢 Using provided company name: {company_name_override}")
            data['companyName'] = company_name_override
        
        # Normalize for database compatibility
        normalized_data = normalize_analysis_for_db(data)
        
        print(f"🎉 GPT-5 analysis completed successfully for {filename}")
        return normalized_data
        
    except Exception as e:
        error_msg = f"GPT-5 analysis failed: {str(e)}"
        print(error_msg)
        print(f"Full traceback: {traceback.format_exc()}")
        # No fallback - raise the error to get clear feedback
        raise Exception(f"GPT-5 analysis failed: {str(e)}")
    
    finally:
        # Clean up - delete the file from OpenAI (only if we uploaded one)
        try:
            if file_response and getattr(file_response, "id", None) and client:
                print("🗑️ Cleaning up uploaded file...")
                client.files.delete(file_response.id)
                print("✅ File deleted successfully!")
        except Exception as cleanup_error:
            print(f"⚠️ File cleanup failed: {cleanup_error}")
        
        # Clean up local temp file (only if we created one)
        try:
            if tmp_path:
                import os
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                    print("🗑️ Local temp file cleaned up")
        except Exception as cleanup_error:
            print(f"⚠️ Local file cleanup failed: {cleanup_error}")


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
                return float(value)
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