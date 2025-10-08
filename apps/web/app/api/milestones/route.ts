import { NextRequest, NextResponse } from 'next/server'

// Simple API route that proxies to the backend Lambda
export async function GET(request: NextRequest) {
  try {
    console.log('🎯 Fetching milestones')
    
    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL
    if (!BACKEND_URL) {
      throw new Error('NEXT_PUBLIC_BACKEND_URL environment variable is not set')
    }
    
    // Get optional company_id from query params
    const searchParams = request.nextUrl.searchParams
    const companyId = searchParams.get('company_id')
    
    const payload: any = { operation: 'get_milestones' }
    if (companyId) {
      payload.company_id = parseInt(companyId)
    }
    
    console.log('📤 Calling backend with payload:', payload)
    
    const response = await fetch(`${BACKEND_URL}/financial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    
    if (!response.ok) {
      throw new Error(`Backend request failed: ${response.status}`)
    }
    
    const data = await response.json()
    console.log(`✅ Retrieved milestones data`)
    
    return NextResponse.json(data)
    
  } catch (error) {
    console.error('❌ Milestones API error:', error)
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to fetch milestones',
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

