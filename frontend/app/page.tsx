'use client'

import React, { useState, useEffect } from 'react'
import FileUpload from '../components/FileUpload'
import CompanyCard from '../components/CompanyCard'
import CompanyModal from '../components/CompanyModal'
import { FinancialReport, Company } from '../types'
import { uploadFile } from '../lib/api'

// Company name normalization for matching
const normalizeCompanyName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\b(corp|corporation|inc|incorporated|ltd|limited|llc|co\.?)\b/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Helper function to find matching company
const findMatchingCompany = (companies: Company[], newCompanyName: string): Company | null => {
  if (!newCompanyName) return null
  
  const normalizedNewName = normalizeCompanyName(newCompanyName)
  
  return companies.find(company => {
    const normalizedExisting = normalizeCompanyName(company.name)
    return normalizedExisting === normalizedNewName ||
           normalizedExisting.includes(normalizedNewName) ||
           normalizedNewName.includes(normalizedExisting)
  }) || null
}

export default function Home() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [currentReportIndex, setCurrentReportIndex] = useState<number>(0)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Load companies from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('portfolio-companies')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setCompanies(Array.isArray(parsed) ? parsed : [])
      } catch (error) {
        console.error('Error parsing saved companies:', error)
        setCompanies([])
      }
    }
  }, [])

  // Save companies to localStorage whenever companies change
  useEffect(() => {
    if (companies.length > 0) {
      localStorage.setItem('portfolio-companies', JSON.stringify(companies))
    }
  }, [companies])

  const handleFileUpload = async (files: File[]) => {
    setIsLoading(true)
    setErrorMessage(null)
    
    for (const file of files) {
      try {
        console.log(`Uploading file: ${file.name}`)
        const result = await uploadFile(file)
        
        if (result.error) {
          console.error('Upload error:', result.error)
          setErrorMessage(`Error uploading ${file.name}: ${result.error}`)
          continue
        }
        
        if (result.data && !result.error) {
          const data = result.data
          console.log('Upload successful:', data)
          
          // Create new report
          const newReport: FinancialReport = {
            id: Date.now().toString() + Math.random(),
            fileName: data.filename || file.name,
            reportDate: data.reportDate || new Date().toISOString().split('T')[0],
            reportPeriod: data.reportPeriod || 'Unknown Period',
            cashOnHand: data.cashOnHand || 'N/A',
            monthlyBurnRate: data.monthlyBurnRate || 'N/A',
            cashOutDate: data.cashOutDate || 'N/A',
            runway: data.runway || 'N/A',
            budgetVsActual: data.budgetVsActual || 'N/A',
            financialSummary: data.financialSummary || 'Financial summary not available',
            clinicalProgress: data.clinicalProgress || 'Clinical progress information not available',
            researchDevelopment: data.researchDevelopment || 'R&D information not available',
            uploadDate: new Date().toLocaleDateString(),
          }

          setCompanies(prev => {
            const existingCompany = findMatchingCompany(prev, data.companyName)
            
            if (existingCompany) {
              // Add report to existing company
              return prev.map(company => {
                if (company.id === existingCompany.id) {
                  const updatedReports = [...company.reports, newReport].sort((a, b) => 
                    new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime()
                  )
                  return {
                    ...company,
                    reports: updatedReports,
                    latestReport: updatedReports[0]
                  }
                }
                return company
              })
            } else {
              // Create new company
              const newCompany: Company = {
                id: Date.now().toString() + Math.random(),
                name: data.companyName || file.name.replace('.pdf', ''),
                reports: [newReport],
                latestReport: newReport
              }
              return [...prev, newCompany]
            }
          })
        } else {
          setErrorMessage(`Error processing ${file.name}: No data returned`)
        }
      } catch (error) {
        console.error('Error uploading file:', error)
        setErrorMessage(`Error uploading ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
    
    setIsLoading(false)
  }

  const handleCompanyClick = (company: Company) => {
    setSelectedCompany(company)
    setCurrentReportIndex(0) // Always start with latest report
  }

  const clearAllData = () => {
    if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
      localStorage.removeItem('portfolio-companies')
      setCompanies([])
      setSelectedCompany(null)
    }
  }

  const dismissError = () => {
    setErrorMessage(null)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-900">Portfolio Companies</h1>
            <div className="flex items-center space-x-4">
              <FileUpload onUpload={handleFileUpload} isLoading={isLoading} />
              <button 
                onClick={clearAllData}
                className="flex items-center space-x-2 text-gray-600 hover:text-gray-900"
              >
                <span>🗑️</span>
                <span>Clear All</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Error Message */}
      {errorMessage && (
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex justify-between items-start">
            <div className="flex items-start space-x-3">
              <div className="text-red-600 text-xl">⚠️</div>
              <div>
                <h3 className="text-red-800 font-medium">Upload Error</h3>
                <p className="text-red-700 text-sm mt-1">{errorMessage}</p>
              </div>
            </div>
            <button 
              onClick={dismissError}
              className="text-red-600 hover:text-red-800 text-xl"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {companies.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📄</div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">No PDFs uploaded yet</h2>
            <p className="text-gray-600">Upload your financial PDF documents to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {companies.map((company) => (
              <CompanyCard
                key={company.id}
                company={company}
                onClick={() => handleCompanyClick(company)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Modal */}
      {selectedCompany && (
        <CompanyModal
          company={selectedCompany}
          currentReportIndex={currentReportIndex}
          onReportChange={setCurrentReportIndex}
          onClose={() => setSelectedCompany(null)}
        />
      )}
    </div>
  )
}
