'use client'

import React, { useCallback, useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { getCompanyNames } from '@/lib/api'

interface Company {
  id: number
  name: string
  manually_edited: boolean
}

interface FileUploadProps {
  onUpload: (files: File[], companyName?: string) => void
  isLoading: boolean
  forceCompanyName?: string
}

export default function FileUpload({ onUpload, isLoading, forceCompanyName }: FileUploadProps) {
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
    const pdfFiles = acceptedFiles.filter(file => file.type === 'application/pdf')
    if (pdfFiles.length > 0) {
      // If a forceCompanyName is provided, bypass the prompt entirely
      if (forceCompanyName && forceCompanyName.trim()) {
        onUpload(pdfFiles, forceCompanyName)
        return
      }
      setPendingFiles(pdfFiles)
      setShowNamePrompt(true)
    }
  }, [onUpload, forceCompanyName])

  const handleSubmit = () => {
    let companyName: string | undefined
    
    if (selectedOption === 'create_new') {
      companyName = customName.trim() || undefined
    } else if (selectedOption) {
      const selectedCompany = companies.find(c => c.id.toString() === selectedOption)
      companyName = selectedCompany?.name
    }
    
    onUpload(pendingFiles, companyName)
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
      'application/pdf': ['.pdf']
    },
    multiple: true
  })

  return (
    <>
      <div className="relative">
        <div
          {...getRootProps()}
          className={`
            px-4 py-2 border border-dashed rounded cursor-pointer transition-colors
            ${isDragActive 
              ? 'border-blue-400 bg-blue-50' 
              : 'border-gray-300 bg-white hover:border-gray-400'
            }
            ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <input {...getInputProps()} disabled={isLoading} />
          <div className="flex items-center space-x-2">
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span className="text-sm font-medium text-gray-600">Processing...</span>
              </>
            ) : (
              <>
                <span className="text-lg">+</span>
                <span className="text-sm font-medium text-gray-700">
                  {isDragActive ? 'Drop PDFs here' : 'Add PDFs'}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Company Name Prompt Modal */}
      {(!forceCompanyName || !forceCompanyName.trim()) && showNamePrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-md sm:max-w-lg">
            <h3 className="text-lg font-semibold mb-4">Select Company</h3>
            <p className="text-sm text-gray-600 mb-4">
              Select an existing company or create a new one. Leave blank to auto-detect from the PDF.
            </p>
            
            {loadingCompanies ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <span className="ml-2 text-sm text-gray-600">Loading companies...</span>
              </div>
            ) : (
              <>
                <select
                  value={selectedOption}
                  onChange={(e) => setSelectedOption(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                  autoFocus
                >
                  <option value="">Auto-detect from PDF</option>
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
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
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 order-1 sm:order-2"
              >
                <span className="hidden sm:inline">Upload {pendingFiles.length} PDF{pendingFiles.length !== 1 ? 's' : ''}</span>
                <span className="sm:hidden">Upload {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
} 