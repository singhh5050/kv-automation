/**
 * API client for connecting to the Flask backend
 */

// Get backend URL from environment or use localhost for development
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000'

interface ApiResponse<T = any> {
  data?: T
  error?: string
  metadata?: any
}

/**
 * Base API request function
 */
async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const url = `${BACKEND_URL}/api${endpoint}`
    
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || `HTTP error! status: ${response.status}`)
    }

    return { data }
  } catch (error) {
    console.error('API request error:', error)
    return { error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Extract PDF content
 */
export async function extractPdf(pdfData: string, filename: string) {
  return apiRequest('/extract-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pdf_data: pdfData,
      filename,
    }),
  })
}

/**
 * Upload file for processing
 */
export async function uploadFile(file: File) {
  const formData = new FormData()
  formData.append('file', file)

  return apiRequest('/upload', {
    method: 'POST',
    body: formData,
  })
}

/**
 * Get competitive landscape
 */
export async function getCompetitiveLandscape(financialData: any) {
  return apiRequest('/competitive-landscape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      financial_data: financialData,
    }),
  })
}

/**
 * Health check
 */
export async function healthCheck() {
  try {
    const response = await fetch(`${BACKEND_URL}/health`)
    return response.ok
  } catch {
    return false
  }
} 