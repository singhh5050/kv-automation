'use client'

import { useState } from 'react'
import { CompanyOverview } from '@/types'
import { generateInternalSummary } from '@/lib/api'
import { detectCompanyStage } from '@/lib/stageDetection'

interface PdfExportModalProps {
  company: CompanyOverview
  isOpen: boolean
  onClose: () => void
}

// Helper to format currency
const formatCurrency = (value: number | null | undefined): string => {
  if (!value) return 'N/A'
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
  return `$${value.toLocaleString()}`
}

export default function PdfExportModal({ company, isOpen, onClose }: PdfExportModalProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [summaryText, setSummaryText] = useState<string>('')
  const [error, setError] = useState<string>('')

  const handleGenerateSummary = async () => {
    setIsGenerating(true)
    setError('')
    setSummaryText('')

    try {
      // Prepare company data for the summary
      const kvInvestors = company.current_cap_table?.investors
        ?.filter(inv => inv.investor_name.startsWith('KV')) || []
      
      const kvFunds = kvInvestors.map(inv => inv.investor_name).join(', ') || 'N/A'
      const totalKvInvested = kvInvestors.reduce((sum, inv) => sum + (inv.total_invested || 0), 0)
      const kvOwnership = kvInvestors.reduce((sum, inv) => sum + (inv.final_fds || 0), 0)
      const stage = detectCompanyStage(company.current_cap_table?.investors || [])

      const companyData = {
        stage: stage,
        kv_funds: kvFunds,
        total_kv_invested: formatCurrency(totalKvInvested),
        kv_ownership: `${(kvOwnership * 100).toFixed(1)}%`,
        total_raised: formatCurrency(company.current_cap_table?.amount_raised),
        last_raise_date: company.current_cap_table?.round_date || 'N/A',
        last_round_amount: formatCurrency(company.current_cap_table?.amount_raised),
        series: company.current_cap_table?.round_name || 'N/A',
        valuation: formatCurrency(company.current_cap_table?.valuation)
      }

      console.log('📝 Generating summary with data:', companyData)

      const result = await generateInternalSummary(parseInt(company.company.id as any), companyData)

      if (result.error) {
        setError(result.error)
      } else if (result.summary) {
        setSummaryText(result.summary)
      } else {
        setError('No summary was generated')
      }
    } catch (err) {
      console.error('Error generating summary:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate summary')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(summaryText)
    alert('Summary copied to clipboard!')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Export One Pager</h2>
              <p className="text-sm text-gray-600 mt-1">
                Generate a concise one-pager summary for {company.company.name}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            {/* Generate Button */}
            {!summaryText && !error && (
              <div className="text-center py-8">
                <p className="text-gray-600 mb-4">
                  Click below to generate a one-pager summary using the 5 most recent financial reports
                </p>
                <button
                  onClick={handleGenerateSummary}
                  disabled={isGenerating}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      <span>Generating...</span>
                    </>
                  ) : (
                    <>
                      <span>📝</span>
                      <span>Generate One Pager</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <span className="text-red-600 text-xl">❌</span>
                  <div>
                    <h3 className="text-red-900 font-medium">Error Generating One Pager</h3>
                    <p className="text-red-700 text-sm mt-1">{error}</p>
                  </div>
                </div>
                <button
                  onClick={handleGenerateSummary}
                  disabled={isGenerating}
                  className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium disabled:opacity-50"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Summary Display */}
            {summaryText && (
              <div className="space-y-4">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-900 leading-relaxed">
                    {summaryText}
                  </pre>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-end space-x-3">
                  <button
                    onClick={handleGenerateSummary}
                    disabled={isGenerating}
                    className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    🔄 Regenerate
                  </button>
                  <button
                    onClick={handleCopyToClipboard}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
                  >
                    <span>📋</span>
                    <span>Copy to Clipboard</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end space-x-3 mt-8 pt-6 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
