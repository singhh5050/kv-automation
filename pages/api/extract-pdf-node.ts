import { NextApiRequest, NextApiResponse } from 'next'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

interface ExtractResult {
  text: string
  tables: any[]
  metadata: {
    filename: string
    pages: number
    tables_found: number
  }
  error?: string
}

// Dynamic import to avoid build issues
async function getPdfParse() {
  try {
    const pdfParse = await import('pdf-parse')
    return pdfParse.default || pdfParse
  } catch (error) {
    console.error('Failed to import pdf-parse:', error)
    return null
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { pdf_data, filename } = req.body

    if (!pdf_data) {
      return res.status(400).json({ error: 'No PDF data provided' })
    }

    // Try to use pdf-parse for text extraction
    const pdfParse = await getPdfParse()
    
    if (pdfParse) {
      try {
        // Convert base64 to buffer
        const pdfBuffer = Buffer.from(pdf_data, 'base64')
        
        // Parse PDF
        const data = await pdfParse(pdfBuffer)
        
        const result: ExtractResult = {
          text: data.text || '',
          tables: [], // pdf-parse doesn't extract tables
          metadata: {
            filename: filename || 'document.pdf',
            pages: data.numpages || 0,
            tables_found: 0
          }
        }
        
        console.log(`PDF parsed successfully: ${filename}, pages: ${data.numpages}, text length: ${data.text?.length || 0}`)
        
        return res.status(200).json(result)
      } catch (parseError) {
        console.error('PDF parsing error:', parseError)
        // Fall through to error response
      }
    }
    
    // If pdf-parse is not available or parsing failed
    const result: ExtractResult = {
      text: '', // Empty text to trigger OpenAI fallback
      tables: [],
      metadata: {
        filename: filename || 'document.pdf',
        pages: 0,
        tables_found: 0
      },
      error: 'PDF extraction failed in Node.js endpoint. Will use OpenAI fallback.'
    }

    return res.status(200).json(result)
  } catch (error) {
    console.error('Error in extract-pdf-node:', error)
    return res.status(500).json({ 
      error: `Error processing request: ${error instanceof Error ? error.message : 'Unknown error'}`,
      text: '',
      tables: [],
      metadata: {
        filename: req.body.filename || 'document.pdf',
        pages: 0,
        tables_found: 0
      }
    })
  }
} 