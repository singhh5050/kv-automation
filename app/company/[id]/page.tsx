'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getCompanyOverview, enrichCompany, getCompanyEnrichment, enrichPerson } from '@/lib/api'
import EditableMetric from '@/components/EditableMetric'
import UniversalDatabaseEditor from '@/components/UniversalDatabaseEditor'
import MarkdownContent from '@/components/MarkdownContent'
import { CompanyOverview, CapTableInvestor, FinancialReport } from '@/types'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts'

// Company name normalization for display
const normalizeCompanyName = (name: string): string => {
  return name
    .replace(/\b(corp|corporation|inc|incorporated|ltd|limited|llc|co\.?)\b/gi, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Currency formatting utility
const formatCurrency = (value: string | number | null | undefined): string => {
  if (!value || value === 'N/A' || value === '') return 'N/A'
  
  const numValue = typeof value === 'string' ? 
    parseFloat(value.replace(/[$,M\s]/gi, '')) : value
  
  if (isNaN(numValue) || numValue === 0) return 'N/A'
  
  if (numValue >= 1000000000) {
    return `$${(numValue / 1000000000).toFixed(1)}B`
  } else if (numValue >= 1000000) {
    return `$${(numValue / 1000000).toFixed(1)}M`
  } else if (numValue >= 1000) {
    return `$${(numValue / 1000).toFixed(0)}K`
  } else {
    return `$${numValue.toLocaleString()}`
  }
}

// Sector-specific field labels mapping
const getSectorLabels = (sector: string = 'unknown') => {
  const sectorLower = sector.toLowerCase()
  switch (sectorLower) {
    case 'healthcare':
      return {
        highlightA: 'Clinical Progress',
        highlightB: 'R&D Updates',
        icon: '🏥'
      }
    case 'consumer':
      return {
        highlightA: 'Customer & Unit Economics',
        highlightB: 'Growth Efficiency Initiatives',
        icon: '🛍️'
      }
    case 'enterprise':
      return {
        highlightA: 'Product Roadmap & Adoption',
        highlightB: 'Go-to-Market Performance',
        icon: '🏢'
      }
    case 'manufacturing':
      return {
        highlightA: 'Operational Performance',
        highlightB: 'Supply Chain & Commercial Pipeline',
        icon: '🏭'
      }
    default:
      return {
        highlightA: 'Sector Highlight A',
        highlightB: 'Sector Highlight B',
        icon: '🏥'
      }
  }
}

type TabType = 'metrics' | 'financials' | 'overview' | 'captable' | 'reports' | 'database' | 'enrichment'

// Chart component for cash history using Recharts
const SimpleCashChart = ({ reports }: { reports: any[] }) => {
  if (!reports || reports.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg p-6 h-48 flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-400 text-2xl mb-2">📊</div>
          <p className="text-gray-500">No financial reports available</p>
          <p className="text-gray-400 text-sm">Upload board decks to see cash trends</p>
        </div>
      </div>
    )
  }

  // Process data for Recharts
  const chartData = reports
    .filter(report => {
      const cashValue = (report as any).cash_on_hand
      return cashValue && 
             cashValue !== 'N/A' && 
             cashValue !== '' && 
             (typeof cashValue === 'string' || typeof cashValue === 'number') &&
             String(cashValue).match(/\d/)
    })
    .map((report) => {
      const cashStr = String((report as any).cash_on_hand || '0')
      const dateStr = (report as any).report_date || (report as any).reportDate
      
      // Parse cash amount - use raw values
      let cashValue = 0
      try {
        const cleanCash = cashStr.replace(/[$,M\s]/gi, '').trim()
        cashValue = parseFloat(cleanCash)
      } catch (e) {
        console.warn('Failed to parse cash value:', cashStr, e)
        cashValue = 0
      }

      let reportDate = new Date()
      try {
        if (dateStr) {
          reportDate = new Date(dateStr)
          if (isNaN(reportDate.getTime())) {
            reportDate = new Date()
          }
        }
      } catch (e) {
        console.warn('Failed to parse date:', dateStr, e)
      }

      // Parse monthly burn - use raw values
      let burnValue = 0
      const burnStr = String((report as any).monthly_burn_rate || '0')
      try {
        const cleanBurn = burnStr.replace(/[$,M\s]/gi, '').trim()
        burnValue = parseFloat(cleanBurn)
      } catch (e) {
        console.warn('Failed to parse burn value:', burnStr, e)
        burnValue = 0
      }

      return {
        date: reportDate.getTime(), // Recharts needs timestamps
        cash: cashValue,
        burn: burnValue,
        period: (report as any).report_period || 'Unknown',
        originalCash: cashStr,
        originalBurn: burnStr
      }
    })
    .filter(item => item.cash > 0)
    .sort((a, b) => a.date - b.date)

  if (chartData.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg p-6 h-48 flex items-center justify-center">
        <div className="text-center">
          <div className="text-yellow-400 text-2xl mb-2">⚠️</div>
          <p className="text-gray-500">No parseable cash data found</p>
          <p className="text-gray-400 text-sm">Check that reports contain cash amounts</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-50 rounded-lg p-4 h-full overflow-hidden">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-medium text-gray-900 text-sm">Cash History</h4>
        <span className="text-xs text-gray-500">{chartData.length} data points</span>
      </div>
      
      <ResponsiveContainer width="100%" height="85%">
        <ComposedChart data={chartData} margin={{ top: 5, right: 15, left: 15, bottom: 15 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis 
            dataKey="date"
            type="number"
            domain={['dataMin', 'dataMax']}
            padding={{ left: 10, right: 10 }}
            tickFormatter={(tick) => new Date(tick).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
            scale="time"
            stroke="#6b7280"
            fontSize={10}
          />
          <YAxis 
            yAxisId="left"
            domain={[0, 'dataMax']}
            tickFormatter={(value) => {
              if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
              if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
              return `$${value.toFixed(0)}`
            }}
            stroke="#6b7280"
            fontSize={10}
            width={35}
          />
          <YAxis 
            yAxisId="right"
            orientation="right"
            domain={[0, 'dataMax']}
            tickFormatter={(value) => {
              if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
              if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
              return `$${value.toFixed(0)}`
            }}
            stroke="#ef4444"
            fontSize={10}
            width={35}
          />
          <Tooltip
            labelFormatter={(label) => new Date(label).toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
            formatter={(value, name) => {
              const formatValue = (val: any) => {
                const numVal = typeof val === 'number' ? val : parseFloat(val) || 0
                if (numVal >= 1000000) return `$${(numVal / 1000000).toFixed(1)}M`
                if (numVal >= 1000) return `$${(numVal / 1000).toFixed(0)}K`
                return `$${numVal.toFixed(0)}`
              }
              
              if (name === 'cash') return [formatValue(value), 'Cash on Hand']
              if (name === 'burn') return [formatValue(value), 'Monthly Burn']
              return [formatValue(value), name]
            }}
            contentStyle={{
              backgroundColor: '#1f2937',
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              fontSize: '12px'
            }}
          />
          <Legend 
            wrapperStyle={{ fontSize: '10px' }}
          />
          <Bar 
            yAxisId="right"
            dataKey="burn" 
            fill="#ef4444" 
            name="Monthly Burn"
            radius={[2, 2, 0, 0]}
            barSize={12}
          />
          <Line 
            yAxisId="left"
            type="monotone" 
            dataKey="cash" 
            stroke="#3b82f6" 
            strokeWidth={2}
            name="Cash on Hand"
            dot={{ fill: '#3b82f6', strokeWidth: 1, r: 3 }}
            activeDot={{ r: 4, stroke: '#3b82f6', strokeWidth: 1, fill: '#ffffff' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function CompanyDetailPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string

  const [company, setCompany] = useState<CompanyOverview | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('metrics')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [latestReportId, setLatestReportId] = useState<number | null>(null)
  
  // Enrichment state
  const [enrichmentData, setEnrichmentData] = useState<any>(null)
  const [loadingEnrichment, setLoadingEnrichment] = useState(false)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [identifierType, setIdentifierType] = useState('website_url')

  // Utility functions for formatting
  const formatLargeNumber = (num: number | null | undefined): string => {
    if (!num || num === 0) return 'N/A'
    
    if (num >= 1000000000) {
      return `$${(num / 1000000000).toFixed(1)}B`
    } else if (num >= 1000000) {
      return `$${(num / 1000000).toFixed(1)}M`
    } else if (num >= 1000) {
      return `$${(num / 1000).toFixed(0)}K`
    } else {
      return `$${num.toLocaleString()}`
    }
  }

  const formatNumber = (num: number | null | undefined): string => {
    if (!num || num === 0) return 'N/A'
    
    if (num >= 1000000000) {
      return `${(num / 1000000000).toFixed(1)}B`
    } else if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(0)}K`
    } else {
      return num.toLocaleString()
    }
  }

  useEffect(() => {
    loadCompanyData()
  }, [companyId])

  const loadCompanyData = async () => {
    if (!companyId) return
    
    setIsLoading(true)
    try {
      const result = await getCompanyOverview(companyId)
      if (result.data && !result.error) {
        const companyData = result.data.data
        setCompany(companyData)
        
        // Set the latest report ID for inline editing
        if (companyData.financial_reports && companyData.financial_reports.length > 0) {
          setLatestReportId(companyData.financial_reports[0].id)
        }
      } else {
        setError(result.error || 'Failed to load company data')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }



  // Enrichment functions
  const handleEnrichCompany = async () => {
    if (!websiteUrl.trim()) {
      alert('Please enter a website URL or other identifier')
      return
    }

    setLoadingEnrichment(true)
    try {
      const result = await enrichCompany(companyId, {
        key: identifierType,
        value: websiteUrl.trim()
      })

      console.log('Raw enrichment response:', result)
      
      // Check if the response indicates success - success is nested in result.data.success
      if (result.data && result.data.success === true) {
        console.log('Enrichment successful! Data:', result.data.data)
        
        // Show success message briefly, then do a fast reload
        alert('✅ Company data enriched successfully! Refreshing data...')
        
        // Small delay to let user see the success message, then fast reload
        setTimeout(async () => {
          // Fast reload - refresh all data without clearing state
          await refreshAllData()
        }, 1500)
      } else {
        // Something went wrong
        console.error('Enrichment failed:', result)
        const errorMsg = result.error || result.data?.error || 'Enrichment failed - please try again'
        alert(`Error: ${errorMsg}`)
      }
    } catch (error) {
      console.error('Error enriching company:', error)
      alert(`Failed to enrich company: ${error}`)
    } finally {
      setLoadingEnrichment(false)
    }
  }

  // Function to load enrichment data
    const loadEnrichmentData = async () => {
    if (!companyId) return
    
      console.log('Loading existing enrichment data for company:', companyId)
    try {
      const result = await getCompanyEnrichment(companyId)
          if (result.data?.data) {
            console.log('Found existing enrichment data:', result.data.data)
            // Transform the financial-crud response to match expected structure
            const dbData = result.data.data
            const transformedData = {
              enrichment: {
                extracted: dbData.extracted_data,
                raw_data: dbData.harmonic_data,
                status: dbData.enrichment_status
              },
              enriched_at: dbData.enriched_at,
              saved_to_db: true
            }
            
            // Enrich person data for leadership
            if (transformedData.enrichment.extracted.leadership) {
              console.log('Leadership data found:', transformedData.enrichment.extracted.leadership)
              for (let leader of transformedData.enrichment.extracted.leadership) {
                console.log('Processing leader:', leader)
                if (leader.person_urn) {
                  console.log('Found person_urn for leader:', leader.person_urn)
                  try {
                    const personData = await enrichPersonData(leader.person_urn)
                    console.log('Person data received:', personData)
                    if (personData) {
                      leader.enriched_person = personData
                      console.log('Enriched person data attached:', leader.enriched_person)
                    }
                  } catch (error) {
                    console.error('Error enriching person data:', error)
                  }
                } else {
                  console.log('No person_urn found for leader:', leader.title)
                }
              }
            }
            
            // Enrich CEO data
            if (transformedData.enrichment.extracted.ceo?.person_urn) {
              try {
                const personData = await enrichPersonData(transformedData.enrichment.extracted.ceo.person_urn)
                if (personData) {
                  transformedData.enrichment.extracted.ceo.enriched_person = personData
                }
              } catch (error) {
                console.error('Error enriching CEO data:', error)
              }
            }
            
            console.log('Final enrichment data being set:', transformedData)
            setEnrichmentData(transformedData)
          } else {
            console.log('No existing enrichment data found')
          }
    } catch (error) {
          console.error('Error loading enrichment data:', error)
    }
  }

  // Function to enrich person data via secure backend API
  const enrichPersonData = async (personUrn: string) => {
    try {
      const result = await enrichPerson(personUrn)
      if (result.data && result.data.success) {
        return result.data.data.extracted_data
      } else {
        console.error('Person enrichment failed:', result.error || result.data?.error)
        return null
      }
    } catch (error) {
      console.error('Error fetching person data:', error)
      return null
    }
  }

  // Function to translate company URN to readable name
  const translateCompanyUrn = (urn: string | any): string => {
    if (typeof urn === 'string') {
      // Extract company name from URN pattern like "urn:harmonic:company:12345"
      if (urn.startsWith('urn:harmonic:company:')) {
        // Try to look up in existing data or return a formatted version
        const id = urn.split(':').pop()
        return `Company ${id || 'Unknown'}`
      } else if (urn.includes('urn:')) {
        // Other URN types
        const parts = urn.split(':')
        const id = parts.pop()
        const type = parts[parts.length - 1] || 'entity'
        return `${type.charAt(0).toUpperCase() + type.slice(1)} ${id || 'Unknown'}`
      }
      return urn
    } else if (urn && typeof urn === 'object') {
      // If it's an object, try to get name or company_urn
      return urn.name || urn.company_name || translateCompanyUrn(urn.company_urn) || 'Unknown Company'
    }
    return 'Unknown Company'
  }

  // Function to refresh all data (company + enrichment)
  const refreshAllData = async () => {
    console.log('Refreshing all company and enrichment data...')
    await Promise.all([
      loadCompanyData(),
      loadEnrichmentData()
    ])
    console.log('✅ All data refreshed successfully')
  }

  // Load existing enrichment data when component mounts (only once)
  useEffect(() => {
    if (companyId) {
      loadEnrichmentData()
    }
  }, [companyId])  // Only depend on companyId, not enrichmentData

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading company data...</p>
        </div>
      </div>
    )
  }

  if (error || !company) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-gray-400 text-6xl mb-4">🏢</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Company Not Found</h1>
          <p className="text-gray-600 mb-6">
            {error ? `Error: ${error}` : 'The requested company could not be found in the portfolio.'}
          </p>
          <div className="space-y-3">
            <button
              onClick={() => router.push('/')}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              ← Back to Portfolio
            </button>
            <button
              onClick={loadCompanyData}
              className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  const displayName = normalizeCompanyName(company.company.name)
  const latestReport = company.financial_reports[0]
  
  // Get sector from company data or latest report
  const companySector = company.company.sector || latestReport?.sector || 'unknown'
  const sectorLabels = getSectorLabels(companySector)
  
  const kvStake = company.current_cap_table ? 
    company.current_cap_table.investors
      ?.filter(inv => inv.investor_name.startsWith('KV'))
      ?.reduce((total, inv) => total + (inv.final_fds || 0), 0) || 0 
    : 0;

  // Sort investors to put KV funds at the top
  const sortedInvestors = company.current_cap_table?.investors ? [...company.current_cap_table.investors].sort((a, b) => {
    const aIsKV = a.investor_name.startsWith('KV')
    const bIsKV = b.investor_name.startsWith('KV')
    
    if (aIsKV && !bIsKV) return -1
    if (!aIsKV && bIsKV) return 1
    
    // If both are KV or both are not KV, sort by total invested (descending)
    const aInvested = a.total_invested || 0
    const bInvested = b.total_invested || 0
    return bInvested - aInvested
  }) : [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Compact Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/')}
                className="flex items-center text-gray-600 hover:text-gray-900 font-medium text-sm"
              >
                ← Back to Portfolio
              </button>
            </div>
            <div className="flex items-center space-x-3">
              {/* Enhanced Enrichment Widget */}
              <div className="flex items-center space-x-3 bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-300 rounded-lg p-3 shadow-sm">
                <div className="flex items-center space-x-2">
                  <span className="text-lg">🚀</span>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">Enrich Company Data</h4>
                    <p className="text-xs text-gray-600">Get real-time data from Harmonic AI</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <select
                    value={identifierType}
                    onChange={(e) => setIdentifierType(e.target.value)}
                    className="text-sm border border-purple-200 bg-white rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  >
                    <option value="website_url">Website URL</option>
                    <option value="website_domain">Domain</option>
                    <option value="linkedin_url">LinkedIn</option>
                    <option value="crunchbase_url">Crunchbase</option>
                    <option value="twitter_url">Twitter</option>
                  </select>
                  <input
                    type="text"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder={
                      identifierType === 'website_url' ? 'https://company.com' :
                      identifierType === 'website_domain' ? 'company.com' :
                      identifierType === 'linkedin_url' ? 'linkedin.com/company/name' :
                      identifierType === 'crunchbase_url' ? 'crunchbase.com/organization/name' :
                      'twitter.com/company'
                    }
                    className="w-48 text-sm border border-purple-200 bg-white rounded-md px-3 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 placeholder-gray-400"
                    onKeyPress={(e) => e.key === 'Enter' && handleEnrichCompany()}
                  />
                  <button
                    onClick={handleEnrichCompany}
                    disabled={loadingEnrichment || !websiteUrl.trim()}
                    className="px-4 py-1 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center space-x-1"
                  >
                    {loadingEnrichment ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                        <span>Enriching...</span>
                      </>
                    ) : (
                      <>
                        <span>✨</span>
                        <span>Enrich</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Company Overview - Compact */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
          {/* Compact Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              {enrichmentData?.enrichment?.extracted?.logo_url && (
                <img 
                  src={enrichmentData.enrichment.extracted.logo_url} 
                  alt={`${displayName} logo`}
                  className="w-10 h-10 rounded-lg object-contain bg-white border border-gray-200 p-1"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              )}
              <div>
                <h1 className="text-xl font-bold text-gray-900">{displayName} Overview</h1>
                <p className="text-gray-600 text-sm">
                  {enrichmentData?.enrichment?.extracted?.short_description || 
                   enrichmentData?.enrichment?.extracted?.description || 
                   `Financial performance and key metrics tracking for portfolio company ${displayName}.`}
                </p>
              </div>
            </div>
          </div>
          
          {/* Compact Stats Grid - 2 rows */}
          <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
            <div className="p-2 rounded-md bg-gray-50 text-center">
              <p className="text-xs font-medium text-gray-500 mb-1">👤 CEO</p>
              <p className="text-sm font-semibold text-gray-900 truncate">
                {enrichmentData?.enrichment?.extracted?.ceo?.enriched_person?.full_name || 
                 enrichmentData?.enrichment?.extracted?.ceo?.title || 
                 'Oded Eran'}
              </p>
            </div>
            
            <div className="p-2 rounded-md bg-gray-50 text-center">
              <p className="text-xs font-medium text-gray-500 mb-1">📈 Stage</p>
              <p className="text-sm font-semibold text-gray-900">Main</p>
            </div>
            
            <div className="p-2 rounded-md bg-gray-50 text-center">
              <p className="text-xs font-medium text-gray-500 mb-1">{sectorLabels.icon} Sector</p>
              <p className="text-sm font-semibold text-gray-900">{companySector.charAt(0).toUpperCase() + companySector.slice(1)}</p>
            </div>
            
            <div className="p-2 rounded-md bg-gray-50 text-center">
              <p className="text-xs font-medium text-gray-500 mb-1">💰 Valuation</p>
              <p className="text-sm font-semibold text-gray-900">{formatCurrency(company.current_cap_table?.valuation)}</p>
            </div>
            
            <div className="p-2 rounded-md bg-gray-50 text-center">
              <p className="text-xs font-medium text-gray-500 mb-1">💵 Last Round</p>
              <p className="text-sm font-semibold text-gray-900">{formatCurrency(company.current_cap_table?.amount_raised)}</p>
            </div>
            
            <div className="p-2 rounded-md bg-blue-50 text-center border border-blue-200">
              <p className="text-xs font-medium text-blue-600 mb-1">🎯 KV Own</p>
              <p className="text-sm font-semibold text-blue-700">
                {kvStake > 0 ? `${(kvStake * 100).toFixed(1)}%` : 'N/A'}
              </p>
            </div>
            
            <div className="p-2 rounded-md bg-gray-50 text-center">
              <p className="text-xs font-medium text-gray-500 mb-1">💎 KV Funds</p>
              <p className="text-xs font-semibold text-gray-900 truncate">
                {company.current_cap_table?.investors
                  ?.filter(inv => inv.investor_name.startsWith('KV'))
                  ?.map(inv => inv.investor_name.split(' ')[1] || inv.investor_name) // Show just "VII" instead of "KV VII"
                  ?.join(', ') || 'N/A'
                }
              </p>
            </div>
            
            <div className="p-2 rounded-md bg-gray-50 text-center">
              <p className="text-xs font-medium text-gray-500 mb-1">📍 Location</p>
              <p className="text-xs font-semibold text-gray-900 truncate">
                {enrichmentData?.enrichment?.extracted?.location?.city || 'Boston'}
              </p>
            </div>
          </div>
        </div>

        {/* Compact Tabs */}
        <div className="bg-white rounded-lg border border-gray-200 mb-6 p-1 shadow-sm">
          <nav className="flex flex-wrap gap-1">
            <button
              onClick={() => setActiveTab('metrics')}
              className={`flex items-center space-x-1 px-3 py-2 rounded-md font-medium text-xs transition-all duration-200 ${
                activeTab === 'metrics'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span>💰</span>
              <span>Cash Position</span>
            </button>
            <button
              onClick={() => setActiveTab('financials')}
              className={`flex items-center space-x-1 px-3 py-2 rounded-md font-medium text-xs transition-all duration-200 ${
                activeTab === 'financials'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span>📊</span>
              <span>Financials</span>
            </button>
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex items-center space-x-1 px-3 py-2 rounded-md font-medium text-xs transition-all duration-200 ${
                activeTab === 'overview'
                  ? 'bg-purple-50 text-purple-700 border border-purple-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span>📈</span>
              <span>Latest Updates</span>
            </button>
            <button
              onClick={() => setActiveTab('captable')}
              className={`flex items-center space-x-1 px-3 py-2 rounded-md font-medium text-xs transition-all duration-200 ${
                activeTab === 'captable'
                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span>🏦</span>
              <span>Cap Table</span>
            </button>
            {/* Temporarily hidden - Company Intel tab moved to header 
            <button
              onClick={() => setActiveTab('enrichment')}
              className={`flex items-center space-x-1 px-3 py-2 rounded-md font-medium text-xs transition-all duration-200 ${
                activeTab === 'enrichment'
                  ? 'bg-purple-50 text-purple-700 border border-purple-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span>🚀</span>
              <span>Company Intel</span>
            </button>
            */}
            <button
              onClick={() => setActiveTab('reports')}
              className={`flex items-center space-x-1 px-3 py-2 rounded-md font-medium text-xs transition-all duration-200 ${
                activeTab === 'reports'
                  ? 'bg-teal-50 text-teal-700 border border-teal-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span>📄</span>
              <span>Financial Reports</span>
              <span className="ml-1 px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-xs font-semibold">
                {company.financial_reports.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('database')}
              className={`flex items-center space-x-1 px-3 py-2 rounded-md font-medium text-xs transition-all duration-200 ${
                activeTab === 'database'
                  ? 'bg-gray-100 text-gray-700 border border-gray-300'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <span>🗄️</span>
              <span>Database</span>
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="grid grid-cols-1 gap-6">
          {/* Main Content - Full Width */}
          <div className="w-full">
            {activeTab === 'metrics' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ gridTemplateColumns: '2fr 1.4fr 1fr' }}>
                {/* 1. Combined Cash Position & History - Proportional Width */}
                <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  {/* Header */}
                  <div className="flex items-center space-x-1 mb-3">
                    <span className="text-sm">💰</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Cash Position</h3>
                      <p className="text-gray-600 text-xs">💡 Click values to edit</p>
                    </div>
                  </div>
                  
                  {/* Main Content: Metrics (1/4) + Chart (3/4) */}
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    {/* Metrics - 1/4 width */}
                    <div className="col-span-1">
                      <div className="space-y-2">
                        <EditableMetric
                          label="Cash on Hand"
                          value={(latestReport as any)?.cash_on_hand || 'N/A'}
                          reportId={latestReportId || undefined}
                          field="cash_on_hand"
                          onUpdate={loadCompanyData}
                          isManuallyEdited={(latestReport as any)?.manually_edited || false}
                        />
                        <EditableMetric
                          label="Monthly Burn"
                          value={(latestReport as any)?.monthly_burn_rate || 'N/A'}
                          reportId={latestReportId || undefined}
                          field="monthly_burn_rate"
                          onUpdate={loadCompanyData}
                          isManuallyEdited={(latestReport as any)?.manually_edited || false}
                        />
                        <EditableMetric
                          label="Runway"
                          value={latestReport?.runway || 'N/A'}
                          reportId={latestReportId || undefined}
                          field="runway"
                          onUpdate={loadCompanyData}
                          formatValue={(value) => `${value} months`}
                          parseValue={(value) => parseInt(String(value).replace(/[^0-9]/g, '')) || 0}
                          isManuallyEdited={(latestReport as any)?.manually_edited || false}
                        />
                      </div>
                      
                      <div className="mt-3">
                        <p className="text-xs text-gray-600 mb-1">
                          Cash out: {(latestReport as any)?.cash_out_date || 'N/A'}
                        </p>
                      </div>
                    </div>
                    
                    {/* Chart - 3/4 width */}
                    <div className="col-span-3">
                      <div className="h-64">
                        <SimpleCashChart reports={company.financial_reports} />
                      </div>
                    </div>
                  </div>
                  
                  {/* Runway Progress Bar - Full Width */}
                  <div className="w-full">
                    {(() => {
                      const reportDate = (latestReport as any)?.report_date
                      const cashOutDate = (latestReport as any)?.cash_out_date
                      
                      if (reportDate && cashOutDate) {
                        const start = new Date(reportDate).getTime()
                        const end = new Date(cashOutDate).getTime()
                        const now = Date.now()
                        const total = end - start
                        const elapsed = Math.max(0, now - start)
                        const pctElapsed = Math.min(elapsed / total * 100, 100)
                        
                        const monthsUsed = Math.round(elapsed / 1000 / 60 / 60 / 24 / 30)
                        const monthsLeft = Math.round((total - elapsed) / 1000 / 60 / 60 / 24 / 30)
                        
                        return (
                          <div className="border-t pt-3 mt-2">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-xs font-medium text-gray-900">Runway Progress</h4>
                              <span className="text-xs text-gray-600">
                                {monthsUsed} months used, {monthsLeft} months left
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-3">
                              <div 
                                className="bg-blue-600 h-3 rounded-full transition-all duration-300" 
                                style={{ width: `${pctElapsed}%` }}
                              />
                            </div>
                          </div>
                        )
                      }
                      
                      // Fallback if dates aren't available
                      return (
                        <div className="border-t pt-3 mt-2">
                          <h4 className="text-xs font-medium text-gray-900 mb-2">Runway Progress</h4>
                          <div className="w-full bg-gray-200 rounded-full h-3">
                            <div className="bg-gray-400 h-3 rounded-full" style={{ width: '50%' }}></div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>

                {/* 3. Upcoming Milestones */}
                <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  <div className="flex items-center space-x-1 mb-2">
                    <span className="text-sm">🎯</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Upcoming Milestones</h3>
                      <p className="text-gray-600 text-xs">📅 Key targets and deadlines</p>
                    </div>
                  </div>
                  
                  {(latestReport as any)?.next_milestones ? (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-2 rounded-lg border border-blue-100">
                      <MarkdownContent content={(latestReport as any).next_milestones} className="text-xs" />
                    </div>
                  ) : (
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-3 rounded-lg border-2 border-dashed border-gray-200 text-center">
                      <div className="text-lg mb-1">📋</div>
                      <p className="text-gray-500 text-xs font-medium mb-1">No milestones data available</p>
                      <p className="text-gray-400 text-xs">Upload a recent board deck to see upcoming targets</p>
                    </div>
                  )}
                </div>

                {/* 4. Team */}
                <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-1">
                      <span className="text-sm">👥</span>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">Team</h3>
                        <p className="text-gray-600 text-xs">👤 Key executives</p>
                      </div>
                    </div>
                    {!enrichmentData?.enrichment?.extracted && (
                      <button
                        onClick={() => setActiveTab('enrichment')}
                        className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                      >
                        Enrich →
                      </button>
                    )}
                  </div>
                  
                  <div className="mb-3">
                    <p className="text-xs font-medium text-gray-500 mb-1">Total Employees</p>
                    <p className="text-lg font-bold text-gray-900">
                      {enrichmentData?.enrichment?.extracted?.headcount || '82'} 
                      <span className="text-xs font-normal text-gray-500">
                        {enrichmentData?.enrichment?.extracted?.headcount ? '' : ' (est.)'}
                      </span>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-medium text-gray-900">Key Executives</h4>
                    </div>
                    <div className="space-y-2">
                      {/* CEO - Highlighted */}
                      {enrichmentData?.enrichment?.extracted?.ceo && (
                        <div className="p-2 rounded-lg border-2 border-blue-200 bg-blue-50">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center space-x-1">
                              <span className="text-xs bg-blue-600 text-white px-1 py-0.5 rounded font-medium">CEO</span>
                              {enrichmentData.enrichment.extracted.ceo.enriched_person?.contact?.linkedin_url ? (
                                <a 
                                  href={enrichmentData.enrichment.extracted.ceo.enriched_person.contact.linkedin_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs font-bold text-blue-700 hover:text-blue-900 hover:underline truncate"
                                >
                                  {enrichmentData.enrichment.extracted.ceo.enriched_person?.full_name || enrichmentData.enrichment.extracted.ceo.title}
                                </a>
                              ) : (
                                <p className="text-xs font-bold text-gray-900 truncate">
                                  {enrichmentData.enrichment.extracted.ceo.enriched_person?.full_name || enrichmentData.enrichment.extracted.ceo.title}
                                </p>
                              )}
                            </div>
                            {enrichmentData.enrichment.extracted.ceo.enriched_person?.contact?.linkedin_url && (
                              <span className="text-xs text-blue-600">🔗</span>
                            )}
                          </div>
                          <p className="text-xs text-blue-700 truncate">
                            {enrichmentData.enrichment.extracted.ceo.enriched_person?.current_position?.title || enrichmentData.enrichment.extracted.ceo.title}
                          </p>
                        </div>
                      )}

                      {/* Other Leadership - Compact */}
                      {enrichmentData?.enrichment?.extracted?.leadership && enrichmentData.enrichment.extracted.leadership.length > 0 ? (
                        enrichmentData.enrichment.extracted.leadership
                          .filter((leader: any) => !leader.title?.toLowerCase().includes('ceo') && !leader.title?.toLowerCase().includes('chief executive'))
                          .slice(0, 2)
                          .map((leader: any, index: number) => (
                            <div key={index} className="p-1.5 rounded border border-gray-100">
                              <div className="flex items-center justify-between">
                                {leader.enriched_person?.contact?.linkedin_url ? (
                                  <a 
                                    href={leader.enriched_person.contact.linkedin_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline truncate"
                                  >
                                    {leader.enriched_person?.full_name || leader.title}
                                  </a>
                                ) : (
                                  <p className="text-xs font-medium text-gray-900 truncate">
                                    {leader.enriched_person?.full_name || leader.title}
                                  </p>
                                )}
                                {leader.enriched_person?.contact?.linkedin_url && (
                                  <span className="text-xs text-blue-600 ml-1">🔗</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-600 truncate">
                                {leader.enriched_person?.current_position?.title || leader.title}
                              </p>
                            </div>
                          ))
                      ) : !enrichmentData?.enrichment?.extracted?.ceo ? (
                        // Fallback to static data if no enrichment data
                        <>
                          <div className="p-1.5 rounded border border-gray-100">
                            <p className="text-xs font-medium text-gray-900">Cristóbal Undurraga</p>
                            <p className="text-xs text-gray-600">Co-founder & CEO</p>
                          </div>
                          <div className="p-1.5 rounded border border-gray-100">
                            <p className="text-xs font-medium text-gray-900">Shayle Kann</p>
                            <p className="text-xs text-gray-600">Investor and Board Observer</p>
                          </div>
                        </>
                      ) : null}
                    </div>
                    
                    {!enrichmentData?.enrichment?.extracted && (
                      <div className="mt-2 p-2 bg-purple-50 rounded border border-purple-100">
                        <p className="text-xs text-purple-700">
                          💡 Get real team data with Company Intel
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'financials' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ gridTemplateColumns: '2fr 1.4fr 1fr' }}>
                {/* 1. Financial Overview - Double Width */}
                <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  {/* Header */}
                  <div className="flex items-center space-x-1 mb-3">
                    <span className="text-sm">📊</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Financial Overview</h3>
                      <p className="text-gray-600 text-xs">📈 Comprehensive financial analysis</p>
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200 p-4 rounded-lg text-center">
                    <div className="w-12 h-12 bg-gradient-to-br from-amber-100 to-yellow-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                      <span className="text-xl">🚧</span>
                    </div>
                    <h4 className="text-sm font-bold text-amber-800 mb-2">Work in Progress</h4>
                    <p className="text-amber-700 text-xs leading-relaxed">
                      This comprehensive financials section is currently under development. 
                      It will include detailed financial statements, cash flow analysis, and advanced metrics.
                    </p>
                    <div className="mt-4 flex justify-center space-x-4 text-xs text-amber-600">
                      <div className="flex items-center space-x-1">
                        <span>📊</span>
                        <span>P&L Statements</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <span>💧</span>
                        <span>Cash Flow</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <span>📈</span>
                        <span>Advanced Metrics</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Quick Stats */}
                <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  <div className="flex items-center space-x-1 mb-3">
                    <span className="text-sm">📈</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Quick Stats</h3>
                      <p className="text-gray-600 text-xs">⚡ Key metrics at a glance</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="bg-blue-50 p-2 rounded border border-blue-100">
                      <p className="text-xs text-blue-600 font-medium">Latest Valuation</p>
                      <p className="text-sm font-bold text-blue-900">{formatCurrency(company.current_cap_table?.valuation)}</p>
                    </div>
                    <div className="bg-green-50 p-2 rounded border border-green-100">
                      <p className="text-xs text-green-600 font-medium">Total Raised</p>
                      <p className="text-sm font-bold text-green-900">{formatCurrency(company.current_cap_table?.amount_raised)}</p>
                    </div>
                    <div className="bg-purple-50 p-2 rounded border border-purple-100">
                      <p className="text-xs text-purple-600 font-medium">KV Ownership</p>
                      <p className="text-sm font-bold text-purple-900">{kvStake > 0 ? `${(kvStake * 100).toFixed(1)}%` : 'N/A'}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
                {/* 1. Financial Overview */}
                <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  {/* Header */}
                  <div className="flex items-center space-x-1 mb-3">
                    <span className="text-sm">💼</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Company Overview</h3>
                      <p className="text-gray-600 text-xs">📊 Financial performance and projections</p>
                    </div>
                  </div>
                  
                  {latestReport ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-2 rounded border border-blue-100">
                        <div className="flex items-center space-x-1 mb-1">
                          <span className="text-xs">📊</span>
                          <h4 className="font-semibold text-blue-900 text-xs">Financial Summary</h4>
                        </div>
                        <MarkdownContent content={(latestReport as any).financial_summary || 'No financial summary available'} className="text-xs text-blue-800" />
                      </div>
                      
                      <div className="bg-gradient-to-br from-purple-50 to-pink-50 p-2 rounded border border-purple-100">
                        <div className="flex items-center space-x-1 mb-1">
                          <span className="text-xs">⚖️</span>
                          <h4 className="font-semibold text-purple-900 text-xs">Budget vs Actual</h4>
                        </div>
                        <MarkdownContent content={(latestReport as any).budget_vs_actual || 'N/A'} className="text-xs text-purple-800" />
                      </div>
                      
                      {(latestReport as any)?.personnel_updates && (
                        <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-2 rounded border border-green-100">
                          <div className="flex items-center space-x-1 mb-1">
                            <span className="text-xs">👥</span>
                            <h4 className="font-semibold text-green-900 text-xs">Personnel Updates</h4>
                          </div>
                          <MarkdownContent content={(latestReport as any).personnel_updates} className="text-xs" />
                        </div>
                      )}
                      
                      {(latestReport as any)?.key_risks && (
                        <div className="bg-gradient-to-br from-red-50 to-pink-50 p-2 rounded border border-red-100">
                          <div className="flex items-center space-x-1 mb-1">
                            <span className="text-xs">⚠️</span>
                            <h4 className="font-semibold text-red-900 text-xs">Key Risks</h4>
                          </div>
                          <MarkdownContent content={(latestReport as any).key_risks} className="text-xs" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-4 rounded border-2 border-dashed border-gray-200 text-center">
                      <div className="text-lg mb-2">📊</div>
                      <p className="text-gray-500 font-medium mb-1 text-xs">No financial reports available</p>
                      <p className="text-gray-400 text-xs">Upload board decks to see financial insights</p>
                    </div>
                  )}
                </div>

                {/* 2. Sector Updates */}
                <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  <div className="flex items-center space-x-1 mb-3">
                    <span className="text-sm">{sectorLabels.icon}</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Sector Updates</h3>
                      <p className="text-gray-600 text-xs">🎯 Industry-specific analysis</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    {/* Sector Highlight A */}
                    <div>
                      <div className="flex items-center space-x-1 mb-1">
                        <span className="text-xs">{sectorLabels.icon}</span>
                        <h4 className="font-semibold text-orange-900 text-xs">{sectorLabels.highlightA}</h4>
                      </div>
                      {(latestReport as any)?.sector_highlight_a ? (
                        <div className="bg-gradient-to-br from-orange-50 to-amber-50 p-2 rounded border border-orange-100">
                          <MarkdownContent content={(latestReport as any).sector_highlight_a} className="text-xs" />
                        </div>
                      ) : (
                        <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-2 rounded border-2 border-dashed border-gray-200 text-center">
                          <div className="text-sm mb-1">{sectorLabels.icon}</div>
                          <p className="text-gray-500 text-xs font-medium mb-1">No {sectorLabels.highlightA.toLowerCase()} data</p>
                        </div>
                      )}
                    </div>

                    {/* Sector Highlight B */}
                    <div>
                      <div className="flex items-center space-x-1 mb-1">
                        <span className="text-xs">🔬</span>
                        <h4 className="font-semibold text-indigo-900 text-xs">{sectorLabels.highlightB}</h4>
                      </div>
                      {(latestReport as any)?.sector_highlight_b ? (
                        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-2 rounded border border-indigo-100">
                          <MarkdownContent content={(latestReport as any).sector_highlight_b} className="text-xs" />
                        </div>
                      ) : (
                        <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-2 rounded border-2 border-dashed border-gray-200 text-center">
                          <div className="text-sm mb-1">🔬</div>
                          <p className="text-gray-500 text-xs font-medium mb-1">No {sectorLabels.highlightB.toLowerCase()} data</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'captable' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ gridTemplateColumns: '2fr 1.4fr 1fr' }}>
                {/* 1. Cap Table - Double Width */}
                <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  {/* Header */}
                  <div className="flex items-center space-x-1 mb-3">
                    <span className="text-sm">🏦</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Cap Table</h3>
                      <p className="text-gray-600 text-xs">💼 Ownership structure and investment details</p>
                    </div>
                  </div>
                  
                  {company.current_cap_table && sortedInvestors.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Investor</th>
                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Invested</th>
                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Round</th>
                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">FDS Ownership</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {sortedInvestors.map((investor, index: number) => {
                            const isKV = investor.investor_name.startsWith('KV')
                            return (
                              <tr key={index} className={isKV ? 'bg-blue-50' : ''}>
                                <td className="px-2 py-1 whitespace-nowrap">
                                  <div className="flex items-center">
                                    <div className="text-xs font-medium text-gray-900">
                                      {investor.investor_name}
                                      {isKV && <span className="ml-1 text-blue-600 text-xs">🏠 KV</span>}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-2 py-1 whitespace-nowrap text-xs text-gray-900">
                                  {formatCurrency(investor.total_invested)}
                                </td>
                                <td className="px-2 py-1 whitespace-nowrap text-xs text-gray-900">
                                  {formatCurrency(investor.final_round_investment)}
                                </td>
                                <td className="px-2 py-1 whitespace-nowrap text-xs text-gray-900">
                                  {investor.final_fds 
                                    ? `${(investor.final_fds * 100).toFixed(1)}%`
                                    : 'N/A'
                                  }
                                </td>
                              </tr>
                            )
                          })}
                          {/* Employee Option Pool Row */}
                          {company.current_cap_table && (company.current_cap_table.total_pool_size || company.current_cap_table.pool_available) && (
                            <tr className="bg-amber-50 border-t-2 border-amber-200">
                              <td className="px-2 py-1 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="text-xs font-medium text-amber-800">
                                    Employee Option Pool
                                    <span className="ml-1 text-amber-600 text-xs">🎯 Options</span>
                                  </div>
                                </div>
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-xs text-gray-600">
                                N/A
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-xs text-gray-600">
                                N/A
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-xs text-amber-800 font-medium">
                                {(() => {
                                  const totalPool = company.current_cap_table.total_pool_size || 0
                                  const poolAvailable = company.current_cap_table.pool_available || 0
                                  const poolUsed = totalPool - poolAvailable
                                  
                                  if (totalPool > 0) {
                                    return `${(totalPool * 100).toFixed(1)}% (${poolUsed > 0 ? `${(poolUsed * 100).toFixed(1)}% used, ` : ''}${(poolAvailable * 100).toFixed(1)}% available)`
                                  }
                                  return 'N/A'
                                })()}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 text-center">
                      <div className="text-gray-400 text-lg mb-2">📊</div>
                      <h4 className="text-xs font-medium text-gray-900 mb-2">No Cap Table Data</h4>
                      <p className="text-gray-500 text-xs">Upload a cap table document to see ownership structure and investor details.</p>
                    </div>
                  )}
                </div>

                {/* 2. Summary Stats */}
                <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  <div className="flex items-center space-x-1 mb-3">
                    <span className="text-sm">📊</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Summary</h3>
                      <p className="text-gray-600 text-xs">⚡ Key ownership metrics</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="bg-blue-50 p-2 rounded border border-blue-100">
                      <p className="text-xs text-blue-600 font-medium">Total Valuation</p>
                      <p className="text-sm font-bold text-blue-900">{formatCurrency(company.current_cap_table?.valuation)}</p>
                    </div>
                    <div className="bg-green-50 p-2 rounded border border-green-100">
                      <p className="text-xs text-green-600 font-medium">Total Raised</p>
                      <p className="text-sm font-bold text-green-900">{formatCurrency(company.current_cap_table?.amount_raised)}</p>
                    </div>
                    <div className="bg-purple-50 p-2 rounded border border-purple-100">
                      <p className="text-xs text-purple-600 font-medium">KV Ownership</p>
                      <p className="text-sm font-bold text-purple-900">{kvStake > 0 ? `${(kvStake * 100).toFixed(1)}%` : 'N/A'}</p>
                    </div>
                    <div className="bg-orange-50 p-2 rounded border border-orange-100">
                      <p className="text-xs text-orange-600 font-medium">Total Investors</p>
                      <p className="text-sm font-bold text-orange-900">{sortedInvestors.length}</p>
                    </div>
                    {company.current_cap_table?.total_pool_size && (
                      <div className="bg-amber-50 p-2 rounded border border-amber-100">
                        <p className="text-xs text-amber-600 font-medium">Option Pool</p>
                        <p className="text-sm font-bold text-amber-900">
                          {(company.current_cap_table.total_pool_size * 100).toFixed(1)}%
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'reports' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ gridTemplateColumns: '2fr 1.4fr 1fr' }}>
                {/* 1. Reports Table - Double Width */}
                <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  {/* Header */}
                  <div className="flex items-center space-x-1 mb-3">
                    <span className="text-sm">📄</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Financial Documents</h3>
                      <p className="text-gray-600 text-xs">📋 Key financial reports and statements</p>
                    </div>
                  </div>
                  
                  {company.financial_reports.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Upload Date</th>
                            <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {company.financial_reports.map((report, index: number) => (
                            <tr key={index}>
                              <td className="px-2 py-1 whitespace-nowrap text-xs font-medium text-gray-900">
                                {(report as any).file_name}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap">
                                <span className="px-1 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                                  {(report as any).report_period}
                                </span>
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-xs text-gray-900">
                                {(report as any).processed_at ? new Date((report as any).processed_at).toLocaleDateString() : 'N/A'}
                              </td>
                              <td className="px-2 py-1 whitespace-nowrap text-xs text-blue-600 hover:text-blue-700">
                                <button>View</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-4 text-center">
                      <div className="text-gray-400 text-lg mb-2">📄</div>
                      <h4 className="text-xs font-medium text-gray-900 mb-2">No Financial Reports</h4>
                      <p className="text-gray-500 text-xs">Upload board decks or financial statements to track company performance and metrics.</p>
                    </div>
                  )}
                </div>

                {/* 2. Report Stats */}
                <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  <div className="flex items-center space-x-1 mb-3">
                    <span className="text-sm">📊</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Report Stats</h3>
                      <p className="text-gray-600 text-xs">⚡ Document summary</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="bg-blue-50 p-2 rounded border border-blue-100">
                      <p className="text-xs text-blue-600 font-medium">Total Reports</p>
                      <p className="text-sm font-bold text-blue-900">{company.financial_reports.length}</p>
                    </div>
                    <div className="bg-green-50 p-2 rounded border border-green-100">
                      <p className="text-xs text-green-600 font-medium">Latest Report</p>
                      <p className="text-sm font-bold text-green-900">
                        {latestReport ? new Date((latestReport as any).report_date).toLocaleDateString() : 'N/A'}
                      </p>
                    </div>
                    <div className="bg-purple-50 p-2 rounded border border-purple-100">
                      <p className="text-xs text-purple-600 font-medium">Report Period</p>
                      <p className="text-sm font-bold text-purple-900">
                        {(latestReport as any)?.report_period || 'N/A'}
                      </p>
                    </div>
                    <div className="bg-orange-50 p-2 rounded border border-orange-100">
                      <p className="text-xs text-orange-600 font-medium">Processing Status</p>
                      <p className="text-sm font-bold text-orange-900">
                        {(latestReport as any)?.processing_status || 'Complete'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}



            {/* Database Tab */}
            {activeTab === 'database' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ gridTemplateColumns: '2fr 1.4fr 1fr' }}>
                {/* 1. Database Editor - Double Width */}
                <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  {/* Header */}
                  <div className="flex items-center space-x-1 mb-3">
                    <span className="text-sm">🗄️</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Database Editor</h3>
                      <p className="text-gray-600 text-xs">⚡ Direct database access and editing tools</p>
                    </div>
                  </div>
                  <UniversalDatabaseEditor 
                    companyId={companyId} 
                    onUpdate={loadCompanyData}
                  />
                </div>

                {/* 2. Database Stats */}
                <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
                  <div className="flex items-center space-x-1 mb-3">
                    <span className="text-sm">📊</span>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Database Stats</h3>
                      <p className="text-gray-600 text-xs">⚡ System information</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="bg-blue-50 p-2 rounded border border-blue-100">
                      <p className="text-xs text-blue-600 font-medium">Company ID</p>
                      <p className="text-sm font-bold text-blue-900">{companyId}</p>
                    </div>
                    <div className="bg-green-50 p-2 rounded border border-green-100">
                      <p className="text-xs text-green-600 font-medium">Financial Reports</p>
                      <p className="text-sm font-bold text-green-900">{company.financial_reports.length}</p>
                    </div>
                    <div className="bg-purple-50 p-2 rounded border border-purple-100">
                      <p className="text-xs text-purple-600 font-medium">Cap Table Rounds</p>
                      <p className="text-sm font-bold text-purple-900">{company.current_cap_table ? '1' : '0'}</p>
                    </div>
                    <div className="bg-orange-50 p-2 rounded border border-orange-100">
                      <p className="text-xs text-orange-600 font-medium">Enrichment Data</p>
                      <p className="text-sm font-bold text-orange-900">
                        {enrichmentData?.enrichment?.extracted ? 'Available' : 'None'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Enrichment Tab - Temporarily hidden, functionality moved to header */}
            {false && activeTab === 'enrichment' && (
              <div className="space-y-4">
                {/* Enrichment Input Section */}
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 p-4 rounded-lg border border-purple-100">
                  <div className="flex items-center space-x-2 mb-3">
                    <span className="text-lg">🚀</span>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Company Intelligence</h3>
                      <p className="text-gray-600 text-xs">🌟 Enrich with real data from Harmonic AI</p>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Identifier Type
                        </label>
                        <select
                          value={identifierType}
                          onChange={(e) => setIdentifierType(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        >
                          <option value="website_url">Website URL</option>
                          <option value="website_domain">Website Domain</option>
                          <option value="linkedin_url">LinkedIn URL</option>
                          <option value="crunchbase_url">Crunchbase URL</option>
                          <option value="twitter_url">Twitter URL</option>
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {identifierType === 'website_url' ? 'Website URL' :
                           identifierType === 'website_domain' ? 'Domain (e.g., company.com)' :
                           identifierType === 'linkedin_url' ? 'LinkedIn Company URL' :
                           identifierType === 'crunchbase_url' ? 'Crunchbase URL' :
                           'Twitter URL'}
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={websiteUrl}
                            onChange={(e) => setWebsiteUrl(e.target.value)}
                            placeholder={
                              identifierType === 'website_url' ? 'https://company.com' :
                              identifierType === 'website_domain' ? 'company.com' :
                              identifierType === 'linkedin_url' ? 'https://linkedin.com/company/...' :
                              identifierType === 'crunchbase_url' ? 'https://crunchbase.com/organization/...' :
                              'https://twitter.com/company'
                            }
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                            onKeyPress={(e) => e.key === 'Enter' && handleEnrichCompany()}
                          />
                          <button
                            onClick={handleEnrichCompany}
                            disabled={loadingEnrichment || !websiteUrl.trim()}
                            className="px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center"
                          >
                            {loadingEnrichment ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                Enriching...
                              </>
                            ) : (
                              'Enrich Data'
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    

                  </div>
                </div>

                {/* Enrichment Results */}
                {loadingEnrichment && !enrichmentData && (
                  <div className="bg-white p-6 rounded-xl border border-gray-200">
                    <div className="animate-pulse space-y-4">
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                      <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                      <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                    </div>
                  </div>
                )}

                {enrichmentData && (
                  <div className="space-y-6">
                    {enrichmentData.status === 'enrichment_in_progress' ? (
                      <div className="bg-yellow-50 border border-yellow-200 p-6 rounded-xl">
                        <h4 className="text-lg font-medium text-yellow-800 mb-2">Enrichment In Progress</h4>
                        <p className="text-yellow-700">{enrichmentData.message}</p>
                        <p className="text-sm text-yellow-600 mt-2">
                          Estimated completion: {enrichmentData.estimated_completion}
                        </p>
                      </div>
                    ) : enrichmentData.enrichment?.extracted ? (
                      <div className="space-y-4">
                        {/* Hero Overview Section */}
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-100">
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            {/* Company Logo & Basic Info */}
                            <div className="lg:col-span-1">
                              {enrichmentData.enrichment.extracted.logo_url ? (
                                <img
                                  src={enrichmentData.enrichment.extracted.logo_url}
                                  alt={`${enrichmentData.enrichment.extracted.name} logo`}
                                  className="w-12 h-12 rounded-lg object-cover mb-2 shadow-sm"
                                />
                              ) : (
                                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center mb-2">
                                  <span className="text-white text-lg font-bold">
                                    {enrichmentData.enrichment.extracted.name?.charAt(0)?.toUpperCase() || 'C'}
                                  </span>
                          </div>
                              )}
                              <h2 className="text-lg font-bold text-gray-900 mb-1">
                                {enrichmentData.enrichment.extracted.name || 'Unknown Company'}
                              </h2>
                              <p className="text-gray-600 mb-3 text-sm">
                                {enrichmentData.enrichment.extracted.short_description || enrichmentData.enrichment.extracted.description}
                              </p>
                              
                              {/* Quick Stats */}
                              <div className="grid grid-cols-2 gap-2 mb-3">
                                <div className="bg-white/70 p-2 rounded">
                                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Founded</p>
                                  <p className="text-sm font-bold text-gray-900">
                                    {enrichmentData.enrichment.extracted.founding_date || 'N/A'}
                                  </p>
                                </div>
                                <div className="bg-white/70 p-2 rounded">
                                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Stage</p>
                                  <p className="text-sm font-bold text-gray-900">
                                    {enrichmentData.enrichment.extracted.stage || 'N/A'}
                                  </p>
                                </div>
                              </div>
                              
                              {/* Key Metrics Stack */}
                              <div className="space-y-2 mb-3">
                                <div className="bg-white p-2 rounded border border-gray-200">
                                  <div className="flex items-center space-x-2">
                                    <span className="text-sm">👥</span>
                                    <div className="text-left">
                                      <p className="text-sm font-bold text-gray-900">
                                        {formatNumber(enrichmentData.enrichment.extracted.headcount) || '97'}
                                      </p>
                                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Employees</p>
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="bg-white p-2 rounded border border-gray-200">
                                  <div className="flex items-center space-x-2">
                                    <span className="text-sm">💰</span>
                                    <div className="text-left">
                                      <p className="text-sm font-bold text-gray-900">
                                        {formatLargeNumber(enrichmentData.enrichment.extracted.funding?.total) || '$61.0M'}
                                      </p>
                                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Funding</p>
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="bg-white p-2 rounded border border-gray-200">
                                  <div className="flex items-center space-x-2">
                                    <span className="text-sm">🌐</span>
                                    <div className="text-left">
                                      <p className="text-sm font-bold text-gray-900">
                                        {formatNumber(enrichmentData.enrichment.extracted.web_traffic) || '28K'}
                                      </p>
                                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Monthly Traffic</p>
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="bg-white p-2 rounded border border-gray-200">
                                  <div className="flex items-center space-x-2">
                                    <span className="text-sm">🏢</span>
                                    <div className="text-left">
                                      <p className="text-sm font-bold text-gray-900">
                                        {enrichmentData.enrichment.extracted.investors?.length || '15'}
                                      </p>
                                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Investors</p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Contact */}
                              {enrichmentData.enrichment.extracted.contact && (
                                <div className="bg-white p-4 rounded-xl border border-gray-200 mb-4">
                                  <div className="flex items-center space-x-3 mb-3">
                                    <span className="text-lg">📧</span>
                                    <h4 className="font-semibold text-gray-900 text-sm">Contact</h4>
                                  </div>
                                  {enrichmentData.enrichment.extracted.contact.primary_email && (
                                    <p className="text-gray-700 font-medium text-sm">
                                      {enrichmentData.enrichment.extracted.contact.primary_email}
                                    </p>
                                  )}
                                  {enrichmentData.enrichment.extracted.contact.phone && (
                                    <p className="text-gray-700 font-medium text-sm">
                                      {enrichmentData.enrichment.extracted.contact.phone}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                            
                            {/* Company Description */}
                            <div className="lg:col-span-2">
                              
                              {/* Company Description */}
                              {(enrichmentData.enrichment.extracted.description || enrichmentData.enrichment.extracted.external_description) && (
                                <div className="mb-8">
                                  <div className="bg-white p-6 rounded-xl border border-gray-200">
                                    <div className="flex items-center space-x-3 mb-4">
                                      <span className="text-xl">📝</span>
                                      <h3 className="text-lg font-semibold text-gray-900">Company Overview</h3>
                                    </div>
                                    <div className="space-y-3">
                                      {enrichmentData.enrichment.extracted.description && (
                                        <div>
                                          <p className="text-sm font-medium text-gray-700 mb-2">Description</p>
                                          <p className="text-gray-600 leading-relaxed">
                                            {enrichmentData.enrichment.extracted.description}
                                          </p>
                                        </div>
                                      )}
                                      {enrichmentData.enrichment.extracted.external_description && enrichmentData.enrichment.extracted.external_description !== enrichmentData.enrichment.extracted.description && (
                                        <div>
                                          <p className="text-sm font-medium text-gray-700 mb-2">External Description</p>
                                          <p className="text-gray-600 leading-relaxed">
                                            {enrichmentData.enrichment.extracted.external_description}
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}


                            </div>
                          </div>
                        </div>

                        {/* Main Content Grid */}
                        <div className="grid grid-cols-1 gap-8">
                          {/* Funding & Investors */}
                          <div>
                            {enrichmentData.enrichment.extracted.funding && (
                              <div className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm mb-8">
                                <div className="flex items-center space-x-3 mb-8">
                                  <span className="text-2xl">💎</span>
                                  <h3 className="text-xl font-bold text-gray-900">Funding Intelligence</h3>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                                  <div className="text-center p-6 bg-green-50 rounded-xl border border-green-100 min-h-[100px] flex flex-col justify-center">
                                    <p className="text-xl font-bold text-green-600 mb-2 truncate">
                                      {formatLargeNumber(enrichmentData.enrichment.extracted.funding.total)}
                                    </p>
                                    <p className="text-sm font-medium text-gray-600">Total Raised</p>
                                  </div>
                                  <div className="text-center p-6 bg-purple-50 rounded-xl border border-purple-100 min-h-[100px] flex flex-col justify-center">
                                    <p className="text-xl font-bold text-purple-600 mb-2 truncate">
                                      {enrichmentData.enrichment.extracted.funding.stage}
                                    </p>
                                    <p className="text-sm font-medium text-gray-600">Current Stage</p>
                                  </div>
                                  <div className="text-center p-6 bg-blue-50 rounded-xl border border-blue-100 min-h-[100px] flex flex-col justify-center">
                                    <p className="text-xl font-bold text-blue-600 mb-2 truncate">
                                      {formatLargeNumber(enrichmentData.enrichment.extracted.funding.valuation) || 'N/A'}
                                    </p>
                                    <p className="text-sm font-medium text-gray-600">Valuation</p>
                                  </div>
                                </div>
                                
                                {/* Investors */}
                                {enrichmentData.enrichment.extracted.investors && enrichmentData.enrichment.extracted.investors.length > 0 && (
                                <div className="pt-6 border-t border-gray-100">
                                    <h4 className="font-semibold text-gray-900 mb-4">Key Investors</h4>
                                    <div className="flex flex-wrap gap-3">
                                      {enrichmentData.enrichment.extracted.investors.map((investor: any, index: number) => (
                                        <span key={index} className="px-4 py-2 bg-gradient-to-r from-gray-50 to-gray-100 text-gray-700 text-sm font-medium rounded-full border border-gray-200 hover:shadow-sm transition-shadow">
                                          {investor.name || investor}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Traction Metrics */}
                            {enrichmentData.enrichment.extracted.traction_metrics && Object.keys(enrichmentData.enrichment.extracted.traction_metrics).length > 0 && (
                              <div className="bg-white p-6 rounded-xl border border-gray-200">
                                <div className="flex items-center space-x-2 mb-6">
                                  <span className="text-2xl">📈</span>
                                  <h3 className="text-xl font-bold text-gray-900">Traction & Growth</h3>
                                </div>
                                
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  {Object.entries(enrichmentData.enrichment.extracted.traction_metrics).slice(0, 6).map(([metric, data]: [string, any]) => (
                                    <div key={metric} className="p-4 border border-gray-200 rounded-lg">
                                      <p className="text-sm font-medium text-gray-500 capitalize mb-1">
                                        {metric.replace(/_/g, ' ')}
                                      </p>
                                      <p className="text-xl font-bold text-gray-900 mb-2">
                                        {formatNumber(data.latest_value)}
                                      </p>
                                      {data.growth_30d && (
                                        <div className="flex items-center space-x-1">
                                          <span className={`text-sm ${data.growth_30d > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {data.growth_30d > 0 ? '↗' : '↘'} {Math.abs(data.growth_30d).toFixed(1)}%
                                          </span>
                                          <span className="text-xs text-gray-500">30d</span>
                                </div>
                                      )}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}
                          </div>
                        </div>

                        {/* Additional Sections */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                          {/* Employee Highlights */}
                          {enrichmentData.enrichment.extracted.employee_highlights && Object.keys(enrichmentData.enrichment.extracted.employee_highlights).length > 0 && (
                            <div className="bg-white p-6 rounded-xl border border-gray-200">
                              <div className="flex items-center space-x-2 mb-6">
                                <span className="text-2xl">🌟</span>
                                <h3 className="text-xl font-bold text-gray-900">Talent Highlights</h3>
                              </div>
                              
                              {Object.entries(enrichmentData.enrichment.extracted.employee_highlights).slice(0, 3).map(([category, highlights]: [string, any]) => (
                                <div key={category} className="mb-4">
                                  <h4 className="font-semibold text-gray-700 mb-2">{category}</h4>
                                  <div className="space-y-1">
                                    {highlights.slice(0, 3).map((highlight: string, index: number) => (
                                      <p key={index} className="text-sm text-gray-600 pl-3 border-l-2 border-gray-200">
                                        {highlight}
                                      </p>
                                    ))}
                                </div>
                              </div>
                              ))}
                          </div>
                        )}

                          {/* Tags & Industry */}
                          <div className="bg-white p-6 rounded-xl border border-gray-200">
                            <div className="flex items-center space-x-2 mb-6">
                              <span className="text-2xl">🏷️</span>
                              <h3 className="text-xl font-bold text-gray-900">Industry & Tags</h3>
                        </div>

                            {/* Company Type & Customer Type */}
                            <div className="mb-4">
                              <div className="flex flex-wrap gap-2 mb-3">
                                {enrichmentData.enrichment.extracted.company_type && (
                                  <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                                    {enrichmentData.enrichment.extracted.company_type}
                                  </span>
                                )}
                                {enrichmentData.enrichment.extracted.customer_type && (
                                  <span className="px-3 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full">
                                    {enrichmentData.enrichment.extracted.customer_type}
                                  </span>
                                )}
                                {enrichmentData.enrichment.extracted.ownership_status && (
                                  <span className="px-3 py-1 bg-purple-100 text-purple-800 text-sm font-medium rounded-full">
                                    {enrichmentData.enrichment.extracted.ownership_status}
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            {/* Tags v2 grouped by type */}
                            {enrichmentData.enrichment.extracted.tags_v2 && Object.keys(enrichmentData.enrichment.extracted.tags_v2).length > 0 && (
                              <div className="space-y-3">
                                {Object.entries(enrichmentData.enrichment.extracted.tags_v2).slice(0, 3).map(([type, tags]: [string, any]) => (
                                  <div key={type}>
                                    <p className="text-sm font-medium text-gray-700 mb-2 capitalize">
                                      {type.replace(/_/g, ' ')}
                                    </p>
                                    <div className="flex flex-wrap gap-1">
                                      {tags.slice(0, 5).map((tag: string, index: number) => (
                                        <span key={index} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                          </div>
                        )}

                            {/* Legacy tags if no tags_v2 */}
                            {(!enrichmentData.enrichment.extracted.tags_v2 || Object.keys(enrichmentData.enrichment.extracted.tags_v2).length === 0) && enrichmentData.enrichment.extracted.tags && (
                              <div className="flex flex-wrap gap-2">
                                {enrichmentData.enrichment.extracted.tags.slice(0, 8).map((tag: string, index: number) => (
                                  <span key={index} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Bottom Section - Social & Related Companies */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                          {/* Social Links & Contact */}
                          <div className="bg-white p-6 rounded-xl border border-gray-200">
                            <div className="flex items-center space-x-2 mb-6">
                              <span className="text-2xl">🔗</span>
                              <h3 className="text-xl font-bold text-gray-900">Online Presence</h3>
                            </div>
                            
                            {/* Website */}
                            {enrichmentData.enrichment.extracted.website && (
                              <div className="mb-4">
                                <a
                                  href={enrichmentData.enrichment.extracted.website.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center space-x-2 text-blue-600 hover:text-blue-700 font-medium"
                                >
                                  <span>🌐</span>
                                  <span>{enrichmentData.enrichment.extracted.website.domain}</span>
                                </a>
                              </div>
                            )}
                            
                            {/* Social Media */}
                            {enrichmentData.enrichment.extracted.socials && (
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {Object.entries(enrichmentData.enrichment.extracted.socials).map(([platform, data]: [string, any]) => (
                                  <a
                                    key={platform}
                                    href={data.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                    className="flex flex-col p-3 hover:bg-gray-50 rounded-lg transition-colors border border-gray-100"
                                  >
                                    <span className="capitalize font-medium text-gray-700 text-sm">{platform}</span>
                                    {data.handle && (
                                      <span className="text-gray-500 text-xs">@{data.handle}</span>
                                    )}
                                    {data.followers && (
                                      <span className="text-gray-400 text-xs">
                                        {formatNumber(data.followers)} followers
                                      </span>
                                    )}
                                  </a>
                                ))}
                              </div>
                            )}
                            

                          </div>

                          {/* Related Companies */}
                          {enrichmentData.enrichment.extracted.related_companies && (
                            <div className="bg-white p-6 rounded-xl border border-gray-200">
                              <div className="flex items-center space-x-2 mb-6">
                                <span className="text-2xl">🏢</span>
                                <h3 className="text-xl font-bold text-gray-900">Company Network</h3>
                              </div>
                              
                              {enrichmentData.enrichment.extracted.related_companies.acquisitions && enrichmentData.enrichment.extracted.related_companies.acquisitions.length > 0 && (
                                <div className="mb-6">
                                  <p className="text-sm font-medium text-gray-700 mb-3">Acquisitions</p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {enrichmentData.enrichment.extracted.related_companies.acquisitions.slice(0, 8).map((acquisition: any, index: number) => (
                                      <div key={index} className="flex items-center space-x-2 p-2 bg-green-50 rounded-lg border border-green-100">
                                        <span className="text-green-600">📈</span>
                                        <span className="text-sm text-gray-700 font-medium">
                                          {translateCompanyUrn(acquisition)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {enrichmentData.enrichment.extracted.related_companies.subsidiaries && enrichmentData.enrichment.extracted.related_companies.subsidiaries.length > 0 && (
                                <div className="mb-6">
                                  <p className="text-sm font-medium text-gray-700 mb-3">Subsidiaries</p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {enrichmentData.enrichment.extracted.related_companies.subsidiaries.slice(0, 8).map((subsidiary: any, index: number) => (
                                      <div key={index} className="flex items-center space-x-2 p-2 bg-blue-50 rounded-lg border border-blue-100">
                                        <span className="text-blue-600">🏢</span>
                                        <span className="text-sm text-gray-700 font-medium">
                                          {translateCompanyUrn(subsidiary)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {enrichmentData.enrichment.extracted.related_companies.acquired_by && (
                                <div className="mb-4">
                                  <p className="text-sm font-medium text-gray-700 mb-3">Acquired By</p>
                                  <div className="flex items-center space-x-2 p-3 bg-purple-50 rounded-lg border border-purple-100">
                                    <span className="text-purple-600">🎯</span>
                                    <span className="text-sm text-gray-700 font-medium">
                                      {translateCompanyUrn(enrichmentData.enrichment.extracted.related_companies.acquired_by)}
                                    </span>
                                  </div>
                                </div>
                              )}
                              
                              {/* Prior Stealth Association */}
                              {enrichmentData.enrichment.extracted.related_companies.prior_stealth_association && 
                               enrichmentData.enrichment.extracted.related_companies.prior_stealth_association.previously_known_as && 
                               enrichmentData.enrichment.extracted.related_companies.prior_stealth_association.previously_known_as.length > 0 && (
                                <div className="mb-4">
                                  <p className="text-sm font-medium text-gray-700 mb-3">Previously Known As</p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {enrichmentData.enrichment.extracted.related_companies.prior_stealth_association.previously_known_as.slice(0, 6).map((prevName: string, index: number) => (
                                      <div key={index} className="flex items-center space-x-2 p-2 bg-yellow-50 rounded-lg border border-yellow-100">
                                        <span className="text-yellow-600">📝</span>
                                        <span className="text-sm text-gray-700 font-medium">
                                          {prevName}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {/* Beta Notice */}
                              {enrichmentData.enrichment.extracted.related_companies.beta_notice && (
                                <div className="mb-4">
                                  <div className="flex items-center space-x-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
                                    <span className="text-blue-600">ℹ️</span>
                                    <span className="text-xs text-blue-700">
                                      {enrichmentData.enrichment.extracted.related_companies.beta_notice}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>


                      </div>
                    ) : (
                      <div className="bg-red-50 border border-red-200 p-6 rounded-xl">
                        <h4 className="text-lg font-medium text-red-800 mb-2">Enrichment Failed</h4>
                        <p className="text-red-700">
                          {enrichmentData.error || 'Unable to enrich company data at this time.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
} 