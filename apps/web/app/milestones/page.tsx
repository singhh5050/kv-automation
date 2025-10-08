'use client'

import React, { useState, useEffect } from 'react'
import { useUser, SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { getMilestones, createMilestone, updateMilestone, deleteMilestone, markMilestoneCompleted, getCompanies } from '@/lib/api'
import { Milestone } from '@/types'
import { cleanFileName } from '@/lib/utils'

export default function MilestonesPage() {
  const { isSignedIn, isLoaded } = useUser()
  const router = useRouter()
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [companies, setCompanies] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [filterPriority, setFilterPriority] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [showCompleted, setShowCompleted] = useState(true)
  
  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null)
  
  // Form state
  const [formData, setFormData] = useState({
    company_id: '',
    milestone_date: '',
    description: '',
    priority: 'medium' as 'critical' | 'high' | 'medium' | 'low'
  })

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      loadMilestones()
      loadCompanies()
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

  const loadCompanies = async () => {
    try {
      const response = await getCompanies()
      const companiesData = response.data?.data?.companies || []
      setCompanies(companiesData)
    } catch (error) {
      console.error('Failed to load companies:', error)
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
      resetForm()
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
      resetForm()
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

  const resetForm = () => {
    setFormData({
      company_id: '',
      milestone_date: '',
      description: '',
      priority: 'medium'
    })
  }

  // Filter milestones
  const filteredMilestones = milestones.filter(milestone => {
    // Completed filter
    if (!showCompleted && milestone.completed) {
      return false
    }
    
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
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                >
                  <span>+</span>
                  <span className="hidden sm:inline">Create Milestone</span>
                  <span className="sm:hidden">Create</span>
                </button>
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
              
              {/* Show Completed Toggle */}
              <div>
                <label className="flex items-center space-x-2 px-4 py-2 border border-gray-300 rounded-lg bg-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCompleted}
                    onChange={(e) => setShowCompleted(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">Show Completed</span>
                </label>
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
              <p className="text-gray-600 mb-4">
                {milestones.length === 0 
                  ? 'Create your first milestone or upload board decks to get started.'
                  : 'Try adjusting your search or filters.'}
              </p>
              {milestones.length === 0 && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                  Create First Milestone
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredMilestones.map((milestone) => (
                <div 
                  key={milestone.id}
                  className={`bg-white border rounded-lg shadow-sm hover:shadow-md transition-shadow p-5 ${
                    milestone.completed ? 'border-gray-200 opacity-75' : 'border-gray-200'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    {/* Left side - Company and description */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <button
                          onClick={() => router.push(`/company/${milestone.company_id}`)}
                          className="text-lg font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                        >
                          {milestone.company_name || `Company #${milestone.company_id}`}
                        </button>
                        <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getPriorityBadge(milestone.priority)}`}>
                          {milestone.priority.toUpperCase()}
                        </span>
                        {milestone.completed && (
                          <span className="px-2 py-1 text-xs font-medium rounded-full border bg-gray-100 text-gray-700 border-gray-300">
                            ✓ COMPLETED
                          </span>
                        )}
                      </div>
                      <p className={`leading-relaxed ${milestone.completed ? 'text-gray-500 line-through' : 'text-gray-700'}`}>
                        {milestone.description}
                      </p>
                    </div>
                    
                    {/* Right side - Date and Actions */}
                    <div className="flex flex-col sm:flex-row lg:flex-col gap-3 items-start lg:items-end">
                      <div className={`text-right ${isPastDate(milestone.milestone_date) && !milestone.completed ? 'text-red-600' : 'text-gray-900'}`}>
                        <div className="text-sm font-medium text-gray-500 mb-1">Target Date</div>
                        <div className="text-lg font-semibold whitespace-nowrap">
                          {formatDate(milestone.milestone_date)}
                          {isPastDate(milestone.milestone_date) && !milestone.completed && (
                            <span className="ml-2 text-xs" title="Past due">⚠️</span>
                          )}
                        </div>
                      </div>
                      
                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleToggleCompleted(milestone)}
                          className={`px-3 py-1 text-xs font-medium rounded border transition-colors ${
                            milestone.completed
                              ? 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                              : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                          }`}
                          title={milestone.completed ? 'Mark as incomplete' : 'Mark as complete'}
                        >
                          {milestone.completed ? '↩️' : '✓'}
                        </button>
                        <button
                          onClick={() => openEditModal(milestone)}
                          className="px-3 py-1 text-xs font-medium rounded border bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors"
                          title="Edit milestone"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDeleteMilestone(milestone.id)}
                          className="px-3 py-1 text-xs font-medium rounded border bg-red-50 text-red-700 border-red-200 hover:bg-red-100 transition-colors"
                          title="Delete milestone"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Footer - metadata */}
                  <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                    <div>
                      Added {formatDate(milestone.created_at)}
                      {milestone.completed && milestone.completed_at && (
                        <span> • Completed {formatDate(milestone.completed_at)}</span>
                      )}
                    </div>
                    {milestone.report_file_name ? (
                      <div className="text-gray-400" title={`From board deck: ${milestone.report_file_name}`}>
                        📄 {cleanFileName(milestone.report_file_name)}
                      </div>
                    ) : (
                      <div className="text-gray-400" title="Manually created">
                        ✍️ Manual
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create/Edit Modal */}
        {(showCreateModal || editingMilestone) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <h2 className="text-2xl font-bold mb-4">
                  {editingMilestone ? 'Edit Milestone' : 'Create New Milestone'}
                </h2>
                
                <div className="space-y-4">
                  {/* Company Selection (only for create) */}
                  {!editingMilestone && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Company *
                      </label>
                      <select
                        value={formData.company_id}
                        onChange={(e) => setFormData({ ...formData, company_id: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="">Select a company...</option>
                        {companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  
                  {/* Date */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Target Date *
                    </label>
                    <input
                      type="date"
                      value={formData.milestone_date}
                      onChange={(e) => setFormData({ ...formData, milestone_date: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>
                  
                  {/* Priority */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Priority *
                    </label>
                    <select
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  
                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description *
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={4}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Describe the milestone..."
                      required
                    />
                  </div>
                </div>
                
                {/* Actions */}
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    onClick={() => {
                      setShowCreateModal(false)
                      setEditingMilestone(null)
                      resetForm()
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={editingMilestone ? handleUpdateMilestone : handleCreateMilestone}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                  >
                    {editingMilestone ? 'Update Milestone' : 'Create Milestone'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </SignedIn>
    </div>
  )
}
