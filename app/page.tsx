'use client'

import React, { useState, useEffect } from 'react'
import FileUpload from '@/components/FileUpload'
import CapTableUpload from '@/components/CapTableUpload'
import CompanyCard from '@/components/CompanyCard'
import { FinancialReport, Company, CompanyOverview, CapTableData } from '@/types'
import { 
  uploadFile, 
  saveFinancialReport, 
  getCompanies, 
  getCompanyOverview,
  healthCheck,
  testDatabaseConnection,
  createDatabaseSchema 
} from '@/lib/api'
import { companiesCache } from '@/lib/companiesCache'

// Company name normalization for matching
const normalizeCompanyName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\b(corp|corporation|inc|incorporated|ltd|limited|llc|co\.?)\b/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Coalesce companies with the same normalized name
const coalesceCompanies = (companies: Company[]): Company[] => {
  const companyMap = new Map<string, Company>()
  
  console.log('🔄 Starting company coalescing...')
  
  for (const company of companies) {
    const normalizedName = normalizeCompanyName(company.name)
    
    if (companyMap.has(normalizedName)) {
      // Merge with existing company
      const existing = companyMap.get(normalizedName)!
      console.log(`🔗 Merging "${company.name}" into "${existing.name}" (normalized: "${normalizedName}")`)
      
      // Combine reports and remove duplicates by ID
      const allReports = [...existing.reports, ...company.reports]
      const uniqueReports = allReports.filter((report, index, self) => 
        index === self.findIndex(r => r.id === report.id)
      )
      
      // Sort reports by date (newest first)
      uniqueReports.sort((a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime())
      
      // Use the most recent cap table (or prefer one with data)
      let mergedCapTable = existing.capTable
      if (!mergedCapTable && company.capTable) {
        mergedCapTable = company.capTable
        console.log(`  📊 Using cap table from "${company.name}"`)
      } else if (existing.capTable && company.capTable) {
        // Use the one with the most recent round_date
        const existingDate = existing.capTable.round_date ? new Date(existing.capTable.round_date) : new Date(0)
        const companyDate = company.capTable.round_date ? new Date(company.capTable.round_date) : new Date(0)
        mergedCapTable = companyDate > existingDate ? company.capTable : existing.capTable
        console.log(`  📊 Using cap table from "${mergedCapTable === company.capTable ? company.name : existing.name}" (more recent)`)
      }
      
      console.log(`  📄 Combined ${existing.reports.length} + ${company.reports.length} = ${uniqueReports.length} unique reports`)
      
      // Update the existing company with merged data
      companyMap.set(normalizedName, {
        ...existing,
        name: existing.name, // Keep the first company name encountered
        reports: uniqueReports,
        latestReport: uniqueReports[0] || null,
        capTable: mergedCapTable
      })
    } else {
      // First time seeing this normalized name
      console.log(`✨ New company: "${company.name}" (normalized: "${normalizedName}")`)
      companyMap.set(normalizedName, { ...company })
    }
  }
  
  const coalesced = Array.from(companyMap.values())
  console.log(`🎯 Coalescing complete: ${companies.length} companies → ${coalesced.length} unique companies`)
  
  return coalesced
}

// Convert database company format to frontend format using new overview API
const convertDatabaseToFrontend = async (dbCompanies: any[]): Promise<Company[]> => {
  const companies: Company[] = []
  
  console.log('🔄 Starting conversion of', dbCompanies.length, 'companies')
  
  for (const dbCompany of dbCompanies) {
    try {
      console.log('🏢 Processing company:', dbCompany.name, 'ID:', dbCompany.id)
      
      // Get complete overview for this company
      const overviewResult = await getCompanyOverview(dbCompany.id.toString())
      console.log('📊 Overview result for', dbCompany.name, ':', overviewResult)
      
      if (overviewResult.data && !overviewResult.error) {
        const overview: CompanyOverview = overviewResult.data.data
        console.log('📄 Found overview for', dbCompany.name, ':', overview)
        
        // Convert financial reports to frontend format
        const reports: FinancialReport[] = overview.financial_reports.map((report: any) => ({
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
          sectorHighlightA: report.sector_highlight_a || 'Sector analysis not available',
          sectorHighlightB: report.sector_highlight_b || 'Sector analysis not available',
          keyRisks: report.key_risks || 'N/A',
          personnelUpdates: report.personnel_updates || 'N/A',
          nextMilestones: report.next_milestones || 'N/A',
          sector: report.sector || 'healthcare',
          uploadDate: report.processed_at ? new Date(report.processed_at).toLocaleDateString() : new Date().toLocaleDateString(),
        }))

        // Sort reports by date (newest first)
        reports.sort((a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime())

        // Transform cap table data to match frontend interface (remove kv_stake and is_kv)
        let capTable: CapTableData | null = null
        if (overview.current_cap_table) {
          const ct = overview.current_cap_table
          capTable = {
            round_id: ct.round_id,
            round_name: ct.round_name || 'Current',
            valuation: ct.valuation,
            amount_raised: ct.amount_raised,
            round_date: ct.round_date,
            total_pool_size: ct.total_pool_size,
            pool_available: ct.pool_available,
            investors: (ct.investors || []).map((inv: any) => ({
              investor_name: inv.investor_name,
              total_invested: inv.total_invested,
              final_fds: inv.final_fds,
              final_round_investment: inv.final_round_investment
            }))
          }
        }

        companies.push({
          id: dbCompany.id.toString(),
          name: dbCompany.name,
          reports: reports,
          latestReport: reports[0] || null,
          capTable: capTable
        })
        
        console.log('✅ Successfully converted company:', dbCompany.name, 'with', reports.length, 'reports and cap table:', !!overview.current_cap_table)
      } else {
        // Check if error is due to missing cap_table_current table
        const isCapTableError = overviewResult.error && overviewResult.error.includes('cap_table_current')
        if (isCapTableError) {
          console.info('ℹ️ Company has no cap table data (table not initialized):', dbCompany.name)
        } else {
          console.warn('⚠️ No overview found for company:', dbCompany.name, 'Error:', overviewResult.error)
        }
        
        // Create basic company without data
        companies.push({
          id: dbCompany.id.toString(),
          name: dbCompany.name,
          reports: [],
          latestReport: null,
          capTable: null
        })
      }
    } catch (error) {
      console.error(`💥 Error loading overview for company ${dbCompany.name}:`, error)
    }
  }
  
  console.log('🎯 Conversion complete. Total companies:', companies.length)
  return coalesceCompanies(companies)
}

export default function Home() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'healthy' | 'unhealthy'>('unknown')
  const [showDebugPanel, setShowDebugPanel] = useState(false)

  // Filter states
  const [filters, setFilters] = useState({
    stage: '',
    sector: '',
    leadPartner: '',
    mdSponsor: '',
    needsHelp: ''
  })

  // Load companies from cache or database on mount
  useEffect(() => {
    loadCompaniesWithCache()
    checkBackendHealth()
  }, [])

  // Apply filters whenever companies or filters change
  useEffect(() => {
    applyFilters()
  }, [companies, filters])

  const applyFilters = () => {
    let filtered = companies

    // Apply stage filter
    if (filters.stage) {
      // For now, we'll assume all companies are "Main" stage since we don't have this data yet
      // In a real implementation, this would filter based on actual stage data
    }

    // Apply sector filter  
    if (filters.sector) {
      // Similar to stage, we'd filter based on actual sector data
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
          
          // Cache the loaded data
          companiesCache.set(frontendCompanies)
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
              sectorHighlightA: data.sectorHighlightA || 'Sector analysis not available',
              sectorHighlightB: data.sectorHighlightB || 'Sector analysis not available',
              keyRisks: data.keyRisks || 'N/A',
              personnelUpdates: data.personnelUpdates || 'N/A',
              nextMilestones: data.nextMilestones || 'N/A',
              sector: data.sector || 'healthcare'
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
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center space-x-6">
              <h1 className="text-2xl font-bold text-gray-900">Portfolio Companies</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => loadCompanies(true)}
                disabled={isLoading}
                className="flex items-center space-x-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <span>🔄</span>
                <span>Reload Cache</span>
              </button>
              <FileUpload onUpload={handleFileUpload} isLoading={isLoading} />
              <CapTableUpload onUpload={handleCapTableUpload} isLoading={isLoading} />
              <button className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Stage</label>
              <select
                value={filters.stage}
                onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="Seed">Seed</option>
                <option value="Series A">Series A</option>
                <option value="Main">Main</option>
              </select>
            </div>

            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Sector</label>
              <select
                value={filters.sector}
                onChange={(e) => setFilters({ ...filters, sector: e.target.value })}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Enterprise">Enterprise</option>
                <option value="Consumer">Consumer</option>
              </select>
            </div>

            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Lead Partner</label>
              <select
                value={filters.leadPartner}
                onChange={(e) => setFilters({ ...filters, leadPartner: e.target.value })}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="Sarah Johnson">Sarah Johnson</option>
                <option value="Alex Morgan">Alex Morgan</option>
              </select>
            </div>

            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">MD Sponsor</label>
              <select
                value={filters.mdSponsor}
                onChange={(e) => setFilters({ ...filters, mdSponsor: e.target.value })}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="Alex Morgan">Alex Morgan</option>
                <option value="Sarah Johnson">Sarah Johnson</option>
              </select>
            </div>

            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Needs help with</label>
              <select
                value={filters.needsHelp}
                onChange={(e) => setFilters({ ...filters, needsHelp: e.target.value })}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                <option value="recruiting">Recruiting</option>
                <option value="GTM">GTM</option>
                <option value="fundraising">Fundraising</option>
              </select>
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isLoading && filteredCompanies.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📄</div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">No companies found</h2>
            <p className="text-gray-600 mb-4">Upload your financial PDF documents to get started</p>
            <p className="text-sm text-gray-500">Data is automatically synced across all your devices</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredCompanies.map((company) => (
              <CompanyCard
                key={company.id}
                company={company}
              />
            ))}
          </div>
        )}
      </main>

      {/* Developer Tools Toggle */}
      <button
        onClick={() => setShowDebugPanel(!showDebugPanel)}
        className="fixed bottom-4 right-4 bg-gray-800 text-white p-2 rounded-full shadow-lg hover:bg-gray-700 transition-colors"
        title="Developer Tools"
      >
        🛠️
      </button>
    </div>
  )
}