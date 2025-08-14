# KV Automation Architecture

## System Overview

The KV Automation platform is built as a serverless architecture with the following components:

### Frontend (apps/web/)
- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Deployment**: Vercel or AWS

### Backend (services/lambdas/)
- **Runtime**: AWS Lambda (Python 3.9)
- **API**: API Gateway for HTTP endpoints
- **Database**: PostgreSQL on AWS RDS
- **Storage**: S3 for file uploads

### Infrastructure
- **IaC**: AWS CDK (TypeScript) or Serverless Framework
- **Monitoring**: CloudWatch logs and metrics
- **Security**: IAM roles and policies

## Lambda Functions

1. **financial-crud**: CRUD operations for financial data
2. **pdf-analysis**: PDF processing and AI analysis
3. **process-cap-table**: Cap table data processing
4. **google-drive-mass-import**: Bulk import from Google Drive
5. **harmonic-enrichment**: Data enrichment services
6. **health-check**: System health monitoring
7. **create-schema**: Database schema management

## Lambda Layers

1. **database**: PostgreSQL connection utilities
2. **google-apis**: Google APIs client libraries
3. **pandas-excel**: Data processing libraries

## Data Flow

1. User uploads files via Next.js frontend
2. Files stored in S3, metadata in PostgreSQL
3. Lambda functions process files asynchronously
4. Results stored in database and displayed in UI

## Investment Classification Logic

Companies are classified by their highest-stage KV investment:

- **Growth Stage** (highest): KV Opp, KV Excelsior funds
- **Main Stage**: KV I, KV II, KV III, etc. (Roman numerals)
- **Early Stage**: Any KV fund with "seed" in name (case-insensitive)

Priority order: Growth > Main > Early

## Security Considerations

- Environment variables for sensitive configuration
- IAM roles with least privilege access
- VPC configuration for database access
- HTTPS encryption for all endpoints
