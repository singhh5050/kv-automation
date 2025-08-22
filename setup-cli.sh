#!/bin/bash

# 🚀 Complete CLI Setup for Direct S3 Uploads
# Run this script to configure everything needed

set -e  # Exit on any error

echo "🔧 Setting up Direct S3 Uploads via CLI..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if required tools are installed
check_tools() {
    echo -e "${BLUE}📋 Checking required tools...${NC}"
    
    if ! command -v vercel &> /dev/null; then
        echo -e "${RED}❌ Vercel CLI not found. Install with: npm i -g vercel${NC}"
        exit 1
    fi
    
    if ! command -v aws &> /dev/null; then
        echo -e "${RED}❌ AWS CLI not found. Install from: https://aws.amazon.com/cli/${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ All tools found${NC}"
}

# Get user inputs
get_inputs() {
    echo -e "${BLUE}📝 Please provide the following information:${NC}"
    
    read -p "AWS Access Key ID: " AWS_ACCESS_KEY_ID
    read -s -p "AWS Secret Access Key: " AWS_SECRET_ACCESS_KEY
    echo
    read -p "AWS Region (default: us-east-1): " AWS_REGION
    AWS_REGION=${AWS_REGION:-us-east-1}
    read -p "S3 Bucket Name (default: kv-board-decks-prod): " S3_BUCKET_NAME
    S3_BUCKET_NAME=${S3_BUCKET_NAME:-kv-board-decks-prod}
    read -p "Your Vercel domain (e.g., myapp.vercel.app): " VERCEL_DOMAIN
    
    echo -e "${GREEN}✅ Configuration collected${NC}"
}

# Set Vercel environment variables
setup_vercel_env() {
    echo -e "${BLUE}🔐 Setting up Vercel environment variables...${NC}"
    
    # Set environment variables for all environments
    echo "$AWS_ACCESS_KEY_ID" | vercel env add AWS_ACCESS_KEY_ID production
    echo "$AWS_SECRET_ACCESS_KEY" | vercel env add AWS_SECRET_ACCESS_KEY production
    echo "$AWS_REGION" | vercel env add AWS_REGION production
    echo "$S3_BUCKET_NAME" | vercel env add S3_BUCKET_NAME production
    
    # Also set for preview and development
    echo "$AWS_ACCESS_KEY_ID" | vercel env add AWS_ACCESS_KEY_ID preview
    echo "$AWS_SECRET_ACCESS_KEY" | vercel env add AWS_SECRET_ACCESS_KEY preview
    echo "$AWS_REGION" | vercel env add AWS_REGION preview
    echo "$S3_BUCKET_NAME" | vercel env add S3_BUCKET_NAME preview
    
    echo -e "${GREEN}✅ Vercel environment variables set${NC}"
}

# Configure S3 CORS
setup_s3_cors() {
    echo -e "${BLUE}🌐 Setting up S3 CORS configuration...${NC}"
    
    # Create CORS configuration
    cat > cors-config.json << EOF
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
    "AllowedOrigins": [
      "https://${VERCEL_DOMAIN}",
      "https://*.vercel.app",
      "http://localhost:3000"
    ],
    "ExposeHeaders": ["ETag", "x-amz-request-id"],
    "MaxAgeSeconds": 3000
  }
]
EOF

    # Apply CORS configuration
    aws s3api put-bucket-cors --bucket "$S3_BUCKET_NAME" --cors-configuration file://cors-config.json
    
    # Clean up
    rm cors-config.json
    
    echo -e "${GREEN}✅ S3 CORS configured${NC}"
}

# Verify S3 bucket permissions
check_s3_permissions() {
    echo -e "${BLUE}🔍 Checking S3 bucket permissions...${NC}"
    
    # Test bucket access
    if aws s3 ls "s3://$S3_BUCKET_NAME" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ S3 bucket accessible${NC}"
    else
        echo -e "${YELLOW}⚠️  Cannot access S3 bucket. Check IAM permissions.${NC}"
        echo -e "${YELLOW}Required permissions in DEPLOYMENT_SETUP.md${NC}"
    fi
}

# Create local environment file
setup_local_env() {
    echo -e "${BLUE}📝 Creating local environment file...${NC}"
    
    cat > apps/web/.env.local << EOF
# AWS Configuration for S3 uploads
AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY
AWS_REGION=$AWS_REGION
S3_BUCKET_NAME=$S3_BUCKET_NAME

# Add your database configuration below if needed
# DB_HOST=your_database_host
# DB_PORT=5432
# DB_NAME=your_database_name
# DB_USER=your_database_user
# DB_PASSWORD=your_database_password
EOF

    echo -e "${GREEN}✅ Local environment file created${NC}"
}

# Deploy to Vercel
deploy_vercel() {
    echo -e "${BLUE}🚀 Deploying to Vercel...${NC}"
    
    vercel --prod
    
    echo -e "${GREEN}✅ Deployed to Vercel${NC}"
}

# Test the setup
test_setup() {
    echo -e "${BLUE}🧪 Testing the setup...${NC}"
    
    # Get the deployment URL
    VERCEL_URL=$(vercel ls | grep "kv-automation" | awk '{print $2}' | head -1)
    
    if [ -z "$VERCEL_URL" ]; then
        echo -e "${YELLOW}⚠️  Could not determine Vercel URL. Test manually.${NC}"
        return
    fi
    
    # Test presign endpoint
    echo -e "${BLUE}Testing presign endpoint at: https://$VERCEL_URL${NC}"
    
    response=$(curl -s -X POST "https://$VERCEL_URL/api/presign-s3" \
        -H "Content-Type: application/json" \
        -d '{"fileName":"test.pdf","fileType":"application/pdf"}')
    
    if echo "$response" | grep -q "presignedUrl"; then
        echo -e "${GREEN}✅ Presign endpoint working!${NC}"
    else
        echo -e "${RED}❌ Presign endpoint failed. Response: $response${NC}"
    fi
}

# Main execution
main() {
    echo -e "${GREEN}🎯 Direct S3 Upload Setup Script${NC}"
    echo "This will configure everything needed for 5GB direct S3 uploads"
    echo ""
    
    check_tools
    get_inputs
    setup_vercel_env
    setup_s3_cors
    check_s3_permissions
    setup_local_env
    deploy_vercel
    test_setup
    
    echo ""
    echo -e "${GREEN}🎉 Setup complete!${NC}"
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Test uploading your 4.43MB file"
    echo "2. Check S3 bucket for uploaded files"
    echo "3. Verify Lambda processing still works"
    echo ""
    echo -e "${YELLOW}If issues occur, check DEPLOYMENT_SETUP.md for troubleshooting${NC}"
}

# Run the script
main "$@"
