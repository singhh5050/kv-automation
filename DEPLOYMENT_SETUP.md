# Vercel Deployment Setup for Direct S3 Uploads

## 🔧 Required Environment Variables

You need to configure these environment variables in your **Vercel Project Settings**:

### AWS Configuration
```
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key  
AWS_REGION=us-east-1
S3_BUCKET_NAME=kv-board-decks-prod
```

### Database Configuration  
```
DB_HOST=your_database_host
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password
```

## 📋 How to Set Environment Variables in Vercel

### Method 1: Vercel Dashboard
1. Go to your project in [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **Settings** tab
3. Click **Environment Variables** in sidebar
4. Add each variable with:
   - **Name**: Variable name (e.g., `AWS_ACCESS_KEY_ID`)
   - **Value**: Your actual value
   - **Environment**: Production, Preview, Development (select as needed)

### Method 2: Vercel CLI
```bash
vercel env add AWS_ACCESS_KEY_ID
vercel env add AWS_SECRET_ACCESS_KEY
vercel env add AWS_REGION
vercel env add S3_BUCKET_NAME
```

## 🌐 S3 CORS Configuration (Critical!)

Your S3 bucket **must** have CORS configured for browser uploads:

1. Go to **S3 Console → Your Bucket → Permissions → CORS**
2. Add this configuration:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
    "AllowedOrigins": [
      "https://your-vercel-domain.vercel.app",
      "https://*.vercel.app",
      "http://localhost:3000"
    ],
    "ExposeHeaders": ["ETag", "x-amz-request-id"],
    "MaxAgeSeconds": 3000
  }
]
```

**Replace `your-vercel-domain` with your actual domain!**

## 🔒 AWS IAM Permissions

Your AWS user/role needs these S3 permissions:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:PutObjectAcl",
                "s3:GetObject"
            ],
            "Resource": "arn:aws:s3:::kv-board-decks-prod/*"
        },
        {
            "Effect": "Allow", 
            "Action": [
                "s3:ListBucket"
            ],
            "Resource": "arn:aws:s3:::kv-board-decks-prod"
        }
    ]
}
```

## 🧪 Testing the Setup

1. **Deploy to Vercel** with environment variables configured
2. **Test the presign endpoint**:
   ```bash
   curl -X POST https://your-app.vercel.app/api/presign-s3 \
     -H "Content-Type: application/json" \
     -d '{"fileName":"test.pdf","fileType":"application/pdf"}'
   ```
3. **Expected response**:
   ```json
   {
     "success": true,
     "presignedUrl": "https://s3.amazonaws.com/...",
     "s3Key": "temp/2024-01-15T10-30-00-000Z-test.pdf"
   }
   ```

## 🚨 Common Issues

### "AWS credentials not configured"
- Check environment variables are set in Vercel
- Verify variable names match exactly
- Redeploy after adding environment variables

### "Access Denied" on S3 upload
- Verify IAM permissions above
- Check S3 bucket name is correct
- Ensure S3 bucket exists and is accessible

### "Failed to get presigned URL"
- Check AWS region matches your S3 bucket region
- Verify AWS credentials are valid

## 🎯 Benefits After Setup

- ✅ **5GB file upload limit** (instead of 4.5MB)
- ✅ **Direct browser-to-S3** uploads
- ✅ **Zero server processing** overhead
- ✅ **Automatic Lambda triggers** via S3 events
- ✅ **Better error handling** and user feedback

## 📝 Local Development

For local development, create `.env.local` in `apps/web/`:

```bash
# apps/web/.env.local
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=us-east-1
S3_BUCKET_NAME=kv-board-decks-prod
```

**Note**: `.env.local` is gitignored for security.
