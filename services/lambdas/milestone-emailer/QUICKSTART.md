# 🚀 Quick Start - 15 Minutes to Email Notifications

Follow these steps to get milestone email notifications running TODAY.

---

## Step 1: Get SendGrid API Key (5 min)

1. **Sign up**: Go to [sendgrid.com](https://sendgrid.com/signup) → Free plan
2. **Create API Key**:
   - Dashboard → Settings → API Keys → "Create API Key"
   - Name: `milestone-notifications`
   - Permissions: "Full Access" (or just "Mail Send")
   - Copy the key (starts with `SG.xxxxx...`) ← **SAVE THIS!**

3. **Verify your email**:
   - Settings → Sender Authentication → "Single Sender Verification"
   - Enter your work email
   - Check your inbox and click verify link

✅ Done! You now have: API Key + Verified sender email

---

## Step 2: Deploy Lambda (5 min)

### Option A: AWS Console (Easiest)

1. **Build the package**:
   ```bash
   cd services/lambdas/milestone-emailer
   ./deploy.sh
   ```

2. **Create Lambda in AWS Console**:
   - Go to [AWS Lambda Console](https://console.aws.amazon.com/lambda)
   - Click "Create function"
   - Function name: `milestone-emailer`
   - Runtime: **Python 3.11**
   - Click "Create function"

3. **Upload code**:
   - In the function page, scroll to "Code source"
   - Click "Upload from" → ".zip file"
   - Upload `milestone-emailer.zip`

4. **Configure**:
   - Tab "Configuration" → "General configuration" → Edit
   - Timeout: **30 seconds**
   - Memory: 256 MB (default is fine)
   - Save

5. **Add environment variables**:
   - Tab "Configuration" → "Environment variables" → Edit
   - Add these variables:
   
   ```
   SENDGRID_API_KEY = SG.your_key_here
   SENDER_EMAIL = your-email@domain.com
   RECIPIENT_EMAILS = email1@domain.com,email2@domain.com
   DB_HOST = your-db-host
   DB_PORT = 5432
   DB_NAME = your-db-name
   DB_USER = your-db-user
   DB_PASSWORD = your-db-password
   ```
   
   *(Use same DB config as your other Lambdas)*

6. **Attach database layer** (if you have one):
   - Scroll down to "Layers" section
   - Click "Add a layer"
   - Select your existing database layer (with pg8000)

✅ Lambda is deployed!

---

## Step 3: Test It NOW (1 min)

Send an email immediately to test:

### Method 1: AWS Console
1. In your Lambda function page, click "Test" tab
2. Event name: `test`
3. Event JSON: `{}`
4. Click "Test"
5. Check the output → Should say "Email sent successfully"
6. **Check your inbox!** 📧

### Method 2: Command Line
```bash
aws lambda invoke \
  --function-name milestone-emailer \
  --payload '{}' \
  response.json

cat response.json
```

### What You Should See:
- ✅ Status 200
- ✅ Message: "Email sent successfully"
- ✅ Milestone count, company count
- ✅ Email in your inbox with milestone summary

---

## Step 4: Setup Monthly Schedule (5 min)

Make it run automatically on the 1st of each month:

1. **Go to EventBridge**:
   - [EventBridge Console](https://console.aws.amazon.com/events)
   - Click "Create rule"

2. **Define rule**:
   - Name: `monthly-milestone-reminder`
   - Description: `Send milestone email on 1st of month`
   - Event bus: `default`
   - Rule type: **Schedule**
   - Click "Next"

3. **Schedule pattern**:
   - Choose: **A schedule that runs at a regular rate**
   - Pattern: `cron(0 17 1 * ? *)`
   
   **Choose your time:**
   - `cron(0 17 1 * ? *)` = 9 AM PST / 12 PM EST (5 PM UTC)
   - `cron(0 14 1 * ? *)` = 6 AM PST / 9 AM EST (2 PM UTC)
   - `cron(0 9 1 * ? *)` = 1 AM PST / 4 AM EST (9 AM UTC)
   
   Click "Next"

4. **Select target**:
   - Target types: **AWS service**
   - Select a target: **Lambda function**
   - Function: `milestone-emailer`
   - Click "Next"

5. **Review and create**:
   - Review settings
   - Click "Create rule"

✅ Done! Emails will auto-send on the 1st of every month!

---

## Testing the Schedule

Want to test the schedule? You can trigger it manually:

1. Go to EventBridge → Rules
2. Select `monthly-milestone-reminder`
3. Click "Actions" → **"Test rule with existing event"**
4. Click "Test"
5. Check your email!

---

## 🎉 You're All Set!

**What you have now:**
- ✅ Manual trigger: Send email anytime with one command/click
- ✅ Automatic trigger: Auto-sends on 1st of each month
- ✅ Beautiful HTML emails with milestone summaries
- ✅ Zero ongoing cost (free tier)

---

## Common Commands

**Send email now:**
```bash
aws lambda invoke \
  --function-name milestone-emailer \
  --payload '{}' \
  response.json && cat response.json
```

**Update Lambda code:**
```bash
cd services/lambdas/milestone-emailer
./deploy.sh
aws lambda update-function-code \
  --function-name milestone-emailer \
  --zip-file fileb://milestone-emailer.zip
```

**Check logs:**
```bash
aws logs tail /aws/lambda/milestone-emailer --follow
```

---

## Troubleshooting

### Email not received?
1. Check CloudWatch Logs: AWS Console → CloudWatch → Log groups → `/aws/lambda/milestone-emailer`
2. Verify sender email is verified in SendGrid
3. Check spam folder
4. Verify `RECIPIENT_EMAILS` is correct

### "No milestones to report"?
This is normal! It means:
- All milestones are completed, OR
- No milestones are due in the next 30 days

To test with fake data, mark some milestones as incomplete in your database.

### Lambda timeout?
Increase timeout: Configuration → General configuration → Timeout → Set to 30-60 seconds

---

## Need Help?

Check the main README.md for detailed documentation and customization options.

