import { NextRequest, NextResponse } from 'next/server'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'

/**
 * API route to invoke the Voice Query Lambda (Vanna.AI)
 * Handles natural language queries about portfolio companies
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🎤 Voice query API route called')
    
    const body = await request.json()
    const { action, question } = body
    
    console.log(`📝 Request:`, { action, question })
    
    if (!action) {
      return NextResponse.json(
        { error: 'action is required (train_schema or query)' },
        { status: 400 }
      )
    }
    
    if (action === 'query' && !question) {
      return NextResponse.json(
        { error: 'question is required for query action' },
        { status: 400 }
      )
    }
    
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
      action,
      question: question || undefined
    }
    
    console.log(`📤 Invoking Voice Query Lambda with payload:`, payload)
    
    // Invoke the Voice Query Lambda
    const command = new InvokeCommand({
      FunctionName: 'kv-automation-voice-query',
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
        { error: errorBody.error || 'Voice query failed', details: errorBody },
        { status: lambdaResult.statusCode }
      )
    }
    
    // Parse and return the successful response
    const resultBody = JSON.parse(lambdaResult.body)
    console.log('✅ Voice query successful')
    
    return NextResponse.json(resultBody)
    
  } catch (error: any) {
    console.error('❌ Voice query error:', error)
    return NextResponse.json(
      { 
        error: error.message || 'Voice query failed',
        details: error.toString()
      },
      { status: 500 }
    )
  }
}

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}





















