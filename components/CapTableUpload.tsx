'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { processCapTableXlsx, getCompanyNames } from '@/lib/api'

interface Company {
  id: number
  name: string
  manually_edited: boolean
}

interface CapTableUploadProps {
  onUpload: (success: boolean) => void
  isLoading: boolean
}

export default function CapTableUpload({ onUpload, isLoading }: CapTableUploadProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [showNamePrompt, setShowNamePrompt] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [selectedOption, setSelectedOption] = useState('')
  const [customName, setCustomName] = useState('')
  const [companies, setCompanies] = useState<Company[]>([])
  const [loadingCompanies, setLoadingCompanies] = useState(false)

  // Load companies when modal opens
  useEffect(() => {
    if (showNamePrompt) {
      setLoadingCompanies(true)
      getCompanyNames().then(result => {
        console.log('getCompanyNames result:', result)
        // The companies are nested: result.data.data (API response structure)
        const companiesArray = result.data?.data || result.data
        if (Array.isArray(companiesArray)) {
          console.log('Companies loaded:', companiesArray.length, 'companies')
          setCompanies(companiesArray)
        } else {
          console.log('No valid data array in result:', result)
          setCompanies([]) // Fallback to empty array
        }
        setLoadingCompanies(false)
      }).catch(error => {
        console.error('Failed to load companies:', error)
        setCompanies([]) // Fallback to empty array
        setLoadingCompanies(false)
      })
    }
  }, [showNamePrompt])

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    
    setPendingFiles(acceptedFiles)
    setShowNamePrompt(true)
  }, [])

  const processFiles = async (files: File[], userCompanyName?: string) => {
    setIsProcessing(true)
    let allSuccess = true
    
    for (const file of files) {
      try {
        console.log(`Processing cap table XLSX: ${file.name}`)
        
        // Convert file to base64
        const base64Data = await fileToBase64(file)
        const cleanBase64 = base64Data.replace(/^data:application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet;base64,/, '')
        
        const result = await processCapTableXlsx({
          xlsx_data: cleanBase64,
          filename: file.name
        }, userCompanyName)
        
        if (result.error) {
          alert(`Error processing cap table ${file.name}: ${result.error}`)
          allSuccess = false
        } else {
          const data = result.data?.data
          const summary = data?.processing_summary
          let message = `Cap table ${file.name} processed successfully!\n\nCompany: ${data?.company_name || 'Unknown'}`
          message += `\nInvestors: ${data?.investors_count || 0}`
          
          if (summary) {
            message += `\n\nData Extracted:`
            message += `\n• Valuation: ${summary.valuation_extracted ? '✅ From metadata' : '❌ Not found'}`
            message += `\n• Amount Raised: ${summary.amount_raised_extracted ? '✅ From metadata' : '❌ Not found'}`
            message += `\n• Round: ${summary.round_extracted ? '✅ From metadata' : '❌ Using default'}`
            message += `\n• Option Pool: ${summary.pool_data_found ? '✅ Found' : '❌ Not found'}`
            message += `\n• Active Investors: ${summary.investors_with_investments || 0}`
          }
          
          // Show defensive fixes if any were applied
          if (data?.defensive_fixes && data.defensive_fixes.length > 0) {
            message += `\n\n🛠️ Defensive Fixes Applied:`
            data.defensive_fixes.forEach((fix: string, index: number) => {
              message += `\n${index + 1}. ${fix}`
            })
            message += `\n\nNote: These fixes ensure clean data reaches the database. Original file data may have had formatting issues.`
          }
          
          alert(message)
        }
      } catch (error) {
        console.error(`Error processing cap table ${file.name}:`, error)
        alert(`Error processing cap table ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        allSuccess = false
      }
    }
    
    setIsProcessing(false)
    onUpload(allSuccess)
  }

  const handleSubmit = () => {
    let companyName: string | undefined
    
    if (selectedOption === 'create_new') {
      companyName = customName.trim() || undefined
    } else if (selectedOption) {
      const selectedCompany = companies.find(c => c.id.toString() === selectedOption)
      companyName = selectedCompany?.name
    }
    
    processFiles(pendingFiles, companyName)
    handleCancel()
  }

  const handleCancel = () => {
    setShowNamePrompt(false)
    setPendingFiles([])
    setSelectedOption('')
    setCustomName('')
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    },
    multiple: true,
    disabled: isLoading || isProcessing
  })

  // Helper function to convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = error => reject(error)
    })
  }

  return (
    <>
      <div className="relative">
        <div
          {...getRootProps()}
          className={`
            px-4 py-2 border border-dashed rounded cursor-pointer transition-colors
            ${isDragActive 
              ? 'border-green-400 bg-green-50' 
              : 'border-gray-300 bg-white hover:border-gray-400'
            }
            ${(isLoading || isProcessing) ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <input {...getInputProps()} disabled={isLoading || isProcessing} />
          <div className="flex items-center space-x-2">
            {(isLoading || isProcessing) ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></div>
                <span className="text-sm font-medium text-gray-600">Processing XLSX...</span>
              </>
            ) : (
              <>
                <span className="text-lg">📊</span>
                <span className="text-sm font-medium text-gray-700">
                  {isDragActive ? 'Drop XLSX files here' : 'Upload Cap Tables (.xlsx)'}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Company Name Prompt Modal */}
      {showNamePrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-md sm:max-w-lg">
            <h3 className="text-lg font-semibold mb-4">Select Company</h3>
            <p className="text-sm text-gray-600 mb-4">
              Select an existing company or create a new one. Leave blank to auto-detect from the cap table.
            </p>
            
            {loadingCompanies ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></div>
                <span className="ml-2 text-sm text-gray-600">Loading companies...</span>
              </div>
            ) : (
              <>
                <select
                  value={selectedOption}
                  onChange={(e) => setSelectedOption(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 mb-4"
                  autoFocus
                >
                  <option value="">Auto-detect from cap table</option>
                  {Array.isArray(companies) && companies.map(company => (
                    <option key={company.id} value={company.id.toString()}>
                      {company.name}
                    </option>
                  ))}
                  <option value="create_new">Create new company...</option>
                </select>
                
                {selectedOption === 'create_new' && (
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Enter new company name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 mb-4"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSubmit()
                      if (e.key === 'Escape') handleCancel()
                    }}
                  />
                )}
              </>
            )}
            
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-4">
              <p className="text-xs text-blue-800">
                <strong>Note:</strong> If a company name isn&apos;t correct, you can edit it in the database. 
                We don&apos;t have merge functionality yet - you&apos;d need to re-add files to the correct name.
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 sm:gap-2">
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 order-2 sm:order-1"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 order-1 sm:order-2"
              >
                <span className="hidden sm:inline">Process {pendingFiles.length} XLSX file{pendingFiles.length !== 1 ? 's' : ''}</span>
                <span className="sm:hidden">Process {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
} 