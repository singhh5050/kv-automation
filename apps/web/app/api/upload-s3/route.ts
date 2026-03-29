import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { auth } from '@clerk/nextjs/server'

// Server-side S3 upload API route
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const { userId } = await auth()
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in to upload files' },
        { status: 401 }
      )
    }
    
    console.log('🚀 Server-side S3 upload initiated')
    console.log('👤 Authenticated user:', userId)
    
    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File
    const companyId = formData.get('companyId') as string
    const companyName = formData.get('companyName') as string
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }
    
    console.log(`📁 Processing file: ${file.name}`)
    console.log(`🏢 Company ID: ${companyId}, Name: ${companyName}`)
    
    // Validate AWS credentials (server-side environment variables)
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('❌ AWS credentials not found in server environment')
      return NextResponse.json(
        { error: 'AWS credentials not configured' },
        { status: 500 }
      )
    }
    
    // Initialize S3 client with server-side credentials
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-west-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
    
    // Create S3 key with company_id for automatic extraction
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    let s3Key: string
    
    if (companyId && companyId !== 'undefined') {
      s3Key = `company-${companyId}/${timestamp}-${file.name}`
    } else {
      // Fallback: use temp folder if no company_id
      s3Key = `temp/${timestamp}-${file.name}`
    }
    
    console.log(`📁 S3 key: ${s3Key}`)
    
    // Prepare metadata for Lambda processing
    const metadata: Record<string, string> = {}
    if (companyId && companyId !== 'undefined') {
      metadata['company-id'] = companyId
    }
    if (companyName && companyName !== 'undefined') {
      metadata['company-name'] = companyName
    }
    
    // Convert file to Uint8Array for S3 upload
    const fileBuffer = new Uint8Array(await file.arrayBuffer())
    
    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME || 'kv-board-decks',
      Key: s3Key,
      Body: fileBuffer,
      ContentType: 'application/pdf',
      Metadata: metadata,
    })
    
    console.log(`📤 Uploading to S3...`)
    console.log(`📊 File size: ${file.size} bytes`)
    console.log(`🎯 Target bucket: ${process.env.S3_BUCKET_NAME || 'kv-board-decks'}`)
    console.log(`📁 Target key: ${s3Key}`)
    
    const result = await s3Client.send(command)
    console.log(`✅ S3 upload successful!`, result)
    console.log(`🆔 Upload ETag: ${result.ETag}`)
    
    return NextResponse.json({
      success: true,
      s3Key,
      bucket: process.env.S3_BUCKET_NAME || 'kv-board-decks',
      message: 'PDF uploaded successfully. Processing will begin automatically.',
      processingNote: 'Financial data extraction and analysis will complete within 2-3 minutes. Results will appear in the company dashboard once processing is complete.',
      etag: result.ETag,
      estimatedProcessingTime: '2-3 minutes'
    })
    
  } catch (error) {
    console.error('❌ Server-side S3 upload error:', error)
    console.error('❌ Error type:', error?.constructor?.name)
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'S3 upload failed',
        fallbackSuggestion: 'Try the legacy upload method if this persists.'
      },
      { status: 500 }
    )
  }
}
