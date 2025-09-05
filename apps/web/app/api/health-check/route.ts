import { NextRequest, NextResponse } from 'next/server'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'

// API route to invoke the PDF analysis Lambda for health check analysis
export async function POST(request: NextRequest) {
  try {
    console.log('🏥 Health check API route called')
    
    const body = await request.json()
    const { company_id, criticality_level, manual_score } = body
    
    if (!company_id) {
      return NextResponse.json(
        { error: 'company_id is required' },
        { status: 400 }
      )
    }
    
    if (criticality_level !== undefined && (criticality_level < 1 || criticality_level > 10)) {
      return NextResponse.json(
        { error: 'criticality_level must be between 1 and 10' },
        { status: 400 }
      )
    }
    
    if (manual_score && !['GREEN', 'YELLOW', 'RED'].includes(manual_score)) {
      return NextResponse.json(
        { error: 'manual_score must be GREEN, YELLOW, or RED' },
        { status: 400 }
      )
    }
    
    console.log(`🏥 Health check for company ${company_id}, criticality: ${criticality_level || 'default'}, manual: ${manual_score || 'none'}`)
    
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
    const payload: any = {
      action: 'health_check',
      company_id: parseInt(company_id)
    }
    
    // Add optional parameters
    if (criticality_level !== undefined) {
      payload.criticality_level = criticality_level
    }
    
    if (manual_score) {
      payload.manual_score = manual_score
    }
    
    console.log(`📤 Invoking Lambda with health check payload:`, payload)
    
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
    const healthResult = JSON.parse(lambdaResult.body)
    
    console.log(`✅ Health check completed for company ${company_id}`)
    
    return NextResponse.json(healthResult)
    
  } catch (error) {
    console.error('❌ Health check API error:', error)
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Health check failed',
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

