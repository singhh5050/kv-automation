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