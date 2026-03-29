import { NextRequest, NextResponse } from 'next/server'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'

// API route to invoke the PDF analysis Lambda for KPI analysis asynchronously
export async function POST(request: NextRequest) {
  try {
    console.log('🚀 Async KPI analysis API route called')
    
    const body = await request.json()
    const { company_id, stage, custom_config } = body
    
    if (!company_id) {
      return NextResponse.json(
        { error: 'company_id is required' },
        { status: 400 }
      )
    }
    
    if (!stage) {
      return NextResponse.json(
        { error: 'stage is required (Early Stage, Main Stage, or Growth Stage)' },
        { status: 400 }
      )
    }
    
    console.log(`📊 Submitting async KPI analysis job for company ${company_id}, stage: ${stage}`, custom_config ? '(custom)' : '(standard)')
    
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
      region: process.env.AWS_REGION || 'us-west-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
    
    // Prepare Lambda payload for async job creation
    const payload: any = {
      action: 'create_async_kpi_job',
      company_id: parseInt(company_id),
      stage: stage
    }
    
    // Add custom config if provided
    if (custom_config) {
      payload.custom_config = custom_config
    }
    
    console.log(`📤 Invoking Lambda with async payload:`, payload)
    
    // Invoke the PDF analysis Lambda synchronously to create the job
    const command = new InvokeCommand({
      FunctionName: 'kv-automation-pdf-analysis',
      Payload: JSON.stringify(payload),
      InvocationType: 'RequestResponse' // Sync call to create job and get job ID
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
    
    // Parse the successful response with job ID
    const jobResponse = JSON.parse(lambdaResult.body)
    
    console.log(`✅ Async KPI analysis job created: ${jobResponse.job_id}`)
    
    return NextResponse.json({
      success: true,
      job_id: jobResponse.job_id,
      status: 'queued',
      message: 'Analysis job submitted successfully. Use the job_id to check status.'
    })
    
  } catch (error) {
    console.error('❌ Async KPI analysis API error:', error)
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Async KPI analysis failed',
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
