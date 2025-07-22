'use client'

import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { processCapTableXlsx } from '@/lib/api'

interface CapTableUploadProps {
  onUpload: (success: boolean) => void
  isLoading: boolean
}

export default function CapTableUpload({ onUpload, isLoading }: CapTableUploadProps) {
  const [isProcessing, setIsProcessing] = useState(false)

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    
    setIsProcessing(true)
    let allSuccess = true
    
    for (const file of acceptedFiles) {
      try {
        console.log(`Processing cap table XLSX: ${file.name}`)
        
        // Convert file to base64
        const base64Data = await fileToBase64(file)
        const cleanBase64 = base64Data.replace(/^data:application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet;base64,/, '')
        
        const result = await processCapTableXlsx({
          xlsx_data: cleanBase64,
          filename: file.name
        })
        
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
  }, [onUpload])

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
    <div className="relative">
      <div
        {...getRootProps()}
        className={`
          px-6 py-3 border-2 border-dashed rounded-lg cursor-pointer transition-colors
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
  )
} 