#!/usr/bin/env python3
"""
Test script to verify pdfplumber installation and PDF extraction functionality
"""

import sys
import json
import tempfile
import os

def test_pdfplumber_import():
    """Test if pdfplumber can be imported"""
    try:
        import pdfplumber
        print("✅ pdfplumber imported successfully")
        print(f"📦 pdfplumber version: {pdfplumber.__version__}")
        return True
    except ImportError as e:
        print(f"❌ Failed to import pdfplumber: {e}")
        return False

def test_pdf_extractor_script():
    """Test if the PDF extractor script exists and is executable"""
    if os.path.exists('pdf_extractor.py'):
        print("✅ pdf_extractor.py found")
        if os.access('pdf_extractor.py', os.X_OK):
            print("✅ pdf_extractor.py is executable")
            return True
        else:
            print("⚠️  pdf_extractor.py is not executable (run: chmod +x pdf_extractor.py)")
            return False
    else:
        print("❌ pdf_extractor.py not found")
        return False

def create_sample_pdf():
    """Create a simple test PDF for testing"""
    try:
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import letter
        
        # Create a temporary PDF file
        temp_pdf = tempfile.NamedTemporaryFile(delete=False, suffix='.pdf')
        c = canvas.Canvas(temp_pdf.name, pagesize=letter)
        
        # Add some sample text
        c.drawString(100, 750, "Test Company Financial Report")
        c.drawString(100, 700, "Cash on Hand: $1,000,000")
        c.drawString(100, 650, "Monthly Burn Rate: $100,000")
        c.drawString(100, 600, "Runway: 10 months")
        
        # Add a simple table
        y_position = 550
        headers = ["Metric", "Q1", "Q2", "Q3"]
        for i, header in enumerate(headers):
            c.drawString(100 + i * 100, y_position, header)
        
        y_position -= 30
        row_data = ["Revenue", "$500K", "$600K", "$700K"]
        for i, cell in enumerate(row_data):
            c.drawString(100 + i * 100, y_position, cell)
        
        c.save()
        temp_pdf.close()
        
        print(f"✅ Created test PDF: {temp_pdf.name}")
        return temp_pdf.name
        
    except ImportError:
        print("⚠️  reportlab not installed, skipping PDF creation test")
        print("   Install with: pip3 install reportlab")
        return None
    except Exception as e:
        print(f"❌ Failed to create test PDF: {e}")
        return None

def main():
    print("🧪 Testing PDF extraction setup...\n")
    
    all_tests_passed = True
    
    # Test 1: Import pdfplumber
    print("Test 1: pdfplumber import")
    if not test_pdfplumber_import():
        all_tests_passed = False
    print()
    
    # Test 2: Check PDF extractor script
    print("Test 2: PDF extractor script")
    if not test_pdf_extractor_script():
        all_tests_passed = False
    print()
    
    # Test 3: Create and test with sample PDF
    print("Test 3: Sample PDF extraction")
    test_pdf_path = create_sample_pdf()
    if test_pdf_path:
        try:
            import subprocess
            result = subprocess.run([
                'python3', 'pdf_extractor.py', test_pdf_path, '--filename', 'test.pdf'
            ], capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0:
                try:
                    output_data = json.loads(result.stdout)
                    print("✅ PDF extraction successful")
                    print(f"📄 Text length: {len(output_data.get('text', ''))}")
                    print(f"📊 Tables found: {len(output_data.get('tables', []))}")
                    if output_data.get('metadata'):
                        print(f"📋 Pages: {output_data['metadata'].get('num_pages', 'N/A')}")
                except json.JSONDecodeError as e:
                    print(f"❌ Invalid JSON output: {e}")
                    print(f"Raw output: {result.stdout[:200]}...")
                    all_tests_passed = False
            else:
                print(f"❌ PDF extraction failed with code {result.returncode}")
                print(f"Error: {result.stderr}")
                all_tests_passed = False
                
            # Clean up test file
            os.unlink(test_pdf_path)
            
        except subprocess.TimeoutExpired:
            print("❌ PDF extraction timed out")
            all_tests_passed = False
        except Exception as e:
            print(f"❌ PDF extraction test failed: {e}")
            all_tests_passed = False
    print()
    
    # Summary
    if all_tests_passed:
        print("🎉 All tests passed! PDF extraction is ready to use.")
    else:
        print("❌ Some tests failed. Please check the issues above.")
        sys.exit(1)

if __name__ == '__main__':
    main() 