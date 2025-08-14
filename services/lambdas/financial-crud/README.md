# Financial CRUD Lambda

CRUD operations for financial data management.

## Purpose
Handles create, read, update, and delete operations for financial records in the database.

## Inputs
- HTTP requests via API Gateway
- JSON payloads with financial data

## Outputs
- JSON responses with operation results
- HTTP status codes

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string
- `LOG_LEVEL`: Logging level (default: INFO)

## Dependencies
See `requirements.txt` for Python dependencies.

## Testing
```bash
pytest tests/
```
