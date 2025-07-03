import OpenAI from 'openai'
import * as harmonic from './harmonicClient'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Function definitions for OpenAI function calling - Updated for Real Harmonic API
const functions = [
  {
    name: "search_companies",
    description: "Search for companies by keywords, industry, or business description. This is the primary way to find companies.",
    parameters: {
      type: "object",
      properties: {
        keywords: { 
          type: "string", 
          description: "Keywords to search for (e.g., 'biotech AI drug discovery', 'healthcare software')" 
        },
        industry: { 
          type: "string", 
          description: "Industry category (e.g., 'biotech', 'healthcare', 'pharmaceuticals')" 
        },
        limit: {
          type: "number",
          description: "Maximum number of companies to return (default 10)"
        }
      },
      required: ["keywords"]
    }
  },
  {
    name: "get_company_profile",
    description: "Get detailed company information including funding, team, and business details for a specific company URN.",
    parameters: {
      type: "object", 
      properties: {
        company_urn: {
          type: "string",
          description: "Harmonic company URN (e.g., 'urn:harmonic:company:12345')"
        }
      },
      required: ["company_urn"]
    }
  },
  {
    name: "find_similar_companies",
    description: "Find competitor or peer companies similar to a given company.",
    parameters: {
      type: "object",
      properties: {
        company_urn: {
          type: "string", 
          description: "Harmonic company URN to find similar companies for"
        }
      },
      required: ["company_urn"]
    }
  },
  {
    name: "get_company_team",
    description: "Get information about a company's employees and team members.",
    parameters: {
      type: "object",
      properties: {
        company_urn: {
          type: "string",
          description: "Harmonic company URN"
        },
        employee_type: {
          type: "string",
          description: "Type of employees to get (optional filter)"
        }
      },
      required: ["company_urn"]
    }
  }
]

// Function execution mapping
async function executeFunctions(functionName: string, args: any) {
  try {
    switch (functionName) {
      case 'search_companies':
        // Use the new searchAndGetCompanies function that handles URNs automatically
        return await harmonic.searchAndGetCompanies(
          args.keywords + (args.industry ? ` ${args.industry}` : ''), 
          args.limit || 10
        )
        
      case 'get_company_profile':
        return await harmonic.getCompanyProfile(args.company_urn)
        
      case 'find_similar_companies':
        const similarResults = await harmonic.getSimilarCompanies(args.company_urn)
        // Get details for first 5 similar companies
        const similarCompanies = []
        for (const urn of similarResults.results.slice(0, 5)) {
          try {
            const company = await harmonic.getCompanyProfile(urn)
            similarCompanies.push(company)
          } catch (error) {
            console.error(`Failed to fetch similar company ${urn}:`, error)
          }
        }
        return {
          count: similarResults.count,
          similar_companies: similarCompanies
        }
        
      case 'get_company_team':
        return await harmonic.getCompanyEmployees(args.company_urn, {
          employee_group_type: args.employee_type
        })
        
      default:
        throw new Error(`Unknown function: ${functionName}`)
    }
  } catch (error) {
    console.error(`Error executing function ${functionName}:`, error)
    throw error
  }
}

export async function fetchCompetitiveLandscape(query: string, companyName: string) {
  try {
    console.log(`Fetching competitive landscape for: ${companyName}`)
    console.log(`Query: ${query}`)

    // Create the system message for biotech competitive intelligence
    const systemMessage = `You are a biotech competitive intelligence analyst with access to the Harmonic AI company database. 

Your goal is to provide comprehensive competitive analysis for biotech/healthcare companies including:
- Competitor identification and analysis
- Funding comparisons and investor networks  
- Team and hiring trends
- Market positioning and opportunities

When analyzing "${companyName}", use the available functions to:
1. First search for the target company to get their URN and basic info
2. Find similar/competitor companies in their space
3. Get detailed profiles for key competitors
4. Analyze funding patterns, team sizes, and market positioning

Always provide structured, actionable insights with specific data points and company comparisons.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: `${query} for ${companyName}` }
      ],
      functions: functions,
      function_call: 'auto',
      temperature: 0.3
    })

    const message = response.choices[0].message

    // If the AI wants to call a function
    if (message.function_call) {
      const functionName = message.function_call.name
      const functionArgs = JSON.parse(message.function_call.arguments)
      
      console.log(`AI calling function: ${functionName}`, functionArgs)
      
      try {
        const functionResult = await executeFunctions(functionName, functionArgs)
        
        // Return structured data response
        return {
          type: 'data' as const,
          payload: functionResult,
          function_called: functionName,
          function_args: functionArgs
        }
      } catch (error) {
        console.error('Function execution error:', error)
        return {
          type: 'error' as const,
          payload: `Failed to execute ${functionName}: ${error instanceof Error ? error.message : 'Unknown error'}`
        }
      }
    }

    // If no function call, return the AI's text response
    return {
      type: 'text' as const,
      payload: message.content || 'No response generated'
    }

  } catch (error) {
    console.error('OpenAI API error:', error)
    
    // Provide graceful fallback
    return {
      type: 'text' as const,
      payload: `I'm unable to access the Harmonic database at the moment due to API limitations. However, I can provide some general competitive analysis insights for ${companyName}:

For biotech competitive analysis, consider:
- Direct competitors in the same therapeutic area  
- Companies with similar technology platforms
- Peers at similar development stages
- Funding and valuation comparisons
- Key opinion leader networks
- Patent landscapes
- Clinical trial timelines

To get detailed competitive data, you may want to:
1. Check company websites and SEC filings
2. Review recent press releases and pipeline updates  
3. Analyze patent filings and publications
4. Monitor conference presentations and abstracts
5. Track partnership announcements

Would you like me to help you structure a competitive analysis framework for ${companyName}?`
    }
  }
} 