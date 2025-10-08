'use client'

import React, { useState, useEffect } from 'react'
import { useUser, SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { getMilestones } from '@/lib/api'
import { Milestone } from '@/types'

export default function MilestonesPage() {
  const { isSignedIn, isLoaded } = useUser()
  const router = useRouter()
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [filterPriority, setFilterPriority] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      loadMilestones()
    }
  }, [isLoaded, isSignedIn])

  const loadMilestones = async () => {
    setIsLoading(true)
    setErrorMessage(null)
    
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
      setErrorMessage('Failed to load milestones')
    } finally {
      setIsLoading(false)
    }
  }

  // Filter milestones
  const filteredMilestones = milestones.filter(milestone => {
    // Priority filter
    if (filterPriority && milestone.priority !== filterPriority) {
      return false
    }
    
    // Search filter
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
        return 'bg-red-100 text-red-800 border-red-200'
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'low':
        return 'bg-green-100 text-green-800 border-green-200'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
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

  return (
    <div className="min-h-screen bg-gray-50">
      <SignedOut>
        <div className="min-h-screen flex items-center justify-center">
          <div className="max-w-md mx-auto text-center p-8">
            <div className="text-6xl mb-6">🎯</div>
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Milestone Tracker
            </h1>
            <p className="text-gray-600 mb-8">
              Please sign in to view portfolio milestones.
            </p>
          </div>
        </div>
      </SignedOut>

      <SignedIn>
        {/* Header */}
        <div className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => router.push('/')}
                  className="text-gray-600 hover:text-gray-900 transition-colors"
                  title="Back to Portfolio"
                >
                  <span className="text-2xl">←</span>
                </button>
                <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                  🎯 Milestone Tracker
                </h1>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={loadMilestones}
                  disabled={isLoading}
                  className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  <span>🔄</span>
                  <span className="hidden sm:inline">Reload</span>
                </button>
                <UserButton />
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-gradient-to-r from-gray-50 to-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Search */}
              <div className="flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search companies or descriptions..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              {/* Priority Filter */}
              <div>
                <select
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value)}
                  className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">All Priorities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
            
            {/* Results count */}
            <div className="mt-3 text-sm text-gray-600">
              Showing {filteredMilestones.length} of {milestones.length} milestone{milestones.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start">
                <span className="text-red-600 text-xl mr-3">⚠️</span>
                <div>
                  <h3 className="text-red-800 font-semibold">Error</h3>
                  <p className="text-red-700">{errorMessage}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading milestones...</p>
            </div>
          ) : filteredMilestones.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🎯</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {milestones.length === 0 ? 'No milestones yet' : 'No matching milestones'}
              </h2>
              <p className="text-gray-600">
                {milestones.length === 0 
                  ? 'Milestones will appear here once board decks are analyzed.'
                  : 'Try adjusting your search or filters.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredMilestones.map((milestone) => (
                <div 
                  key={milestone.id}
                  className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    {/* Left side - Company and description */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          onClick={() => router.push(`/company/${milestone.company_id}`)}
                          className="text-lg font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                        >
                          {milestone.company_name || `Company #${milestone.company_id}`}
                        </button>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getPriorityBadge(milestone.priority)}`}>
                          {milestone.priority.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-gray-700 leading-relaxed">
                        {milestone.description}
                      </p>
                    </div>
                    
                    {/* Right side - Date */}
                    <div className="flex-shrink-0">
                      <div className={`text-right ${isPastDate(milestone.milestone_date) ? 'text-red-600' : 'text-gray-900'}`}>
                        <div className="text-sm font-medium text-gray-500 mb-1">Target Date</div>
                        <div className="text-lg font-semibold whitespace-nowrap">
                          {formatDate(milestone.milestone_date)}
                          {isPastDate(milestone.milestone_date) && (
                            <span className="ml-2 text-xs" title="Past due">⚠️</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Footer - metadata */}
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                    <div>
                      Added {formatDate(milestone.created_at)}
                    </div>
                    {milestone.financial_report_id && (
                      <div className="text-gray-400">
                        Report #{milestone.financial_report_id}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SignedIn>
    </div>
  )
}

