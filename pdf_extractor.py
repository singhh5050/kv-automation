#!/usr/bin/env python3
import pdfplumber
import json
import sys
import argparse
from datetime import datetime

def extract_pdf_data(pdf_path, filename):
    """Extract text and table data from PDF using pdfplumber"""
    
    result = {
        'filename': filename,
        'text': '',
        'tables': [],
        'metadata': {},
        'extraction_method': 'pdfplumber'
    }
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            # Extract metadata
            result['metadata'] = {
                'num_pages': len(pdf.pages),
                'creator': pdf.metadata.get('Creator', ''),
                'producer': pdf.metadata.get('Producer', ''),
                'creation_date': str(pdf.metadata.get('CreationDate', '')),
                'title': pdf.metadata.get('Title', '')
            }
            
            # Extract text from all pages
            full_text = []
            all_tables = []
            
            for page_num, page in enumerate(pdf.pages, 1):
                # Extract text
                page_text = page.extract_text()
                if page_text:
                    full_text.append(f"--- Page {page_num} ---\n{page_text}")
                
                # Extract tables
                tables = page.extract_tables()
                for table_num, table in enumerate(tables, 1):
                    if table:
                        # Convert table to list of dictionaries for better structure
                        headers = table[0] if table else []
                        rows = table[1:] if len(table) > 1 else []
                        
                        table_data = {
                            'page': page_num,
                            'table_number': table_num,
                            'headers': headers,
                            'rows': rows,
                            'raw_table': table
                        }
                        all_tables.append(table_data)
            
            result['text'] = '\n\n'.join(full_text)
            result['tables'] = all_tables
            
    except Exception as e:
        result['error'] = str(e)
        result['text'] = f"Error extracting PDF: {str(e)}"
    
    return result

def main():
    parser = argparse.ArgumentParser(description='Extract PDF data using pdfplumber')
    parser.add_argument('pdf_path', help='Path to the PDF file')
    parser.add_argument('--filename', help='Original filename', default='unknown.pdf')
    
    args = parser.parse_args()
    
    # Extract data
    result = extract_pdf_data(args.pdf_path, args.filename)
    
    # Output JSON
    print(json.dumps(result, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main() 