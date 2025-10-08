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

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    
    // If a company is forced, bypass the prompt and process immediately
    if (forceCompanyName && forceCompanyName.trim()) {
      processFiles(acceptedFiles, forceCompanyName)
      return
    }
    
    // Use browser dialogs instead of modal
    await handleCompanySelection(acceptedFiles)
  }, [forceCompanyName])

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
      
      if (choiceNumber === companiesArray.length + 1) {
        // Create new company
        companyName = prompt('Enter new company name (or leave blank to auto-detect):')
        if (companyName !== null) {
          companyName = companyName.trim() || undefined
        } else {
          return // User cancelled
        }
      } else {
        // Use existing company
        const selectedCompany = companiesArray[choiceNumber - 1]
        companyName = selectedCompany.name
      }
      
      // Process the files
      processFiles(files, companyName)
      
    } catch (error) {
      console.error('Error loading companies:', error)
      alert('Failed to load companies. Please try again.')
    }
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

    </>
  )
} 