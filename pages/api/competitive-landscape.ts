import { NextApiRequest, NextApiResponse } from 'next'
import { getCompetitors, getHeadcountEstimate, getInvestorList, getLatestNews } from '../../lib/harmonicClient'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { action, companyName, query } = req.body

    if (!companyName) {
      return res.status(400).json({ error: 'Company name is required' })
    }

    console.log(`Processing competitive landscape action: ${action} for company: ${companyName}`)

    // Handle different competitive landscape actions
    switch (action) {
      case 'getCompetitors':
        try {
          const competitors = await getCompetitors(companyName)
          return res.status(200).json({
            type: 'competitors',
            data: competitors,
            metadata: {
              action,
              company: companyName,
              timestamp: new Date().toISOString(),
              count: competitors.length
            }
          })
        } catch (error) {
          console.error('Error getting competitors:', error)
          return res.status(500).json({
            error: 'Failed to fetch competitors',
            details: error instanceof Error ? error.message : 'Unknown error'
          })
        }

      case 'getHeadcountEstimate':
        try {
          const headcountData = await getHeadcountEstimate(companyName)
          return res.status(200).json({
            type: 'headcount',
            data: headcountData,
            metadata: {
              action,
              company: companyName,
              timestamp: new Date().toISOString()
            }
          })
        } catch (error) {
          console.error('Error getting headcount estimate:', error)
          return res.status(500).json({
            error: 'Failed to fetch headcount estimate',
            details: error instanceof Error ? error.message : 'Unknown error'
          })
        }

      case 'getInvestorList':
        try {
          const investorData = await getInvestorList(companyName)
          return res.status(200).json({
            type: 'investors',
            data: investorData,
            metadata: {
              action,
              company: companyName,
              timestamp: new Date().toISOString()
            }
          })
        } catch (error) {
          console.error('Error getting investor list:', error)
          return res.status(500).json({
            error: 'Failed to fetch investor list',
            details: error instanceof Error ? error.message : 'Unknown error'
          })
        }

      case 'getLatestNews':
        try {
          const newsData = await getLatestNews(companyName)
          return res.status(200).json({
            type: 'news',
            data: newsData,
            metadata: {
              action,
              company: companyName,
              timestamp: new Date().toISOString()
            }
          })
        } catch (error) {
          console.error('Error getting latest news:', error)
          return res.status(500).json({
            error: 'Failed to fetch latest news',
            details: error instanceof Error ? error.message : 'Unknown error'
          })
        }

      case 'naturalLanguageQuery':
        // Keep the natural language option but mark as work in progress
        return res.status(200).json({
          type: 'text',
          data: {
            message: `Natural language search is still a work in progress. 
            
For "${query}" about ${companyName}, please try one of the specific actions:
• Get Competitors - Find similar companies in the same space
• Headcount Estimate - Get team size and growth data  
• Investor List - See funding history and investor details
• Latest News - View recent highlights and updates

These specific actions provide more reliable data from the Harmonic database.`
          },
          metadata: {
            action,
            company: companyName,
            query,
            timestamp: new Date().toISOString(),
            status: 'work_in_progress'
          }
        })

      default:
        return res.status(400).json({
          error: 'Invalid action',
          available_actions: ['getCompetitors', 'getHeadcountEstimate', 'getInvestorList', 'getLatestNews', 'naturalLanguageQuery']
        })
    }

  } catch (error) {
    console.error('Competitive landscape API error:', error)
    
    return res.status(500).json({
      error: 'Internal server error processing competitive landscape request',
      details: error instanceof Error ? error.message : 'Unknown error',
      type: 'error'
    })
  }
} 