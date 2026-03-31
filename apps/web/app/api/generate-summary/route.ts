import { NextRequest, NextResponse } from 'next/server'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { currentUser } from '@clerk/nextjs/server'

// API route to invoke the PDF analysis Lambda for internal summary generation
export async function POST(request: NextRequest) {
  try {
    console.log('📝 Generate summary API route called')
    
    const body = await request.json()
    const { company_id, company_data } = body
    
    if (!company_id) {
      return NextResponse.json(
        { error: 'company_id is required' },
        { status: 400 }
      )
    }
    
    console.log(`📝 Generating internal summary for company ${company_id}`)
    
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
    
    // Prepare Lambda payload
    const clerkUser = await currentUser()
    const userEmail = clerkUser?.emailAddresses?.[0]?.emailAddress

    const payload: any = {
      action: 'generate_internal_summary',
      company_id: parseInt(company_id),
      company_data: company_data || {},
      user_id: userEmail
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
    const summaryResult = JSON.parse(lambdaResult.body)
    
    console.log(`✅ Summary generated for company ${company_id}: ${summaryResult.summary?.length || 0} characters`)
    
    return NextResponse.json(summaryResult)
    
  } catch (error) {
    console.error('❌ Generate summary API error:', error)
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Summary generation failed',
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

