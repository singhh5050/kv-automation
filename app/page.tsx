'use client'

import React, { useState, useEffect } from 'react'
import FileUpload from '../components/FileUpload'
import CompanyCard from '../components/CompanyCard'
import CompanyModal from '../components/CompanyModal'
import { FinancialReport, Company } from '../types'

// Company name normalization for matching
const normalizeCompanyName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\b(corp|corporation|inc|incorporated|ltd|limited|llc|co\.?)\b/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Find matching company using fuzzy matching
const findMatchingCompany = (companies: Company[], newCompanyName: string): Company | null => {
  const normalizedNew = normalizeCompanyName(newCompanyName)
  
  return companies.find(company => {
    const normalizedExisting = normalizeCompanyName(company.name)
    
    // Exact match after normalization
    if (normalizedExisting === normalizedNew) return true
    
    // Check if one is a substring of the other
    if (normalizedExisting.includes(normalizedNew) || normalizedNew.includes(normalizedExisting)) {
      return true
    }
    
    return false
  }) || null
}

export default function Home() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [currentReportIndex, setCurrentReportIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

  // Load data from localStorage on mount
  useEffect(() => {
    const savedCompanies = localStorage.getItem('portfolio-companies')
    if (savedCompanies) {
      try {
        setCompanies(JSON.parse(savedCompanies))
      } catch (error) {
        console.error('Error loading saved data:', error)
      }
    }
  }, [])

  // Save to localStorage whenever companies change
  useEffect(() => {
    if (companies.length > 0) {
      localStorage.setItem('portfolio-companies', JSON.stringify(companies))
    }
  }, [companies])

  const handleFileUpload = async (files: File[]) => {
    setIsLoading(true)
    
    for (const file of files) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })
        
        if (response.ok) {
          const data = await response.json()
          
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
        }
      } catch (error) {
        console.error('Error uploading file:', error)
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
