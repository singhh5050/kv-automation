# KV Automation

A monorepo containing Next.js frontend and AWS Lambda backend services for KV's investment automation platform.

## Repository Structure

```
├── apps/web/              # Next.js application
├── services/lambdas/      # AWS Lambda functions  
├── services/layers/       # AWS Lambda layers
├── infra/                 # Infrastructure as Code
├── scripts/               # Build and deployment scripts
├── docs/                  # Documentation
└── examples/              # Example files and test data
```

## Getting Started

### Prerequisites
- Node.js 18+ and npm
- Python 3.9+
- AWS CLI (for deployment)

### Development Setup

1. Install dependencies:
   ```bash
   npm install
   cd apps/web && npm install
   ```

2. Set up environment:
   ```bash
   cp apps/web/.env.example apps/web/.env.local
   # Edit .env.local with your configuration
   ```

3. Start development:
   ```bash
   npm run dev
   ```

## Available Scripts

```bash
npm run dev          # Start Next.js dev server
npm run build        # Build for production
npm run lint         # Run ESLint
npm run lambda:build # Build all Lambda functions
```

## Architecture

- **Frontend**: Next.js 14 with App Router, TypeScript, Tailwind CSS
- **Backend**: AWS Lambda functions, PostgreSQL database
- **Infrastructure**: AWS CDK or Serverless Framework

## Investment Stage Classification

The system classifies investments by fund type:
- **Early Stage**: KV funds with "seed" in name
- **Main Stage**: KV Roman numeral funds (KV I, II, III, etc.)
- **Growth Stage**: KV Opp or KV Excelsior funds

Priority: Growth > Main > Early (highest stage wins for multi-fund companies)

## Contributing

1. Create feature branch
2. Make changes with tests
3. Run linting: `npm run lint`
4. Submit pull request

Private repository - KV Internal Use Only