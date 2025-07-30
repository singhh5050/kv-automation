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

def download_from_s3(s3_key: str) -> bytes:
    """Download PDF file from S3 bucket"""
    import boto3
    
    try:
        s3_client = boto3.client('s3')
        bucket_name = 'kv-board-decks-prod'
        
        print(f"Downloading {s3_key} from bucket {bucket_name}")
        response = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
        pdf_bytes = response['Body'].read()
        
        print(f"Successfully downloaded {len(pdf_bytes)} bytes from S3")
        return pdf_bytes
        
    except Exception as e:
        print(f"Error downloading from S3: {str(e)}")
        raise Exception(f"Failed to download PDF from S3: {str(e)}")

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
        if not body and ('pdf_b64' in event or 's3_key' in event):
            body = event
            
    except json.JSONDecodeError:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': 'Invalid JSON in request body'})
        }
    
    # Get PDF data - support both S3 and base64 methods
    s3_key = body.get('s3_key')
    pdf_base64 = body.get('pdf_data') or body.get('pdf_b64')
    filename = body.get('filename', 'document.pdf')
    company_name_override = body.get('company_name_override')
    compressed = body.get('compressed', False)
    
    if not s3_key and not pdf_base64:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': 'No PDF data provided (neither s3_key nor pdf_data)'})
        }
    
    try:
        print(f"Starting PDF processing for: {filename}")
        
        if s3_key:
            # Download from S3
            print(f"Downloading PDF from S3 key: {s3_key}")
            pdf_bytes = download_from_s3(s3_key)
            print(f"Downloaded PDF from S3, size: {len(pdf_bytes)} bytes")
        else:
            # Decode base64 PDF with optional gzip decompression (legacy method)
            print("Using legacy base64 PDF data")
            if compressed:
                import gzip
                pdf_bytes = gzip.decompress(base64.b64decode(pdf_base64))
                print(f"Decompressed PDF, size: {len(pdf_bytes)} bytes")
            else:
                pdf_bytes = base64.b64decode(pdf_base64)
                print(f"Decoded PDF, size: {len(pdf_bytes)} bytes")
        
        # Analyze with OpenAI (with optional company name override)
        analysis_result = analyze_with_openai(pdf_bytes, filename, company_name_override)
        
        # Add S3 key to result if we downloaded from S3
        if s3_key:
            analysis_result['s3_key'] = s3_key
            print(f"Added S3 key to analysis result: {s3_key}")
        
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
       
    NOTE: This function is now LEGACY as we've moved to OpenAI's vision-based PDF processing.
    It's kept for potential fallback scenarios but is no longer used in the main flow.
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
    Analyze PDF with company name override for mass import using vision capabilities
    """
    try:
        # Decode base64 PDF
        pdf_bytes = base64.b64decode(pdf_data)
        
        # Use vision-based analysis directly
        analysis_result = analyze_with_openai(pdf_bytes, filename, company_name_override)
        
        return {
            "success": True,
            "data": analysis_result
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"PDF analysis failed: {str(e)}"
        }

def analyze_with_openai(pdf_bytes, filename, company_name_override: str = None):
    """Analyze PDF using OpenAI's vision capabilities with direct file upload"""
    
    # Check for API key
    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        print("OPENAI_API_KEY not configured")
        return create_fallback_response(filename, "", "OpenAI API key not configured")
    
    print(f"OpenAI API key found: {api_key[:10]}...{api_key[-4:] if len(api_key) > 14 else 'short'}")
    
    try:
        # Import and initialize OpenAI client
        print("Importing OpenAI library...")
        from openai import OpenAI
        import io
        print("OpenAI library imported successfully")
        
        # Initialize client
        client = OpenAI(api_key=api_key)
        print("OpenAI client initialized")
        
        print(f"Starting PDF analysis with vision for {filename} ({len(pdf_bytes)} bytes)")
        
        # Upload PDF file to OpenAI Files API for vision processing
        print("Uploading PDF to OpenAI Files API...")
        file_obj = client.files.create(
            file=("board_deck.pdf", io.BytesIO(pdf_bytes), "application/pdf"),
            purpose="user_data"  # Use user_data for PDFs, not vision
        )
        file_id = file_obj.id
        print(f"PDF uploaded successfully with file_id: {file_id}")
        
        # Enhanced system prompt for vision-based PDF analysis
        system_prompt = """You are an expert financial analyst specializing in parsing board deck presentations for venture capital portfolio companies. You will analyze the attached PDF board deck using your vision capabilities to extract key information in a structured JSON format.

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

### For financialSummary - Narrative-driven summary:
Begin with a 2-3 sentence "Executive Narrative" that tells the quarter's story (context → implications → forward-looking). Follow with **bold metrics** embedded inline throughout the narrative. Connect the dots between different metrics to create a cohesive board-ready story.

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
  "financialSummary": "Narrative-driven executive summary with **bold metrics** and strategic implications",
  "sectorHighlightA": "Structured markdown with **Overview** narrative + **Key Metrics** with context + **Strategic Implications**",
  "sectorHighlightB": "Structured markdown with **Overview** narrative + **Key Metrics** with context + **Strategic Implications**", 
  "keyRisks": "Markdown bullet list with emoji status (⚠️) and strategic risk context",
  "personnelUpdates": "Markdown bullet list with team changes and strategic impact",
  "nextMilestones": "Markdown bullet list with emoji status (✅🚀⚠️) and milestone context"
}

CRITICAL: Use null (no quotes) for missing numeric values, and "N/A" for missing text fields. NEVER include code blocks (```) in the JSON strings - just the raw markdown."""

        # User prompt requesting analysis of the uploaded PDF
        user_prompt = f"""Analyze the attached board deck PDF and extract financial data in the specified JSON format.

Filename: {filename}

IMPORTANT: Use your vision capabilities to read all text, tables, charts, and graphs in the PDF. Look for:
- Financial metrics and KPIs
- Budget vs actual performance data  
- Cash position and burn rate information
- Sector-specific metrics and milestones
- Risk factors and team updates
- Timeline information and next steps

Follow the STORYTELLING GUIDELINES and FORMATTING REQUIREMENTS exactly—weave compelling narratives around metrics, use emojis for milestone status, and connect dots between different data points.

Return valid JSON with the structured analysis."""
        
        # Create message with correct PDF file input format
        response = client.chat.completions.create(
            model="o3",  # Use o3 model as requested
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": user_prompt},
                        {"type": "input_file", "file_id": file_id}
                    ]
                }
            ]
        )
        
        print("OpenAI vision analysis completed successfully")
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
                'financialSummary': f'Vision analysis completed but JSON parsing failed. Raw response: {content[:1000]}',
                'sectorHighlightA': 'Analysis not available',
                'sectorHighlightB': 'Analysis not available',
                'keyRisks': 'N/A',
                'personnelUpdates': 'N/A',
                'nextMilestones': 'N/A'
            }
            return normalize_analysis_for_db(fallback_result)
        
    except Exception as e:
        error_msg = f"OpenAI vision analysis failed: {str(e)}"
        print(error_msg)
        return create_fallback_response(filename, "", error_msg)


def create_fallback_response(filename, text, error_msg):
    """Create a fallback response when OpenAI analysis fails"""
    
    # Try to extract company name from filename or text
    company_name = filename.replace('.pdf', '').replace('_', ' ').replace('-', ' ')
    
    # Basic text analysis for company name (if text is available)
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
        'financialSummary': f'Vision-based PDF processing available but analysis failed: {error_msg}' + (f' ({len(text)} characters extracted)' if text else ''),
        'sectorHighlightA': 'Analysis not available due to API issues',
        'sectorHighlightB': 'Analysis not available due to API issues',
        'keyRisks': 'N/A',
        'personnelUpdates': 'N/A',
        'nextMilestones': 'N/A'
    } 
    return normalize_analysis_for_db(fallback_result) 