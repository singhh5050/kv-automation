'use client'

// Trigger Vercel deployment - Database Editor fixes applied
import React, { useState, useEffect } from 'react'
import FileUpload from '@/components/ui/FileUpload'
import CapTableUpload from '@/components/company/CapTableUpload'
import CompanyCard from '@/components/company/CompanyCard'
import { FinancialReport, Company, CompanyOverview, CapTableData, PortfolioSummary } from '@/types'
import { 
  uploadFile, 
  uploadToS3,
  saveFinancialReport, 
  getCompanies, 
  getPortfolioSummary,
  getCompanyOverview,
  getCompanyEnrichment,
  healthCheck,
  testDatabaseConnection,
  createDatabaseSchema 
} from '@/lib/api'
import { companiesCache } from '@/lib/companiesCache'
import { detectCompanyStage } from '@/lib/stageDetection'



// Convert portfolio summary to frontend Company format  
const convertPortfolioSummaryToFrontend = (portfolioData: any[]): Company[] => {
  console.log('🔄 Converting portfolio summary for', portfolioData.length, 'companies')
  
  return portfolioData.map((company: any) => ({
    id: company.id.toString(),
    name: company.name,
    sector: company.sector || 'unknown',
    stage: company.investment_stage || 'Unknown',
    reports: [], // We don't need full reports for portfolio view
    latestReport: null, // Will be populated if needed when user clicks on company
    capTable: company.valuation ? {
      round_id: null,
      round_name: 'Current',
      valuation: company.valuation,
      amount_raised: null,
      round_date: null,
      total_pool_size: null,
      pool_available: null,
      pool_utilization: null,
      options_outstanding: null,
      investors: [] // Will be populated if needed when user clicks on company
    } : null,
    // Portfolio summary specific fields
    portfolioSummary: {
      cash_out_date: company.cash_out_date,
      total_reports: company.total_reports,
      kv_ownership: company.kv_ownership,
      kv_investment: company.kv_investment,
      kv_funds: company.kv_funds,
      company_logo: company.company_logo
    }
  }))
}

export default function Home() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([])
  const [enrichmentData, setEnrichmentData] = useState<Record<string, any>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'healthy' | 'unhealthy'>('unknown')
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [showUploads, setShowUploads] = useState(false)

  // Filter states
  const [filters, setFilters] = useState({
    stage: '',
    sector: '',
    search: ''
  })

  // Load companies from cache or database on mount
  useEffect(() => {
    loadCompaniesWithCache()
    checkBackendHealth()
  }, [])

  // Apply filters whenever companies or filters change
  useEffect(() => {
    let filtered = companies

    // Apply search filter
    if (filters.search) {
      filtered = filtered.filter(company => 
        company.name?.toLowerCase().includes(filters.search.toLowerCase())
      )
    }

    // Apply sector filter  
    if (filters.sector) {
      filtered = filtered.filter(company => 
        company.sector?.toLowerCase() === filters.sector.toLowerCase()
      )
    }

    // Apply stage filter
    if (filters.stage) {
      filtered = filtered.filter(company => 
        company.stage === filters.stage
      )
    }

    // Apply other filters as needed...

    setFilteredCompanies(filtered)
  }, [companies, filters])

  const applyFilters = () => {
    let filtered = companies

    // Apply sector filter  
    if (filters.sector) {
      filtered = filtered.filter(company => 
        company.sector?.toLowerCase() === filters.sector.toLowerCase()
      )
    }

    // Apply stage filter
    if (filters.stage) {
      filtered = filtered.filter(company => 
        company.stage === filters.stage
      )
    }

    // Apply other filters as needed...

    setFilteredCompanies(filtered)
  }

  const loadCompaniesWithCache = async () => {
    // First check if we have valid cached data
    const cachedCompanies = companiesCache.get()
    if (cachedCompanies && cachedCompanies.length > 0) {
      console.log('📦 Using cached companies data:', cachedCompanies.length, 'companies')
      setCompanies(cachedCompanies)
      // Load enrichment data for cached companies
      loadEnrichmentData(cachedCompanies)
      return
    }

    // If no cache, load from database
    await loadCompanies()
  }

  const loadCompanies = async (forceReload = false) => {
    // If forcing reload, clear cache first
    if (forceReload) {
      companiesCache.clear()
    }

    setIsLoading(true)
    try {
      console.log('🔄 Loading portfolio summary from database...')
      const result = await getPortfolioSummary()
      console.log('📊 Portfolio summary result:', result)
      
      if (result.data && !result.error) {
        const portfolioCompanies = result.data.data?.companies || []
        console.log('🏢 Portfolio companies:', portfolioCompanies)
        console.log('📈 Number of companies found:', portfolioCompanies.length)
        
        if (portfolioCompanies.length === 0) {
          console.log('⚠️ No companies found in database')
          setCompanies([])
        } else {
          console.log('🔄 Converting portfolio summary to frontend format...')
          console.log('📊 Sample portfolio company data:', portfolioCompanies[0])
          const frontendCompanies = convertPortfolioSummaryToFrontend(portfolioCompanies)
          console.log('✅ Converted companies:', frontendCompanies)
          console.log('📊 Sample frontend company:', frontendCompanies[0])
          console.log('📊 Number of frontend companies:', frontendCompanies.length)
          setCompanies(frontendCompanies)
          
          // Cache the loaded data
          companiesCache.set(frontendCompanies)
          
          // Load enrichment data for companies (if needed)
          // Note: Portfolio summary already includes logos, so this may not be needed
          loadEnrichmentData(frontendCompanies)
        }
      } else {
        console.error('❌ Error loading portfolio summary:', result.error)
        setErrorMessage(`Failed to load companies: ${result.error}`)
      }
    } catch (error) {
      console.error('💥 Exception loading portfolio summary:', error)
      setErrorMessage(`Failed to load companies: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsLoading(false)
    }
  }

  const loadEnrichmentData = async (companies: Company[]) => {
    try {
      console.log('🔍 Loading enrichment data for', companies.length, 'companies...')
      
      // Load enrichment data sequentially to avoid overwhelming the server
      const enrichmentMap: Record<string, any> = {}
      
              for (const company of companies) {
          try {
            const enrichmentResult = await getCompanyEnrichment(company.id)
            console.log(`Enrichment result for ${company.name}:`, enrichmentResult)
            if (enrichmentResult.data && !enrichmentResult.error && enrichmentResult.data.data) {
              console.log(`Raw enrichment data for ${company.name}:`, enrichmentResult.data.data)
              // Store the data in the structure expected by CompanyCard
              enrichmentMap[company.id] = {
                enrichment: {
                  extracted: enrichmentResult.data.data.extracted_data
                }
              }
              console.log(`Stored enrichment data for ${company.name}:`, enrichmentMap[company.id])
            }
          } catch (error) {
            console.log(`No enrichment data for ${company.name}:`, error)
            // Continue with next company instead of failing completely
          }
        }
      
      console.log('✅ Loaded enrichment data for', Object.keys(enrichmentMap).length, 'companies')
      setEnrichmentData(enrichmentMap)
    } catch (error) {
      console.error('❌ Error loading enrichment data:', error)
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

  const handleFileUpload = async (files: File[], companyName?: string, companyId?: number) => {
    setIsLoading(true)
    setErrorMessage(null)
    
    for (const file of files) {
      try {
        console.log(`🚀 Uploading ${file.name}${companyName ? ` for company: ${companyName}` : ''} via ${companyId ? 'S3 direct upload' : 'legacy API Gateway'}`)
        
        // Use S3 direct upload if we have a company ID, otherwise fall back to legacy method
        const result = companyId 
          ? await uploadToS3(file, companyId, companyName)
          : await uploadFile(file, companyName)
        
        if (result.error) {
          console.error('Upload error:', result.error)
          setErrorMessage(`Error uploading ${file.name}: ${result.error}`)
          continue
        }
        
        if (result.data && !result.error) {
          const data = result.data
          console.log('Upload successful:', data)
          
          // Handle different response types: S3 upload vs API Gateway
          if (data.s3Key) {
            // S3 Upload: Processing is asynchronous via Lambda
            console.log(`✅ S3 upload completed: ${data.s3Key}`)
            console.log(`🔄 ${data.message}`)
            
            // Show user feedback about async processing
            setErrorMessage(null) // Clear any previous errors
            
            // Refresh companies list to show any new entries (in case this is a new company)
            await loadCompanies(true)
            
            // Note: No immediate database save - Lambda will handle this automatically
            
          } else {
            // Legacy API Gateway: Immediate processing and database save
            console.log('📡 Legacy upload - saving to database immediately')
            
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
                sectorHighlightA: data.sectorHighlightA || 'Sector analysis not available',
                sectorHighlightB: data.sectorHighlightB || 'Sector analysis not available',
                keyRisks: data.keyRisks || 'N/A',
                personnelUpdates: data.personnelUpdates || 'N/A',
                nextMilestones: data.nextMilestones || 'N/A',
                sector: data.sector || 'unknown',
                user_provided_name: data.user_provided_name || !!companyName  // Flag for user-provided names
              })
            
            if (saveResult.error) {
              console.error('Failed to save to database:', saveResult.error)
              setErrorMessage(`Error saving ${file.name}: ${saveResult.error}`)
            } else {
              console.log('Saved to database successfully')
              // Reload companies to show the new data (force reload to bypass cache)
              await loadCompanies(true)
            }
            } catch (error) {
              console.error('Database save error:', error)
              setErrorMessage(`Error saving ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          } // End legacy API Gateway handling
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

  const handleCapTableUpload = async (success: boolean) => {
    if (success) {
      // Reload companies to show the new cap table data (force reload to bypass cache)
      await loadCompanies(true)
    }
  }

  const clearAllData = () => {
    if (confirm('Are you sure you want to clear all data? This will delete all companies and reports from the database and cannot be undone.')) {
      // TODO: Implement database clearing functionality
      // For now, just clear the local state and cache
      setCompanies([])
      companiesCache.clear()
      alert('Note: This only clears the local view and cache. Database clearing functionality needs to be implemented.')
    }
  }

  const handleDeleteCompany = (companyId: string) => {
    // Remove from companies state
    setCompanies(prev => prev.filter(company => company.id.toString() !== companyId))
    // Also remove from filtered companies
    setFilteredCompanies(prev => prev.filter(company => company.id.toString() !== companyId))
    // Clear from cache and refresh cache with updated data
    companiesCache.clear()
    setTimeout(() => {
      // Update cache with remaining companies after state update
      companiesCache.set(companies.filter(company => company.id.toString() !== companyId))
    }, 100)
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
      
      if (companiesResult.data?.data?.companies?.length > 0) {
        const firstCompany = companiesResult.data.data.companies[0]
        console.log('🏢 First company:', firstCompany)
        
        // Test getting overview for the first company
        const overviewResult = await getCompanyOverview(firstCompany.id.toString())
        console.log('📄 Overview for first company:', overviewResult)
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
      console.log('🔧 Initializing database schema...')
      const result = await createDatabaseSchema()
      console.log('📊 Schema initialization result:', result)
      
      if (result.data && !result.error) {
        alert('✅ Database schema initialized successfully!')
        // Reload companies after schema creation
        await loadCompanies(true)
      } else {
        console.error('❌ Schema initialization failed:', result.error)
        alert(`❌ Database schema initialization failed: ${result.error}`)
      }
    } catch (error) {
      console.error('💥 Exception during schema initialization:', error)
      alert(`💥 Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-4 gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                Portfolio Companies
              </h1>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
              <button
                onClick={() => loadCompanies(true)}
                disabled={isLoading}
                className="flex items-center justify-center space-x-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                <span>🔄</span>
                <span className="hidden sm:inline">Reload Cache</span>
                <span className="sm:hidden">Reload</span>
              </button>
              
              {/* Upload Toggle Button (Mobile) */}
              <div className="sm:hidden">
                <button
                  onClick={() => setShowUploads(!showUploads)}
                  className="flex items-center justify-center space-x-2 w-full px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                >
                  <span>📁</span>
                  <span>Upload Files</span>
                  <span className={`transform transition-transform ${showUploads ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                </button>
              </div>
              
              {/* Upload Buttons - Always visible on desktop, collapsible on mobile */}
              <div className={`${showUploads ? 'flex' : 'hidden'} sm:flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto`}>
                <FileUpload onUpload={handleFileUpload} isLoading={isLoading} />
                <CapTableUpload onUpload={handleCapTableUpload} isLoading={isLoading} />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="bg-gradient-to-r from-gray-50 to-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Filter Toggle Button (Mobile) */}
          <div className="sm:hidden py-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
            >
              <span className="flex items-center">
                <span className="mr-2">🔍</span>
                Filters
                {(filters.stage || filters.sector) && (
                  <span className="ml-2 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">
                    {[filters.stage, filters.sector].filter(Boolean).length}
                  </span>
                )}
              </span>
              <span className={`transform transition-transform ${showFilters ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>
          </div>

          {/* Filter Content */}
          <div className={`${showFilters ? 'block' : 'hidden'} sm:block py-3`}>
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 sm:gap-4">
              {/* Search Input */}
              <div className="flex flex-col sm:flex-row sm:items-center space-y-1 sm:space-y-0 sm:space-x-2">
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Search</label>
                <div className="relative">
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    placeholder="Search companies..."
                    className="text-sm border border-gray-300 rounded px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-full sm:min-w-[200px] sm:w-auto"
                  />
                  {filters.search && (
                    <button
                      onClick={() => setFilters({ ...filters, search: '' })}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center space-y-1 sm:space-y-0 sm:space-x-2">
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Stage</label>
                <select
                  value={filters.stage}
                  onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
                  className="text-sm border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-full sm:min-w-[110px] sm:w-auto"
                >
                  <option value="">All Stages</option>
                  {Array.from(new Set(companies.map(c => c.stage).filter(Boolean)))
                    .sort()
                    .map(stage => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))
                  }
                </select>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center space-y-1 sm:space-y-0 sm:space-x-2">
                <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Sector</label>
                <select
                  value={filters.sector}
                  onChange={(e) => setFilters({ ...filters, sector: e.target.value })}
                  className="text-sm border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-full sm:min-w-[110px] sm:w-auto"
                >
                  <option value="">All Sectors</option>
                  {Array.from(new Set(companies.map(c => c.sector).filter(Boolean)))
                    .sort()
                    .map(sector => (
                      <option key={sector} value={sector}>
                        {sector!.charAt(0).toUpperCase() + sector!.slice(1)}
                      </option>
                    ))
                  }
                </select>
              </div>

              {(filters.sector || filters.stage || filters.search) && (
                <button
                  onClick={() => setFilters({ stage: '', sector: '', search: '' })}
                  className="px-3 py-2 text-sm bg-slate-100 text-slate-700 rounded hover:bg-slate-200 font-medium border border-slate-200 whitespace-nowrap"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

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
                onClick={initializeDatabase}
                disabled={isLoading}
                className="px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600 disabled:opacity-50"
              >
                Initialize Schema
              </button>
              <button
                onClick={testDatabaseContents}
                disabled={isLoading}
                className="px-3 py-1 bg-purple-500 text-white rounded text-sm hover:bg-purple-600 disabled:opacity-50"
              >
                Test DB Contents
              </button>
              <button
                onClick={() => loadCompanies(true)}
                disabled={isLoading}
                className="px-3 py-1 bg-orange-500 text-white rounded text-sm hover:bg-orange-600 disabled:opacity-50"
              >
                Force Reload Data
              </button>
              <button
                onClick={() => {
                  companiesCache.clear()
                  alert('Cache cleared!')
                }}
                className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
              >
                Clear Cache
              </button>
              <button
                onClick={() => {
                  const info = companiesCache.getInfo()
                  alert(`Cache Info:\n${JSON.stringify(info, null, 2)}`)
                }}
                className="px-3 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600"
              >
                Cache Info
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
      <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
        {!isLoading && companies.length > 0 && (
          <div className="mb-4">
            <p className="text-sm text-gray-600">
              Showing {filteredCompanies.length} of {companies.length} companies
              {filters.search && ` matching "${filters.search}"`}
              {filters.sector && ` in ${filters.sector} sector`}
              {filters.stage && ` at ${filters.stage}`}
            </p>
          </div>
        )}
        
        {!isLoading && filteredCompanies.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📄</div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              {companies.length === 0 ? 'No companies found' : 'No companies match your filters'}
            </h2>
            <p className="text-gray-600 mb-4">
              {companies.length === 0 
                ? 'Upload your financial PDF documents to get started'
                : 'Try adjusting your filters or clearing them to see more companies'
              }
            </p>
            {companies.length === 0 && (
              <p className="text-sm text-gray-500">Data is automatically synced across all your devices</p>
            )}
          </div>
        ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
            {filteredCompanies.map((company) => (
              <CompanyCard
                key={company.id}
                company={company}
                enrichmentData={enrichmentData[company.id]}
                onDelete={handleDeleteCompany}
              />
            ))}
          </div>
        )}
      </main>

      {/* Developer Tools Toggle */}
      <button
        onClick={() => setShowDebugPanel(!showDebugPanel)}
        className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 bg-gray-800 text-white p-2 sm:p-3 rounded-full shadow-lg hover:bg-gray-700 transition-colors text-sm sm:text-base"
        title="Developer Tools"
      >
        🛠️
      </button>
    </div>
  )
}