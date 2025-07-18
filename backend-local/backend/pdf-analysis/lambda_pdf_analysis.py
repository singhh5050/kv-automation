import json
import base64
import tempfile
import os
import sys
import traceback
from datetime import datetime

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
    except json.JSONDecodeError:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': 'Invalid JSON in request body'})
        }
    
    # Get PDF data
    pdf_base64 = body.get('pdf_data')
    filename = body.get('filename', 'document.pdf')
    
    if not pdf_base64:
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({'error': 'No PDF data provided'})
        }
    
    try:
        print(f"Starting PDF processing for: {filename}")
        
        # Decode base64 PDF
        pdf_bytes = base64.b64decode(pdf_base64)
        print(f"Decoded PDF, size: {len(pdf_bytes)} bytes")
        
        # Extract text from PDF (optimized for speed)
        extracted_text = extract_pdf_text_optimized(pdf_bytes, filename)
        
        if not extracted_text:
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'Failed to extract text from PDF'})
            }
        
        print(f"Extracted text length: {len(extracted_text)} characters")
        
        # Analyze with OpenAI
        analysis_result = analyze_with_openai(extracted_text, filename)
        
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


def extract_pdf_text_optimized(pdf_bytes, filename):
    """Extract text from PDF with smart filtering for financial content - OPTIMIZED FOR SPEED"""
    
    try:
        import pdfplumber
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_file:
            temp_file.write(pdf_bytes)
            temp_path = temp_file.name
        
        try:
            extracted_text = ""
            financial_keywords = [
                'cash', 'burn', 'runway', 'revenue', 'expenses', 'budget', 
                'million', 'funding', 'financial', 'quarter', 'q1', 'q2', 'q3', 'q4',
                'balance', 'sheet', 'statement', 'income', 'expenditure', 'cost',
                'investment', 'financing', 'capital', 'valuation', 'ebitda'
            ]
            
            with pdfplumber.open(temp_path) as pdf:
                total_pages = len(pdf.pages)
                print(f"PDF opened with pdfplumber. Pages: {total_pages}")
                
                # Process first 20 pages max for speed (most financial info is early in decks)
                max_pages = min(20, total_pages)
                pages_processed = 0
                
                for i in range(max_pages):
                    try:
                        page = pdf.pages[i]
                        page_text = page.extract_text()
                        
                        if page_text:
                            # Check if page contains financial keywords
                            page_text_lower = page_text.lower()
                            has_financial_content = any(keyword in page_text_lower for keyword in financial_keywords)
                            
                            if has_financial_content or i < 5:  # Always include first 5 pages
                                extracted_text += page_text + "\n"
                                print(f"Page {i+1}: Extracted {len(page_text)} characters (financial content)")
                                pages_processed += 1
                            else:
                                print(f"Page {i+1}: Skipped (no financial keywords)")
                        
                        # Limit total text size to 12,000 characters for speed
                        if len(extracted_text) > 12000:
                            print(f"Text limit reached at {len(extracted_text)} characters, stopping extraction")
                            break
                            
                    except Exception as e:
                        print(f"Error extracting text from page {i+1}: {str(e)}")
                
                print(f"Processed {pages_processed} of {max_pages} pages")
            
            return extracted_text.strip()
            
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except Exception as e:
        print(f"Optimized extraction failed: {str(e)}, falling back to full extraction")
        return extract_pdf_text(pdf_bytes, filename)

def extract_pdf_text(pdf_bytes, filename):
    """Extract text from PDF using available libraries"""
    
    # Try pdfplumber first (most reliable)
    try:
        import pdfplumber
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_file:
            temp_file.write(pdf_bytes)
            temp_path = temp_file.name
        
        try:
            extracted_text = ""
            
            with pdfplumber.open(temp_path) as pdf:
                print(f"PDF opened with pdfplumber. Pages: {len(pdf.pages)}")
                
                for i, page in enumerate(pdf.pages):
                    try:
                        page_text = page.extract_text()
                        if page_text:
                            extracted_text += page_text + "\n"
                            print(f"Page {i+1}: Extracted {len(page_text)} characters")
                    except Exception as e:
                        print(f"Error extracting text from page {i+1}: {str(e)}")
            
            return extracted_text.strip()
            
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except ImportError:
        print("pdfplumber not available, trying PyPDF2...")
    except Exception as e:
        print(f"pdfplumber extraction failed: {str(e)}")
    
    # Fallback to PyPDF2
    try:
        import PyPDF2
        
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_file:
            temp_file.write(pdf_bytes)
            temp_path = temp_file.name
        
        try:
            extracted_text = ""
            
            with open(temp_path, 'rb') as pdf_file:
                pdf_reader = PyPDF2.PdfReader(pdf_file)
                print(f"PDF opened with PyPDF2. Pages: {len(pdf_reader.pages)}")
                
                for i, page in enumerate(pdf_reader.pages):
                    try:
                        page_text = page.extract_text()
                        if page_text:
                            extracted_text += page_text + "\n"
                            print(f"Page {i+1}: Extracted {len(page_text)} characters")
                    except Exception as e:
                        print(f"PyPDF2 error on page {i+1}: {str(e)}")
            
            return extracted_text.strip()
            
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except ImportError:
        print("PyPDF2 not available")
    except Exception as e:
        print(f"PyPDF2 extraction failed: {str(e)}")
    
    # If both libraries fail, return an error
    print("All PDF extraction methods failed")
    return None


def analyze_with_openai(text, filename):
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
        
        # Enhanced system prompt for better financial analysis accuracy
        system_prompt = """You are an expert financial analyst specializing in biotech, healthcare, and technology companies. You have extensive experience analyzing financial statements, board presentations, and investor materials.

Your task is to analyze the provided PDF document and extract information in two distinct styles:

METRICS (Be extremely concise - output numbers only, no explanations):
1. Cash Position: Current cash, cash equivalents, short-term investments
2. Burn Rate: Monthly cash consumption
3. Runway: Simple duration or end date
4. Basic Performance: Revenue, margins, key ratios

DETAILED ANALYSIS (Provide comprehensive 5-6 sentence analysis with specific details):
1. Financial Summary: Analyze trends in revenue, profitability, operational efficiency, and capital allocation. Include quarter-over-quarter or year-over-year comparisons. Highlight significant changes in business metrics, cost structure, or financial strategy. Reference specific numbers and percentages.

2. Clinical Progress: Detail ongoing trials with phase numbers, patient counts, and timelines. Describe recent clinical results including efficacy rates and p-values. Include regulatory interactions, upcoming milestones, and changes to trial protocols. Mention specific drug candidates and indications.

3. Research & Development: Elaborate on active research programs, providing specific molecule names or therapeutic targets. Detail collaboration agreements with specific terms and partner names. Describe IP portfolio including patent counts and expiration timelines. Include technology platform developments and pipeline expansion plans.

Return your response as a JSON object with exactly these fields:
{
  "companyName": "Company name only",
  "reportDate": "YYYY-MM-DD format only",
  "reportPeriod": "Q1 2025 or 2024 Annual Report format only",
  "cashOnHand": "Amount with currency only (e.g., '$3.1M')",
  "monthlyBurnRate": "Amount per month only (e.g., '$1.2M')",
  "cashOutDate": "Date only (e.g., 'April 2025')",
  "runway": "Duration or date only (e.g., '18 months')",
  "budgetVsActual": "Key variance metrics only",
  "financialSummary": "Detailed 5-6 sentence analysis",
  "clinicalProgress": "Detailed 5-6 sentence analysis",
  "researchDevelopment": "Detailed 5-6 sentence analysis"
}

Do your analysis and reasoning internally, but in the output:
- For metric fields: Return ONLY the values, no explanations
- For detailed fields: Provide comprehensive multi-sentence analysis with specific details
- Use 'N/A' for unavailable information"""

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
            
            # Ensure all required fields exist
            required_fields = [
                'companyName', 'reportDate', 'reportPeriod', 'filename',
                'cashOnHand', 'monthlyBurnRate', 'cashOutDate', 'runway', 
                'budgetVsActual', 'financialSummary', 'clinicalProgress', 'researchDevelopment'
            ]
            
            # Add filename and fill missing fields
            analysis_result['filename'] = filename
            for field in required_fields:
                if field not in analysis_result:
                    analysis_result[field] = 'N/A'
            
            print(f"Successfully parsed JSON response for {analysis_result.get('companyName', filename)}")
            return analysis_result
            
        except json.JSONDecodeError as e:
            print(f"JSON parsing failed: {str(e)}")
            print(f"Raw response: {content[:500]}...")
            
            # Return fallback response with the raw content
            return {
                'companyName': filename.replace('.pdf', ''),
                'reportDate': datetime.now().strftime('%Y-%m-%d'),
                'reportPeriod': 'Analysis Period',
                'filename': filename,
                'cashOnHand': 'Analysis failed',
                'monthlyBurnRate': 'Analysis failed',
                'cashOutDate': 'N/A',
                'runway': 'N/A',
                'budgetVsActual': 'N/A',
                'financialSummary': f'JSON parsing failed. Raw response: {content[:1000]}',
                'clinicalProgress': 'Analysis not available',
                'researchDevelopment': 'Analysis not available'
            }
        
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
    
    return {
        'companyName': company_name,
        'reportDate': datetime.now().strftime('%Y-%m-%d'),
        'reportPeriod': 'Analysis Period',
        'filename': filename,
        'cashOnHand': 'Analysis unavailable',
        'monthlyBurnRate': 'Analysis unavailable',
        'cashOutDate': 'N/A',
        'runway': 'N/A',
        'budgetVsActual': 'N/A',
        'financialSummary': f'Text extraction successful ({len(text)} characters), but AI analysis failed: {error_msg}',
        'clinicalProgress': 'Analysis not available due to API issues',
        'researchDevelopment': 'Analysis not available due to API issues'
    } 