#!/bin/bash

# Voice Query Lambda Deployment Script
# Usage: ./deploy.sh

set -e  # Exit on error

echo "🚀 Starting Voice Query Lambda Deployment..."

# Configuration
LAMBDA_NAME="kv-automation-voice-query"
RUNTIME="python3.9"
HANDLER="handler.lambda_handler"
TIMEOUT=60
MEMORY=512
REGION="${AWS_REGION:-us-east-1}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Please install it first.${NC}"
    exit 1
fi

# Check if required environment variables are set
if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
    echo -e "${YELLOW}⚠️  AWS credentials not found in environment${NC}"
    echo "Make sure you have configured AWS CLI with: aws configure"
fi

echo "📦 Step 1: Creating deployment package..."

# Clean previous builds
rm -rf package
rm -f voice-query-lambda.zip

# Create package directory
mkdir -p package

# Install dependencies
echo "📥 Installing Python dependencies..."
pip install -r requirements.txt -t package/ --quiet

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    exit 1
fi

# Copy source code
echo "📄 Copying source code..."
cp src/handler.py package/

# Create ZIP file
echo "🗜️  Creating ZIP archive..."
cd package
zip -r ../voice-query-lambda.zip . -q
cd ..

echo -e "${GREEN}✅ Deployment package created: voice-query-lambda.zip${NC}"
echo "   Size: $(du -h voice-query-lambda.zip | cut -f1)"

# Check if Lambda function exists
echo ""
echo "🔍 Step 2: Checking if Lambda function exists..."

if aws lambda get-function --function-name $LAMBDA_NAME --region $REGION &>/dev/null; then
    echo -e "${YELLOW}📝 Lambda function exists. Updating code...${NC}"
    
    aws lambda update-function-code \
        --function-name $LAMBDA_NAME \
        --zip-file fileb://voice-query-lambda.zip \
        --region $REGION \
        --output json > /dev/null
    
    echo -e "${GREEN}✅ Lambda function code updated${NC}"
    
    # Update function configuration
    echo "⚙️  Updating function configuration..."
    aws lambda update-function-configuration \
        --function-name $LAMBDA_NAME \
        --timeout $TIMEOUT \
        --memory-size $MEMORY \
        --region $REGION \
        --output json > /dev/null
    
    echo -e "${GREEN}✅ Lambda function configuration updated${NC}"
else
    echo -e "${YELLOW}📝 Lambda function doesn't exist. Creating new function...${NC}"
    echo ""
    echo -e "${RED}⚠️  IMPORTANT: You need to provide:${NC}"
    echo "   1. Lambda execution role ARN"
    echo "   2. VPC configuration (if RDS is in VPC)"
    echo ""
    echo "Example command to create Lambda:"
    echo ""
    echo "aws lambda create-function \\"
    echo "  --function-name $LAMBDA_NAME \\"
    echo "  --runtime $RUNTIME \\"
    echo "  --handler $HANDLER \\"
    echo "  --zip-file fileb://voice-query-lambda.zip \\"
    echo "  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_LAMBDA_ROLE \\"
    echo "  --timeout $TIMEOUT \\"
    echo "  --memory-size $MEMORY \\"
    echo "  --region $REGION \\"
    echo "  --vpc-config SubnetIds=subnet-xxx,subnet-yyy,SecurityGroupIds=sg-zzz"
    echo ""
    echo "Or use AWS Console to create the function with the generated ZIP file."
    exit 0
fi

# Test the function
echo ""
echo "🧪 Step 3: Testing Lambda function..."

# Create test payload
cat > test_payload.json <<EOF
{
  "action": "query",
  "question": "SELECT 1 as test"
}
EOF

echo "📤 Invoking Lambda with test payload..."

aws lambda invoke \
    --function-name $LAMBDA_NAME \
    --payload file://test_payload.json \
    --region $REGION \
    test_response.json \
    --output json > /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Lambda invocation successful${NC}"
    echo ""
    echo "Response:"
    cat test_response.json | python3 -m json.tool
    
    # Clean up test files
    rm test_payload.json test_response.json
else
    echo -e "${RED}❌ Lambda invocation failed${NC}"
    cat test_response.json
    rm test_payload.json test_response.json
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Set environment variables in Lambda:"
echo "   - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD"
echo "   - VANNA_API_KEY (get from https://vanna.ai/)"
echo "   - VANNA_MODEL_NAME (e.g., 'kv-portfolio')"
echo "   - ANTHROPIC_API_KEY (for response formatting)"
echo ""
echo "2. Train Vanna on your schema (ONE TIME):"
echo "   aws lambda invoke \\"
echo "     --function-name $LAMBDA_NAME \\"
echo "     --payload '{\"action\": \"train_schema\"}' \\"
echo "     --region $REGION \\"
echo "     training_response.json"
echo ""
echo "3. Test a query:"
echo "   aws lambda invoke \\"
echo "     --function-name $LAMBDA_NAME \\"
echo "     --payload '{\"action\": \"query\", \"question\": \"How many companies?\"}' \\"
echo "     --region $REGION \\"
echo "     query_response.json"
echo ""
echo "4. Check CloudWatch logs for any issues:"
echo "   aws logs tail /aws/lambda/$LAMBDA_NAME --follow"
echo ""
echo "📚 Full documentation: VOICE_MODE_SETUP.md"
echo ""

# Clean up build artifacts (optional)
read -p "🗑️  Clean up build artifacts (package/, *.zip)? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf package
    rm -f voice-query-lambda.zip
    echo -e "${GREEN}✅ Cleaned up build artifacts${NC}"
fi

echo ""
echo -e "${GREEN}✨ All done! Happy querying! 🎤${NC}"
