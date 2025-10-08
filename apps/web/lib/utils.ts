/**
 * Utility functions for the application
 */

/**
 * Normalize company name for matching and display
 * Should be identical to actual name, but lowercased only
 */
export const normalizeCompanyName = (name: string): string => {
  return (name || '').toLowerCase().trim()
}

/**
 * Strip timestamp prefix from S3 file names
 * Example: "2025-10-08T12-04-19-154Z-2025-08-30T00-36-06-685Z-20250827_BOD_CorporateUpdate.pdf"
 * Returns: "20250827_BOD_CorporateUpdate.pdf"
 */
export const cleanFileName = (fileName: string | null | undefined): string => {
  if (!fileName) return 'N/A'
  
  // Pattern to match timestamp prefix: YYYY-MM-DDTHH-MM-SS-MMMZ-
  // We want to remove all timestamp prefixes before the actual filename
  // The actual filename typically starts after the last timestamp
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/g
  
  // Keep removing timestamp prefixes until there are none left
  let cleaned = fileName
  let previousCleaned = ''
  
  while (cleaned !== previousCleaned && timestampPattern.test(cleaned)) {
    previousCleaned = cleaned
    cleaned = cleaned.replace(timestampPattern, '')
  }
  
  return cleaned
}