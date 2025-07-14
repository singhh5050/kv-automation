#!/bin/bash

# KV Automation Frontend - Vercel Deployment Script

set -e

echo "🚀 Deploying KV Automation Frontend to Vercel..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Vercel CLI...${NC}"
    npm install -g vercel
fi

# Check for required environment variable
if [ -z "$NEXT_PUBLIC_BACKEND_URL" ]; then
    echo -e "${RED}❌ Error: NEXT_PUBLIC_BACKEND_URL environment variable is not set${NC}"
    echo "Please set the backend URL environment variable before deploying:"
    echo "export NEXT_PUBLIC_BACKEND_URL=your_api_gateway_url"
    exit 1
fi

echo -e "${BLUE}🔧 Configuration:${NC}"
echo -e "  Backend URL: $NEXT_PUBLIC_BACKEND_URL"
echo ""

# Set environment variable for deployment
echo -e "${YELLOW}🔑 Setting environment variables...${NC}"
vercel env add NEXT_PUBLIC_BACKEND_URL production <<< "${NEXT_PUBLIC_BACKEND_URL}"

# Deploy to Vercel
echo -e "${YELLOW}🚀 Deploying to Vercel...${NC}"

# Deploy to production
vercel --prod

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Frontend deployed successfully to Vercel!${NC}"
    echo ""
    echo -e "${BLUE}📋 Deployment complete:${NC}"
    echo "  • Frontend: Available on your Vercel domain"
    echo "  • Backend: $NEXT_PUBLIC_BACKEND_URL"
    echo ""
    echo -e "${GREEN}🎉 Your KV Automation platform is now live!${NC}"
else
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi 