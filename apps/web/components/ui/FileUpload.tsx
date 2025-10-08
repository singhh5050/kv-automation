'use client'

import React, { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { getCompanyNames } from '@/lib/api'

interface Company {
  id: number
  name: string
  manually_edited: boolean
}

interface FileUploadProps {
  onUpload: (files: File[], companyName?: string, companyId?: number) => void
  isLoading: boolean
  forceCompanyName?: string
  forceCompanyId?: number
}

export default function FileUpload({ onUpload, isLoading, forceCompanyName, forceCompanyId }: FileUploadProps) {
  const [showModal, setShowModal] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const pdfFiles = acceptedFiles.filter(file => file.type === 'application/pdf')
    
    // Validate file sizes (5GB limit for direct S3 uploads)
    const maxSize = 5 * 1024 * 1024 * 1024 // 5GB in bytes
    const oversizedFiles = pdfFiles.filter(file => file.size > maxSize)
    
    if (oversizedFiles.length > 0) {
      const oversizedNames = oversizedFiles.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)}MB)`).join(', ')
      alert(`File(s) too large: ${oversizedNames}. Maximum size is 5GB for direct S3 uploads. Please compress or split the file(s) if they exceed this limit.`)
      return
    }
    
    if (pdfFiles.length > 0) {
      // If a forceCompanyName is provided, bypass the modal entirely
      if (forceCompanyName && forceCompanyName.trim()) {
        onUpload(pdfFiles, forceCompanyName, forceCompanyId)
        return
      }
      
      // Show modal for company selection
      setPendingFiles(pdfFiles)
      await loadCompanies()
      setShowModal(true)
    }
  }, [onUpload, forceCompanyName, forceCompanyId])

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

  const handleSubmit = () => {
    if (isCreatingNew) {
      if (!newCompanyName.trim()) {
        alert('Please enter a company name')
        return
      }
      onUpload(pendingFiles, newCompanyName.trim())
    } else {
      if (!selectedCompany) {
        alert('Please select a company')
        return
      }
      onUpload(pendingFiles, selectedCompany.name, selectedCompany.id)
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
      'application/pdf': ['.pdf']
    },
    multiple: true
  })

  return (
    <>
      <div
        {...getRootProps()}
        className={`
          w-full flex items-center px-3 py-2 text-sm font-medium rounded-md cursor-pointer transition-colors
          ${isDragActive 
            ? 'bg-blue-100 text-blue-900' 
            : 'text-gray-700 hover:bg-gray-50'
          }
          ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} disabled={isLoading} />
        {isLoading ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
            <span>Uploading...</span>
          </>
        ) : (
          <>
            <span className="mr-3">📄</span>
            <span>{isDragActive ? 'Drop here' : 'Add PDF'}</span>
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
                Choose a company to upload {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} to
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
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Select Existing
                </button>
                <button
                  onClick={() => setIsCreatingNew(true)}
                  className={`flex-1 px-4 py-2 rounded-md font-medium transition-colors ${
                    isCreatingNew
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Create New
                </button>
              </div>

              {isCreatingNew ? (
                /* Create New Company Form */
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="Enter company name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
              ) : (
                /* Select Existing Company */
                <div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search companies..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                              ? 'bg-blue-50 border-blue-300 text-blue-900'
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
                className="px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition-colors"
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