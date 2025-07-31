'use client'

import React, { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface FileUploadProps {
  onUpload: (files: File[]) => void
  isLoading: boolean
}

export default function FileUpload({ onUpload, isLoading }: FileUploadProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const pdfFiles = acceptedFiles.filter(file => file.type === 'application/pdf')
    if (pdfFiles.length > 0) {
      onUpload(pdfFiles)
    }
  }, [onUpload])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf']
    },
    multiple: true
  })

  return (
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
  )
} 