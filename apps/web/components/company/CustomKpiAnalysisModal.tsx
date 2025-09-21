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

// Helper function to strip timestamp prefix from filename for display
function stripTimestampFromFilename(filename: string): string {
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
  
  const [whatToLookFor, setWhatToLookFor] = useState('')
  const [responseStructure, setResponseStructure] = useState('')
  const [useBulletPoints, setUseBulletPoints] = useState(true)
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
    
    if (!whatToLookFor.trim() && !responseStructure.trim()) {
      return // Don't submit if both fields are empty
    }

    const config: KpiAnalysisConfig = {
      whatToLookFor: whatToLookFor.trim(),
      responseStructure: responseStructure.trim(),
      useBulletPoints,
      selected_files: selectedFiles.length > 0 ? selectedFiles : undefined
    }

    console.log('📋 Submitting simplified analysis config:', config)
    onSubmit(config)
  }

  const handleFileSelection = (s3Key: string) => {
    setSelectedFiles(prev => {
      if (prev.includes(s3Key)) {
        return prev.filter(key => key !== s3Key)
      } else if (prev.length < 4) {
        return [...prev, s3Key]
      }
      return prev
    })
  }

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setWhatToLookFor('')
      setResponseStructure('')
      setUseBulletPoints(true)
      setSelectedFiles([])
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        
        {/* Fixed Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Custom Analysis</h2>
            <p className="text-sm text-gray-600 mt-1">Tell the AI exactly what you want from {companyName}'s documents</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 hover:bg-gray-100 rounded-lg"
            disabled={isLoading}
          >
            <X size={24} />
          </button>
        </div>

        {/* Scrollable Form Content */}
        <div className="flex-1 overflow-y-auto">
          <form id="kpi-analysis-form" onSubmit={handleSubmit} className="p-6 space-y-6">
            
            {/* Question 1: What to look for */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                What should the AI look for with these document(s)?
              </label>
              <textarea
                value={whatToLookFor}
                onChange={(e) => setWhatToLookFor(e.target.value)}
                placeholder="e.g., Revenue trends, customer acquisition costs, burn rate, cash runway, key metrics by quarter..."
                className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              />
            </div>

            {/* Question 2: Response structure */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                How would you like your response structured?
              </label>
              <textarea
                value={responseStructure}
                onChange={(e) => setResponseStructure(e.target.value)}
                placeholder="e.g., Show quarterly trends in a table, highlight key changes, include percentage growth rates..."
                className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              />
            </div>

            {/* Format toggle */}
            <div className="space-y-2">
              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={useBulletPoints}
                  onChange={(e) => setUseBulletPoints(e.target.checked)}
                  className="w-5 h-5 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                />
                <span className="text-gray-900 font-medium">Use bullet points (unchecked = prose format)</span>
              </label>
            </div>

            {/* File Selection */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-gray-900">Select Files (Optional)</h3>
              <p className="text-sm text-gray-600">
                Choose 1-4 specific files to analyze, or leave unselected to use the most recent files automatically.
              </p>
              
              {loadingFiles ? (
                <div className="flex items-center space-x-2 text-gray-500">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-500"></div>
                  <span className="text-sm">Loading files...</span>
                </div>
              ) : availableFiles.length > 0 ? (
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                  {availableFiles.map((file, index) => (
                    <label key={file.s3_key} className={`flex items-center space-x-3 p-3 hover:bg-gray-50 cursor-pointer ${index !== availableFiles.length - 1 ? 'border-b border-gray-100' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selectedFiles.includes(file.s3_key)}
                        onChange={() => handleFileSelection(file.s3_key)}
                        disabled={!selectedFiles.includes(file.s3_key) && selectedFiles.length >= 4}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {stripTimestampFromFilename(file.file_name)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {file.report_period} • Uploaded {new Date(file.upload_date).toLocaleDateString()}
                        </p>
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
            disabled={isLoading || (!whatToLookFor.trim() && !responseStructure.trim())}
            className={`px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              isLoading || (!whatToLookFor.trim() && !responseStructure.trim())
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