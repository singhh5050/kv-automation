#!/bin/bash

# Setup script for Python dependencies

echo "🐍 Setting up Python environment for PDF extraction..."

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    echo "   Visit: https://www.python.org/downloads/"
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"

# Check if pip is installed
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 is not installed. Please install pip3."
    exit 1
fi

echo "✅ pip3 found: $(pip3 --version)"

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip3 install -r requirements.txt

# Verify installation
echo "🔍 Verifying pdfplumber installation..."
python3 -c "import pdfplumber; print('✅ pdfplumber installed successfully:', pdfplumber.__version__)" 2>/dev/null || {
    echo "❌ pdfplumber installation failed"
    exit 1
}

# Make the Python script executable
chmod +x pdf_extractor.py

echo "🎉 Python environment setup complete!"
echo ""
echo "You can now run the application with: npm run dev"
echo ""
echo "📋 Summary:"
echo "   - Python 3: ✅ Installed"
echo "   - pdfplumber: ✅ Installed"
echo "   - PDF extractor script: ✅ Ready" 