import json
import base64
import tempfile
import os
import sys

# Try to import pdfplumber, handle if not available
try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False
    print("Warning: pdfplumber not available", file=sys.stderr)

def handler(request, response):
    """Vercel serverless function handler for PDF extraction"""
    
    # Handle CORS
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    
    # Handle OPTIONS request for CORS preflight
    if request.method == 'OPTIONS':
        response.status_code = 200
        return response
    
    # Only accept POST requests
    if request.method != 'POST':
        response.status_code = 405
        return json.dumps({"error": "Method not allowed"})
    
    try:
        # Parse request body
        body = request.body
        if isinstance(body, bytes):
            body = body.decode('utf-8')
        
        data = json.loads(body)
        
        if not data.get('pdf_data'):
            response.status_code = 400
            return json.dumps({"error": "No PDF data provided"})
        
        # Decode base64 PDF data
        pdf_bytes = base64.b64decode(data['pdf_data'])
        filename = data.get('filename', 'document.pdf')
        
        # Extract PDF content
        result = extract_pdf_content(pdf_bytes, filename)
        
        response.status_code = 200
        response.headers['Content-Type'] = 'application/json'
        return json.dumps(result)
        
    except json.JSONDecodeError as e:
        response.status_code = 400
        return json.dumps({"error": f"Invalid JSON: {str(e)}"})
    except Exception as e:
        print(f"Error processing PDF: {str(e)}", file=sys.stderr)
        response.status_code = 500
        return json.dumps({"error": f"Error processing PDF: {str(e)}"})

def extract_pdf_content(pdf_bytes, filename):
    """Extract text and tables from PDF using pdfplumber"""
    
    if not PDFPLUMBER_AVAILABLE:
        return {
            "error": "pdfplumber not available on server",
            "text": "",
            "tables": [],
            "metadata": {"filename": filename, "pages": 0}
        }
    
    try:
        # Create temporary file
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_file:
            temp_file.write(pdf_bytes)
            temp_path = temp_file.name
        
        try:
            # Extract content using pdfplumber
            extracted_text = ""
            all_tables = []
            
            with pdfplumber.open(temp_path) as pdf:
                total_pages = len(pdf.pages)
                
                for page_num, page in enumerate(pdf.pages):
                    # Extract text
                    page_text = page.extract_text()
                    if page_text:
                        extracted_text += f"\n--- Page {page_num + 1} ---\n"
                        extracted_text += page_text
                    
                    # Extract tables
                    tables = page.extract_tables()
                    for table_idx, table in enumerate(tables):
                        if table and len(table) > 0:
                            # Clean and structure table data
                            clean_table = []
                            for row in table:
                                if row and any(cell is not None and str(cell).strip() for cell in row):
                                    clean_row = [str(cell).strip() if cell is not None else "" for cell in row]
                                    clean_table.append(clean_row)
                            
                            if clean_table:
                                all_tables.append({
                                    "page": page_num + 1,
                                    "table_index": table_idx,
                                    "data": clean_table,
                                    "headers": clean_table[0] if clean_table else [],
                                    "rows": clean_table[1:] if len(clean_table) > 1 else []
                                })
            
            return {
                "text": extracted_text.strip(),
                "tables": all_tables,
                "metadata": {
                    "filename": filename,
                    "pages": total_pages,
                    "tables_found": len(all_tables)
                }
            }
            
        finally:
            # Clean up temporary file
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except Exception as e:
        print(f"PDF extraction failed: {str(e)}", file=sys.stderr)
        return {
            "error": f"PDF extraction failed: {str(e)}",
            "text": "",
            "tables": [],
            "metadata": {"filename": filename, "pages": 0}
        } 