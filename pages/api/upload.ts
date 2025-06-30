import { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'
import path from 'path'

import OpenAI from 'openai'

// Disable body parsing for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
}

interface ExtractedData {
  companyName: string
  reportDate: string
  reportPeriod: string
  filename: string
  cashOnHand: string
  monthlyBurnRate: string
  cashOutDate: string
  runway: string
  budgetVsActual: string
  financialSummary: string
  clinicalProgress: string
  researchDevelopment: string
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Helper function to get the correct base URL for the current deployment
function getBaseUrl(req: NextApiRequest) {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  // fallback: use the host from the request (current deployment)
  const host = req.headers.host!
  return `https://${host}`
}

// PDF extraction using Python - hybrid approach for local dev and Vercel
async function extractPdfWithPython(filePath: string, fileName: string, req: NextApiRequest): Promise<{ text: string, tables: any[], metadata: any }> {
  // Check if we're running on Vercel (production) or locally
  const isVercel = process.env.VERCEL === '1'
  
  if (isVercel) {
    // Production: Call Python serverless function with proper URL construction
    try {
      const pdfBuffer = fs.readFileSync(filePath)
      const pdfBase64 = pdfBuffer.toString('base64')
      
      // Get the current request's origin to construct the proper URL
      const baseUrl = getBaseUrl(req)
      
      console.log('Making request to Python function at:', `${baseUrl}/api/extract-pdf`)
      
      // Try Python endpoint first
      let response = await fetch(`${baseUrl}/api/extract-pdf`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'User-Agent': 'kv-automation-internal'
        },
        body: JSON.stringify({
          pdf_data: pdfBase64,
          filename: fileName
        }),
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(25000) // 25 second timeout
      }).catch(async (error) => {
        console.error('Python endpoint failed, trying Node.js fallback:', error)
        // Fallback to Node.js endpoint
        return fetch(`${baseUrl}/api/extract-pdf-node`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'User-Agent': 'kv-automation-internal'
          },
          body: JSON.stringify({
            pdf_data: pdfBase64,
            filename: fileName
          })
        })
      })
      
      console.log('PDF extraction response status:', response.status)
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('PDF extraction API error:', response.status, errorText)
        // Don't throw here, let it fall through to OpenAI extraction
        return {
          text: '',
          tables: [],
          metadata: { filename: fileName, pages: 0, error: `HTTP ${response.status}: ${errorText}` }
        }
      }
      
      const result = await response.json()
      console.log('PDF extraction result:', result.metadata || 'No metadata')
      
      // If there's an error or no text, it will fall through to OpenAI
      if (result.error && !result.text) {
        console.log('PDF extraction returned error, will use OpenAI fallback')
        return {
          text: '',
          tables: [],
          metadata: { filename: fileName, pages: 0, error: result.error }
        }
      }
      
      return result
    } catch (error) {
      console.error('Vercel PDF extraction error:', error)
      // Return empty result to trigger OpenAI fallback
      return {
        text: '',
        tables: [],
        metadata: { filename: fileName, pages: 0, error: String(error) }
      }
    }
  } else {
    // Local development: Use original Python script approach
    const { spawn } = require('child_process')
    
    return new Promise((resolve, reject) => {
      const pythonScript = path.join(process.cwd(), 'pdf_extractor.py')
      const pythonProcess = spawn('python3', [pythonScript, filePath, '--filename', fileName])
      
      let output = ''
      let errorOutput = ''
      
      pythonProcess.stdout.on('data', (data: Buffer) => {
        output += data.toString()
      })
      
      pythonProcess.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString()
      })
      
      pythonProcess.on('close', (code: number | null) => {
        if (code !== 0) {
          console.error('Python script error:', errorOutput)
          reject(new Error(`Python script exited with code ${code}: ${errorOutput}`))
          return
        }
        
        try {
          const result = JSON.parse(output)
          if (result.error) {
            reject(new Error(result.error))
          } else {
            resolve(result)
          }
        } catch (parseError) {
          console.error('JSON parsing error:', parseError)
          console.error('Raw output:', output)
          reject(new Error(`Failed to parse Python output: ${parseError}`))
        }
      })
      
      pythonProcess.on('error', (error: Error) => {
        console.error('Failed to start Python process:', error)
        reject(new Error(`Failed to start Python process: ${error.message}`))
      })
    })
  }
}

// AI-powered extraction function using OpenAI
async function extractFinancialData(text: string, fileName: string): Promise<ExtractedData> {
  // Check if OpenAI API key is available
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OpenAI API key not found. Cannot perform extraction.')
    throw new Error('OpenAI API key not configured.')
  }
  const prompt = `You are a financial analyst specializing in biotech and healthcare companies. Analyze the following PDF content and extract key financial and business information.

PDF Filename: ${fileName}
PDF Content:
${text}

Please extract and analyze the information to provide a comprehensive company overview. Return your response as a JSON object with the following structure:

{
  "companyName": "Exact company name as it appears in the document (standardize variations like 'Corp' vs 'Corporation')",
  "reportDate": "Document date in YYYY-MM-DD format (extract from headers, footers, or content)",
  "reportPeriod": "Reporting period (e.g., 'Q3 2024', 'March 2024', 'H1 2024')",
  "cashOnHand": "Current cash position (format: $XXXk or $X.XM)",
  "monthlyBurnRate": "Monthly cash burn rate (format: $XXXk)",
  "cashOutDate": "Estimated cash out date (format: MM/DD/YYYY)",
  "runway": "Cash runway in months (format: XX months)",
  "budgetVsActual": "Budget performance status (On Track/Over Budget/Under Budget)",
  "financialSummary": "Single string containing detailed financial analysis focused on: 1) Current cash position and burn rate trends 2) Key financial metrics and ratios 3) Operational expense breakdown 4) Funding history and capital structure",
  "clinicalProgress": "Single string containing detailed clinical development status: 1) Trial phases with exact enrollment numbers (e.g., 45/100 patients enrolled) 2) Primary/secondary endpoint data with p-values 3) Specific trial locations and sites 4) Precise timeline of completed milestones (MM/DD/YYYY) 5) Next expected data readouts with exact dates 6) Regulatory submissions/approvals with dates",
  "researchDevelopment": "Single string containing R&D metrics: 1) Active programs with development phase and indication 2) Success rates for each phase 3) Detailed timeline of technical milestones achieved 4) Specific platform capabilities with validation data 5) R&D headcount and allocation 6) Patent portfolio metrics (counts, expiration dates) 7) Collaboration details with specific terms"
}

Analysis Guidelines:
1. For companyName: Extract the exact legal entity name from headers, logos, or document metadata. Standardize common variations (Corp/Corporation, Inc/Incorporated, Ltd/Limited)
2. For reportDate: Look for date patterns in headers, footers, "As of [Date]", or document properties. Use YYYY-MM-DD format
3. For reportPeriod: Extract quarterly references (Q1 2024), monthly (March 2024), or other period indicators from the document
4. Extract actual financial figures when available in the document
5. For missing data, provide reasonable estimates based on company stage and context
6. Focus on biotech/healthcare specific metrics and terminology
7. Include specific dates, numbers, and concrete details when available
8. Each section should be 3-4 paragraphs with bullet points for key items
9. Use professional financial and clinical terminology
10. Calculate runway as: Cash on Hand ÷ Monthly Burn Rate
11. Set cash out date as: Current Date + Runway months

CRITICAL: Each summary field (financialSummary, clinicalProgress, etc.) must be a SINGLE STRING, not an object or array. Format as plain text with line breaks (\\n) for paragraphs.

Return ONLY the JSON object with string values, no additional text or formatting.`

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4-1106-preview", // Using latest GPT-4 model (o3 not yet available)
      messages: [
        {
          role: "system",
          content: "You are a precise financial analyst. Return only valid JSON objects without any additional formatting or text."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3, // Lower temperature for more consistent financial analysis
      max_tokens: 4000
    })

    const response = completion.choices[0]?.message?.content
    if (!response) {
      throw new Error('No response from OpenAI')
    }

    console.log('OpenAI response for', fileName, ':', response.substring(0, 200) + '...')

    // Clean the response by removing markdown code blocks if present
    let cleanResponse = response.trim()
    if (cleanResponse.startsWith('```json')) {
      cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    } else if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }
    
    // Parse JSON response
    const rawData = JSON.parse(cleanResponse)
    
    // Clean and validate the data, ensuring all summary fields are strings
    const extractedData: ExtractedData = {
      companyName: rawData.companyName || fileName.replace('.pdf', '').replace(/[_-]/g, ' ')
        .split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
      reportDate: rawData.reportDate || new Date().toISOString().split('T')[0],
      reportPeriod: rawData.reportPeriod || 'Unknown Period',
      filename: fileName,
      cashOnHand: rawData.cashOnHand || 'N/A',
      monthlyBurnRate: rawData.monthlyBurnRate || 'N/A',
      cashOutDate: rawData.cashOutDate || 'N/A',
      runway: rawData.runway || 'N/A',
      budgetVsActual: rawData.budgetVsActual || 'N/A',
      financialSummary: typeof rawData.financialSummary === 'string' 
        ? rawData.financialSummary 
        : JSON.stringify(rawData.financialSummary || 'Financial summary not available'),
      clinicalProgress: typeof rawData.clinicalProgress === 'string' 
        ? rawData.clinicalProgress 
        : JSON.stringify(rawData.clinicalProgress || 'Clinical progress not available'),
      researchDevelopment: typeof rawData.researchDevelopment === 'string' 
        ? rawData.researchDevelopment 
        : JSON.stringify(rawData.researchDevelopment || 'R&D information not available')
    }
    
    return extractedData

  } catch (error) {
    console.error('OpenAI API Error for file', fileName, ':', error)
    // Re-throw the error to be caught by the main handler
    throw new Error(`Failed to extract data using OpenAI: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
    })

    const [fields, files] = await form.parse(req)
    const file = Array.isArray(files.file) ? files.file[0] : files.file

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    console.log('Processing file:', file.originalFilename)

    // Extract PDF data using Python pdfplumber
    let pdfData
    try {
      pdfData = await extractPdfWithPython(file.filepath, file.originalFilename || 'Unknown', req)
      // If there's no text, we can't proceed with OpenAI
      if (!pdfData.text || pdfData.text.trim().length === 0) {
        throw new Error('PDF text extraction failed or returned empty content.')
      }
      console.log('PDF data extracted with pdfplumber, text length:', pdfData.text.length, 'tables found:', pdfData.tables.length)
    } catch (error) {
      console.error('PDF extraction failed, aborting for this file:', error)
      // Clean up temporary file
      fs.unlinkSync(file.filepath)
      return res.status(500).json({ 
        error: `Failed to extract text from PDF. ${error instanceof Error ? error.message : String(error)}`
      })
    }
    
    // Extract financial data using OpenAI
    const extractedData = await extractFinancialData(pdfData.text, file.originalFilename || 'Unknown')
    
    console.log('Data extracted for:', extractedData.companyName)
    
    // Clean up temporary file
    fs.unlinkSync(file.filepath)
    
    res.status(200).json(extractedData)
  } catch (error) {
    console.error('Error processing PDF:', error)
    // Ensure file path exists before unlinking
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024,
    });
    const [fields, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (file && file.filepath && fs.existsSync(file.filepath)) {
      fs.unlinkSync(file.filepath);
    }
    res.status(500).json({ error: `Error processing PDF: ${error instanceof Error ? error.message : String(error)}` })
  }
} 