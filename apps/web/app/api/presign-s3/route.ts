import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Generate presigned URLs for direct browser-to-S3 uploads
export async function POST(request: NextRequest) {
  try {
    console.log('🔗 Generating presigned URL for direct S3 upload')
    
    const body = await request.json()
    const { fileName, fileType, companyId, companyName } = body
    
    if (!fileName || !fileType) {
      return NextResponse.json(
        { error: 'fileName and fileType are required' },
        { status: 400 }
      )
    }
    
    // Validate AWS credentials
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('❌ AWS credentials not found in server environment')
      console.error('📋 Available env vars:', Object.keys(process.env).filter(k => k.startsWith('AWS')))
      return NextResponse.json(
        { 
          error: 'AWS credentials not configured',
          details: 'Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in Vercel environment variables',
          requiredVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET_NAME']
        },
        { status: 500 }
      )
    }
    
    // Initialize S3 client
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
    
    // Create S3 key with company_id for automatic extraction
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    let s3Key: string
    
    if (companyId && companyId !== 'undefined') {
      s3Key = `company-${companyId}/${timestamp}-${fileName}`
    } else {
      // Fallback: use temp folder if no company_id
      s3Key = `temp/${timestamp}-${fileName}`
    }
    
    console.log(`📁 Generating presigned URL for S3 key: ${s3Key}`)
    
    // Prepare metadata for Lambda processing
    const metadata: Record<string, string> = {}
    if (companyId && companyId !== 'undefined') {
      metadata['company-id'] = companyId.toString()
    }
    if (companyName && companyName !== 'undefined') {
      metadata['company-name'] = companyName
    }
    
    // Create the command for presigned URL
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME || 'kv-board-decks-prod',
      Key: s3Key,
      ContentType: fileType,
      Metadata: metadata,
    })
    
    // Generate presigned URL (valid for 10 minutes)
    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 600, // 10 minutes
    })
    
    console.log(`✅ Presigned URL generated successfully`)
    console.log(`🎯 Target bucket: ${process.env.S3_BUCKET_NAME || 'kv-board-decks-prod'}`)
    console.log(`📁 Target key: ${s3Key}`)
    
    return NextResponse.json({
      success: true,
      presignedUrl,
      s3Key,
      bucket: process.env.S3_BUCKET_NAME || 'kv-board-decks-prod',
      message: 'Presigned URL generated successfully',
      expiresIn: 600
    })
    
  } catch (error) {
    console.error('❌ Presigned URL generation error:', error)
    console.error('❌ Error type:', error?.constructor?.name)
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to generate presigned URL',
      },
      { status: 500 }
    )
  }
}
