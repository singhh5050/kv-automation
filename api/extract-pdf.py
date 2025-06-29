from http.server import BaseHTTPRequestHandler
import json
import base64
import tempfile
import os

try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except ImportError:
    PDFPLUMBER_AVAILABLE = False

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            # Read the request body
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            # Parse JSON data
            data = json.loads(post_data.decode('utf-8'))
            
            if not data.get('pdf_data'):
                self.send_error(400, "No PDF data provided")
                return
            
            # Decode base64 PDF data
            pdf_bytes = base64.b64decode(data['pdf_data'])
            filename = data.get('filename', 'document.pdf')
            
            # Extract PDF content
            result = self.extract_pdf_content(pdf_bytes, filename)
            
            # Send response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            response = json.dumps(result)
            self.wfile.write(response.encode('utf-8'))
            
        except Exception as e:
            self.send_error(500, f"Error processing PDF: {str(e)}")
    
    def do_OPTIONS(self):
        # Handle CORS preflight
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def extract_pdf_content(self, pdf_bytes, filename):
        """Extract text and tables from PDF using pdfplumber"""
        
        if not PDFPLUMBER_AVAILABLE:
            return {
                "error": "pdfplumber not available",
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
            return {
                "error": f"PDF extraction failed: {str(e)}",
                "text": "",
                "tables": [],
                "metadata": {"filename": filename, "pages": 0}
            } 