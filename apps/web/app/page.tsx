'use client'

// Trigger Vercel deployment - Database Editor fixes applied
import React, { useState, useEffect } from 'react'
import { useUser, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import FileUpload from '@/components/ui/FileUpload'
import CapTableUpload from '@/components/company/CapTableUpload'
import CompanyCard from '@/components/company/CompanyCard'
import { FinancialReport, Company, CompanyOverview, CapTableData, PortfolioSummary, Milestone } from '@/types'
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
  createDatabaseSchema,
  createOrGetCompany,
  getMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  markMilestoneCompleted
} from '@/lib/api'
import { companiesCache } from '@/lib/companiesCache'
import { detectCompanyStage } from '@/lib/stageDetection'
import { cleanFileName } from '@/lib/utils'

type ActiveView = 'portfolio' | 'milestones' | 'voice'



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
  const { isSignedIn, user, isLoaded } = useUser()
  const router = useRouter()
  const [activeView, setActiveView] = useState<ActiveView>('portfolio')
  const [companies, setCompanies] = useState<Company[]>([])
  const [filteredCompanies, setFilteredCompanies] = useState<Company[]>([])
  const [enrichmentData, setEnrichmentData] = useState<Record<string, any>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'healthy' | 'unhealthy'>('unknown')
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [showUploads, setShowUploads] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)

  // Filter states
  const [filters, setFilters] = useState({
    stage: '',
    sector: '',
    search: ''
  })

  // Milestone states
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [filterPriority, setFilterPriority] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [showCompleted, setShowCompleted] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailRecipient, setEmailRecipient] = useState('')
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  
  // Milestone form state
  const [formData, setFormData] = useState({
    company_id: '',
    milestone_date: '',
    description: '',
    priority: 'medium' as 'critical' | 'high' | 'medium' | 'low'
  })

  // Load companies from cache or database only when user is authenticated
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      loadCompaniesWithCache()
      loadMilestones()
      checkBackendHealth()
    }
  }, [isLoaded, isSignedIn])

  // Close sort menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (showSortMenu && !target.closest('.sort-menu-container')) {
        setShowSortMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSortMenu])

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
    
    // ALWAYS ensure we have a company ID - create company if needed
    let finalCompanyId = companyId
    let finalCompanyName = companyName
    
    // If we don't have a company ID but have a company name, create/get the company
    if (!finalCompanyId && finalCompanyName) {
      console.log(`🏢 Creating/getting company: ${finalCompanyName}`)
      try {
        const companyResult = await createOrGetCompany(finalCompanyName)
        
        if (companyResult.error) {
          setErrorMessage(`Failed to create/get company: ${companyResult.error}`)
          setIsLoading(false)
          return
        }
        
        finalCompanyId = companyResult.companyId
        finalCompanyName = companyResult.companyName
        console.log(`✅ Company resolved: ID ${finalCompanyId}, Name: ${finalCompanyName}`)
      } catch (error) {
        console.error('Failed to create/get company:', error)
        setErrorMessage(`Failed to create company: ${error instanceof Error ? error.message : 'Unknown error'}`)
        setIsLoading(false)
        return
      }
    }
    
    // At this point we should ALWAYS have a company ID
    if (!finalCompanyId) {
      setErrorMessage('Cannot upload: No company ID available and no company name provided')
      setIsLoading(false)
      return
    }
    
    for (const file of files) {
      try {
        console.log(`🚀 Uploading ${file.name} for company: ${finalCompanyName}`)
        console.log(`📋 Company DB ID: ${finalCompanyId}`)
        console.log(`🛤️  Upload method: S3 direct upload (SOTA)`)
        
        // Always use S3 direct upload since we now guarantee having a company ID
        const result = await uploadToS3(file, finalCompanyId, finalCompanyName)
        
        if (result.error) {
          console.error('Upload error:', result.error)
          setErrorMessage(`Error uploading ${file.name}: ${result.error}`)
          continue
        }
        
        if (result.data && !result.error) {
          const data = result.data
          console.log('Upload successful:', data)
          
          // S3 Upload: Processing is asynchronous via Lambda
          console.log(`✅ S3 upload completed: ${data.s3Key}`)
          console.log(`🔄 ${data.message}`)
          
          // Show user feedback about async processing with detailed timeline
          setErrorMessage(null) // Clear any previous errors
          
          // Show success notification with processing timeline and reload option
          const shouldReload = confirm(`✅ Upload successful! 

🔄 Processing in background - Your PDF is being analyzed automatically. Financial data extraction and analysis will complete within 2-3 minutes.

📊 Results will appear in the company dashboard once processing is complete.

Click OK to reload the page and see updated company list, or Cancel to continue without reloading.`)
          
          if (shouldReload) {
            window.location.reload()
          } else {
            // Refresh companies list to show any new entries (in case this is a new company)
            await loadCompanies(true)
          }
          
          // Note: No immediate database save - Lambda will handle this automatically
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

  // Milestone functions
  const loadMilestones = async () => {
    try {
      const response = await getMilestones()
      
      if (response.error) {
        setErrorMessage(response.error)
        return
      }
      
      const milestonesData = response.data?.data?.data?.milestones || response.data?.data?.milestones || []
      setMilestones(milestonesData)
      console.log(`✅ Loaded ${milestonesData.length} milestones`)
    } catch (error) {
      console.error('Failed to load milestones:', error)
    }
  }

  const handleCreateMilestone = async () => {
    if (!formData.company_id || !formData.milestone_date || !formData.description) {
      alert('Please fill in all required fields')
      return
    }

    try {
      const result = await createMilestone({
        company_id: parseInt(formData.company_id),
        milestone_date: formData.milestone_date,
        description: formData.description,
        priority: formData.priority
      })

      if (result.error) {
        alert(`Failed to create milestone: ${result.error}`)
        return
      }

      setShowCreateModal(false)
      resetMilestoneForm()
      loadMilestones()
    } catch (error) {
      alert(`Failed to create milestone: ${error}`)
    }
  }

  const handleUpdateMilestone = async () => {
    if (!editingMilestone || !formData.milestone_date || !formData.description) {
      alert('Please fill in all required fields')
      return
    }

    try {
      const result = await updateMilestone({
        milestone_id: editingMilestone.id,
        milestone_date: formData.milestone_date,
        description: formData.description,
        priority: formData.priority
      })

      if (result.error) {
        alert(`Failed to update milestone: ${result.error}`)
        return
      }

      setEditingMilestone(null)
      resetMilestoneForm()
      loadMilestones()
    } catch (error) {
      alert(`Failed to update milestone: ${error}`)
    }
  }

  const handleDeleteMilestone = async (milestoneId: number) => {
    if (!confirm('Are you sure you want to delete this milestone? This cannot be undone.')) {
      return
    }

    try {
      const result = await deleteMilestone(milestoneId)

      if (result.error) {
        alert(`Failed to delete milestone: ${result.error}`)
        return
      }

      loadMilestones()
    } catch (error) {
      alert(`Failed to delete milestone: ${error}`)
    }
  }

  const handleToggleCompleted = async (milestone: Milestone) => {
    try {
      const result = await markMilestoneCompleted(milestone.id, !milestone.completed)

      if (result.error) {
        alert(`Failed to update milestone: ${result.error}`)
        return
      }

      loadMilestones()
    } catch (error) {
      alert(`Failed to update milestone: ${error}`)
    }
  }

  const openEditModal = (milestone: Milestone) => {
    setEditingMilestone(milestone)
    setFormData({
      company_id: milestone.company_id.toString(),
      milestone_date: milestone.milestone_date,
      description: milestone.description,
      priority: milestone.priority
    })
  }

  const resetMilestoneForm = () => {
    setFormData({
      company_id: '',
      milestone_date: '',
      description: '',
      priority: 'medium'
    })
  }

  const handleSendEmail = async () => {
    if (!emailRecipient || !emailRecipient.includes('@')) {
      alert('Please enter a valid email address')
      return
    }

    setIsSendingEmail(true)
    
    try {
      const response = await fetch('/api/send-milestone-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailRecipient })
      })

      const result = await response.json()

      if (result.error) {
        alert(`Failed to send email: ${result.error}`)
        return
      }

      alert(`✅ Email sent successfully to ${emailRecipient}!`)
      setShowEmailModal(false)
      setEmailRecipient('')
    } catch (error) {
      alert(`Failed to send email: ${error}`)
    } finally {
      setIsSendingEmail(false)
    }
  }

  // Filter milestones
  const filteredMilestones = milestones.filter(milestone => {
    if (!showCompleted && milestone.completed) return false
    if (filterPriority && milestone.priority !== filterPriority) return false
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        milestone.company_name?.toLowerCase().includes(query) ||
        milestone.description?.toLowerCase().includes(query)
      )
    }
    return true
  })

  // Get priority badge styling
  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'bg-red-100 text-red-700 border-red-200'
      case 'high':
        return 'bg-orange-100 text-orange-700 border-orange-200'
      case 'medium':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      case 'low':
        return 'bg-green-100 text-green-700 border-green-200'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  // Format date
  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A'
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      })
    } catch {
      return dateString
    }
  }

  // Check if date is in the past
  const isPastDate = (dateString: string) => {
    if (!dateString) return false
    try {
      const date = new Date(dateString)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return date < today
    } catch {
      return false
    }
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

  // Show loading state while authentication is being determined
  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  // Get page title based on active view
  const getPageTitle = () => {
    switch (activeView) {
      case 'portfolio':
        return 'Portfolio Management System'
      case 'milestones':
        return 'Milestone Tracking & Monitoring'
      case 'voice':
        return 'Database Intelligence'
      default:
        return 'Portfolio Management System'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SignedOut>
        {/* Header for unauthenticated users */}
        <header className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <h1 className="text-xl font-bold text-gray-900">
                PDF Finance Summarizer
              </h1>
              <div className="flex items-center space-x-4">
                <SignInButton mode="modal">
                  <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">
                    Sign In
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="bg-gray-100 hover:bg-gray-200 text-gray-900 px-4 py-2 rounded-md text-sm font-medium border border-gray-300 transition-colors">
                    Sign Up
                  </button>
                </SignUpButton>
              </div>
            </div>
          </div>
        </header>
        
        {/* Landing page for unauthenticated users */}
        <div className="min-h-screen flex items-center justify-center">
          <div className="max-w-md mx-auto text-center p-8">
            <div className="text-6xl mb-6">📊</div>
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Portfolio Management Platform
            </h1>
            <p className="text-gray-600 mb-8">
              Securely manage your portfolio companies, upload financial reports, and track performance metrics.
            </p>
            <p className="text-sm text-gray-500">
              Please sign in to access your portfolio dashboard.
            </p>
          </div>
        </div>
      </SignedOut>

      <SignedIn>
        {/* Main Layout with Sidebar */}
        <div className="flex h-screen overflow-hidden">
          {/* Left Sidebar */}
          <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
            {/* Logo */}
            <div className="px-8 py-6 border-b border-gray-200">
              <img 
                src="/kv-logo.png" 
                alt="Khosla Ventures" 
                className="h-8 w-auto object-contain"
              />
            </div>

            {/* Navigation */}
            <div className="flex-1 overflow-y-auto py-6">
              {/* Agents Section */}
              <div className="px-4 mb-8">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-3">
                  Agents
                </h2>
                <nav className="space-y-1">
              <button
                    onClick={() => setActiveView('portfolio')}
                    className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      activeView === 'portfolio'
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="mr-3">📊</span>
                    Portfolio
              </button>
              <button
                    onClick={() => setActiveView('milestones')}
                    className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      activeView === 'milestones'
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="mr-3">🎯</span>
                    Milestones
              </button>
                <button
                    onClick={() => setActiveView('voice')}
                    className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      activeView === 'voice'
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="mr-3">🎤</span>
                    Voice
                </button>
                </nav>
              </div>
              
              {/* Tools Section */}
              <div className="px-4">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-3">
                  Tools
                </h2>
                <nav className="space-y-1">
                  <FileUpload onUpload={handleFileUpload} isLoading={isLoading} />
                  <CapTableUpload onUpload={handleCapTableUpload} isLoading={isLoading} />
              <button
                onClick={() => loadCompanies(true)}
                disabled={isLoading}
                    className="w-full flex items-center px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-md transition-colors disabled:opacity-50"
              >
                    <span className="mr-3">🔄</span>
                    Reload Cache
              </button>
              
                  {/* Sort/Filter Button */}
                  <div className="relative sort-menu-container">
                <button
                      onClick={() => setShowSortMenu(!showSortMenu)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-md transition-colors bg-white"
                    >
                      <span>Sort & Filter</span>
                      <span className="text-xs">
                        {filters.stage || filters.sector ? (
                          <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                            {[filters.stage, filters.sector].filter(Boolean).length}
                          </span>
                        ) : (
                          '▼'
                        )}
                  </span>
                </button>
                    
                    {/* Dropdown Menu */}
                    {showSortMenu && (
                      <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-64 overflow-y-auto">
                        <div className="p-2">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2 py-1">
                            Stage
              </div>
                          {Array.from(new Set(companies.map(c => c.stage).filter((s): s is string => Boolean(s))))
                            .sort()
                            .map((stage: string) => (
                              <button
                                key={stage}
                                onClick={() => setFilters({ ...filters, stage: filters.stage === stage ? '' : stage })}
                                className={`w-full text-left px-2 py-1.5 text-sm rounded transition-colors ${
                                  filters.stage === stage
                                    ? 'bg-blue-100 text-blue-900 font-medium'
                                    : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {filters.stage === stage && <span className="mr-1">✓</span>}
                                {stage}
                              </button>
                            ))
                          }
                          
                          <div className="border-t border-gray-200 my-2"></div>
                          
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2 py-1">
                            Sector
              </div>
                          {Array.from(new Set(companies.map(c => c.sector).filter((s): s is string => Boolean(s))))
                            .sort()
                            .map((sector: string) => (
                              <button
                                key={sector}
                                onClick={() => setFilters({ ...filters, sector: filters.sector === sector ? '' : sector })}
                                className={`w-full text-left px-2 py-1.5 text-sm rounded transition-colors ${
                                  filters.sector === sector
                                    ? 'bg-blue-100 text-blue-900 font-medium'
                                    : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {filters.sector === sector && <span className="mr-1">✓</span>}
                                {sector.charAt(0).toUpperCase() + sector.slice(1)}
                              </button>
                            ))
                          }
                          
                          {(filters.stage || filters.sector) && (
                            <>
                              <div className="border-t border-gray-200 my-2"></div>
                              <button
                                onClick={() => {
                                  setFilters({ ...filters, stage: '', sector: '' })
                                }}
                                className="w-full text-left px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
                              >
                                Clear All
                              </button>
                            </>
                          )}
              </div>
            </div>
                    )}
      </div>

                  {/* Active Filters Display */}
                  {(filters.stage || filters.sector) && (
                    <div className="flex flex-wrap gap-1 px-3">
                      {filters.stage && (
                        <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">
                          {filters.stage}
            <button
                            onClick={() => setFilters({ ...filters, stage: '' })}
                            className="hover:text-blue-900"
                          >
                            ×
                          </button>
                  </span>
                )}
                      {filters.sector && (
                        <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">
                          {filters.sector.charAt(0).toUpperCase() + filters.sector.slice(1)}
                          <button
                            onClick={() => setFilters({ ...filters, sector: '' })}
                            className="hover:text-blue-900"
                          >
                            ×
            </button>
                        </span>
                      )}
          </div>
                  )}
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    placeholder="Search..."
                    className="w-full flex items-center px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-md transition-colors placeholder:text-gray-400 bg-white"
                  />
                </nav>
              </div>
              </div>
              
            {/* Profile Section */}
            <div className="p-4 border-t border-gray-200">
              <div className="flex items-center space-x-3">
                <UserButton />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {user?.firstName || user?.emailAddresses[0]?.emailAddress}
                  </p>
                  <p className="text-xs text-gray-500">Profile</p>
              </div>
            </div>
          </div>
        </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-8 py-6">
              <h1 className="text-2xl font-bold text-gray-900">{getPageTitle()}</h1>
      </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-8">
              {/* Error Message */}
              {errorMessage && (
                <div className="mb-4">
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

              {/* Portfolio View */}
              {activeView === 'portfolio' && (
                <>
                  {/* Loading State */}
                  {isLoading && companies.length === 0 && (
                    <div className="text-center py-12">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                      <h2 className="text-xl font-semibold text-gray-900 mb-2">Loading companies...</h2>
                      <p className="text-gray-600">Fetching data from database</p>
                </div>
                  )}

                  {/* Stats */}
                  {!isLoading && companies.length > 0 && (
                    <div className="mb-6">
                      <p className="text-sm text-gray-600">
                        Showing {filteredCompanies.length} of {companies.length} companies
                        {filters.search && ` matching "${filters.search}"`}
                        {filters.sector && ` in ${filters.sector} sector`}
                        {filters.stage && ` at ${filters.stage}`}
                      </p>
                      {(filters.sector || filters.stage || filters.search) && (
                        <button
                          onClick={() => setFilters({ stage: '', sector: '', search: '' })}
                          className="mt-2 px-3 py-1 text-xs bg-slate-100 text-slate-700 rounded hover:bg-slate-200 font-medium border border-slate-200"
                        >
                          Clear Filters
            </button>
                      )}
              </div>
                  )}

                  {/* Portfolio Grid */}
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
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
                </>
              )}

              {/* Milestones View */}
              {activeView === 'milestones' && (
                <>
                  {/* Milestone Filters */}
                  <div className="mb-6 flex items-center gap-3">
                  <input
                    type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search milestones..."
                      className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                <select
                      value={filterPriority}
                      onChange={(e) => setFilterPriority(e.target.value)}
                      className="px-4 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">All Priorities</option>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                </select>
                    <label className="flex items-center space-x-2 px-4 py-2 border border-gray-300 rounded bg-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showCompleted}
                        onChange={(e) => setShowCompleted(e.target.checked)}
                        className="rounded w-4 h-4"
                      />
                      <span className="text-sm font-medium text-gray-700">Show Completed</span>
                    </label>
                    <button
                      onClick={() => setShowEmailModal(true)}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors"
                    >
                      📧 Send Email
                    </button>
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                    >
                      + Create Milestone
                    </button>
              </div>

                  {/* Milestone Stats */}
                  <div className="mb-6">
                    <p className="text-sm text-gray-600">
                      {filteredMilestones.length} / {milestones.length} milestones
                    </p>
                  </div>

                  {/* Milestone List */}
                  {isLoading && milestones.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                      <p className="text-gray-600">Loading milestones...</p>
                    </div>
                  ) : filteredMilestones.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="text-6xl mb-4">🎯</div>
                      <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                        {milestones.length === 0 ? 'No milestones yet' : 'No matching milestones'}
                      </h2>
                      <p className="text-gray-600 mb-4">
                        {milestones.length === 0 
                          ? 'Create your first milestone or upload board decks to get started.'
                          : 'Try adjusting your search or filters.'}
                      </p>
                      {milestones.length === 0 && (
                        <button
                          onClick={() => setShowCreateModal(true)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded font-medium transition-colors"
                        >
                          Create First Milestone
                    </button>
                  )}
                </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredMilestones.map((milestone) => (
                        <div 
                          key={milestone.id}
                          className={`bg-white border rounded-lg shadow-sm hover:shadow transition-shadow p-4 ${
                            milestone.completed ? 'border-gray-200 opacity-70' : 'border-gray-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0 flex items-center gap-3">
                              <button
                                onClick={() => router.push(`/company/${milestone.company_id}`)}
                                className="text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                              >
                                {milestone.company_name || `Company #${milestone.company_id}`}
                              </button>
                              <span className={`px-2 py-1 text-xs font-medium rounded border ${getPriorityBadge(milestone.priority)}`}>
                                {milestone.priority.toUpperCase()}
                              </span>
                              {milestone.completed && (
                                <span className="text-sm text-gray-500">✓</span>
                              )}
                              <p className={`text-sm ${milestone.completed ? 'text-gray-500 line-through' : 'text-gray-700'}`}>
                                {milestone.description}
                              </p>
              </div>

                            <div className="flex items-center gap-3">
                              <div className={`text-right ${isPastDate(milestone.milestone_date) && !milestone.completed ? 'text-red-600' : 'text-gray-700'}`}>
                                <div className="text-sm font-semibold">
                                  {formatDate(milestone.milestone_date)}
                                  {isPastDate(milestone.milestone_date) && !milestone.completed && (
                                    <span className="ml-1 text-sm">⚠️</span>
                                  )}
                                </div>
                              </div>
                              
                              <div className="flex gap-1">
                                <button
                                  onClick={() => handleToggleCompleted(milestone)}
                                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                                    milestone.completed
                                      ? 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'
                                      : 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100'
                                  }`}
                                >
                                  {milestone.completed ? '↩️' : '✓'}
                                </button>
                                <button
                                  onClick={() => openEditModal(milestone)}
                                  className="px-2 py-1 text-xs rounded border bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100 transition-colors"
                                >
                                  ✏️
                                </button>
                                <button
                                  onClick={() => handleDeleteMilestone(milestone.id)}
                                  className="px-2 py-1 text-xs rounded border bg-red-50 text-red-600 border-red-200 hover:bg-red-100 transition-colors"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                          </div>
                          
                          <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                            <div>
                              Added {formatDate(milestone.created_at)}
                              {milestone.completed && milestone.completed_at && (
                                <span> • Done {formatDate(milestone.completed_at)}</span>
                              )}
                            </div>
                            {milestone.report_file_name ? (
                              <div title={`From board deck: ${milestone.report_file_name}`}>
                                📄 {cleanFileName(milestone.report_file_name)}
                              </div>
                            ) : (
                              <div title="Manually created">✍️ Manual</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Voice View - Coming Soon */}
              {activeView === 'voice' && (
                <div className="flex flex-col items-center justify-center py-20">
                  <div className="text-8xl mb-6">🎤</div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-4">Database Intelligence</h2>
                  <p className="text-lg text-gray-600 mb-6 max-w-2xl text-center">
                    Coming Soon: Interact with your portfolio database using natural language. 
                    Ask questions, get insights, and manage your companies hands-free.
                  </p>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 max-w-2xl">
                    <h3 className="font-semibold text-blue-900 mb-3">Planned Features:</h3>
                    <ul className="space-y-2 text-sm text-blue-800">
                      <li className="flex items-start">
                        <span className="mr-2">•</span>
                        <span>Natural language queries about company performance and metrics</span>
                      </li>
                      <li className="flex items-start">
                        <span className="mr-2">•</span>
                        <span>Voice-activated data updates and milestone tracking</span>
                      </li>
                      <li className="flex items-start">
                        <span className="mr-2">•</span>
                        <span>AI-powered insights and recommendations</span>
                      </li>
                      <li className="flex items-start">
                        <span className="mr-2">•</span>
                        <span>Hands-free portfolio management</span>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Email Modal */}
        {showEmailModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6">
                <h2 className="text-lg font-bold mb-4">📧 Send Milestone Reminder</h2>
                
                <p className="text-sm text-gray-600 mb-4">
                  This will send an email with all incomplete and upcoming milestones to the address below.
                </p>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Email Address *</label>
                  <input
                    type="email"
                    value={emailRecipient}
                    onChange={(e) => setEmailRecipient(e.target.value)}
                    placeholder="example@domain.com"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-green-500"
                    disabled={isSendingEmail}
                  />
                </div>
                
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowEmailModal(false)
                      setEmailRecipient('')
                    }}
                    disabled={isSendingEmail}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSendEmail}
                    disabled={isSendingEmail}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors disabled:opacity-50"
                  >
                    {isSendingEmail ? 'Sending...' : 'Send Email'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create/Edit Milestone Modal */}
        {(showCreateModal || editingMilestone) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <h2 className="text-lg font-bold mb-4">
                  {editingMilestone ? 'Edit Milestone' : 'Create Milestone'}
                </h2>
                
                <div className="space-y-4">
                  {!editingMilestone && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Company *</label>
                <select
                        value={formData.company_id}
                        onChange={(e) => setFormData({ ...formData, company_id: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">Select a company...</option>
                        {companies.map((company) => (
                          <option key={company.id} value={company.id}>{company.name}</option>
                        ))}
                </select>
              </div>
                  )}
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Target Date *</label>
                    <input
                      type="date"
                      value={formData.milestone_date}
                      onChange={(e) => setFormData({ ...formData, milestone_date: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Priority *</label>
                <select
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                </select>
              </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Description *</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Describe the milestone..."
                      required
                    />
                  </div>
                </div>
                
                <div className="mt-6 flex justify-end space-x-3">
                <button
                    onClick={() => {
                      setShowCreateModal(false)
                      setEditingMilestone(null)
                      resetMilestoneForm()
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                </button>
                  <button
                    onClick={editingMilestone ? handleUpdateMilestone : handleCreateMilestone}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                  >
                    {editingMilestone ? 'Update' : 'Create'}
                  </button>
            </div>
          </div>
        </div>
      </div>
        )}

      {/* Debug Panel */}
      {showDebugPanel && (
          <div className="fixed bottom-20 right-4 bg-white border border-gray-300 rounded-lg shadow-xl p-4 w-80 z-50">
            <h3 className="font-bold text-gray-900 mb-3">Developer Tools</h3>
            <div className="flex flex-col gap-2">
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
      )}

        {/* Developer Tools Toggle */}
        <button
          onClick={() => setShowDebugPanel(!showDebugPanel)}
          className="fixed bottom-4 right-4 bg-gray-800 text-white p-3 rounded-full shadow-lg hover:bg-gray-700 transition-colors z-40"
          title="Developer Tools"
        >
          🛠️
        </button>
      </SignedIn>
    </div>
  )
}