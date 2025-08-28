import { NextRequest, NextResponse } from 'next/server'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'

// API route to check the status of an async analysis job
export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params
    
    if (!jobId) {
      return NextResponse.json(
        { error: 'jobId is required' },
        { status: 400 }
      )
    }
    
    console.log(`🔍 Checking status for job: ${jobId}`)
    
    // Validate AWS credentials
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.error('❌ AWS credentials not found in server environment')
      return NextResponse.json(
        { error: 'AWS credentials not configured' },
        { status: 500 }
      )
    }
    
    // Initialize Lambda client
    const lambdaClient = new LambdaClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
    
    // Prepare Lambda payload for status check
    const payload = {
      action: 'get_job_status',
      job_id: jobId
    }
    
    console.log(`📤 Checking job status with payload:`, payload)
    
    // Invoke the Lambda to get job status
    const command = new InvokeCommand({
      FunctionName: 'kv-automation-pdf-analysis',
      Payload: JSON.stringify(payload),
      InvocationType: 'RequestResponse'
    })
    
    const lambdaResponse = await lambdaClient.send(command)
    
    if (!lambdaResponse.Payload) {
      throw new Error('No payload returned from Lambda')
    }
    
    // Parse Lambda response
    const responseString = new TextDecoder().decode(lambdaResponse.Payload)
    const lambdaResult = JSON.parse(responseString)
    
    console.log(`📥 Lambda response status: ${lambdaResult.statusCode}`)
    
    if (lambdaResult.statusCode !== 200) {
      const errorBody = JSON.parse(lambdaResult.body)
      throw new Error(errorBody.error || 'Lambda execution failed')
    }
    
    // Parse the successful response
    const statusResponse = JSON.parse(lambdaResult.body)
    
    console.log(`✅ Job status retrieved: ${statusResponse.status}`)
    
    return NextResponse.json(statusResponse)
    
  } catch (error) {
    console.error('❌ Job status API error:', error)
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to get job status',
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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
