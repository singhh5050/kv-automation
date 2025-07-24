import json
import base64
import tempfile
import os
import sys
import traceback
from datetime import datetime
from typing import Dict, Any

# Add the Lambda layer path for dependencies
sys.path.insert(0, '/opt/python')

def lambda_handler(event, context):
    """
    Lambda function for PDF extraction and OpenAI analysis
    Expects: POST request with base64 encoded PDF file
    Returns: Extracted and analyzed financial data
    """
    
    # Log the incoming event for debugging
    print(f"Lambda invoked with event: {json.dumps(event)[:500]}...")
    
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
        
        # Analyze with OpenAI (with optional company name override)
        analysis_result = analyze_with_openai(extracted_text, filename, company_name_override)
        
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

def analyze_pdf_with_override(pdf_data: str, filename: str, company_name_override: str = None) -> Dict[str, Any]:
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
        
        # Analyze with OpenAI
        analysis_result = analyze_with_openai(extracted_text, filename, company_name_override)
        
        return {
            "success": True,
            "data": analysis_result
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"PDF analysis failed: {str(e)}"
        }

def analyze_with_openai(text, filename, company_name_override: str = None):
    """Analyze PDF text with OpenAI using o3 model - simple approach"""
    
    # Check for API key
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        print("OPENAI_API_KEY not configured")
        return create_fallback_response(filename, text, "OpenAI API key not configured")
    
    print(f"OpenAI API key found: {api_key[:10]}...{api_key[-4:] if len(api_key) > 14 else 'short'}")
    
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
- **sectorHighlightA** ("Clinical Progress"): Trial phases, patient enrollment, safety/efficacy data, regulatory milestones, FDA interactions
- **sectorHighlightB** ("R&D Updates"): Preclinical studies, CMC scale-up, IP filings, partnership developments, competitive landscape

### Consumer  
- **sectorHighlightA** ("Customer & Unit Economics"): User acquisition metrics, CAC/LTV trends, retention rates, policies-in-force, conversion rates
- **sectorHighlightB** ("Growth Efficiency Initiatives"): Market expansion, AI-driven productivity, channel optimization, operational improvements

### Enterprise
- **sectorHighlightA** ("Product Roadmap & Adoption"): Feature launches, usage metrics, customer engagement, platform development
- **sectorHighlightB** ("Go-to-Market Performance"): Sales pipeline, bookings by region, partnership channels, customer success metrics

### Manufacturing
- **sectorHighlightA** ("Operational Performance"): Units produced/shipped, manufacturing efficiency, quality metrics, capacity utilization
- **sectorHighlightB** ("Supply Chain & Commercial Pipeline"): Supplier relationships, inventory management, customer contracts, regulatory approvals

## WRITING STYLE
Write analysis in the style of an executive summary for board members:
- Use bullet-point structure with embedded metrics (e.g., "Q4 revenue $1.7M [$6.9M annualized, 4.7x YoY]")
- Include specific percentages, dollar amounts, and timeline references
- Focus on narrative developments, personnel changes, strategic decisions, and risk factors
- Ask strategic questions when appropriate ("How sustainable is current pricing model?")
- Keep sentences concise but information-dense
- Note cash runway implications and funding needs

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
  "budgetVsActual": "Key variance metrics summary",
  "financialSummary": "Detailed 5-6 sentence executive summary with metrics",
  "sectorHighlightA": "Detailed sector-specific analysis with metrics and narrative",
  "sectorHighlightB": "Detailed sector-specific analysis with metrics and narrative",
  "keyRisks": "Strategic risks and dependencies",
  "personnelUpdates": "Team changes and hiring updates",
  "nextMilestones": "Upcoming targets and goals"
}

EXAMPLES:
- If document shows "$3.1M cash" → cashOnHand: 3100000
- If document shows "$1.2M monthly burn" → monthlyBurnRate: 1200000  
- If document shows "18 month runway" → runway: 18

CRITICAL: Use null (no quotes) for missing numeric values, and "N/A" for missing text fields."""

        # User prompt with the full document
        user_prompt = f"Analyze this financial document:\n\nFilename: {filename}\n\nContent:\n{text}"
        
        # Make the API call using gpt-4o-mini for better speed
        response = client.chat.completions.create(
            model="gpt-4o-mini",
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
                print(f"Overrode company name to: {company_name_override}")

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