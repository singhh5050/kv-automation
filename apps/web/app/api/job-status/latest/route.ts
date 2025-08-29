import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { company_id } = await request.json()

    if (!company_id) {
      return NextResponse.json(
        { error: 'Company ID is required' },
        { status: 400 }
      )
    }

    // Call the Lambda function to get the latest completed job
    const lambdaResponse = await fetch(process.env.NEXT_PUBLIC_BACKEND_URL + '/job-status/latest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        company_id: company_id,
      }),
    })

    if (!lambdaResponse.ok) {
      throw new Error(`Lambda request failed: ${lambdaResponse.status}`)
    }

    const result = await lambdaResponse.json()
    
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error getting latest async analysis:', error)
    return NextResponse.json(
      { error: 'Failed to get latest analysis' },
      { status: 500 }
    )
  }
}
