/**
 * API client for connecting to the AWS Lambda backend
 */

// Get backend URL from environment
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL
if (!BACKEND_URL) {
  throw new Error('NEXT_PUBLIC_BACKEND_URL environment variable is not set')
}

interface ApiResponse<T = any> {
  data?: T
  error?: string
  metadata?: any
}

/**
 * Base API request function for Lambda endpoints
 */
async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const url = `${BACKEND_URL}${endpoint}`
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    const responseData = await response.json()

    if (!response.ok) {
      throw new Error(responseData.error || `HTTP error! status: ${response.status}`)
    }

    // Handle Lambda response structure - unwrap the nested data
    if (responseData.status === 'success' && responseData.data) {
      return { data: responseData }
    }
    
    return { data: responseData }
  } catch (error) {
    console.error('API request error:', error)
    return { error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Extract and analyze PDF content using OpenAI
 */
export async function extractPdf(pdfData: string, filename: string) {
  return apiRequest('/analyze-pdf', {
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
 * Upload file for processing - converts to base64 and calls PDF analysis
 */
export async function uploadFile(file: File) {
  try {
    // Convert file to base64
    const base64Data = await fileToBase64(file)
    
    // Remove the data:application/pdf;base64, prefix if present
    const cleanBase64 = base64Data.replace(/^data:application\/pdf;base64,/, '')
    
    // Call the PDF analysis Lambda function
    return await extractPdf(cleanBase64, file.name)
  } catch (error) {
    console.error('File upload error:', error)
    return { error: error instanceof Error ? error.message : 'File upload failed' }
  }
}

/**
 * Helper function to convert file to base64
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = error => reject(error)
  })
}

/**
 * Save financial report to database
 */
export async function saveFinancialReport(reportData: any) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'save_financial_report',
      ...reportData,
    }),
  })
}

/**
 * Get all companies from database
 */
export async function getCompanies() {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'get_companies',
    }),
  })
}

/**
 * Get reports for a specific company
 */
export async function getCompanyReports(companyId: string) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'get_company_reports',
      company_id: companyId,
    }),
  })
}

/**
 * Get company by name
 */
export async function getCompanyByName(companyName: string) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'get_company_by_name',
      company_name: companyName,
    }),
  })
}

/**
 * Create database schema
 */
export async function createDatabaseSchema() {
  return apiRequest('/schema', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

/**
 * Test database connection
 */
export async function testDatabaseConnection() {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'test_connection',
    }),
  })
}

/**
 * Health check
 */
export async function healthCheck() {
  try {
    const response = await fetch(`${BACKEND_URL}/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Get competitive landscape (if needed for future use)
 */
export async function getCompetitiveLandscape(financialData: any) {
  // This would need to be implemented as a separate Lambda function if needed
  return { error: 'Competitive landscape analysis not yet implemented in Lambda backend' }
} 