'use client'

import React, { useCallback } from 'react'
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
      // If a forceCompanyName is provided, bypass the prompt entirely
      if (forceCompanyName && forceCompanyName.trim()) {
        onUpload(pdfFiles, forceCompanyName, forceCompanyId)
        return
      }
      
      // Use browser dialogs instead of modal
      await handleCompanySelection(pdfFiles)
    }
  }, [onUpload, forceCompanyName, forceCompanyId])

  const handleCompanySelection = async (files: File[]) => {
    try {
      // Load companies first
      const result = await getCompanyNames()
      const companiesArray = result.data?.data || result.data || []
      
      if (!Array.isArray(companiesArray)) {
        console.error('Failed to load companies')
        alert('Failed to load companies. Please try again.')
        return
      }
      
      // Create options string for confirm dialog
      let optionsText = 'Available companies:\n'
      companiesArray.forEach((company, index) => {
        optionsText += `${index + 1}. ${company.name}\n`
      })
      optionsText += `${companiesArray.length + 1}. Create new company\n\n`
      
      // Show selection dialog
      const selection = prompt(
        `${optionsText}Enter the number of your choice (1-${companiesArray.length + 1}):`
      )
      
      if (!selection) {
        // User cancelled
        return
      }
      
      const choiceNumber = parseInt(selection.trim())
      
      if (isNaN(choiceNumber) || choiceNumber < 1 || choiceNumber > companiesArray.length + 1) {
        alert('Invalid selection. Please try again.')
        return
      }
      
      let companyName: string | undefined
      let companyId: number | undefined
      
      if (choiceNumber === companiesArray.length + 1) {
        // Create new company
        companyName = prompt('Enter new company name:')
        if (!companyName || !companyName.trim()) {
          alert('Company name is required.')
          return
        }
        companyName = companyName.trim()
      } else {
        // Use existing company
        const selectedCompany = companiesArray[choiceNumber - 1]
        companyName = selectedCompany.name
        companyId = selectedCompany.id
      }
      
      // Process the upload
      onUpload(files, companyName, companyId)
      
    } catch (error) {
      console.error('Error loading companies:', error)
      alert('Failed to load companies. Please try again.')
    }
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
                <span className="text-sm font-medium text-gray-600">Uploading & queuing for analysis...</span>
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

    </>
  )
} 