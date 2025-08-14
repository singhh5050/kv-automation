# PDF Analysis Lambda

Processes PDF documents to extract financial information and generate AI-powered summaries.

## Purpose
- Extract text and tables from PDF documents
- Analyze financial data using AI
- Generate structured summaries

## Inputs
- PDF files (via S3 or direct upload)
- Analysis parameters

## Outputs
- Extracted text and data
- Financial analysis results
- Structured JSON summaries

## Environment Variables
- `OPENAI_API_KEY`: OpenAI API key for analysis
- `S3_BUCKET`: S3 bucket for PDF storage
- `DATABASE_URL`: Database connection for results

## Dependencies
- pdf-parse for PDF processing
- OpenAI client for analysis
- Database connection layer

## Testing
```bash
pytest tests/
```
