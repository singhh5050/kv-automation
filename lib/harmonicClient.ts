// Harmonic AI API Client - Using Real API Endpoints
const HARMONIC_API_KEY = process.env.HARMONIC_API_KEY
const BASE_URL = 'https://api.harmonic.ai'

interface SearchCompaniesParams {
  contains_all_of_keywords?: string
  contains_any_of_keywords?: string
  does_not_contain_keywords?: string
  include_ids_only?: boolean
}

interface SimilarCompaniesParams {
}

interface EmployeesParams {
  employee_group_type?: string
  page?: number
}

interface HarmonicSearchResponse {
  count: number
  page_info: any
  results: string[] // Array of URNs like "urn:harmonic:company:12345"
}

interface HarmonicCompany {
  id: string
  name: string
  description?: string
  website?: string
  industry?: string
  funding_rounds?: any[]
  people?: any[]
  [key: string]: any
}

async function makeRequest(endpoint: string, options: RequestInit = {}) {
  try {
    // Check if API key is available
    if (!HARMONIC_API_KEY) {
      throw new Error('Harmonic API key not configured. Please set HARMONIC_API_KEY environment variable.')
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json',
        'apikey': HARMONIC_API_KEY,
        ...options.headers,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Harmonic API Error (${response.status}):`, errorText)
      throw new Error(`Harmonic API Error: ${response.status} - ${errorText}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Harmonic API request failed:', error)
    throw error
  }
}

// Extract company ID from URN format: "urn:harmonic:company:12345" -> "12345"
function extractCompanyId(urn: string): string {
  return urn.replace('urn:harmonic:company:', '')
}

export async function searchCompanies(params: SearchCompaniesParams): Promise<HarmonicSearchResponse> {
  const response = await makeRequest('/search/companies_by_keywords', {
    method: 'POST',
    body: JSON.stringify(params),
  })
  return response
}

export async function getCompanyProfile(companyUrn: string): Promise<HarmonicCompany> {
  const companyId = extractCompanyId(companyUrn)
  const response = await makeRequest(`/companies/${companyId}`, {
    method: 'GET',
  })
  return response
}

export async function getSimilarCompanies(companyUrn: string, params: SimilarCompaniesParams = {}): Promise<HarmonicSearchResponse> {
  const companyId = extractCompanyId(companyUrn)
  const response = await makeRequest(`/search/similar_companies/${companyId}`, {
    method: 'GET',
  })
  return response
}

export async function getCompanyEmployees(companyUrn: string, params: EmployeesParams = {}): Promise<any> {
  const companyId = extractCompanyId(companyUrn)
  const queryParams = new URLSearchParams()
  
  if (params.employee_group_type) queryParams.set('employee_group_type', params.employee_group_type)
  if (params.page) queryParams.set('page', params.page.toString())
  
  const queryString = queryParams.toString()
  const endpoint = `/companies/${companyId}/employees${queryString ? `?${queryString}` : ''}`
  
  const response = await makeRequest(endpoint, {
    method: 'GET',
  })
  return response
}

export async function enrichCompanyByDomain(domain: string): Promise<HarmonicCompany> {
  const response = await makeRequest(`/companies?website_domain=${domain}`, {
    method: 'POST',
  })
  return response
}

// Helper function to search and get full company details in one call
export async function searchAndGetCompanies(keywords: string, limit: number = 10): Promise<HarmonicCompany[]> {
  try {
    // Step 1: Search for companies
    const searchResult = await searchCompanies({
      contains_all_of_keywords: keywords
    })
    
    if (searchResult.count === 0) {
      return []
    }
    
    // Step 2: Get details for first few companies
    const urnsToFetch = searchResult.results.slice(0, limit)
    const companies: HarmonicCompany[] = []
    
    for (const urn of urnsToFetch) {
      try {
        const company = await getCompanyProfile(urn)
        companies.push(company)
      } catch (error) {
        console.error(`Failed to fetch company ${urn}:`, error)
        // Continue with other companies
      }
    }
    
    return companies
  } catch (error) {
    console.error('Failed to search and get companies:', error)
    throw error
  }
}

// Get funding data - this is included in the main company profile
export async function get_funding_rounds(params: { companyId: string }) {
  const company = await makeRequest(`/companies/${params.companyId}`)
  return {
    funding: company.funding,
    funding_rounds: company.funding_rounds
  }
}

// Get company highlights - this is included in the main company profile  
export async function get_highlights(params: { companyId: string }) {
  const company = await makeRequest(`/companies/${params.companyId}`)
  return {
    highlights: company.highlights,
    tags: company.tags,
    tags_v2: company.tags_v2
  }
}

// Search typeahead for company names
export async function search_typeahead(params: {
  query: string
  search_type?: string
}) {
  const queryParams = new URLSearchParams()
  queryParams.append('query', params.query)
  queryParams.append('search_type', params.search_type || 'COMPANY')

  return await makeRequest(`/search/typeahead?${queryParams.toString()}`)
}

// Legacy functions that don't have direct equivalents but we can simulate
export async function get_co_investors(params: { companyId: string }) {
  // This doesn't exist in the real API, so we'll return funding data
  const company = await makeRequest(`/companies/${params.companyId}`)
  return {
    message: "Co-investor data not directly available via API. Use funding rounds data.",
    funding: company.funding,
    funding_rounds: company.funding_rounds
  }
}

export async function benchmark_burn_rate(params: { companyId: string }) {
  // This doesn't exist in the real API
  return {
    message: "Burn rate benchmarking not available via API. Use similar companies for comparison.",
    suggestion: `Use list_peers() to find similar companies and compare their funding/headcount data`
  }
}

export async function get_latest_news(params: { companyId: string }) {
  // This doesn't exist in the real API
  return {
    message: "News data not available via API. Check company highlights or use external news APIs.",
    suggestion: "Use get_highlights() for company achievements and milestones"
  }
}

export async function get_market_analysis(params: { industry: string }) {
  // This doesn't exist in the real API, but we can search for companies in the industry
  return await searchAndGetCompanies(params.industry, 20)
}

// Simplified Competitive Landscape Functions
export async function getCompetitors(companyName: string): Promise<HarmonicCompany[]> {
  try {
    // Step 1: Search for the target company
    const searchResult = await searchCompanies({
      contains_all_of_keywords: companyName
    })
    
    if (searchResult.count === 0) {
      // If exact name not found, try broader search
      const broaderSearch = await searchCompanies({
        contains_any_of_keywords: companyName
      })
      
      if (broaderSearch.count === 0) {
        return []
      }
      
      // Get the first company as best match
      const targetCompany = await getCompanyProfile(broaderSearch.results[0])
      
      // Step 2: Find similar companies
      const similarResults = await getSimilarCompanies(broaderSearch.results[0])
      
      // Step 3: Get details for competitor companies
      const competitors: HarmonicCompany[] = []
      for (const urn of similarResults.results.slice(0, 8)) {
        try {
          const competitor = await getCompanyProfile(urn)
          competitors.push(competitor)
        } catch (error) {
          console.error(`Failed to fetch competitor ${urn}:`, error)
        }
      }
      
      return competitors
    }
    
    // Get the target company
    const targetCompany = await getCompanyProfile(searchResult.results[0])
    
    // Find similar companies
    const similarResults = await getSimilarCompanies(searchResult.results[0])
    
    // Get details for competitor companies
    const competitors: HarmonicCompany[] = []
    for (const urn of similarResults.results.slice(0, 8)) {
      try {
        const competitor = await getCompanyProfile(urn)
        competitors.push(competitor)
      } catch (error) {
        console.error(`Failed to fetch competitor ${urn}:`, error)
      }
    }
    
    return competitors
  } catch (error) {
    console.error('Failed to get competitors:', error)
    throw error
  }
}

export async function getHeadcountEstimate(companyName: string): Promise<{
  target_company: HarmonicCompany | null
  headcount_data: {
    current_headcount: number | null
    external_headcount: number | null
    corrected_headcount: number | null
    growth_metrics: any
  }
  peer_comparison: Array<{
    name: string
    headcount: number | null
    stage: string
  }>
}> {
  try {
    // Search for the target company
    const searchResult = await searchCompanies({
      contains_all_of_keywords: companyName
    })
    
    if (searchResult.count === 0) {
      return {
        target_company: null,
        headcount_data: {
          current_headcount: null,
          external_headcount: null,
          corrected_headcount: null,
          growth_metrics: null
        },
        peer_comparison: []
      }
    }
    
    const targetCompany = await getCompanyProfile(searchResult.results[0])
    
    // Get similar companies for comparison
    const similarResults = await getSimilarCompanies(searchResult.results[0])
    const peers = []
    
    for (const urn of similarResults.results.slice(0, 5)) {
      try {
        const peer = await getCompanyProfile(urn)
        peers.push({
          name: peer.name,
          headcount: peer.headcount || peer.corrected_headcount || peer.external_headcount,
          stage: peer.stage || 'Unknown'
        })
      } catch (error) {
        console.error(`Failed to fetch peer ${urn}:`, error)
      }
    }
    
    return {
      target_company: targetCompany,
      headcount_data: {
        current_headcount: targetCompany.headcount,
        external_headcount: targetCompany.external_headcount,
        corrected_headcount: targetCompany.corrected_headcount,
        growth_metrics: targetCompany.traction_metrics?.headcount || null
      },
      peer_comparison: peers
    }
  } catch (error) {
    console.error('Failed to get headcount estimate:', error)
    throw error
  }
}

export async function getInvestorList(companyName: string): Promise<{
  target_company: HarmonicCompany | null
  funding_data: {
    total_funding: number
    funding_rounds: any[]
    investors: any[]
    last_funding_date: string | null
    funding_stage: string
  }
  investor_networks: Array<{
    investor_name: string
    other_portfolio_companies: string[]
  }>
}> {
  try {
    // Search for the target company
    const searchResult = await searchCompanies({
      contains_all_of_keywords: companyName
    })
    
    if (searchResult.count === 0) {
      return {
        target_company: null,
        funding_data: {
          total_funding: 0,
          funding_rounds: [],
          investors: [],
          last_funding_date: null,
          funding_stage: 'Unknown'
        },
        investor_networks: []
      }
    }
    
    const targetCompany = await getCompanyProfile(searchResult.results[0])
    
    return {
      target_company: targetCompany,
      funding_data: {
        total_funding: targetCompany.funding?.funding_total || 0,
        funding_rounds: targetCompany.funding_rounds || [],
        investors: targetCompany.funding?.investors || [],
        last_funding_date: targetCompany.funding?.last_funding_at,
        funding_stage: targetCompany.funding?.funding_stage || 'Unknown'
      },
      investor_networks: [] // Note: Co-investor analysis requires additional API calls not directly available
    }
  } catch (error) {
    console.error('Failed to get investor list:', error)
    throw error
  }
}

export async function getLatestNews(companyName: string): Promise<{
  target_company: HarmonicCompany | null
  highlights: any[]
  recent_updates: {
    funding_updates: any[]
    team_updates: any[]
    business_updates: any[]
  }
  market_context: string
}> {
  try {
    // Search for the target company
    const searchResult = await searchCompanies({
      contains_all_of_keywords: companyName
    })
    
    if (searchResult.count === 0) {
      return {
        target_company: null,
        highlights: [],
        recent_updates: {
          funding_updates: [],
          team_updates: [],
          business_updates: []
        },
        market_context: 'Company not found in database'
      }
    }
    
    const targetCompany = await getCompanyProfile(searchResult.results[0])
    
    return {
      target_company: targetCompany,
      highlights: targetCompany.highlights || [],
      recent_updates: {
        funding_updates: targetCompany.funding_rounds?.slice(-3) || [],
        team_updates: targetCompany.employee_highlights || [],
        business_updates: targetCompany.highlights?.slice(-5) || []
      },
      market_context: `${targetCompany.name} operates in ${targetCompany.industry || 'the general business sector'} with ${targetCompany.funding?.funding_stage || 'unknown funding stage'}.`
    }
  } catch (error) {
    console.error('Failed to get latest news:', error)
    throw error
  }
} 