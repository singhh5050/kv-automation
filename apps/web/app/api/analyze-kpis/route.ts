import { NextRequest, NextResponse } from 'next/server'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'

// API route to invoke the PDF analysis Lambda for KPI analysis
export async function POST(request: NextRequest) {
  try {
    console.log('🔍 KPI analysis API route called')
    
    const body = await request.json()
    const { company_id, stage } = body
    
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
    
    console.log(`📊 Analyzing KPIs for company ${company_id}, stage: ${stage}`)
    
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
    
    // Prepare Lambda payload
    const payload = {
      action: 'analyze_kpis',
      company_id: parseInt(company_id),
      stage: stage
    }
    
    console.log(`📤 Invoking Lambda with payload:`, payload)
    
    // Invoke the PDF analysis Lambda
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
    const analysisResult = JSON.parse(lambdaResult.body)
    
    console.log('✅ KPI analysis completed successfully')
    
    return NextResponse.json(analysisResult)
    
  } catch (error) {
    console.error('❌ KPI analysis API error:', error)
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'KPI analysis failed',
        details: 'Check server logs for more information'
      },
      { status: 500 }
    )
  }
}

// Handle CORS preflight requests
export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
