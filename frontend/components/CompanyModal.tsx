'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Company } from '../types'

interface CompanyModalProps {
  company: Company
  currentReportIndex: number
  onReportChange: (index: number) => void
  onClose: () => void
}

type TabType = 'financial' | 'clinical' | 'research' | 'competitive'

export default function CompanyModal({ company, currentReportIndex, onReportChange, onClose }: CompanyModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('financial')
  const [competitiveQuery, setCompetitiveQuery] = useState('')
  const [competitiveData, setCompetitiveData] = useState<any>(null)
  const [loadingCompetitive, setLoadingCompetitive] = useState(false)
  
  const currentReport = company.reports[currentReportIndex]
  const canGoToPrevious = currentReportIndex < company.reports.length - 1
  const canGoToNext = currentReportIndex > 0

  const handlePreviousReport = useCallback(() => {
    if (canGoToPrevious) {
      onReportChange(currentReportIndex + 1)
    }
  }, [canGoToPrevious, currentReportIndex, onReportChange])

  const handleNextReport = useCallback(() => {
    if (canGoToNext) {
      onReportChange(currentReportIndex - 1)
    }
  }, [canGoToNext, currentReportIndex, onReportChange])

  const handleCompetitiveQuery = useCallback(async (query?: string) => {
    const queryToUse = query || competitiveQuery
    if (!queryToUse.trim()) return

    setLoadingCompetitive(true)
    try {
      const response = await fetch('/api/competitive-landscape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: queryToUse,
          companyName: company.name 
        })
      })
      const data = await response.json()
      setCompetitiveData(data)
    } catch (error) {
      console.error('Error fetching competitive data:', error)
      setCompetitiveData({ error: 'Failed to fetch competitive landscape data' })
    } finally {
      setLoadingCompetitive(false)
    }
  }, [competitiveQuery, company.name])

  // Handle specific competitive actions
  const handleCompetitiveAction = useCallback(async (action: string) => {
    setLoadingCompetitive(true)
    try {
      const response = await fetch('/api/competitive-landscape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action,
          companyName: company.name 
        })
      })
      const data = await response.json()
      setCompetitiveData(data)
    } catch (error) {
      console.error('Error fetching competitive data:', error)
      setCompetitiveData({ error: 'Failed to fetch competitive data' })
    } finally {
      setLoadingCompetitive(false)
    }
  }, [company.name])

  // Render competitive results based on type
  const renderCompetitiveResults = () => {
    if (!competitiveData) return null

    switch (competitiveData.type) {
      case 'competitors':
        return (
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">Competitor Analysis</h4>
            {competitiveData.data && competitiveData.data.length > 0 ? (
              <div className="space-y-3">
                {competitiveData.data.slice(0, 6).map((competitor: any, index: number) => (
                  <div key={index} className="p-3 border border-gray-200 rounded-lg">
                    <div className="flex justify-between items-start">
                      <div>
                        <h5 className="font-medium text-gray-900">{competitor.name}</h5>
                        <p className="text-sm text-gray-600 mt-1">{competitor.description?.substring(0, 150)}...</p>
                        <div className="flex space-x-4 mt-2 text-xs text-gray-500">
                          <span>Stage: {competitor.stage || 'Unknown'}</span>
                          <span>Funding: ${competitor.funding?.funding_total?.toLocaleString() || 'N/A'}</span>
                          <span>Headcount: {competitor.headcount || competitor.corrected_headcount || 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No competitors found for {company.name}</p>
            )}
          </div>
        )

      case 'headcount':
        return (
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">Headcount Analysis</h4>
            {competitiveData.data?.target_company ? (
              <div className="space-y-4">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h5 className="font-medium text-gray-900">{competitiveData.data.target_company.name}</h5>
                  <div className="grid grid-cols-3 gap-4 mt-2 text-sm">
                    <div>
                      <span className="text-gray-500">Current:</span>
                      <p className="font-medium">{competitiveData.data.headcount_data.current_headcount || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">External:</span>
                      <p className="font-medium">{competitiveData.data.headcount_data.external_headcount || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Corrected:</span>
                      <p className="font-medium">{competitiveData.data.headcount_data.corrected_headcount || 'N/A'}</p>
                    </div>
                  </div>
                </div>
                {competitiveData.data.peer_comparison && competitiveData.data.peer_comparison.length > 0 && (
                  <div>
                    <h6 className="font-medium text-gray-900 mb-2">Peer Comparison</h6>
                    <div className="space-y-2">
                      {competitiveData.data.peer_comparison.map((peer: any, index: number) => (
                        <div key={index} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                          <span className="text-sm">{peer.name}</span>
                          <div className="text-sm text-gray-600">
                            <span className="mr-2">👥 {peer.headcount || 'N/A'}</span>
                            <span>📈 {peer.stage}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500">No headcount data found for {company.name}</p>
            )}
          </div>
        )

      case 'investors':
        return (
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">Investor Analysis</h4>
            {competitiveData.data?.target_company ? (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 rounded-lg">
                  <h5 className="font-medium text-gray-900">{competitiveData.data.target_company.name}</h5>
                  <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
                    <div>
                      <span className="text-gray-500">Total Funding:</span>
                      <p className="font-medium">${competitiveData.data.funding_data.total_funding?.toLocaleString() || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Stage:</span>
                      <p className="font-medium">{competitiveData.data.funding_data.funding_stage || 'Unknown'}</p>
                    </div>
                  </div>
                  {competitiveData.data.funding_data.last_funding_date && (
                    <p className="text-sm text-gray-600 mt-2">
                      Last funding: {new Date(competitiveData.data.funding_data.last_funding_date).toLocaleDateString()}
                    </p>
                  )}
                </div>
                {competitiveData.data.funding_data.funding_rounds && competitiveData.data.funding_data.funding_rounds.length > 0 && (
                  <div>
                    <h6 className="font-medium text-gray-900 mb-2">Recent Funding Rounds</h6>
                    <div className="space-y-2">
                      {competitiveData.data.funding_data.funding_rounds.slice(-3).map((round: any, index: number) => (
                        <div key={index} className="p-2 bg-gray-50 rounded text-sm">
                          <div className="flex justify-between">
                            <span>{round.funding_type || 'Unknown Round'}</span>
                            <span className="font-medium">${round.funding_total?.toLocaleString() || 'N/A'}</span>
                          </div>
                          {round.announced_date && (
                            <span className="text-gray-500">{new Date(round.announced_date).toLocaleDateString()}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500">No investor data found for {company.name}</p>
            )}
          </div>
        )

      case 'news':
        return (
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">Latest News & Updates</h4>
            {competitiveData.data?.target_company ? (
              <div className="space-y-4">
                <div className="p-4 bg-orange-50 rounded-lg">
                  <h5 className="font-medium text-gray-900">{competitiveData.data.target_company.name}</h5>
                  <p className="text-sm text-gray-600 mt-1">{competitiveData.data.market_context}</p>
                </div>
                {competitiveData.data.highlights && competitiveData.data.highlights.length > 0 ? (
                  <div>
                    <h6 className="font-medium text-gray-900 mb-2">Company Highlights</h6>
                    <div className="space-y-2">
                      {competitiveData.data.highlights.map((highlight: any, index: number) => (
                        <div key={index} className="p-2 bg-gray-50 rounded text-sm">
                          {typeof highlight === 'string' ? highlight : JSON.stringify(highlight)}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600">No recent highlights available</p>
                )}
                {competitiveData.data.recent_updates && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    {competitiveData.data.recent_updates.funding_updates?.length > 0 && (
                      <div>
                        <h6 className="font-medium text-gray-900 mb-1">Funding Updates</h6>
                        <div className="space-y-1">
                          {competitiveData.data.recent_updates.funding_updates.map((update: any, index: number) => (
                            <div key={index} className="text-gray-600">${update.funding_total?.toLocaleString() || 'N/A'}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500">No news data found for {company.name}</p>
            )}
          </div>
        )

      case 'text':
        return (
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Analysis</h4>
            <p className="text-gray-700 leading-relaxed whitespace-pre-line">
              {competitiveData.data?.message || competitiveData.payload}
            </p>
          </div>
        )

      default:
        return (
          <div>
            <h4 className="font-semibold text-gray-900 mb-2">Competitive Intelligence</h4>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap">
              {JSON.stringify(competitiveData, null, 2)}
            </pre>
          </div>
        )
    }
  }

  // Auto-populate competitive landscape when tab is opened
  useEffect(() => {
    if (activeTab === 'competitive' && !competitiveData && !loadingCompetitive) {
      // Auto-load competitors when tab is opened
      handleCompetitiveAction('getCompetitors')
    }
  }, [activeTab, company.name, competitiveData, loadingCompetitive, handleCompetitiveAction])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      } else if (event.key === 'ArrowLeft' && canGoToPrevious) {
        handlePreviousReport()
      } else if (event.key === 'ArrowRight' && canGoToNext) {
        handleNextReport()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [canGoToPrevious, canGoToNext, onClose, handlePreviousReport, handleNextReport])

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      ></div>

      {/* Modal */}
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <span className="text-blue-600 font-semibold text-xl">
                  {company.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{company.name}</h2>
                <div className="flex items-center space-x-2">
                  <p className="text-sm text-gray-500">{currentReport.reportPeriod}</p>
                  <span className="text-gray-300">•</span>
                  <p className="text-sm text-gray-500">{currentReport.fileName}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/* Report Navigation */}
              {company.reports.length > 1 && (
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handlePreviousReport}
                    disabled={!canGoToPrevious}
                    className={`p-2 rounded-lg ${
                      canGoToPrevious 
                        ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100' 
                        : 'text-gray-300 cursor-not-allowed'
                    }`}
                    title="Previous report (older)"
                  >
                    ←
                  </button>
                  <span className="text-sm text-gray-500">
                    {currentReportIndex + 1} of {company.reports.length}
                  </span>
                  <button
                    onClick={handleNextReport}
                    disabled={!canGoToNext}
                    className={`p-2 rounded-lg ${
                      canGoToNext 
                        ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100' 
                        : 'text-gray-300 cursor-not-allowed'
                    }`}
                    title="Next report (newer)"
                  >
                    →
                  </button>
                </div>
              )}
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <span className="text-2xl">×</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[60vh]">
            {/* Key Metrics Grid */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Financial Metrics</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-gray-500">Cash on Hand</p>
                  <p className="text-2xl font-bold text-gray-900">{currentReport.cashOnHand}</p>
                  <p className="text-xs text-gray-500 mt-1">Most important raw number</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-gray-500">Monthly Burn Rate</p>
                  <p className="text-2xl font-bold text-gray-900">{currentReport.monthlyBurnRate}</p>
                  <p className="text-xs text-gray-500 mt-1">Determines pace of cash use</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-gray-500">Cash Out Date</p>
                  <p className="text-2xl font-bold text-gray-900">{currentReport.cashOutDate}</p>
                  <p className="text-xs text-gray-500 mt-1">The investor&apos;s clock</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-gray-500">Runway</p>
                  <p className="text-2xl font-bold text-gray-900">{currentReport.runway}</p>
                  <p className="text-xs text-gray-500 mt-1">Useful shorthand derived from above</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-gray-500">Budget vs Actual</p>
                  <p className="text-2xl font-bold text-gray-900">{currentReport.budgetVsActual}</p>
                  <p className="text-xs text-gray-500 mt-1">Signals fiscal discipline or drift</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-gray-500">Report Date</p>
                  <p className="text-2xl font-bold text-gray-900">{new Date(currentReport.reportDate).toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric' 
                  })}</p>
                  <p className="text-xs text-gray-500 mt-1">When this deck was created</p>
                </div>
              </div>
            </div>

            {/* Tabbed Summary Sections */}
            <div className="mt-8">
              <div className="border-b border-gray-200">
                <nav className="-mb-px flex space-x-8">
                  <button
                    onClick={() => setActiveTab('financial')}
                    className={`${
                      activeTab === 'financial'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                  >
                    Financial Summary
                  </button>
                  <button
                    onClick={() => setActiveTab('clinical')}
                    className={`${
                      activeTab === 'clinical'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                  >
                    Clinical Progress
                  </button>
                  <button
                    onClick={() => setActiveTab('research')}
                    className={`${
                      activeTab === 'research'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                  >
                    Research & Development
                  </button>
                  <button
                    onClick={() => setActiveTab('competitive')}
                    className={`${
                      activeTab === 'competitive'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                  >
                    Competitive Landscape
                  </button>
                </nav>
              </div>

              <div className="mt-6">
                {activeTab === 'financial' && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Financial Overview</h3>
                    <p className="text-gray-700 leading-relaxed whitespace-pre-line">
                      {currentReport.financialSummary}
                    </p>
                  </div>
                )}

                {activeTab === 'clinical' && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Clinical Progress</h3>
                    <p className="text-gray-700 leading-relaxed whitespace-pre-line">
                      {currentReport.clinicalProgress}
                    </p>
                  </div>
                )}

                {activeTab === 'research' && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Research & Development Status</h3>
                    <p className="text-gray-700 leading-relaxed whitespace-pre-line">
                      {currentReport.researchDevelopment}
                    </p>
                  </div>
                )}

                {activeTab === 'competitive' && (
                  <div className="space-y-6">
                    {/* Main Action Buttons */}
                    <div className="bg-gray-50 p-6 rounded-lg">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Competitive Intelligence</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <button
                          onClick={() => handleCompetitiveAction('getCompetitors')}
                          disabled={loadingCompetitive}
                          className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                        >
                          {loadingCompetitive ? 'Loading...' : 'Get Competitors'}
                        </button>
                        <button
                          onClick={() => handleCompetitiveAction('getHeadcountEstimate')}
                          disabled={loadingCompetitive}
                          className="px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                        >
                          {loadingCompetitive ? 'Loading...' : 'Headcount Estimate'}
                        </button>
                        <button
                          onClick={() => handleCompetitiveAction('getInvestorList')}
                          disabled={loadingCompetitive}
                          className="px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                        >
                          {loadingCompetitive ? 'Loading...' : 'Investor List'}
                        </button>
                        <button
                          onClick={() => handleCompetitiveAction('getLatestNews')}
                          disabled={loadingCompetitive}
                          className="px-4 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                        >
                          {loadingCompetitive ? 'Loading...' : 'Latest News'}
                        </button>
                      </div>
                    </div>

                    {/* Natural Language Query (Work in Progress) */}
                    <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                      <div className="flex items-center mb-2">
                        <h4 className="text-md font-medium text-gray-900">Natural Language Search</h4>
                        <span className="ml-2 px-2 py-1 text-xs bg-yellow-200 text-yellow-800 rounded-full">Work in Progress</span>
                      </div>
                      <div className="flex space-x-2 mb-2">
                        <input
                          type="text"
                          value={competitiveQuery}
                          onChange={(e) => setCompetitiveQuery(e.target.value)}
                          placeholder="Ask about competitors, market position, funding comparisons..."
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          onKeyPress={(e) => e.key === 'Enter' && handleCompetitiveQuery()}
                        />
                        <button
                          onClick={() => handleCompetitiveQuery()}
                          disabled={loadingCompetitive || !competitiveQuery.trim()}
                          className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                          {loadingCompetitive ? 'Loading...' : 'Try'}
                        </button>
                      </div>
                      <p className="text-sm text-yellow-700">
                        For reliable results, please use the specific action buttons above.
                      </p>
                    </div>

                    {/* Results */}
                    {loadingCompetitive && (
                      <div className="bg-white p-6 rounded-lg border border-gray-200">
                        <div className="animate-pulse space-y-4">
                          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                          <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                        </div>
                      </div>
                    )}

                    {competitiveData && !loadingCompetitive && (
                      <div className="bg-white p-6 rounded-lg border border-gray-200">
                        {competitiveData.error ? (
                          <div className="text-red-600">
                            <p className="font-medium">Error:</p>
                            <p>{competitiveData.error}</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {renderCompetitiveResults()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* File Info */}
            <div className="mt-6 pt-4 border-t border-gray-200">
              <div className="flex justify-between items-center text-sm text-gray-500">
                <span>Source: {currentReport.fileName}</span>
                <span>Uploaded: {currentReport.uploadDate}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end p-6 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
} 