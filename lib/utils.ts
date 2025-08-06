/**
 * Utility functions for the application
 */

/**
 * Normalize company name for matching and display
 * Removes legal suffixes and special characters
 */
export const normalizeCompanyName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\b(corp|corporation|inc|incorporated|ltd|limited|llc|co\.?)\b/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}