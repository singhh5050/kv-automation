'use client'

import React, { useState } from 'react'
import { X, Search, Globe, TrendingUp, Building2 } from 'lucide-react'
import MarkdownContent from '../shared/MarkdownContent'

interface CompetitionAnalysisModalProps {
  isOpen: boolean
  onClose: () => void
  companyName: string
}

interface AnalysisResult {
  success: boolean
  company_name: string
  is_public: boolean
  analysis: string
  timestamp: string
  error?: string
}

export default function CompetitionAnalysisModal({ 
  isOpen, 
  onClose, 
  companyName 
}: CompetitionAnalysisModalProps) {
  const [isPublic, setIsPublic] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = async () => {
    setIsLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/competition-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          company_name: companyName, 
          is_public: isPublic 
        })
      })

      const data = await response.json()

      if (!response.ok || data.error) {
        const errorMsg = data.error || `Analysis failed (${response.status})`
        const errorCode = data.error_code ? ` [${data.error_code}]` : ''
        setError(`${errorMsg}${errorCode}`)
        return
      }

      setResult(data)
    } catch (e: any) {
      setError(e.message || 'Failed to analyze competition')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setResult(null)
    setError(null)
    setIsLoading(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Search className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Competition Analysis</h2>
              <p className="text-sm text-gray-600">for {companyName}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isLoading}
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!result && !isLoading && (
            <div className="space-y-6">
              {/* Company Type Selection */}
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Building2 className="w-5 h-5 text-gray-600" />
                  <h3 className="text-lg font-semibold text-gray-900">Company Type</h3>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="relative cursor-pointer">
                    <input
                      type="radio"
                      name="companyType"
                      checked={!isPublic}
                      onChange={() => setIsPublic(false)}
                      className="sr-only"
                    />
                    <div className={`p-4 rounded-lg border-2 transition-all ${
                      !isPublic
                        ? 'border-indigo-500 bg-indigo-50 shadow-md'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}>
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                          <span className="text-indigo-600">🏢</span>
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">Private Company</div>
                          <div className="text-sm text-gray-600">Fundraising, investors, news</div>
                        </div>
                      </div>
                    </div>
                  </label>

                  <label className="relative cursor-pointer">
                    <input
                      type="radio"
                      name="companyType"
                      checked={isPublic}
                      onChange={() => setIsPublic(true)}
                      className="sr-only"
                    />
                    <div className={`p-4 rounded-lg border-2 transition-all ${
                      isPublic
                        ? 'border-purple-500 bg-purple-50 shadow-md'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}>
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                          <TrendingUp className="w-4 h-4 text-purple-600" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">Public Company</div>
                          <div className="text-sm text-gray-600">Stock price, market cap, news</div>
                        </div>
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* What we'll search for */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center space-x-2 mb-3">
                  <Globe className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">What we'll search for:</span>
                </div>
                {isPublic ? (
                  <ul className="text-sm text-gray-600 space-y-1 ml-6 list-disc">
                    <li>Current stock price and market cap</li>
                    <li>Key competitors and market positioning</li>
                    <li>Latest news and industry developments</li>
                  </ul>
                ) : (
                  <ul className="text-sm text-gray-600 space-y-1 ml-6 list-disc">
                    <li>Latest funding rounds and valuation</li>
                    <li>Key competitors (private and public)</li>
                    <li>Recent news, partnerships, and announcements</li>
                  </ul>
                )}
              </div>

              {/* Error Display */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <span className="text-red-500 text-lg">⚠️</span>
                    <div>
                      <p className="font-medium text-red-800">Analysis Failed</p>
                      <p className="text-sm text-red-600 mt-1">{error}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-indigo-200 rounded-full animate-spin border-t-indigo-600"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Search className="w-6 h-6 text-indigo-600" />
                </div>
              </div>
              <p className="mt-4 text-gray-600 font-medium">Searching the web...</p>
              <p className="text-sm text-gray-500 mt-1">This may take 10-20 seconds</p>
            </div>
          )}

          {/* Results Display */}
          {result && !isLoading && (
            <div className="space-y-4">
              {/* Results Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-green-500 text-lg">✓</span>
                  <span className="font-medium text-gray-900">Analysis Complete</span>
                </div>
                <span className="text-xs text-gray-500">
                  {new Date(result.timestamp).toLocaleString()}
                </span>
              </div>

              {/* Analysis Content */}
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                <MarkdownContent content={result.analysis} />
              </div>

              {/* New Search Button */}
              <button
                onClick={() => {
                  setResult(null)
                  setError(null)
                }}
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
              >
                ← Run another search
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="flex items-center justify-end p-6 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleAnalyze}
                disabled={isLoading}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center space-x-2 ${
                  isLoading
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 shadow-md hover:shadow-lg'
                }`}
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    <span>Searching...</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>Analyze Competition</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Footer for results view */}
        {result && (
          <div className="flex items-center justify-end p-6 border-t border-gray-200 bg-gray-50">
            <button
              onClick={handleClose}
              className="px-6 py-2 rounded-lg text-sm font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

