import { NextRequest, NextResponse } from 'next/server'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { currentUser } from '@clerk/nextjs/server'

export async function POST(request: NextRequest) {
  try {
    console.log('📧 Sending milestone reminder email...')
    
    // Get email from request body
    const body = await request.json()
    const { email } = body
    
    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email address is required' },
        { status: 400 }
      )
    }

    console.log(`📤 Sending to: ${email}`)

    // Create Lambda client
    const lambda = new LambdaClient({
      region: process.env.AWS_REGION || 'us-west-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
      }
    })

    const clerkUser = await currentUser()
    const userEmail = clerkUser?.emailAddresses?.[0]?.emailAddress

    // Prepare Lambda invocation
    const command = new InvokeCommand({
      FunctionName: 'milestone-emailer',
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({
        recipient_email: email,
        user_id: userEmail
      })
    })

    console.log('🚀 Invoking Lambda function...')
    
    const result = await lambda.send(command)
    
    console.log('✅ Lambda invoked successfully')
    
    // Parse Lambda response
    const payloadString = new TextDecoder().decode(result.Payload)
    const responsePayload = JSON.parse(payloadString)
    
    if (responsePayload.statusCode === 200) {
      const body = JSON.parse(responsePayload.body)
      return NextResponse.json({
        success: true,
        message: 'Email sent successfully',
        data: body
      })
    } else {
      const body = JSON.parse(responsePayload.body)
      return NextResponse.json(
        { error: body.error || 'Failed to send email' },
        { status: 500 }
      )
    }
    
  } catch (error) {
    console.error('❌ Email sending error:', error)
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to send email',
        details: 'Check server logs for more information'
      },
      { status: 500 }
    )
  }
}

// Handle CORS preflight requests
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

