'use client'

import React, { useState, useCallback } from 'react'
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
  forceCompanyName?: string
}

export default function CapTableUpload({ onUpload, isLoading, forceCompanyName }: CapTableUploadProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    
    // If a company is forced, bypass the modal and process immediately
    if (forceCompanyName && forceCompanyName.trim()) {
      processFiles(acceptedFiles, forceCompanyName)
      return
    }
    
    // Show modal for company selection
    setPendingFiles(acceptedFiles)
    await loadCompanies()
    setShowModal(true)
  }, [forceCompanyName])

  const loadCompanies = async () => {
    try {
      const result = await getCompanyNames()
      const companiesArray = result.data?.data || result.data || []
      
      if (Array.isArray(companiesArray)) {
        setCompanies(companiesArray)
      } else {
        console.error('Failed to load companies')
        setCompanies([])
      }
    } catch (error) {
      console.error('Error loading companies:', error)
      setCompanies([])
    }
  }

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
          
          const shouldReload = confirm(`${message}\n\nClick OK to reload the page and see updated data, or Cancel to continue without reloading.`)
          
          if (shouldReload) {
            window.location.reload()
          }
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
    if (isCreatingNew) {
      const companyName = newCompanyName.trim() || undefined
      processFiles(pendingFiles, companyName)
    } else {
      if (!selectedCompany) {
        alert('Please select a company')
        return
      }
      processFiles(pendingFiles, selectedCompany.name)
    }
    closeModal()
  }

  const closeModal = () => {
    setShowModal(false)
    setPendingFiles([])
    setSelectedCompany(null)
    setNewCompanyName('')
    setIsCreatingNew(false)
    setSearchQuery('')
  }

  const filteredCompanies = companies.filter(company =>
    company.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

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
      <div
        {...getRootProps()}
        className={`
          w-full flex items-center px-3 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors whitespace-nowrap
          ${isDragActive 
            ? 'bg-green-100 text-green-900' 
            : 'text-gray-700 hover:bg-gray-50'
          }
          ${(isLoading || isProcessing) ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} disabled={isLoading || isProcessing} />
        {(isLoading || isProcessing) ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600 mr-3"></div>
            <span>Processing...</span>
          </>
        ) : (
          <>
            <span className="mr-3">📊</span>
            <span>{isDragActive ? 'Drop here' : 'Add Cap Table'}</span>
          </>
        )}
      </div>

      {/* Company Selection Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Select Company</h2>
              <p className="text-sm text-gray-500 mt-1">
                Choose a company to upload {pendingFiles.length} cap table file{pendingFiles.length !== 1 ? 's' : ''} to
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Toggle between existing and new */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setIsCreatingNew(false)}
                  className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
                    !isCreatingNew
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Select Existing
                </button>
                <button
                  onClick={() => setIsCreatingNew(true)}
                  className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
                    isCreatingNew
                      ? 'bg-green-100 text-green-700 border border-green-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Create New / Auto-detect
                </button>
              </div>

              {isCreatingNew ? (
                /* Create New Company Form */
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Company Name (optional - leave blank to auto-detect)
                  </label>
                  <input
                    type="text"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="Enter company name or leave blank"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                    autoFocus
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    If left blank, the system will attempt to auto-detect the company name from the file.
                  </p>
                </div>
              ) : (
                /* Select Existing Company */
                <div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search companies..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md mb-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {filteredCompanies.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">No companies found</p>
                    ) : (
                      filteredCompanies.map((company) => (
                        <button
                          key={company.id}
                          onClick={() => setSelectedCompany(company)}
                          className={`w-full text-left px-4 py-3 rounded-md border transition-colors ${
                            selectedCompany?.id === company.id
                              ? 'bg-green-50 border-green-300 text-green-900'
                              : 'bg-white border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <div className="font-medium">{company.name}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                className="px-4 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 transition-colors"
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
} 