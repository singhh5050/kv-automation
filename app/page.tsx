'use client'

import React, { useState, useEffect } from 'react'
import FileUpload from '@/components/FileUpload'
import CompanyCard from '@/components/CompanyCard'
import CompanyModal from '@/components/CompanyModal'
import { FinancialReport, Company } from '@/types'
import { 
  uploadFile, 
  saveFinancialReport, 
  getCompanies, 
  getCompanyReports,
  healthCheck,
  testDatabaseConnection,
  createDatabaseSchema 
} from '@/lib/api'

// Company name normalization for matching
const normalizeCompanyName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\b(corp|corporation|inc|incorporated|ltd|limited|llc|co\.?)\b/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Convert database company format to frontend format
const convertDatabaseToFrontend = async (dbCompanies: any[]): Promise<Company[]> => {
  const companies: Company[] = []
  
  console.log('🔄 Starting conversion of', dbCompanies.length, 'companies')
  
  for (const dbCompany of dbCompanies) {
    try {
      console.log('🏢 Processing company:', dbCompany.name, 'ID:', dbCompany.id)
      
      // Get reports for this company
      const reportsResult = await getCompanyReports(dbCompany.id.toString())
      console.log('📊 Reports result for', dbCompany.name, ':', reportsResult)
      
      if (reportsResult.data && !reportsResult.error) {
        const dbReports = reportsResult.data.data?.reports || []
        console.log('📄 Found', dbReports.length, 'reports for', dbCompany.name)
        
        // Convert reports to frontend format
        const reports: FinancialReport[] = dbReports.map((report: any) => ({
          id: report.id.toString(),
          fileName: report.file_name || 'Unknown File',
          reportDate: report.report_date || new Date().toISOString().split('T')[0],
          reportPeriod: report.report_period || 'Unknown Period',
          cashOnHand: report.cash_on_hand || 'N/A',
          monthlyBurnRate: report.monthly_burn_rate || 'N/A',
          cashOutDate: report.cash_out_date || 'N/A',
          runway: report.runway || 'N/A',
          budgetVsActual: report.budget_vs_actual || 'N/A',
          financialSummary: report.financial_summary || 'Financial summary not available',
          clinicalProgress: report.clinical_progress || 'Clinical progress information not available',
          researchDevelopment: report.research_development || 'R&D information not available',
          uploadDate: report.processed_at ? new Date(report.processed_at).toLocaleDateString() : new Date().toLocaleDateString(),
        }))

        // Sort reports by date (newest first)
        reports.sort((a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime())

        companies.push({
          id: dbCompany.id.toString(),
          name: dbCompany.name,
          reports: reports,
          latestReport: reports[0] || null
        })
        
        console.log('✅ Successfully converted company:', dbCompany.name, 'with', reports.length, 'reports')
      } else {
        console.warn('⚠️ No reports found for company:', dbCompany.name, 'Error:', reportsResult.error)
      }
    } catch (error) {
      console.error(`💥 Error loading reports for company ${dbCompany.name}:`, error)
    }
  }
  
  console.log('🎯 Conversion complete. Total companies with reports:', companies.length)
  return companies
}

export default function Home() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [currentReportIndex, setCurrentReportIndex] = useState<number>(0)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'healthy' | 'unhealthy'>('unknown')
  const [showDebugPanel, setShowDebugPanel] = useState(false)

  // Load companies from database on mount
  useEffect(() => {
    loadCompanies()
    checkBackendHealth()
  }, [])

  const loadCompanies = async () => {
    setIsLoading(true)
    try {
      console.log('🔄 Loading companies from database...')
      const result = await getCompanies()
      console.log('📊 Raw database result:', result)
      
      if (result.data && !result.error) {
        const dbCompanies = result.data.data?.companies || []
        console.log('🏢 Database companies:', dbCompanies)
        console.log('📈 Number of companies found:', dbCompanies.length)
        
        if (dbCompanies.length === 0) {
          console.log('⚠️ No companies found in database')
          setCompanies([])
        } else {
          console.log('🔄 Converting database format to frontend format...')
          const frontendCompanies = await convertDatabaseToFrontend(dbCompanies)
          console.log('✅ Converted companies:', frontendCompanies)
          console.log('📊 Number of frontend companies:', frontendCompanies.length)
          setCompanies(frontendCompanies)
        }
      } else {
        console.error('❌ Error loading companies:', result.error)
        setErrorMessage(`Failed to load companies: ${result.error}`)
      }
    } catch (error) {
      console.error('💥 Exception loading companies:', error)
      setErrorMessage(`Failed to load companies: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const checkBackendHealth = async () => {
    try {
      const isHealthy = await healthCheck()
      setBackendStatus(isHealthy ? 'healthy' : 'unhealthy')
    } catch {
      setBackendStatus('unhealthy')
    }
  }

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
          
          // Always save to database
          try {
            const saveResult = await saveFinancialReport({
              companyName: data.companyName || file.name.replace('.pdf', ''),
              filename: file.name,
              reportDate: data.reportDate || new Date().toISOString().split('T')[0],
              reportPeriod: data.reportPeriod || 'Unknown Period',
              cashOnHand: data.cashOnHand || 'N/A',
              monthlyBurnRate: data.monthlyBurnRate || 'N/A',
              cashOutDate: data.cashOutDate || 'N/A',
              runway: data.runway || 'N/A',
              budgetVsActual: data.budgetVsActual || 'N/A',
              financialSummary: data.financialSummary || 'Financial summary not available',
              clinicalProgress: data.clinicalProgress || 'Clinical progress information not available',
              researchDevelopment: data.researchDevelopment || 'R&D information not available'
            })
            
            if (saveResult.error) {
              console.error('Failed to save to database:', saveResult.error)
              setErrorMessage(`Error saving ${file.name}: ${saveResult.error}`)
            } else {
              console.log('Saved to database successfully')
              // Reload companies to show the new data
              await loadCompanies()
            }
          } catch (error) {
            console.error('Database save error:', error)
            setErrorMessage(`Error saving ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
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
    if (confirm('Are you sure you want to clear all data? This will delete all companies and reports from the database and cannot be undone.')) {
      // TODO: Implement database clearing functionality
      // For now, just clear the local state
      setCompanies([])
      setSelectedCompany(null)
      alert('Note: This only clears the local view. Database clearing functionality needs to be implemented.')
    }
  }

  const dismissError = () => {
    setErrorMessage(null)
  }

  // Debug functions
  const testBackendConnection = async () => {
    setIsLoading(true)
    try {
      const result = await testDatabaseConnection()
      alert(JSON.stringify(result, null, 2))
    } catch (error) {
      alert(`Error: ${error}`)
    }
    setIsLoading(false)
  }

  const testDatabaseContents = async () => {
    setIsLoading(true)
    try {
      console.log('🔍 Testing database contents...')
      
      // Test getting companies
      const companiesResult = await getCompanies()
      console.log('📊 Companies result:', companiesResult)
      
      if (companiesResult.data?.companies?.length > 0) {
        const firstCompany = companiesResult.data.companies[0]
        console.log('🏢 First company:', firstCompany)
        
        // Test getting reports for the first company
        const reportsResult = await getCompanyReports(firstCompany.id.toString())
        console.log('📄 Reports for first company:', reportsResult)
      }
      
      alert('Check console for detailed database contents')
    } catch (error) {
      console.error('💥 Error testing database:', error)
      alert(`Error: ${error}`)
    }
    setIsLoading(false)
  }

  const initializeDatabase = async () => {
    setIsLoading(true)
    try {
      const result = await createDatabaseSchema()
      alert(JSON.stringify(result, null, 2))
    } catch (error) {
      alert(`Error: ${error}`)
    }
    setIsLoading(false)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-600'
      case 'unhealthy': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <h1 className="text-3xl font-bold text-gray-900">Portfolio Companies</h1>
              <div className="flex items-center space-x-2 text-sm">
                <span className="text-gray-500">Backend:</span>
                <span className={getStatusColor(backendStatus)}>
                  {backendStatus === 'unknown' ? '🔄' : backendStatus === 'healthy' ? '🟢' : '🔴'} 
                  {backendStatus}
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setShowDebugPanel(!showDebugPanel)}
                className="text-gray-600 hover:text-gray-900 text-sm"
              >
                🛠️ Debug
              </button>
              <button
                onClick={loadCompanies}
                disabled={isLoading}
                className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 disabled:opacity-50"
              >
                <span>🔄</span>
                <span>Refresh</span>
              </button>
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

      {/* Debug Panel */}
      {showDebugPanel && (
        <div className="bg-gray-100 border-b">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={checkBackendHealth}
                className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
              >
                Test Health
              </button>
              <button
                onClick={testBackendConnection}
                disabled={isLoading}
                className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600 disabled:opacity-50"
              >
                Test DB Connection
              </button>
              <button
                onClick={testDatabaseContents}
                disabled={isLoading}
                className="px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600 disabled:opacity-50"
              >
                Test DB Contents
              </button>
              <button
                onClick={initializeDatabase}
                disabled={isLoading}
                className="px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600 disabled:opacity-50"
              >
                Initialize Schema
              </button>
              <button
                onClick={loadCompanies}
                disabled={isLoading}
                className="px-3 py-1 bg-orange-500 text-white rounded text-sm hover:bg-orange-600 disabled:opacity-50"
              >
                Reload Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex justify-between items-start">
            <div className="flex items-start space-x-3">
              <div className="text-red-600 text-xl">⚠️</div>
              <div>
                <h3 className="text-red-800 font-medium">Error</h3>
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

      {/* Loading State */}
      {isLoading && companies.length === 0 && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Loading companies...</h2>
          <p className="text-gray-600">Fetching data from database</p>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {!isLoading && companies.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📄</div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">No companies found</h2>
            <p className="text-gray-600 mb-4">Upload your financial PDF documents to get started</p>
            <p className="text-sm text-gray-500">Data is automatically synced across all your devices</p>
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