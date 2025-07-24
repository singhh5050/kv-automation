# Minimal Database Changes for Sector-Specific Analysis

## Database Schema Changes

### 1. Companies Table - Add Sector Field
```sql
ALTER TABLE companies 
ADD COLUMN sector VARCHAR(20) CHECK (sector IN ('healthcare', 'consumer', 'enterprise', 'manufacturing'));
```

### 2. Financial Reports Table - Replace Biotech-Specific Fields
```sql
-- Replace existing columns
ALTER TABLE financial_reports 
RENAME COLUMN clinical_progress TO sector_highlight_a;

ALTER TABLE financial_reports 
RENAME COLUMN research_development TO sector_highlight_b;

-- Update any existing data migration script
UPDATE financial_reports 
SET sector_highlight_a = clinical_progress,
    sector_highlight_b = research_development
WHERE clinical_progress IS NOT NULL OR research_development IS NOT NULL;
```

## Code Changes Required

### 1. PDF Analysis Lambda (`backend/pdf-analysis/lambda_pdf_analysis.py`)
- Update system prompt to use the new sector-specific prompt
- Add sector detection logic
- Map sector to appropriate highlight categories
- Update JSON response structure

### 2. Financial CRUD Lambda
- Update field mappings from `clinical_progress`/`research_development` to `sector_highlight_a`/`sector_highlight_b`
- Add sector field handling
- Update validation logic

### 3. Frontend Components
- Update field labels to be dynamic based on sector
- Add sector selection/display
- Update form validation

## Benefits of This Approach

1. **Minimal Schema Impact**: Only 1 new field + 2 renamed fields
2. **Backward Compatibility**: Existing data is preserved through renaming
3. **Generic Field Names**: `sector_highlight_a` and `sector_highlight_b` work for all sectors
4. **Clean Separation**: Sector logic is in the application layer, not hardcoded in database

## Implementation Priority

1. **High Priority**: Update PDF analysis lambda with new prompt
2. **Medium Priority**: Add sector field to companies table
3. **Low Priority**: Update frontend labels to be dynamic
4. **Cleanup**: Rename database fields (can be done last for backward compatibility)

This approach keeps the "bloated" financial CRUD lambda mostly unchanged - only field name updates needed. 