'use client'

import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { KpiAnalysisConfig } from '../../types'
import { listCompanyPDFs } from '../../lib/api'

interface CustomKpiAnalysisModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (analysisConfig: KpiAnalysisConfig) => void
  isLoading: boolean
  companyName: string
  companyId: number
}

const SCOPE_OPTIONS = [
  { value: 'auto', label: 'Auto (best available)' },
  { value: 'ttm', label: 'TTM (last 12 mo)' },
  { value: 'all', label: 'All available' },
  { value: 'custom', label: 'Custom…' }
]

// Helper function to strip timestamp prefix from filename for display
function stripTimestampFromFilename(filename: string): string {
  // Pattern matches: YYYY-MM-DDTHH-MM-SS-sssZ- at the start of filename
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/;
  return filename.replace(timestampPattern, '');
}

export default function CustomKpiAnalysisModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  isLoading,
  companyName,
  companyId
}: CustomKpiAnalysisModalProps) {
  const [standardPL, setStandardPL] = useState(true)
  const [unitEconomics, setUnitEconomics] = useState(true)
  const [customKpis, setCustomKpis] = useState('')
  const [scope, setScope] = useState('auto')
  const [customScope, setCustomScope] = useState('')
  const [additionalInfo, setAdditionalInfo] = useState('')
  const [availableFiles, setAvailableFiles] = useState<any[]>([])
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)

  // Load available PDF files when modal opens
  useEffect(() => {
    if (isOpen && companyId && companyId > 0) {
      setLoadingFiles(true)
      console.log(`🔍 Loading PDF files for company ID: ${companyId}`)
      listCompanyPDFs(companyId)
        .then(result => {
          if (result.success) {
            setAvailableFiles(result.files)
            console.log(`✅ Loaded ${result.files.length} PDF files`)
          } else {
            console.error('Failed to load PDF files:', result.error)
            setAvailableFiles([])
          }
        })
        .catch(error => {
          console.error('Error loading PDF files:', error)
          setAvailableFiles([])
        })
        .finally(() => {
          setLoadingFiles(false)
        })
    } else if (isOpen) {
      console.warn(`⚠️ Modal opened but invalid company ID: ${companyId}`)
      setAvailableFiles([])
      setLoadingFiles(false)
    }
  }, [isOpen, companyId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Build the target KPIs based on selections
    const targetKpis = []
    if (standardPL) {
      targetKpis.push('Revenue, COGS, Gross Profit, OpEx, EBITDA, Net Income')
    }
    if (unitEconomics) {
      targetKpis.push('CAC, LTV, Payback Period, Contribution Margin')
    }
    if (customKpis.trim()) {
      targetKpis.push(customKpis.trim())
    }

    // Determine the final scope value
    const finalScope = scope === 'custom' ? customScope.trim() || 'Auto (best available)' : scope

    const config: KpiAnalysisConfig = {
      targetKpis: targetKpis.join(', '),
      tableFormat: 'KPIs as columns, time periods as rows, include percentage changes between periods',
      analysisMood: 'balanced',
      previousIssues: additionalInfo.trim(),
      previousPlan: '',
      competitiveContext: '',
      customPrompt: '',
      scope: finalScope,
      selected_files: selectedFiles.length > 0 ? selectedFiles : undefined
    }

    onSubmit(config)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-purple-50 flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-lg">📊</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">KPI Analysis</h2>
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

        {/* Scrollable Form Content */}
        <div className="flex-1 overflow-y-auto">
          <form id="kpi-analysis-form" onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* What to extract */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">What to extract</h3>
            
            <div className="space-y-3">
              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={standardPL}
                  onChange={(e) => setStandardPL(e.target.checked)}
                  className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
                <span className="text-gray-900 font-medium">Standard P&L (Revenue, COGS, Gross Profit, OpEx, EBITDA, Net)</span>
              </label>

              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={unitEconomics}
                  onChange={(e) => setUnitEconomics(e.target.checked)}
                  className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
                <span className="text-gray-900 font-medium">Unit Economics (CAC, LTV, Payback, Contribution Margin)</span>
              </label>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                (Optional) Add custom KPIs/categories
              </label>
              <input
                type="text"
                value={customKpis}
                onChange={(e) => setCustomKpis(e.target.value)}
                placeholder='e.g., "ARR by product," "NRR," "Churn," "Runway"'
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Scope */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-900">Scope</h3>
            <div className="flex flex-wrap gap-3">
              {SCOPE_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="scope"
                    value={option.value}
                    checked={scope === option.value}
                    onChange={(e) => setScope(e.target.value)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 focus:ring-2"
                  />
                  <span className="text-gray-900">{option.label}</span>
                </label>
              ))}
            </div>
            
            {/* Custom scope input */}
            {scope === 'custom' && (
              <div className="mt-3">
                <input
                  type="text"
                  value={customScope}
                  onChange={(e) => setCustomScope(e.target.value)}
                  placeholder="e.g., Last 6 months, Q1-Q3 2024, Since Series A..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            )}
          </div>

          {/* Additional Info */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Additional Info / What went wrong last time (Optional)
            </label>
            <textarea
              value={additionalInfo}
              onChange={(e) => setAdditionalInfo(e.target.value)}
              placeholder="e.g., Last analysis missed seasonal trends, didn't account for pricing changes, focus on unit economics..."
              className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </div>

          {/* File Selection */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-900">Select Files (Optional)</h3>
            <p className="text-sm text-gray-600">
              Choose 1-4 specific files to analyze, or leave unselected to use the most recent files automatically.
            </p>
            
            {loadingFiles ? (
              <div className="flex items-center space-x-2 text-gray-500">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-600"></div>
                <span>Loading available files...</span>
              </div>
            ) : availableFiles.length > 0 ? (
              <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-2">
                {availableFiles.map((file) => (
                  <label key={file.key} className="flex items-start space-x-3">
                    <input
                      type="checkbox"
                      checked={selectedFiles.includes(file.key)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (selectedFiles.length < 4) {
                            setSelectedFiles([...selectedFiles, file.key])
                          }
                        } else {
                          setSelectedFiles(selectedFiles.filter(key => key !== file.key))
                        }
                      }}
                      disabled={!selectedFiles.includes(file.key) && selectedFiles.length >= 4}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-gray-900 break-all">
                        {stripTimestampFromFilename(file.name)}
                      </span>
                      <div className="text-xs text-gray-500">
                        {new Date(file.last_modified).toLocaleDateString()} • {Math.round(file.size / 1024)} KB
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">No PDF files found for this company.</p>
            )}
            
            {selectedFiles.length > 0 && (
              <div className="text-sm text-blue-600">
                {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected (max 4)
              </div>
            )}
          </div>

          </form>
        </div>

        {/* Fixed Footer with Action Buttons */}
        <div className="flex items-center justify-end p-6 border-t border-gray-200 space-x-3 flex-shrink-0 bg-white">
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
            form="kpi-analysis-form"
            disabled={isLoading || (!standardPL && !unitEconomics && !customKpis.trim())}
            className={`px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              isLoading || (!standardPL && !unitEconomics && !customKpis.trim())
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
              'Extract'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
