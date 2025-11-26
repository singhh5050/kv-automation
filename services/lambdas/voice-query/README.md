# Voice Query Lambda - Vanna.AI Integration

Natural language to SQL query system powered by Vanna.AI for KV portfolio management.

## 🎯 What This Does

Converts natural language questions like "Which companies have low runway?" into SQL queries, executes them safely against your PostgreSQL database, and returns conversational responses suitable for voice output.

## 📁 Files

```
voice-query/
├── src/
│   └── handler.py          # Main Lambda handler (530 lines)
├── requirements.txt        # Python dependencies
├── deploy.sh              # Automated deployment script
└── README.md              # This file
```

## 🚀 Quick Deploy

```bash
# Make script executable (if not already)
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

The script will:
1. Install dependencies
2. Create deployment package
3. Update or create Lambda function
4. Test the deployment

## ⚙️ Environment Variables

Set these in Lambda configuration:

### Required
- `DB_HOST` - RDS endpoint
- `DB_PORT` - 5432 (default)
- `DB_NAME` - kv_automation
- `DB_USER` - postgres (or read-only user)
- `DB_PASSWORD` - Database password
- `VANNA_API_KEY` - From https://vanna.ai/
- `VANNA_MODEL_NAME` - Your model name (e.g., 'kv-portfolio')
- `ANTHROPIC_API_KEY` - For Claude response formatting

### AWS Lambda Config
- **Runtime**: Python 3.9
- **Timeout**: 60 seconds
- **Memory**: 512 MB
- **VPC**: Same as RDS (for database access)

## 📝 Usage

### 1. Train Vanna (One-Time Setup)

```bash
aws lambda invoke \
  --function-name kv-automation-voice-query \
  --payload '{"action": "train_schema"}' \
  response.json

cat response.json
```

Expected output:
```json
{
  "statusCode": 200,
  "body": {
    "status": "success",
    "data": {
      "tables_trained": 8,
      "queries_trained": 15
    }
  }
}
```

### 2. Query the Database

```bash
aws lambda invoke \
  --function-name kv-automation-voice-query \
  --payload '{"action": "query", "question": "How many companies do we have?"}' \
  response.json

cat response.json
```

Expected output:
```json
{
  "statusCode": 200,
  "body": {
    "status": "success",
    "question": "How many companies do we have?",
    "response": "You have 47 companies in your portfolio.",
    "data": [{"count": 47}],
    "sql_executed": "SELECT COUNT(*) FROM companies;",
    "row_count": 1
  }
}
```

## 🧪 Testing Locally

```python
# test_local.py
import os
import json
from src.handler import lambda_handler

# Set environment variables
os.environ['DB_HOST'] = 'your-endpoint.rds.amazonaws.com'
os.environ['DB_PORT'] = '5432'
os.environ['DB_NAME'] = 'kv_automation'
os.environ['DB_USER'] = 'postgres'
os.environ['DB_PASSWORD'] = 'your-password'
os.environ['VANNA_API_KEY'] = 'vn_xxx'
os.environ['VANNA_MODEL_NAME'] = 'kv-portfolio'
os.environ['ANTHROPIC_API_KEY'] = 'sk-ant-xxx'

# Test query
event = {
    "action": "query",
    "question": "How many companies do we have?"
}

result = lambda_handler(event, None)
print(json.dumps(json.loads(result["body"]), indent=2))
```

Run:
```bash
python test_local.py
```

## 📊 Example Queries

### Simple
- "How many companies do we have?"
- "List all companies"
- "Show me companies by sector"

### Financial
- "Which companies have less than 6 months runway?"
- "What's the total cash on hand?"
- "Show me companies with highest burn rate"

### Health
- "Which companies have red health scores?"
- "List companies with yellow or red health"

### Milestones
- "What milestones are overdue?"
- "Show me all critical milestones"
- "What's due this week?"

### Complex
- "Show me healthcare companies with low runway and red health scores"
- "List CEOs of companies with less than $1M cash"

## 🔒 Security Features

1. **Read-Only**: Only SELECT queries allowed
2. **Keyword Blocking**: DROP, DELETE, UPDATE, etc. blocked
3. **Query Timeout**: 60 second limit
4. **SQL Validation**: Checks before execution
5. **VPC Isolation**: Lambda in same VPC as RDS

## 🐛 Troubleshooting

### "Vanna API Error"
- Check `VANNA_API_KEY` is correct
- Verify model name matches Vanna dashboard
- Check CloudWatch logs

### "Database Connection Failed"
- Verify Lambda is in correct VPC
- Check security group rules
- Test DB credentials

### "No SQL Generated"
- Train Vanna first with `train_schema` action
- Add more example queries for your use case

### "Query Timeout"
- Increase Lambda timeout to 60+ seconds
- Check if query is too complex
- Optimize database indexes

## 📈 Monitoring

### CloudWatch Logs
```bash
# Watch logs in real-time
aws logs tail /aws/lambda/kv-automation-voice-query --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/kv-automation-voice-query \
  --filter-pattern "ERROR"
```

### Metrics to Track
- Invocation count
- Duration (should be < 5s)
- Error rate (target < 5%)
- SQL accuracy (track manually)

## 💰 Cost Estimate

Per query:
- **Vanna.AI**: Free (50/day) or $50/month unlimited
- **Claude API**: ~$0.01
- **Lambda**: ~$0.001
- **Total**: ~$0.011 per query

Monthly (1000 queries): ~$11-15

## 🔄 Updates & Maintenance

### Update Code
```bash
# Edit src/handler.py
# Then run:
./deploy.sh
```

### Update Dependencies
```bash
# Edit requirements.txt
# Then run:
./deploy.sh
```

### Retrain Vanna
```bash
# If schema changes or you want to add examples
aws lambda invoke \
  --function-name kv-automation-voice-query \
  --payload '{"action": "train_schema"}' \
  response.json
```

## ✅ Success Checklist

- [ ] Lambda deployed successfully
- [ ] Environment variables configured
- [ ] Vanna trained on schema
- [ ] Test query returns results
- [ ] CloudWatch logs show no errors
- [ ] Frontend can invoke Lambda
- [ ] Voice queries work end-to-end

## 🎉 You're Done!

The Lambda is ready to handle voice queries. Next step: Use it from the frontend via `/api/voice-query` route.

---

**Note**: Your database structure is perfect for Vanna. DO NOT consolidate tables - Vanna learns JOINs automatically!



