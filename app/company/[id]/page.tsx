'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getCompanyOverview } from '@/lib/api'
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

// Sector-specific field labels mapping
const getSectorLabels = (sector: string = 'healthcare') => {
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

type TabType = 'metrics' | 'overview' | 'sector' | 'captable' | 'reports' | 'database'

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
    <div className="bg-gray-50 rounded-lg p-6 h-[360px] overflow-hidden">
      <div className="flex justify-between items-center mb-6">
        <h4 className="font-medium text-gray-900">Cash History</h4>
        <span className="text-sm text-gray-500">{chartData.length} data points</span>
      </div>
      
      <ResponsiveContainer width="100%" height="95%">
        <ComposedChart data={chartData} margin={{ top: 10, right: 40, left: 30, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis 
            dataKey="date"
            type="number"
            domain={['dataMin', 'dataMax']}
            padding={{ left: 20, right: 20 }}
            tickFormatter={(tick) => new Date(tick).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
            scale="time"
            stroke="#6b7280"
            fontSize={12}
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
            fontSize={12}
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
            fontSize={12}
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
              color: 'white'
            }}
          />
          <Legend />
          <Bar 
            yAxisId="left"
            dataKey="cash" 
            fill="#3b82f6" 
            name="Cash on Hand"
            radius={[4, 4, 0, 0]}
            barSize={24}
          />
          <Line 
            yAxisId="right"
            type="monotone" 
            dataKey="burn" 
            stroke="#ef4444" 
            strokeWidth={3}
            name="Monthly Burn"
            dot={{ fill: '#ef4444', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6, stroke: '#ef4444', strokeWidth: 2, fill: '#ffffff' }}
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
  
  // Get sector from company data or latest report
  const companySector = company.company.sector || latestReport?.sector || 'healthcare'
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
                    <span className="text-sm font-medium text-gray-500">{sectorLabels.icon} Sector</span>
                  </div>
                  <p className="text-lg font-semibold text-gray-900">{companySector.charAt(0).toUpperCase() + companySector.slice(1)}</p>
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
              onClick={() => setActiveTab('sector')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'sector'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Sector-Specific Updates
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
                          <>
                            <div className="w-full bg-gray-200 rounded-full h-3">
                              <div 
                                className="bg-blue-600 h-3 rounded-full transition-all duration-300" 
                                style={{ width: `${pctElapsed}%` }}
                              />
                            </div>
                            <p className="text-sm text-gray-600 mt-1">
                              {monthsUsed} months used, {monthsLeft} months left
                            </p>
                          </>
                        )
                      }
                      
                      // Fallback if dates aren't available
                      return (
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div className="bg-gray-400 h-3 rounded-full" style={{ width: '50%' }}></div>
                        </div>
                      )
                    })()}
                  </div>

                  {/* Cash History Chart */}
                  <SimpleCashChart reports={company.financial_reports} />
                </div>

                {/* Upcoming Milestones */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-xl font-semibold text-gray-900 mb-1">Upcoming Milestones</h3>
                  <p className="text-gray-600 text-sm mb-6">Key targets and deadlines from latest board deck</p>
                  
                  {(latestReport as any)?.next_milestones ? (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <MarkdownContent content={(latestReport as any).next_milestones} className="text-sm" />
                    </div>
                  ) : (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-gray-500 text-sm italic">
                        No milestones data available. Upload a recent board deck to see upcoming targets.
                      </p>
                    </div>
                  )}
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
                        <MarkdownContent content={(latestReport as any).financial_summary || 'No financial summary available'} className="text-sm" />
                      </div>
                      
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-medium text-gray-900 mb-2">Budget vs Actual</h4>
                        <MarkdownContent content={(latestReport as any).budget_vs_actual || 'N/A'} className="text-sm" />
                      </div>
                      
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-medium text-gray-900 mb-2">Report Period</h4>
                        <p className="text-xl font-bold text-gray-900">{(latestReport as any).report_period || 'N/A'}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500">No financial reports available</p>
                  )}
                </div>

                {/* Personnel Updates */}
                {(latestReport as any)?.personnel_updates && (
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-xl font-semibold text-gray-900 mb-1">Personnel Updates</h3>
                    <p className="text-gray-600 text-sm mb-6">Team changes and key hires from latest board deck</p>
                    
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <MarkdownContent content={(latestReport as any).personnel_updates} className="text-sm" />
                    </div>
                  </div>
                )}

                {/* Key Risks */}
                {(latestReport as any)?.key_risks && (
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-xl font-semibold text-gray-900 mb-1">Key Risks</h3>
                    <p className="text-gray-600 text-sm mb-6">Risk factors and mitigation strategies</p>
                    
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <MarkdownContent content={(latestReport as any).key_risks} className="text-sm" />
                    </div>
                  </div>
                )}

                {/* Next Milestones */}
                {(latestReport as any)?.next_milestones && (
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-xl font-semibold text-gray-900 mb-1">Upcoming Milestones</h3>
                    <p className="text-gray-600 text-sm mb-6">Key targets and deadlines from latest board deck</p>
                    
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <MarkdownContent content={(latestReport as any).next_milestones} className="text-sm" />
                    </div>
                  </div>
                )}


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

            {/* Sector-Specific Updates Tab */}
            {activeTab === 'sector' && (
              <div className="space-y-6">
                {/* Sector Highlight A */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-xl font-semibold text-gray-900 mb-1">{sectorLabels.highlightA}</h3>
                  <p className="text-gray-600 text-sm mb-6">Sector-specific analysis and updates</p>
                  
                  {(latestReport as any)?.sector_highlight_a ? (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <MarkdownContent content={(latestReport as any).sector_highlight_a} className="text-sm" />
                    </div>
                  ) : (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-gray-500 text-sm italic">
                        No {sectorLabels.highlightA.toLowerCase()} data available. Upload a recent board deck to see sector-specific analysis.
                      </p>
                    </div>
                  )}
                </div>

                {/* Sector Highlight B */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-xl font-semibold text-gray-900 mb-1">{sectorLabels.highlightB}</h3>
                  <p className="text-gray-600 text-sm mb-6">Sector-specific analysis and updates</p>
                  
                  {(latestReport as any)?.sector_highlight_b ? (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <MarkdownContent content={(latestReport as any).sector_highlight_b} className="text-sm" />
                    </div>
                  ) : (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <p className="text-gray-500 text-sm italic">
                        No {sectorLabels.highlightB.toLowerCase()} data available. Upload a recent board deck to see sector-specific analysis.
                      </p>
                    </div>
                  )}
                </div>
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