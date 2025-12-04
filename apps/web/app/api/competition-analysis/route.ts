import { NextRequest, NextResponse } from 'next/server'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'

/**
 * API route for competition analysis
 * Invokes the pdf-analysis Lambda which uses OpenAI's web search capabilities
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔍 Competition analysis API route called')
    
    const body = await request.json()
    const { company_name, is_public } = body
    
    if (!company_name) {
      return NextResponse.json(
        { error: 'company_name is required' },
        { status: 400 }
      )
    }
    
    console.log(`🏢 Analyzing competition for: ${company_name} (${is_public ? 'public' : 'private'})`)
    
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
      action: 'competition_analysis',
      company_name,
      is_public: !!is_public
    }
    
    console.log(`📤 Invoking Lambda with competition analysis payload:`, payload)
    
    // Invoke the PDF analysis Lambda (which handles competition analysis)
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
      console.error('❌ Lambda returned error:', errorBody)
      return NextResponse.json(
        { 
          error: errorBody.error || 'Competition analysis failed',
          error_code: errorBody.error_code || 'LAMBDA_ERROR'
        },
        { status: lambdaResult.statusCode }
      )
    }
    
    // Parse and return the successful response
    const resultBody = JSON.parse(lambdaResult.body)
    console.log('✅ Competition analysis successful')
    
    return NextResponse.json(resultBody)
    
  } catch (error: any) {
    console.error('❌ Competition analysis error:', error)
    
    return NextResponse.json(
      { 
        error: error.message || 'Competition analysis failed',
        error_code: 'API_ERROR',
        details: error.toString()
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
