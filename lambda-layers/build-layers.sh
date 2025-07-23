#!/bin/bash

echo "🔧 Building Lambda Layers for x86_64 Architecture"

# Create Google APIs layer
echo "📦 Building Google APIs layer..."
docker run --rm --platform=linux/amd64 \
  -v $(pwd)/lambda-layers/google-apis:/layer \
  -w /layer \
  python:3.9-slim \
  /bin/bash -c "
    pip install --no-cache-dir -t python/ \
      google-api-python-client==2.108.0 \
      google-auth==2.23.4 \
      google-auth-oauthlib==1.1.0 \
      google-auth-httplib2==0.1.1 \
      httplib2==0.22.0
  "

# Zip the layer
cd lambda-layers/google-apis
zip -r ../google-apis-layer.zip python/
cd ../..

echo "✅ Google APIs layer created: lambda-layers/google-apis-layer.zip"

# Create pandas/excel layer (if not exists)
echo "📦 Building Pandas/Excel layer..."
mkdir -p lambda-layers/pandas-excel/python

docker run --rm --platform=linux/amd64 \
  -v $(pwd)/lambda-layers/pandas-excel:/layer \
  -w /layer \
  python:3.9-slim \
  /bin/bash -c "
    pip install --no-cache-dir -t python/ \
      pandas==2.1.3 \
      openpyxl==3.1.2 \
      xlsxwriter==3.1.9
  "

# Zip the layer
cd lambda-layers/pandas-excel
zip -r ../pandas-excel-layer.zip python/
cd ../..

echo "✅ Pandas/Excel layer created: lambda-layers/pandas-excel-layer.zip"

# Create database layer
echo "📦 Building Database layer..."
mkdir -p lambda-layers/database/python

docker run --rm --platform=linux/amd64 \
  -v $(pwd)/lambda-layers/database:/layer \
  -w /layer \
  python:3.9-slim \
  /bin/bash -c "
    pip install --no-cache-dir -t python/ \
      pg8000==1.30.3 \
      requests==2.31.0
  "

# Zip the layer
cd lambda-layers/database
zip -r ../database-layer.zip python/
cd ../..

echo "✅ Database layer created: lambda-layers/database-layer.zip"

echo "🎉 All layers built successfully!"
echo "📁 Files created:"
echo "  - lambda-layers/google-apis-layer.zip"
echo "  - lambda-layers/pandas-excel-layer.zip" 
echo "  - lambda-layers/database-layer.zip" 