# 📧 Milestone Email Notifications - Complete Setup

Automated email notifications for incomplete/overdue milestones. Runs monthly + manual trigger option.

---

## 🎯 What You Get

✅ **Automated monthly emails** (1st of each month)  
✅ **Manual trigger** (send email anytime with 1 command)  
✅ **Beautiful HTML emails** with milestone summaries  
✅ **Zero cost** (SendGrid free tier)  
✅ **Zero maintenance** (set and forget)

---

## 📋 15-Minute Setup Checklist

### [ ] 1. Get SendGrid Account (5 min)

1. Sign up: [sendgrid.com/signup](https://sendgrid.com/signup) (free)
2. Create API Key: Settings → API Keys → "Create API Key"
   - Name: `milestone-notifications`
   - Save the key (starts with `SG.xxx...`)
3. Verify sender email: Settings → Sender Authentication → Verify email

### [ ] 2. Deploy Lambda (5 min)

```bash
# Build the package
cd services/lambdas/milestone-emailer
./deploy.sh

# Upload to AWS Lambda Console:
# - Function name: milestone-emailer
# - Runtime: Python 3.11
# - Upload: milestone-emailer.zip
# - Handler: handler.lambda_handler
# - Timeout: 30 seconds
```

**Add Environment Variables** (in Lambda Console → Configuration → Environment variables):
```
SENDGRID_API_KEY=SG.your_key_here
SENDER_EMAIL=your-verified-email@domain.com
RECIPIENT_EMAILS=email1@domain.com,email2@domain.com
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=your-db-name
DB_USER=your-db-user
DB_PASSWORD=your-db-password
```

### [ ] 3. Test NOW (1 min)

```bash
# Send email immediately
./test-email.sh

# OR use AWS CLI:
aws lambda invoke \
  --function-name milestone-emailer \
  --payload '{}' \
  response.json
```

**Check your inbox!** 📧

### [ ] 4. Setup Monthly Schedule (5 min)

**EventBridge Console** → Create rule:
- Name: `monthly-milestone-reminder`
- Rule type: **Schedule**
- Cron: `cron(0 17 1 * ? *)` (9 AM PST on 1st of month)
- Target: Lambda function `milestone-emailer`

---

## 🚀 Usage

### Send Email TODAY (Manual Trigger)

**Option 1: Script**
```bash
cd services/lambdas/milestone-emailer
./test-email.sh
```

**Option 2: AWS Console**
- Go to Lambda → milestone-emailer → Test tab
- Click "Test" button

**Option 3: AWS CLI**
```bash
aws lambda invoke \
  --function-name milestone-emailer \
  --payload '{}' \
  response.json && cat response.json
```

### Automatic Monthly Email

EventBridge will automatically trigger on the **1st of each month** at your scheduled time.

No action needed! ✨

---

## 📧 What's Included in the Email

- **Summary**: Total milestones, overdue count, upcoming count
- **Grouped by company**
- **Color-coded priorities**: Critical (red), High (orange), Medium (blue), Low (gray)
- **Overdue milestones highlighted**
- **Clean HTML formatting** with plain text fallback

### Email Scope
- ❌ Completed milestones (excluded)
- ✅ Overdue milestones (past due date)
- ✅ Upcoming milestones (next 30 days)

---

## ⏰ Cron Schedule Options

Choose your preferred time for monthly emails:

```bash
# Format: cron(minute hour day month ? year)

cron(0 17 1 * ? *)   # 9 AM PST / 12 PM EST on 1st
cron(0 14 1 * ? *)   # 6 AM PST / 9 AM EST on 1st
cron(0 9 1 * ? *)    # 1 AM PST / 4 AM EST on 1st
cron(0 12 1 * ? *)   # 4 AM PST / 7 AM EST on 1st
```

All times run on the **1st day** of each month.

---

## 🔧 Common Commands

**Send email now:**
```bash
cd services/lambdas/milestone-emailer
./test-email.sh
```

**Update Lambda code:**
```bash
./deploy.sh
aws lambda update-function-code \
  --function-name milestone-emailer \
  --zip-file fileb://milestone-emailer.zip
```

**View logs:**
```bash
aws logs tail /aws/lambda/milestone-emailer --follow
```

**Test EventBridge schedule:**
- EventBridge Console → Rules → monthly-milestone-reminder
- Actions → "Test rule with existing event"

---

## 💰 Cost Breakdown

| Service | Cost | Notes |
|---------|------|-------|
| SendGrid | **$0** | 100 emails/day free forever |
| AWS Lambda | **$0** | 1M free requests/month (you use ~12-50) |
| EventBridge | **$0** | Scheduling included |
| **Total** | **$0/month** | 🎉 |

---

## 🐛 Troubleshooting

### "Email not received"
1. Check spam folder
2. Verify sender email is verified in SendGrid
3. Check CloudWatch Logs: Console → CloudWatch → `/aws/lambda/milestone-emailer`
4. Verify `RECIPIENT_EMAILS` environment variable

### "No milestones to report"
This is normal! It means:
- All milestones are completed, OR
- No milestones due in next 30 days

### Lambda errors
- Check CloudWatch Logs for detailed errors
- Verify database credentials are correct
- Ensure Lambda has database layer attached (pg8000)
- Check timeout (should be 30+ seconds)

---

## 📁 Files

```
services/lambdas/milestone-emailer/
├── src/
│   └── handler.py           # Main Lambda code
├── requirements.txt         # Dependencies (pg8000)
├── README.md               # Full documentation
├── QUICKSTART.md           # Step-by-step setup guide
├── deploy.sh               # Build script
└── test-email.sh           # Test sending email
```

---

## 📚 Documentation

- **Quick Start**: `services/lambdas/milestone-emailer/QUICKSTART.md`
- **Full README**: `services/lambdas/milestone-emailer/README.md`
- **This File**: `MILESTONE_EMAIL_SETUP.md`

---

## ✅ Next Steps

1. [ ] Complete setup checklist above
2. [ ] Send test email to verify
3. [ ] Confirm monthly schedule is active
4. [ ] Customize email template (optional)
5. [ ] Add more recipients as needed

**Questions?** Check the detailed docs in `services/lambdas/milestone-emailer/`

---

**That's it!** 🎉 Your milestone notifications are live!

