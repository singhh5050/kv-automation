# Milestone Email Notification Lambda

Sends automated email notifications for incomplete or overdue company milestones.

## Features

- ✅ Checks for incomplete milestones (not marked as completed)
- ✅ Includes overdue milestones (past due date)
- ✅ Includes upcoming milestones (next 30 days)
- ✅ Groups by company with priority indicators
- ✅ Beautiful HTML email with plain text fallback
- ✅ Zero external dependencies (uses Python stdlib + pg8000)

## Setup

### 1. Get SendGrid API Key (5 minutes)

1. Go to [sendgrid.com](https://sendgrid.com) and sign up (free)
2. Settings → API Keys → Create API Key
3. Copy the API key (starts with `SG.`)
4. Settings → Sender Authentication → Verify single sender email

### 2. Set Environment Variables in AWS Lambda

```bash
SENDGRID_API_KEY=SG.your_api_key_here
SENDER_EMAIL=your-email@domain.com
RECIPIENT_EMAILS=recipient1@domain.com,recipient2@domain.com
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=your-db-name
DB_USER=your-db-user
DB_PASSWORD=your-db-password
```

### 3. Deploy Lambda

```bash
# Build the Lambda
cd services/lambdas/milestone-emailer
npm run build  # or use the build script

# Deploy via AWS Console:
# 1. Upload the .zip file
# 2. Set runtime to Python 3.11
# 3. Set handler to handler.lambda_handler
# 4. Attach database layer (if you have one)
# 5. Add environment variables above
# 6. Set timeout to 30 seconds
```

### 4. Test Manually (Send Email TODAY)

```bash
# Test the Lambda immediately
aws lambda invoke \
  --function-name milestone-emailer \
  --payload '{}' \
  response.json

# Check the result
cat response.json
```

### 5. Setup Monthly Schedule (EventBridge)

1. Go to AWS EventBridge Console
2. Create Rule:
   - Name: `monthly-milestone-reminder`
   - Rule type: Schedule
   - Cron expression: `cron(0 9 1 * ? *)` (9 AM UTC on 1st of month)
   - Target: Lambda function `milestone-emailer`

**Cron Examples:**
- `cron(0 9 1 * ? *)` - 9 AM UTC on 1st of month (1 AM PST / 4 AM EST)
- `cron(0 17 1 * ? *)` - 5 PM UTC on 1st of month (9 AM PST / 12 PM EST)

## Usage

### Manual Trigger (Send Email Now)

**Option 1: AWS CLI**
```bash
aws lambda invoke \
  --function-name milestone-emailer \
  --payload '{}' \
  response.json
```

**Option 2: AWS Console**
1. Go to Lambda console
2. Select `milestone-emailer` function
3. Click "Test" tab
4. Create new test event (leave payload as `{}`)
5. Click "Test" button

**Option 3: AWS Lambda URL (if enabled)**
```bash
curl -X POST https://your-lambda-url.lambda-url.us-east-1.on.aws/
```

### Automated Trigger

EventBridge will automatically trigger on the 1st of each month at the scheduled time.

## Email Preview

The email includes:
- Summary of total milestones, overdue count, upcoming count
- Grouped by company
- Color-coded by priority (Critical, High, Medium, Low)
- Overdue milestones highlighted in red
- Clean HTML formatting with plain text fallback

## Troubleshooting

### "Missing database configuration"
- Verify all DB environment variables are set in Lambda

### "Missing email configuration"
- Check `SENDGRID_API_KEY` and `SENDER_EMAIL` are set
- Verify the API key is valid (starts with `SG.`)

### "No milestones to report"
- This is normal if all milestones are completed or far in the future
- The Lambda only reports milestones due within 30 days

### Email not received
- Check CloudWatch Logs for errors
- Verify sender email is verified in SendGrid
- Check spam folder
- Verify recipient emails are correct

## Cost

- **SendGrid**: Free (100 emails/day)
- **AWS Lambda**: Free (1M requests/month, you'll use ~12-50/month)
- **EventBridge**: Free (scheduling included)
- **Total**: $0/month 🎉

## Customization

Edit `handler.py` to customize:
- Email template HTML/CSS
- Date range for milestones (currently 30 days)
- Priority colors and icons
- Grouping logic

