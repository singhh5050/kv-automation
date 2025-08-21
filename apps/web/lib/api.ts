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
export async function extractPdf(pdfData: string, filename: string, companyName?: string) {
  const requestBody: any = {
    pdf_data: pdfData,
    filename,
  }
  
  // Add company name and user_provided_name flag if provided
  if (companyName) {
    requestBody.company_name_override = companyName
    requestBody.user_provided_name = true
  }
  
  return apiRequest('/analyze-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })
}

/**
 * Upload file for processing - converts to base64 and calls PDF analysis
 */
export async function uploadFile(file: File, companyName?: string) {
  try {
    // Convert file to base64
    const base64Data = await fileToBase64(file)
    
    // Remove the data:application/pdf;base64, prefix if present
    const cleanBase64 = base64Data.replace(/^data:application\/pdf;base64,/, '')
    
    // Call the PDF analysis Lambda function with optional company name
    return await extractPdf(cleanBase64, file.name, companyName)
  } catch (error) {
    console.error('File upload error:', error)
    return { error: error instanceof Error ? error.message : 'File upload failed' }
  }
}

/**
 * Direct S3 Upload via Presigned URLs
 * Browser uploads directly to S3, bypassing server size limits (supports up to 5GB)
 */
export async function uploadToS3(file: File, companyId?: number, companyName?: string) {
  try {
    console.log(`🚀 Starting direct S3 upload for ${file.name}`)
    console.log(`📋 Company ID: ${companyId}, Company Name: ${companyName}`)
    console.log(`📊 File size: ${(file.size / 1024 / 1024).toFixed(2)}MB`)
    
    // Step 1: Get presigned URL from our API
    console.log(`🔗 Requesting presigned URL...`)
    const presignResponse = await fetch('/api/presign-s3', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type || 'application/pdf',
        companyId,
        companyName,
      }),
    })
    
    if (!presignResponse.ok) {
      const presignError = await presignResponse.json()
      throw new Error(presignError.error || `Failed to get presigned URL: ${presignResponse.status}`)
    }
    
    const presignData = await presignResponse.json()
    console.log(`✅ Presigned URL obtained for key: ${presignData.s3Key}`)
    
    // Step 2: Upload directly to S3 using presigned URL
    console.log(`📤 Uploading directly to S3...`)
    const uploadResponse = await fetch(presignData.presignedUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type || 'application/pdf',
      },
    })
    
    if (!uploadResponse.ok) {
      // S3 errors are typically not JSON, but plain text
      let errorMessage = `S3 upload failed (${uploadResponse.status})`
      try {
        const errorText = await uploadResponse.text()
        errorMessage += `: ${errorText.slice(0, 200)}`
      } catch {
        // If we can't read the error text, use the status
      }
      throw new Error(errorMessage)
    }
    
    console.log(`✅ Direct S3 upload successful!`)
    console.log(`🆔 S3 ETag: ${uploadResponse.headers.get('ETag')}`)
    
    return {
      data: {
        success: true,
        s3Key: presignData.s3Key,
        bucket: presignData.bucket,
        message: 'PDF uploaded successfully to S3. Processing will begin automatically.',
        processingNote: 'Results will appear in the database shortly.',
        etag: uploadResponse.headers.get('ETag'),
        uploadMethod: 'direct-s3'
      }
    }
    
  } catch (error) {
    console.error('❌ Direct S3 upload error:', error)
    console.error('❌ Error type:', error?.constructor?.name)
    
    return { 
      error: error instanceof Error ? error.message : 'S3 upload failed',
      fallbackSuggestion: 'Try refreshing and uploading again. Contact support if the issue persists.',
      errorDetails: error
    }
  }
}

/**
 * Helper function to convert file to base64 (legacy method)
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
 * Save cap table round data
 */
export async function saveCapTableRound(capTableData: any) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'save_cap_table_round',
      ...capTableData,
    }),
  })
}

/**
 * Get complete company overview (cap table + financial reports)
 */
export async function getCompanyOverview(companyId: string) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'get_company_overview',
      company_id: companyId,
    }),
  })
}

/**
 * Process cap table XLSX file and extract data
 */
export async function processCapTableXlsx(xlsxData: { xlsx_data: string, filename: string }, companyName?: string) {
  const requestBody: any = {
    operation: 'process_cap_table_xlsx',
    ...xlsxData,
  }
  
  // Add company name and user_provided_name flag if provided
  if (companyName) {
    requestBody.company_name_override = companyName
    requestBody.user_provided_name = true
  }
  
  return apiRequest('/process-cap-table', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })
}

/**
 * Get competitive landscape (if needed for future use)
 */
export async function getCompetitiveLandscape(financialData: any) {
  // This would need to be implemented as a separate Lambda function if needed
  return { error: 'Competitive landscape analysis not yet implemented in Lambda backend' }
} 

/**
 * Update financial metrics for a specific report
 */
export async function updateFinancialMetrics(reportId: number, updates: Record<string, any>) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'update_financial_metrics',
      report_id: reportId,
      updates: updates,
    }),
  })
}

/**
 * Update company information
 */
export async function updateCompany(companyId: number, updates: Record<string, any>) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'update_company',
      company_id: companyId,
      updates: updates,
    }),
  })
}

/**
 * Update cap table round information
 */
export async function updateCapTableRound(roundId: number, updates: Record<string, any>) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'update_cap_table_round',
      round_id: roundId,
      updates: updates,
    }),
  })
}

/**
 * Update cap table investor information
 */
export async function updateCapTableInvestor(investorId: number, updates: Record<string, any>) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'update_cap_table_investor',
      investor_id: investorId,
      updates: updates,
    }),
  })
}

/**
 * Get all database data for a company (comprehensive editing view)
 */
export async function getAllCompanyData(companyId: string) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'get_all_company_data',
      company_id: companyId,
    }),
  })
}

/**
 * Enrich company data using Harmonic AI
 */
export async function enrichCompany(companyId: string, identifier: { key: string; value: string }) {
  return apiRequest('/harmonic-enrichment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      company_id: companyId,
      [identifier.key]: identifier.value,
    }),
  })
}

/**
 * Get existing enrichment data for a company
 */
export async function getCompanyEnrichment(companyId: string) {
  return apiRequest('/harmonic-enrichment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'get_company_enrichment',
      company_id: companyId,
    }),
  })
}

/**
 * Enrich person data using Harmonic AI (secure backend call)
 */
export async function enrichPerson(personUrn: string) {
  return apiRequest('/harmonic-enrichment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'enrich_person',
      person_urn: personUrn,
    }),
  })
}

/**
 * Delete a company and all its associated data
 */
export async function deleteCompany(companyId: string) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'delete_company',
      company_id: companyId,
    }),
  })
}

/**
 * Get company names for dropdown selection
 */
export async function getCompanyNames() {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'get_company_names',
    }),
  })
}

// ────────────────────────────────────────────────────────────
// COMPANY NOTES API FUNCTIONS
// ────────────────────────────────────────────────────────────

/**
 * Get all notes for a specific company
 */
export async function getCompanyNotes(companyId: string) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'get_company_notes',
      company_id: companyId,
    }),
  })
}

/**
 * Create a new note for a company
 */
export async function createCompanyNote(companyId: string, noteData: { subject: string; content: string }) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'create_company_note',
      company_id: companyId,
      ...noteData,
    }),
  })
}

/**
 * Update an existing company note
 */
export async function updateCompanyNote(noteId: number, updates: { subject?: string; content?: string }) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'update_company_note',
      note_id: noteId,
      updates,
    }),
  })
}

/**
 * Delete a company note
 */
export async function deleteCompanyNote(noteId: number) {
  return apiRequest('/financial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'delete_company_note',
      note_id: noteId,
    }),
  })
} 