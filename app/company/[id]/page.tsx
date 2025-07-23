'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getCompanyOverview } from '@/lib/api'
import EditableMetric from '@/components/EditableMetric'
import UniversalDatabaseEditor from '@/components/UniversalDatabaseEditor'
import { CompanyOverview, CapTableInvestor, FinancialReport } from '@/types'

// Company name normalization for display
const normalizeCompanyName = (name: string): string => {
  return name
    .replace(/\b(corp|corporation|inc|incorporated|ltd|limited|llc|co\.?)\b/gi, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

type TabType = 'metrics' | 'overview' | 'cap-table' | 'competitors' | 'documents' | 'reports' | 'captable' | 'database'

// Simple chart component for cash history
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

  console.log('Raw reports data:', reports)
  console.log('Reports length:', reports?.length || 0)

  // Extract cash amounts and dates from reports with better error handling
  const chartData = reports
    .map((report, index) => {
      console.log(`Report ${index}:`, {
        cash_on_hand: (report as any).cash_on_hand,
        report_date: (report as any).report_date,
        report_period: (report as any).report_period
      })
      return report
    })
    .filter(report => {
      const cashValue = (report as any).cash_on_hand
      return cashValue && 
             cashValue !== 'N/A' && 
             cashValue !== '' && 
             (typeof cashValue === 'string' || typeof cashValue === 'number') &&
             String(cashValue).match(/\d/)
    })
    .map(report => {
      const cashStr = String((report as any).cash_on_hand || '0')
      const dateStr = (report as any).report_date || (report as any).reportDate
      
      // Parse cash amount more robustly
      let cashValue = 0
      try {
        // Remove currency symbols and convert to number
        const cleanCash = cashStr.replace(/[$,M\s]/gi, '').trim()
        cashValue = parseFloat(cleanCash)
        
        // If original had 'M' suffix, treat as millions, otherwise as raw number
        if (cashStr.toLowerCase().includes('m')) {
          // Already in millions
        } else if (cashValue > 1000000) {
          // Convert large numbers to millions
          cashValue = cashValue / 1000000
        }
      } catch (e) {
        console.warn('Failed to parse cash value:', cashStr, e)
        cashValue = 0
      }

      let reportDate = new Date()
      try {
        if (dateStr) {
          reportDate = new Date(dateStr)
          if (isNaN(reportDate.getTime())) {
            console.warn('Invalid date:', dateStr)
            reportDate = new Date()
          }
        }
      } catch (e) {
        console.warn('Failed to parse date:', dateStr, e)
      }

      return {
        date: reportDate,
        cash: cashValue,
        period: (report as any).report_period || 'Unknown',
        originalCash: cashStr
      }
    })
    .filter(item => item.cash > 0) // Only show positive cash values
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  console.log('Processed chart data:', chartData)

  if (chartData.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg p-6 h-48 flex items-center justify-center">
        <div className="text-center">
          <div className="text-yellow-400 text-2xl mb-2">⚠️</div>
          <p className="text-gray-500">No parseable cash data found</p>
          <p className="text-gray-400 text-sm">Check that reports contain cash amounts</p>
          <div className="mt-2 text-xs text-gray-400">
            Found {reports.length} reports, none with valid cash data
          </div>
        </div>
      </div>
    )
  }

  const maxCash = Math.max(...chartData.map(d => d.cash))
  const minCash = Math.min(...chartData.map(d => d.cash))
  const range = maxCash - minCash || 1

  return (
    <div className="bg-gray-50 rounded-lg p-6 h-48">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-medium text-gray-900">Cash History</h4>
        <span className="text-sm text-gray-500">{chartData.length} data points</span>
      </div>
      
      <div className="relative h-32">
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 text-xs text-gray-500">
          ${Math.round(maxCash * 10) / 10}M
        </div>
        <div className="absolute left-0 bottom-0 text-xs text-gray-500">
          ${Math.round(minCash * 10) / 10}M
        </div>
        
        {/* Chart bars */}
        <div className="flex items-end h-full space-x-1 ml-12">
          {chartData.map((point, index) => {
            const height = range > 0 ? ((point.cash - minCash) / range) * 100 : 50
            return (
              <div key={index} className="flex-1 relative group">
                <div
                  className="bg-blue-500 rounded-t transition-all duration-200 hover:bg-blue-600 min-h-[4px]"
                  style={{ height: `${Math.max(height, 8)}%` }}
                ></div>
                
                {/* Tooltip on hover */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded py-1 px-2 whitespace-nowrap">
                    <div>${Math.round(point.cash * 10) / 10}M</div>
                    <div>{point.period}</div>
                    <div className="text-gray-300">{point.originalCash}</div>
                  </div>
                </div>
                
                {/* X-axis label */}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-1 text-xs text-gray-500 truncate w-16 text-center">
                  {point.date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (error || !company) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Company Not Found</h1>
          <p className="text-gray-600 mb-4">{error || 'The requested company could not be found.'}</p>
          <button
            onClick={() => router.push('/')}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            ← Back to Portfolio
          </button>
        </div>
      </div>
    )
  }

  const displayName = normalizeCompanyName(company.company.name)
  const latestReport = company.financial_reports[0]
  const kvStake = company.current_cap_table ? 
    company.current_cap_table.investors
      ?.filter(inv => inv.investor_name.startsWith('KV'))
      ?.reduce((total, inv) => total + (inv.final_fds || 0), 0) || 0 
    : 0

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
  }) : []

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/')}
                className="flex items-center text-gray-600 hover:text-gray-900 font-medium"
              >
                ← Back to Portfolio
              </button>
            </div>
            <div className="flex items-center space-x-4">
              <button className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
                Upload Document
              </button>
              <button 
                onClick={loadCompanyData}
                className="text-gray-600 hover:text-gray-900"
              >
                Refresh Data
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Company Overview */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg border border-gray-200 p-8 mb-8">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-900 mb-4">{displayName} Overview</h1>
              <p className="text-gray-600 text-lg mb-6">
                Financial performance and key metrics tracking for portfolio company {displayName}.
              </p>
              
              {/* Key Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm font-medium text-gray-500">👤 CEO</span>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">Alex Johnson</p>
                </div>
                
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm font-medium text-gray-500">📈 Stage</span>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">Main</p>
                </div>
                
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm font-medium text-gray-500">🏥 Sector</span>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">Healthcare</p>
                </div>
                
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm font-medium text-gray-500">💰 Valuation</span>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">
                    {company.current_cap_table?.valuation 
                      ? `$${(company.current_cap_table.valuation / 1000000).toFixed(1)}M`
                      : 'N/A'
                    }
                  </p>
                </div>
                
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm font-medium text-gray-500">💵 Last Round</span>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">
                    {company.current_cap_table?.amount_raised 
                      ? `$${(company.current_cap_table.amount_raised / 1000000).toFixed(1)}M`
                      : 'N/A'
                    }
                  </p>
                </div>
                
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm font-medium text-gray-500">🎯 KV Ownership</span>
                  </div>
                  <p className="text-lg font-semibold text-blue-600">
                    {kvStake > 0 ? `${(kvStake * 100).toFixed(1)}%` : 'N/A'}
                  </p>
                </div>
                
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm font-medium text-gray-500">💎 KV Funds</span>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">
                    {company.current_cap_table?.investors
                      ?.filter(inv => inv.investor_name.startsWith('KV'))
                      ?.map(inv => inv.investor_name)
                      ?.join(', ') || 'N/A'
                    }
                  </p>
                </div>
                
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-sm font-medium text-gray-500">📍 Location</span>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">San Francisco, CA</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-8">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('metrics')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'metrics'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Key Metrics
            </button>
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'overview'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Financial Overview
            </button>
            <button
              onClick={() => setActiveTab('captable')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'captable'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Cap Table
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'reports'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Financial Reports ({company.financial_reports.length})
            </button>
            <button
              onClick={() => setActiveTab('database')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'database'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Database
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2">
            {activeTab === 'metrics' && (
              <div className="space-y-8">
                {/* Cash Position */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-xl font-semibold text-gray-900 mb-1">Cash Position</h3>
                  <p className="text-gray-600 text-sm mb-6">Burn rate and runway (click values to edit)</p>
                  
                  <div className="grid grid-cols-2 gap-6 mb-6">
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
                  </div>

                  <div className="mb-6">
                    <div className="flex justify-between items-center mb-2">
                      <EditableMetric
                        label="Runway"
                        value={latestReport?.runway || 'N/A'}
                        reportId={latestReportId || undefined}
                        field="runway"
                        onUpdate={loadCompanyData}
                        formatValue={(value) => `${value} months`}
                        parseValue={(value) => parseInt(String(value).replace(/[^0-9]/g, '')) || 0}
                        isManuallyEdited={(latestReport as any)?.manually_edited || false}
                        className="flex-1"
                      />
                      <p className="text-sm text-gray-600">
                        Cash out: {(latestReport as any)?.cash_out_date || 'N/A'}
                      </p>
                    </div>
                    {/* Runway Progress Bar */}
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div className="bg-gray-900 h-3 rounded-full" style={{ width: '65%' }}></div>
                    </div>
                  </div>

                  {/* Cash History Chart */}
                  <SimpleCashChart reports={company.financial_reports} />
                </div>

                {/* Key Milestones */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-xl font-semibold text-gray-900 mb-1">Key Milestones</h3>
                  <p className="text-gray-600 text-sm mb-6">Upcoming targets and goals</p>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span className="font-medium text-gray-900">Interim Data Readout</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm text-gray-600">Target: Q2 2024</span>
                        <span className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded-full">On Track</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'overview' && (
              <div className="space-y-8">
                {/* Key Financials */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-xl font-semibold text-gray-900 mb-1">Key Financials</h3>
                  <p className="text-gray-600 text-sm mb-6">Financial performance and projections</p>
                  
                  {latestReport ? (
                    <div className="space-y-4">
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-medium text-gray-900 mb-2">Financial Overview</h4>
                        <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-line">
                          {(latestReport as any).financial_summary || 'No financial summary available'}
                        </p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <p className="text-sm font-medium text-gray-500">Budget vs Actual</p>
                          <p className="text-xl font-bold text-gray-900">{(latestReport as any).budget_vs_actual || 'N/A'}</p>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <p className="text-sm font-medium text-gray-500">Report Period</p>
                          <p className="text-xl font-bold text-gray-900">{(latestReport as any).report_period || 'N/A'}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500">No financial reports available</p>
                  )}
                </div>

                {/* Business Development Update */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-xl font-semibold text-gray-900 mb-1">Business Development Update</h3>
                  <p className="text-gray-600 text-sm mb-6">Go-to-market strategy and key deals</p>
                  
                  <div className="grid grid-cols-2 gap-6 mb-6">
                    <div>
                      <p className="text-sm font-medium text-gray-500 mb-1">Pipeline</p>
                      <p className="text-2xl font-bold text-gray-900">$4.5M</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-500 mb-1">Coverage Ratio</p>
                      <p className="text-2xl font-bold text-gray-900">3.2x</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-medium text-gray-900">Key Deals</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">Enterprise Corp</p>
                          <p className="text-sm text-gray-600">$450K</p>
                        </div>
                        <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">Signed</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">Tech Solutions</p>
                          <p className="text-sm text-gray-600">$320K</p>
                        </div>
                        <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded-full">In negotiation</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'captable' && (
              <div className="bg-white rounded-lg border border-gray-200">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-xl font-semibold text-gray-900 mb-1">Cap Table</h3>
                  <p className="text-gray-600 text-sm">Ownership structure and investment details</p>
                </div>
                
                {company.current_cap_table && sortedInvestors.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Investor</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Invested</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Round</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">FDS Ownership</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {sortedInvestors.map((investor, index) => {
                          const isKV = investor.investor_name.startsWith('KV')
                          return (
                            <tr key={index} className={isKV ? 'bg-blue-50' : ''}>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                  <div className="text-sm font-medium text-gray-900">
                                    {investor.investor_name}
                                    {isKV && <span className="ml-2 text-blue-600 text-xs">🏠 KV</span>}
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {investor.total_invested 
                                  ? `$${(investor.total_invested / 1000000).toFixed(1)}M`
                                  : 'N/A'
                                }
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {investor.final_round_investment 
                                  ? `$${(investor.final_round_investment / 1000000).toFixed(1)}M`
                                  : '$0'
                                }
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                {investor.final_fds 
                                  ? `${(investor.final_fds * 100).toFixed(1)}%`
                                  : 'N/A'
                                }
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center">
                    <p className="text-gray-500">No cap table data available</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'reports' && (
              <div className="bg-white rounded-lg border border-gray-200">
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-xl font-semibold text-gray-900 mb-1">Financial Documents</h3>
                  <p className="text-gray-600 text-sm">Key financial reports and statements</p>
                </div>
                
                {company.financial_reports.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Upload Date</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {company.financial_reports.map((report, index) => (
                          <tr key={index}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {(report as any).file_name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">
                                {(report as any).report_period}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {(report as any).processed_at ? new Date((report as any).processed_at).toLocaleDateString() : 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              2.4 MB
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 hover:text-blue-700">
                              <button>View</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center">
                    <p className="text-gray-500">No documents available</p>
                  </div>
                )}
              </div>
            )}

            {/* Database Tab */}
            {activeTab === 'database' && (
              <UniversalDatabaseEditor 
                companyId={companyId} 
                onUpdate={loadCompanyData}
              />
            )}
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-8">
            {/* Team */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Team</h3>
              
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-500 mb-1">Total Employees</p>
                <p className="text-2xl font-bold text-gray-900">
                  12 <span className="text-sm font-normal text-green-600">(est.)</span>
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-900">Key Executives</h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Derek Croote</p>
                      <p className="text-xs text-gray-600">Co-founder & Chief Technical Officer – Engineering</p>
                    </div>
                    <button className="text-gray-400 hover:text-gray-600">
                      <span className="text-sm">↗</span>
                    </button>
                  </div>
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Jessica Grossman Md</p>
                      <p className="text-xs text-gray-600">Chief Executive Officer – Operations</p>
                    </div>
                    <button className="text-gray-400 hover:text-gray-600">
                      <span className="text-sm">↗</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            {company.current_cap_table && (
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Round Details</h3>
                
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-gray-500 mb-1">Round</p>
                    <p className="text-lg font-semibold text-gray-900">{company.current_cap_table.round_name}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500 mb-1">Round Date</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {company.current_cap_table.round_date 
                        ? new Date(company.current_cap_table.round_date).toLocaleDateString()
                        : 'N/A'
                      }
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500 mb-1">Option Pool</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {company.current_cap_table.total_pool_size 
                        ? `${(company.current_cap_table.total_pool_size * 100).toFixed(1)}%`
                        : 'N/A'
                      }
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
} 