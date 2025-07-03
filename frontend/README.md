# KV Automation Frontend

Next.js-based frontend for the KV Automation financial document processing system.

## Setup

### Local Development

1. Install dependencies:
```bash
npm install
# or
pnpm install
```

2. Set up environment variables:
```bash
cp env.local.example .env.local
# Edit .env.local with your configuration
```

3. Run the development server:
```bash
npm run dev
# or
pnpm dev
```

Open http://localhost:3000 in your browser.

## Features

- PDF upload and processing
- Financial data extraction
- Company portfolio management
- Competitive landscape analysis
- Multi-report tracking per company

## Deployment to Vercel

1. Push your code to GitHub

2. Import project in Vercel:
   - Go to https://vercel.com/new
   - Import your GitHub repository
   - Configure environment variables:
     - `NEXT_PUBLIC_BACKEND_URL` - Your backend API URL

3. Deploy!

## Environment Variables

- `NEXT_PUBLIC_BACKEND_URL` - Backend API URL (e.g., https://your-backend.herokuapp.com)
- `HARMONIC_API_KEY` - Harmonic API key (if using direct API calls)

## Architecture

The frontend communicates with a Flask backend API for:
- PDF text extraction
- Financial data analysis
- Competitive landscape information

All data is stored locally in the browser using localStorage. 