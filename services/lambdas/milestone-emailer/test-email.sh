#!/bin/bash

# Quick script to test the milestone emailer Lambda
# Usage: ./test-email.sh [function-name]

FUNCTION_NAME=${1:-milestone-emailer}

echo "📧 Sending test email via Lambda: $FUNCTION_NAME"
echo ""

# Invoke Lambda
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  response.json

echo ""
echo "Response:"
cat response.json | jq '.' 2>/dev/null || cat response.json
echo ""
echo ""
echo "✅ Check your email inbox!"
echo "📊 Check CloudWatch Logs for details:"
echo "   https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups/log-group/\$252Faws\$252Flambda\$252F$FUNCTION_NAME"

