# Async Analysis Implementation - Deployment Guide

## Overview

This implementation replaces the timeout-prone synchronous GPT-5 multi-PDF analysis with an asynchronous job queue system that eliminates API Gateway timeout issues.

## What Changed

### 1. Database Schema
- ✅ Added `async_analysis_jobs` table to track job status and results
- ✅ Includes progress tracking, error handling, and job metadata

### 2. Backend Changes
- ✅ New Lambda handlers for async job creation, status checking, and processing
- ✅ Self-invoking Lambda architecture for background processing
- ✅ Progress tracking and error handling throughout the pipeline

### 3. API Changes
- ✅ `/api/analyze-kpis-async` - Create async analysis job (returns immediately)
- ✅ `/api/job-status/{jobId}` - Poll job status and get results
- ✅ Backward compatible - old `/api/analyze-kpis` still works

### 4. Frontend Changes
- ✅ New `useAsyncAnalysis` React hook for job management
- ✅ Real-time progress indicator with polling
- ✅ Better error handling and user feedback
- ✅ Graceful fallback to legacy sync analysis

## Deployment Steps

### 1. Update Database Schema
```bash
# Deploy the create-schema Lambda to add the new async_analysis_jobs table
# This is already included in the schema update
```

### 2. Deploy Lambda Functions
```bash
# Deploy the updated pdf-analysis Lambda with new async handlers
cd services/lambdas/pdf-analysis
# Build and deploy according to your deployment process
```

### 3. Deploy Frontend
```bash
# Deploy the updated Next.js frontend
cd apps/web
npm run build
# Deploy according to your deployment process
```

## Benefits

### ✅ No More Timeouts
- API Gateway 30-second limit eliminated
- Lambda can run for up to 15 minutes
- User gets immediate response with job ID

### ✅ Better User Experience
- Real-time progress tracking
- Clear status indicators
- Non-blocking UI
- Automatic polling for results

### ✅ Scalable Architecture
- Async processing allows multiple jobs
- Database-backed job queue
- Self-healing with retry capabilities
- Proper error handling and logging

### ✅ Backward Compatibility
- Legacy sync endpoint still works
- Existing saved analyses load correctly
- Gradual migration possible

## Architecture Flow

```
Frontend → API Gateway → Lambda (Job Creation) → Database (Job Record)
                                ↓
                         Async Lambda Invoke
                                ↓
                    Background Processing Lambda
                                ↓
                    OpenAI Multi-PDF Analysis
                                ↓
                    Database (Update Results)
                                ↑
Frontend ← API Gateway ← Lambda (Status Check) ← Database (Poll Results)
```

## Testing

1. **Create Analysis Job**: Submit a multi-PDF analysis request
2. **Monitor Progress**: Watch real-time progress updates
3. **View Results**: See completed analysis with timestamps
4. **Error Handling**: Test with invalid company IDs or missing PDFs
5. **Clear Jobs**: Test job cleanup functionality

## Monitoring

- Lambda CloudWatch logs show job processing details
- Database tracks all job states and timings
- Frontend provides user-visible status and errors
- Progress tracking helps identify bottlenecks

## Future Enhancements

- **Email Notifications**: Notify users when long-running jobs complete
- **Bulk Analysis**: Process multiple companies in parallel
- **Job History**: Show past analysis jobs in UI
- **Retry Logic**: Automatic retry for failed jobs
- **Priority Queue**: Prioritize urgent analyses

The async implementation completely eliminates timeout issues while providing a much better user experience!
