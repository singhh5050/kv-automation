import { NextRequest, NextResponse } from 'next/server'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'

export async function POST(request: NextRequest) {
  try {
    const { company_id } = await request.json()

    if (!company_id) {
      return NextResponse.json(
        { error: 'Company ID is required' },
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

    // Call the Lambda function directly
    const command = new InvokeCommand({
      FunctionName: 'kv-automation-pdf-analysis',
      Payload: JSON.stringify({
        action: 'get_latest_completed_job',
        company_id: parseInt(company_id)
      }),
      InvocationType: 'RequestResponse'
    })

    const lambdaResponse = await lambdaClient.send(command)
    
    if (!lambdaResponse.Payload) {
      throw new Error('No payload returned from Lambda')
    }

    // Parse Lambda response
    const responseString = new TextDecoder().decode(lambdaResponse.Payload)
    const lambdaResult = JSON.parse(responseString)

    if (lambdaResult.statusCode !== 200) {
      const errorBody = JSON.parse(lambdaResult.body)
      throw new Error(errorBody.error || 'Lambda execution failed')
    }

    // Parse the successful response
    const result = JSON.parse(lambdaResult.body)
    
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error getting latest async analysis:', error)
    return NextResponse.json(
      { error: 'Failed to get latest analysis' },
      { status: 500 }
    )
  }
}
