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
        
        # Analyze with OpenAI (with optional company name override)
        analysis_result = analyze_with_openai(extracted_text, filename, company_name_override, user_provided_name)
        
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
        
        # Analyze with OpenAI
        analysis_result = analyze_with_openai(extracted_text, filename, company_name_override, user_provided_name)
        
        return {
            "success": True,
            "data": analysis_result
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"PDF analysis failed: {str(e)}"
        }

def analyze_with_openai(text, filename, company_name_override: str = None, user_provided_name: bool = False):
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