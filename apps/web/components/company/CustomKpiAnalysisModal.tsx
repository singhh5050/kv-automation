'use client'

import React, { useState } from 'react'
import { X } from 'lucide-react'

interface CustomKpiAnalysisModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (analysisConfig: KpiAnalysisConfig) => void
  isLoading: boolean
  companyName: string
}

export interface KpiAnalysisConfig {
  targetKpis: string
  tableFormat: string
  analysisMood: string
  previousIssues: string
  industryContext: string
  businessModelDetails: string
}

const MOOD_OPTIONS = [
  { value: 'cheerleader', label: '📣 Cheerleader', description: 'Optimistic, encouraging tone' },
  { value: 'balanced', label: '⚖️ Balanced', description: 'Neutral, factual analysis' },
  { value: 'skeptical', label: '🤨 Wall Street Skeptic', description: 'Critical, detailed scrutiny' },
  { value: 'roast', label: '🔥 Roast Mode', description: 'Brutally honest (but constructive!)' }
]

export default function CustomKpiAnalysisModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  isLoading,
  companyName 
}: CustomKpiAnalysisModalProps) {
  const [config, setConfig] = useState<KpiAnalysisConfig>({
    targetKpis: '',
    tableFormat: '',
    analysisMood: 'balanced',
    previousIssues: '',
    industryContext: '',
    businessModelDetails: ''
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(config)
  }

  const handleReset = () => {
    setConfig({
      targetKpis: '',
      tableFormat: '',
      analysisMood: 'balanced',
      previousIssues: '',
      industryContext: '',
      businessModelDetails: ''
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-purple-50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-lg">📊</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Custom KPI Analysis</h2>
              <p className="text-sm text-gray-600">for {companyName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isLoading}
          >
            <X size={24} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Target KPIs */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              🎯 What KPIs do you want to analyze?
            </label>
            <textarea
              value={config.targetKpis}
              onChange={(e) => setConfig({ ...config, targetKpis: e.target.value })}
              placeholder="e.g., Monthly Recurring Revenue (MRR), Customer Acquisition Cost (CAC), Monthly Active Users (MAU), Gross Margin, Net Revenue Retention..."
              className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              required
            />
            <p className="text-xs text-gray-500">Be specific about the metrics you care about most</p>
          </div>

          {/* Table Format */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              📋 How do you want your results table structured?
            </label>
            <textarea
              value={config.tableFormat}
              onChange={(e) => setConfig({ ...config, tableFormat: e.target.value })}
              placeholder="e.g., Columns should be the KPIs I specified above, rows should be time periods (months/quarters). Include percentage changes between periods. Add a trend direction column with arrows..."
              className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              required
            />
            <p className="text-xs text-gray-500">Describe the exact table layout and calculations you want</p>
          </div>

          {/* Analysis Mood */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-gray-900">
              🎭 Analysis Personality
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MOOD_OPTIONS.map((mood) => (
                <label key={mood.value} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="analysisMood"
                    value={mood.value}
                    checked={config.analysisMood === mood.value}
                    onChange={(e) => setConfig({ ...config, analysisMood: e.target.value })}
                    className="sr-only"
                  />
                  <div className={`p-3 rounded-lg border-2 transition-all ${
                    config.analysisMood === mood.value
                      ? 'border-blue-500 bg-blue-50 shadow-md'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <div className="font-medium text-sm text-gray-900">{mood.label}</div>
                    <div className="text-xs text-gray-600 mt-1">{mood.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Previous Issues */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              ⚠️ What went wrong in previous analyses? (Optional)
            </label>
            <textarea
              value={config.previousIssues}
              onChange={(e) => setConfig({ ...config, previousIssues: e.target.value })}
              placeholder="e.g., Last time it missed the seasonality in our Q4 metrics, or it didn't account for our pricing change in March..."
              className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
            <p className="text-xs text-gray-500">Help us avoid repeating past mistakes</p>
          </div>

          {/* Industry Context */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              🏭 Industry & Competitive Context
            </label>
            <textarea
              value={config.industryContext}
              onChange={(e) => setConfig({ ...config, industryContext: e.target.value })}
              placeholder="e.g., We're in B2B SaaS with 12-month contracts, typical industry CAC payback is 18 months, our main competitor is X with different pricing model..."
              className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
            <p className="text-xs text-gray-500">Industry benchmarks and competitive dynamics</p>
          </div>

          {/* Business Model Details */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              💰 Key Business Model Details
            </label>
            <textarea
              value={config.businessModelDetails}
              onChange={(e) => setConfig({ ...config, businessModelDetails: e.target.value })}
              placeholder="e.g., Revenue mix: 70% subscription, 30% usage-based. Key unit economics: LTV/CAC = 4.2x, gross margin target = 80%. Seasonal patterns in Q4..."
              className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
            <p className="text-xs text-gray-500">Revenue streams, unit economics, and business model specifics</p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              disabled={isLoading}
            >
              Reset Form
            </button>
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !config.targetKpis.trim() || !config.tableFormat.trim()}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isLoading || !config.targetKpis.trim() || !config.tableFormat.trim()
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 shadow-md hover:shadow-lg'
                }`}
              >
                {isLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    <span>Analyzing...</span>
                  </div>
                ) : (
                  'Start Analysis'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
