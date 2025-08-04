# KV Automation Platform: Investor Portfolio Management System

## Executive Summary

The KV Automation Platform is a sophisticated, investor-centric portfolio management system designed to automate and streamline key venture capital workflows. Built with modern cloud-native architecture, this platform enables automated analysis of board deck presentations, financial report processing, cap table management, and competitive intelligence gathering across portfolio companies.

The system leverages artificial intelligence, external data enrichment, and secure cloud infrastructure to provide comprehensive insights that enhance investment decision-making and portfolio monitoring capabilities.

## System Architecture Overview

### High-Level Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   Frontend      │    │   API Gateway    │    │   Lambda Functions  │
│   (Vercel)      │◄──►│   (AWS)          │◄──►│   (AWS)             │
│   Next.js       │    │   RESTful APIs   │    │   Python 3.11       │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
                                                           │
                       ┌──────────────────┐              │
                       │   Load Balancer  │              │
                       │   (ALB)          │              │
                       └──────────────────┘              │
                                                          │
┌─────────────────┐    ┌──────────────────┐    ┌─────────▼─────────────┐
│   Harmonic AI   │◄──►│   PostgreSQL     │◄──►│   Private Subnets    │
│   External API  │    │   RDS Database   │    │   (VPC Secured)      │
└─────────────────┘    └──────────────────┘    └──────────────────────┘
```

## Core Features & Investor Workflow Automation

### 1. Automated Board Deck Analysis
**Purpose**: Streamline the analysis of portfolio company board presentations
- **PDF Processing**: Automated extraction and parsing of board deck PDFs using OpenAI GPT models
- **Sector-Specific Analysis**: Tailored analysis based on company sectors (Healthcare, Consumer, Enterprise, Manufacturing)
- **Key Metrics Extraction**: Automatic extraction of financial metrics, cash burn rates, runway calculations
- **Milestone Tracking**: Identification and tracking of key company milestones and progress indicators

### 2. Financial Report Management
**Purpose**: Centralized financial data management and trend analysis
- **Automated Data Entry**: Reduction of manual data entry through AI-powered extraction
- **Historical Tracking**: Comprehensive database of financial reports across portfolio companies
- **Comparative Analysis**: Cross-company financial performance comparison capabilities
- **Risk Assessment**: Automated identification of financial risks and concerns

### 3. Cap Table Processing & Analysis
**Purpose**: Streamlined equity structure analysis and KV fund position tracking
- **Excel Processing**: Automated parsing of complex cap table spreadsheets
- **KV Stake Calculation**: Automatic calculation of KV fund ownership across different fund stages
- **Investor Mapping**: Comprehensive tracking of co-investors and syndicate partners
- **Equity Dilution Analysis**: Historical tracking of ownership changes across funding rounds

### 4. Company Enrichment & Intelligence
**Purpose**: Enhanced company insights through external data integration
- **Harmonic AI Integration**: Real-time company data enrichment including funding information, team details, competitive positioning
- **Competitive Landscape**: Automated generation of competitive analysis and market positioning
- **Market Intelligence**: Integration of external market data and industry trends
- **Due Diligence Support**: Comprehensive data collection for investment decision-making

### 5. Portfolio Oversight Dashboard
**Purpose**: Centralized monitoring and management interface
- **Company Filtering**: Advanced filtering by sector, stage, performance metrics
- **Visual Analytics**: Interactive company cards with key performance indicators
- **Status Monitoring**: Real-time health checks and system status indicators
- **Trend Analysis**: Historical performance tracking and trend identification

## Technical Architecture

### Frontend Layer (Vercel)
**Technology Stack**: Next.js 14, React, TypeScript, Tailwind CSS

**Key Components**:
- **Company Management Interface**: `app/page.tsx` - Main dashboard for portfolio overview
- **Company Detail Views**: `app/company/[id]/page.tsx` - Detailed company analysis
- **Interactive Components**:
  - `CompanyCard.tsx` - Portfolio company display with enriched data
  - `FileUpload.tsx` - PDF document upload interface
  - `CapTableUpload.tsx` - Excel cap table processing
  - `EditableMetric.tsx` - Interactive financial data editing

**Features**:
- **Smart Caching**: Client-side caching system (`companiesCache.ts`) for optimized performance
- **Real-time Updates**: Live data synchronization with backend services
- **Responsive Design**: Mobile-optimized interface for portfolio monitoring
- **Error Handling**: Comprehensive error states with clear user feedback [[memory:3247879]]

### Backend Services (AWS Lambda)

#### Core Lambda Functions

1. **Financial CRUD Service** (`kv-automation-financial-crud`)
   - **Purpose**: Primary database operations for financial data
   - **Operations**: Company creation, financial report management, data retrieval
   - **Database Integration**: Direct PostgreSQL connectivity via pg8000
   - **Security**: VPC-secured with dedicated security groups

2. **PDF Analysis Service** (`kv-automation-pdf-analysis`)
   - **Purpose**: AI-powered board deck analysis
   - **AI Integration**: OpenAI GPT models for document processing
   - **Sector Intelligence**: Tailored analysis prompts for different industries
   - **Output**: Structured JSON with extracted financial and operational metrics

3. **Cap Table Processor** (`kv-automation-process-cap-table`)
   - **Purpose**: Excel spreadsheet parsing and cap table analysis
   - **Processing**: Automated detection of investor stakes, round information
   - **KV Integration**: Specific logic for KV fund stake calculation
   - **Data Validation**: Comprehensive validation and error handling

4. **Harmonic Enrichment Service** (`kv-automation-harmonic-enrichment`)
   - **Purpose**: External data enrichment via Harmonic AI API
   - **Data Sources**: Company profiles, funding information, market intelligence
   - **Caching**: Intelligent caching to optimize API usage
   - **Enrichment Types**: Company details, competitive analysis, investor networks

5. **Health Check Service** (`kv-automation-health-check`)
   - **Purpose**: System monitoring and status verification
   - **Monitoring**: Database connectivity, API availability
   - **Alerts**: Proactive issue detection and reporting

6. **Database Schema Management** (`kv-automation-create-schema`)
   - **Purpose**: Database initialization and schema management
   - **Migrations**: Automated database schema updates
   - **Data Integrity**: Constraint enforcement and validation

### Database Layer (Amazon RDS PostgreSQL)

**Configuration**:
- **Engine**: PostgreSQL 17.4
- **Instance Type**: db.t3.small
- **Storage**: 20GB GP3 (expandable to 1TB)
- **Encryption**: AWS KMS encryption at rest
- **Backup**: 7-day retention with automated backups
- **Security**: Private subnet deployment with restricted access

**Schema Design**:
```sql
-- Core Tables
companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    normalized_name VARCHAR,
    sector VARCHAR(20) CHECK (sector IN ('healthcare', 'consumer', 'enterprise', 'manufacturing')),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
)

financial_reports (
    id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(id),
    file_name VARCHAR NOT NULL,
    report_date DATE,
    report_period VARCHAR,
    sector VARCHAR(20),
    cash_on_hand DECIMAL,
    monthly_burn_rate DECIMAL,
    cash_out_date DATE,
    runway INTEGER,
    budget_vs_actual TEXT,
    financial_summary TEXT,
    sector_highlight_a TEXT,  -- Sector-specific analysis
    sector_highlight_b TEXT,  -- Sector-specific analysis
    key_risks TEXT,
    personnel_updates TEXT,
    next_milestones TEXT,
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

cap_tables (
    id SERIAL PRIMARY KEY,
    company_id INTEGER REFERENCES companies(id),
    round_name VARCHAR NOT NULL,
    valuation DECIMAL,
    amount_raised DECIMAL,
    round_date DATE,
    investors JSONB,  -- Structured investor data
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

## AWS Infrastructure & Networking

### Virtual Private Cloud (VPC) Architecture

**VPC Configuration**:
- **CIDR Block**: 172.31.0.0/16 (Default VPC)
- **Region**: us-east-1
- **Multi-AZ Deployment**: High availability across 6 availability zones

### Subnet Architecture

**Public Subnets** (Internet-facing resources):
- **us-east-1c**: 172.31.80.0/20 - Application Load Balancer
- **us-east-1d**: 172.31.16.0/20 - NAT Gateway
- **us-east-1e**: 172.31.48.0/20 - ALB Secondary AZ
- **us-east-1a**: 172.31.32.0/20 - Public resources
- **us-east-1b**: 172.31.0.0/20 - Public backup
- **us-east-1f**: 172.31.64.0/20 - Public tertiary

**Private Subnets** (Secured backend resources):
- **us-east-1a**: 172.31.96.0/20 (private-subnet-1a) - RDS Primary
- **us-east-1b**: 172.31.112.0/20 (private-subnet-1b) - RDS Secondary
- **Lambda Functions**: Deployed across private subnets for security

### Security Groups Configuration

#### Application Load Balancer Security Group (`kv-alb-sg`)
```
Inbound Rules:
- Port 80 (HTTP): 0.0.0.0/0
- Port 443 (HTTPS): 0.0.0.0/0

Outbound Rules:
- All traffic: 0.0.0.0/0
```

#### Lambda Functions Security Group (`lambda-rds-access-sg`)
```
Inbound Rules: None (restrictive)
Outbound Rules:
- All traffic: 0.0.0.0/0 (for external API calls)
```

#### RDS Database Security Group (`private-subnet-rds-sg`)
```
Inbound Rules:
- Port 5432: sg-0e5b848a514d3faaf (Jump box access)
- Port 5432: sg-093b324a7d11d1858 (Lambda functions only)

Outbound Rules:
- All traffic: 0.0.0.0/0
```

#### Jump Box Security Group (`jump-box-sg`)
```
Inbound Rules:
- Port 22 (SSH): 0.0.0.0/0

Outbound Rules:
- All traffic: 0.0.0.0/0
```

### Network Routing & Internet Connectivity

#### Internet Gateway
- **Gateway ID**: igw-054ac09e6f1114806
- **Purpose**: Provides internet connectivity for public subnets
- **Attachment**: Attached to main VPC

#### NAT Gateway (`kv-nat-for-openai`)
- **Gateway ID**: nat-0580c14571ca848a1
- **Location**: Public subnet (us-east-1c)
- **Elastic IP**: 54.197.110.184
- **Purpose**: Enables Lambda functions in private subnets to access external APIs (OpenAI, Harmonic AI)

#### Route Tables

**Main Route Table** (Public subnets):
```
Destination: 172.31.0.0/16 → local
Destination: 0.0.0.0/0 → igw-054ac09e6f1114806
```

**Private Route Table** (`private-demo-rt`):
```
Destination: 172.31.0.0/16 → local
Destination: 0.0.0.0/0 → nat-0580c14571ca848a1
```

### Application Load Balancer (ALB)

**Configuration**:
- **Name**: kv-pdf-alb
- **Type**: Application Load Balancer
- **Scheme**: Internet-facing
- **DNS**: kv-pdf-alb-536586805.us-east-1.elb.amazonaws.com
- **Availability Zones**: us-east-1c, us-east-1e
- **Security**: Secured with dedicated security group
- **Purpose**: Routes PDF analysis requests to Lambda functions

### API Gateway Architecture

**Primary API** (`kv-automation-api`):
- **Type**: Regional API Gateway
- **Purpose**: Financial data processing endpoints
- **Integration**: Direct Lambda function integration
- **CORS**: Configured for cross-origin requests

**Unified API** (`kv-automation-unified-api`):
- **Type**: Edge API Gateway
- **Purpose**: Handles both board decks and cap table processing
- **Global Distribution**: Edge-optimized for global access
- **Security**: API key authentication where required

## Security Implementation

### Network Security
- **Private Subnet Isolation**: Database and sensitive Lambda functions isolated in private subnets
- **Security Group Restrictions**: Principle of least privilege access
- **VPC Endpoint Security**: Secure communication between AWS services
- **Encrypted Transit**: HTTPS/TLS encryption for all external communications

### Data Security
- **Database Encryption**: RDS encryption at rest using AWS KMS
- **Key Management**: Dedicated KMS key (88d12fa5-a8ec-46ca-b897-b9eb24cba10f)
- **Secret Management**: Environment variables for sensitive configuration
- **Access Control**: IAM roles with minimal required permissions

### API Security
- **CORS Configuration**: Proper cross-origin resource sharing setup
- **Authentication**: Secure API key management for external services
- **Rate Limiting**: Built-in API Gateway throttling and monitoring
- **Audit Logging**: Comprehensive CloudWatch logging for all services

## Deployment & Infrastructure Management

### Lambda Layer Architecture
The system utilizes several optimized Lambda layers for dependency management:

1. **Database Layer** (`pg8000-layer`): PostgreSQL connectivity
2. **PDF Processing Layer** (`pdf-openai-deps`): OpenAI and PDF processing libraries
3. **Analytics Layer** (`AWSSDKPandas-Python311`): Data analysis capabilities
4. **Cap Table Layer** (`cap-table-deps`): Excel processing dependencies
5. **Harmonic Layer** (`harmonic-requests-layer`): External API integration
6. **Google APIs Layer** (`kv-automation-google-apis`): Google Drive integration
7. **Excel Processing Layer** (`kv-automation-pandas-excel`): Spreadsheet processing

### Environment Configuration

Required environment variables for deployment:

```bash
# Frontend Configuration
NEXT_PUBLIC_BACKEND_URL=https://your-api-gateway-url

# AI Service Integration
OPENAI_API_KEY=your_openai_api_key
HARMONIC_API_KEY=your_harmonic_api_key

# Database Configuration (Lambda Environment)
DB_HOST=database-1.cgr2i0s2iki4.us-east-1.rds.amazonaws.com
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your_secure_password
DB_PORT=5432
```

### Monitoring & Observability

**CloudWatch Integration**:
- **Lambda Logs**: Comprehensive logging for all functions
- **RDS Monitoring**: Database performance and connection monitoring
- **ALB Metrics**: Load balancer health and performance tracking
- **Custom Metrics**: Business-specific KPIs and system health indicators

**Log Groups**:
- `/aws/lambda/kv-automation-pdf-analysis`
- `/aws/lambda/kv-automation-financial-crud`
- `/aws/lambda/kv-automation-harmonic-enrichment`
- `/aws/lambda/kv-automation-process-cap-table`
- `/aws/lambda/kv-automation-health-check`

## User Experience & Interface Design

### Dashboard Interface
The main portfolio dashboard provides:
- **Company Grid View**: Visual card-based company representation
- **Smart Filtering**: Sector and stage-based filtering capabilities
- **Real-time Status**: Live backend connectivity indicators
- **Progressive Loading**: Optimized data loading with caching

### Company Detail Views
Individual company pages feature:
- **Financial Timeline**: Historical financial report progression
- **Cap Table Analysis**: Visual representation of ownership structure
- **Enriched Data Display**: Integrated external data presentation
- **Interactive Editing**: In-place editing of financial metrics

### Upload & Processing Workflows
Streamlined workflows for:
- **Board Deck Upload**: Drag-and-drop PDF processing with real-time analysis
- **Cap Table Import**: Excel file processing with validation and preview
- **Batch Operations**: Efficient handling of multiple file uploads

## Business Intelligence & Analytics

### Sector-Specific Intelligence

**Healthcare Companies**:
- **Clinical Progress Tracking**: FDA interactions, trial phases, safety data
- **R&D Updates**: Preclinical studies, IP filings, competitive landscape

**Consumer Companies**:
- **Unit Economics**: CAC/LTV trends, retention rates, conversion metrics
- **Growth Initiatives**: Market expansion, channel optimization

**Enterprise Companies**:
- **Product Adoption**: Usage metrics, customer engagement, feature launches
- **Go-to-Market**: Sales pipeline, regional performance, partnerships

**Manufacturing Companies**:
- **Operational Performance**: Production metrics, quality indicators, capacity utilization
- **Supply Chain**: Supplier relationships, inventory management, contracts

### Investment Stage Analysis
The platform automatically detects and categorizes companies based on KV fund participation:

- **Early Stage**: KV Seed funds (A-Z designation)
- **Growth Stage**: KV Roman numeral funds (I-XV)
- **Late Stage**: KV Opportunity funds

### Competitive Intelligence
Automated competitive landscape analysis including:
- **Market Positioning**: Company positioning within industry segments
- **Peer Comparison**: Comparative analysis with similar companies
- **Funding Benchmarks**: Investment round comparisons and market trends
- **Team Analysis**: Leadership and key personnel tracking

## Data Flow & Integration Architecture

### Data Ingestion Pipeline
```
PDF Upload → Lambda Analysis → OpenAI Processing → Database Storage → Frontend Display
    ↓
Cap Table Upload → Excel Processing → Investor Analysis → Database Update → Dashboard Refresh
    ↓
Company Search → Harmonic API → Data Enrichment → Cache Update → UI Enhancement
```

### API Integration Patterns

**Synchronous Operations**:
- Financial report retrieval
- Company data queries
- Real-time status checks

**Asynchronous Operations**:
- PDF analysis processing
- Large cap table imports
- External data enrichment

**Batch Operations**:
- Historical data migrations
- Bulk company updates
- System-wide analytics refresh

## Performance & Scalability

### Performance Optimizations
- **Client-Side Caching**: Intelligent caching of company data and enrichment information
- **Lambda Optimization**: Optimized function sizing and timeout configurations
- **Database Indexing**: Strategic database indexes for query performance
- **CDN Integration**: Static asset delivery via Vercel's global CDN

### Scalability Considerations
- **Auto-scaling Lambda**: Automatic scaling based on request volume
- **RDS Scaling**: Database instance scaling capabilities
- **Multi-AZ Deployment**: High availability and disaster recovery
- **API Gateway Throttling**: Built-in rate limiting and traffic management

## Future Enhancements & Roadmap

### Planned Features
1. **Advanced Analytics Dashboard**: Enhanced visualizations and trend analysis
2. **Automated Reporting**: Scheduled portfolio performance reports
3. **Mobile Application**: Native mobile app for portfolio monitoring
4. **API Ecosystem**: Public API for third-party integrations
5. **ML-Powered Insights**: Predictive analytics for investment outcomes

### Technical Improvements
1. **GraphQL API**: Enhanced API flexibility and performance
2. **Real-time Updates**: WebSocket integration for live data updates
3. **Advanced Security**: Enhanced authentication and authorization
4. **Global Deployment**: Multi-region deployment for improved performance
5. **Compliance Features**: Enhanced audit trails and compliance reporting

## Conclusion

The KV Automation Platform represents a sophisticated, purpose-built solution for modern venture capital portfolio management. By combining artificial intelligence, cloud-native architecture, and investor-focused workflows, the platform significantly enhances the efficiency and effectiveness of portfolio monitoring and analysis.

The robust AWS infrastructure ensures security, scalability, and reliability, while the intelligent automation features reduce manual overhead and provide deeper insights into portfolio company performance. This comprehensive system positions KV to maintain competitive advantage through superior portfolio intelligence and operational efficiency.

---

*This documentation reflects the current system architecture and capabilities. For technical implementation details, deployment instructions, or system modifications, please refer to the individual component documentation and AWS console configurations.*
