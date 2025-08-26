import { NextRequest, NextResponse } from 'next/server'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'

const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
})

export async function POST(request: NextRequest) {
  try {
    const { reportId } = await request.json()

    if (!reportId) {
      return NextResponse.json(
        { error: 'Report ID is required' },
        { status: 400 }
      )
    }

    // Prepare the payload for the Lambda function
    const payload = {
      body: JSON.stringify({
        operation: 'delete_financial_report',
        report_id: reportId
      })
    }

    console.log('🔍 Lambda payload:', JSON.stringify(payload, null, 2))

    // Invoke the financial-crud Lambda function
    const command = new InvokeCommand({
      FunctionName: 'kv-automation-financial-crud',
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(payload)
    })

    const response = await lambdaClient.send(command)
    
    if (!response.Payload) {
      throw new Error('No response from Lambda function')
    }

    // Parse the Lambda response
    const responseBody = JSON.parse(Buffer.from(response.Payload).toString())
    
    console.log('🔍 Lambda response:', JSON.stringify(responseBody, null, 2))
    
    if (response.StatusCode !== 200) {
      throw new Error(`Lambda execution failed with status ${response.StatusCode}`)
    }

    // Handle Lambda function errors
    if (responseBody.status === 'failed') {
      return NextResponse.json(
        { error: responseBody.error || 'Failed to delete financial report' },
        { status: 500 }
      )
    }

    // Return success response
    return NextResponse.json({
      success: true,
      data: responseBody.data
    })

  } catch (error) {
    console.error('❌ Delete financial report API error:', error)
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'An unknown error occurred',
        success: false 
      },
      { status: 500 }
    )
  }
}
