# Internal Summary Feature - Implementation Summary

## Overview
Replaced the complex screenshot-based PDF export with a simple, text-based internal summary generator that uses OpenAI to create concise bullet-point summaries based on financial data.

## Changes Made

### 1. Lambda Function (`services/lambdas/pdf-analysis/src/handler.py`)
**Added:**
- `generate_internal_summary()` function - Queries PostgresDB for 5 most recent financial reports and generates summary using OpenAI GPT-4
- `handle_generate_internal_summary_request()` - Handler wrapper for the Lambda routing
- Added `generate_internal_summary` action to lambda_handler routing

**Data Sources:**
- **PostgresDB:** 5 most recent financial_reports (report_date, cash_on_hand, burn_rate, runway, risks, milestones, etc.)
- **Frontend:** Company metadata (KV funds, ownership %, valuation, stage, etc.)

**OpenAI Prompt Template:**
- Company name + cadence (Monthly/Quarterly/Bi-Monthly)
- Snapshot line with all key metrics
- Standardized headers: One-line Description, Update Status, Keys to Success, Risks, Key Metrics, Financial Metrics, Hiring, Runway/Burn/Cash
- Bullet points only, no prose

### 2. Next.js API Route (`apps/web/app/api/generate-summary/route.ts`)
**Created new route:**
- Accepts `company_id` and `company_data` from frontend
- Invokes pdf-analysis Lambda with action `generate_internal_summary`
- Returns plain markdown text summary

### 3. API Client (`apps/web/lib/api.ts`)
**Added:**
- `generateInternalSummary()` function to call the new API route

### 4. PdfExportModal Component (`apps/web/components/company/PdfExportModal.tsx`)
**Completely rewritten:**
- Removed all complex section configuration UI
- Removed screenshot-based PDF generation
- Added simple "Generate Internal Summary" button
- Displays generated text in a pre-formatted text box
- Added "Copy to Clipboard" functionality
- Added "Regenerate" button

**Removed:**
- `ExportConfig` interface complexity
- All subsection checkboxes
- Custom header markdown editor
- Screenshot-based PDF generation

### 5. Company Page (`apps/web/app/company/[id]/page.tsx`)
**Updated:**
- Removed `ExportConfig` import
- Removed `generatePDF` import
- Removed `handlePdfExport` function
- Removed `pdfExporting` state
- Updated `PdfExportModal` to not require `onExport` prop

## Summary Template Format

The generated summary follows this exact structure:
```
**[Company Name] — [Cadence]**

**Snapshot**: Priority | KV Fund | Total Invested | Ownership % | Total Raised | Date of Last Raise | Last Round Raised | Series | Last Post Money

**One-line Description**: [Brief description]

**Update Status**: [Status note]

**Keys to the Next 12 Months' Success**:
• [Bullet points]

**Risks**:
• [Bullet points]

**Key Metrics**:
• [Bullet points]

**Financial Metrics (YTD vs Plan)**:
• [Bullet points]

**Hiring**:
• [Bullet points]

**Runway/Burn/Cash**:
• [Bullet points]
```

## Environment Variables Required

All already configured in Lambda:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `OPENAI_API_KEY`

All already configured in Next.js/Vercel:
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`

## How to Use

1. Navigate to any company page
2. Click "Export PDF" button (will be renamed to "Generate Summary" in UI)
3. Click "Generate Internal Summary" in the modal
4. Wait 5-10 seconds for OpenAI to generate the summary
5. Copy to clipboard or regenerate as needed

## Benefits

✅ **Simple:** No complex configuration, just one button
✅ **Fast:** Generates in seconds using OpenAI
✅ **Data-Driven:** Uses actual financial data from PostgresDB
✅ **Consistent:** Follows standardized template format
✅ **Portable:** Easy to copy/paste into emails or documents
✅ **Cost-Effective:** No expensive screenshot rendering
✅ **Maintainable:** Simple text generation, easy to modify prompt

## Next Steps (Optional)

- Rename "Export PDF" button to "Generate Summary" in UI
- Add ability to download as .txt or .md file
- Add ability to email summary directly
- Cache summaries to avoid regenerating
- Add summary history/versioning

