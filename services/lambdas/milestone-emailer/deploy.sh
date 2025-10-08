#!/bin/bash

# Simple deployment script for milestone-emailer Lambda
# Usage: ./deploy.sh [function-name]

FUNCTION_NAME=${1:-milestone-emailer}
REGION=${AWS_REGION:-us-east-1}

echo "🚀 Building milestone-emailer Lambda..."

# Clean previous build
rm -f milestone-emailer.zip

# Create deployment package
cd src
zip -r ../milestone-emailer.zip . -x "*.pyc" -x "__pycache__/*" -x "*.git/*"
cd ..

echo "✅ Built milestone-emailer.zip"
echo ""
echo "📦 Deployment package ready!"
echo ""
echo "Next steps:"
echo "1. Go to AWS Lambda Console: https://console.aws.amazon.com/lambda"
echo "2. Create or update function: $FUNCTION_NAME"
echo "3. Upload milestone-emailer.zip"
echo "4. Set runtime: Python 3.11"
echo "5. Set handler: handler.lambda_handler"
echo "6. Add environment variables (see README.md)"
echo "7. Attach database layer (if you have one)"
echo ""
echo "Or use AWS CLI:"
echo ""
echo "# Update existing function:"
echo "aws lambda update-function-code \\"
echo "  --function-name $FUNCTION_NAME \\"
echo "  --zip-file fileb://milestone-emailer.zip \\"
echo "  --region $REGION"
echo ""
echo "# Test it immediately:"
echo "aws lambda invoke \\"
echo "  --function-name $FUNCTION_NAME \\"
echo "  --payload '{}' \\"
echo "  response.json"

