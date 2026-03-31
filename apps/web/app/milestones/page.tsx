'use client'

import React, { useState, useEffect } from 'react'
import { useUser, SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { setCurrentUserEmail, getMilestones, createMilestone, updateMilestone, deleteMilestone, markMilestoneCompleted, getCompanies } from '@/lib/api'
import { Milestone } from '@/types'
import { cleanFileName } from '@/lib/utils'

export default function MilestonesPage() {
  const { isSignedIn, isLoaded, user } = useUser()
  const router = useRouter()

  useEffect(() => {
    if (user?.primaryEmailAddress?.emailAddress) {
      setCurrentUserEmail(user.primaryEmailAddress.emailAddress)
    }
  }, [user])
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
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [emailRecipient, setEmailRecipient] = useState('')
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  
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
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Milestone Tracker</h1>
            <p className="text-gray-600 mb-8">Please sign in to view portfolio milestones.</p>
          </div>
        </div>
      </SignedOut>

      <SignedIn>
        {/* Ultra-Compact Header */}
        <div className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-2.5">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => router.push('/')}
                  className="text-gray-600 hover:text-gray-900 transition-colors"
                  title="Back to Portfolio"
                >
                  <span className="text-lg">←</span>
                </button>
                <h1 className="text-lg font-bold text-gray-900">
                  🎯 Milestone Tracker
                </h1>
              </div>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => setShowEmailModal(true)}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors"
                  title="Send milestone reminder email"
                >
                  📧 Send Email
                </button>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                >
                  + Create
                </button>
                <button
                  onClick={loadMilestones}
                  disabled={isLoading}
                  className="px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  🔄
                </button>
                <UserButton />
              </div>
            </div>
          </div>
        </div>

        {/* Ultra-Compact Filters */}
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="flex-1 px-2.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="px-2.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              >
                <option value="">All Priorities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <label className="flex items-center space-x-1 px-2.5 py-1 border border-gray-300 rounded bg-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(e) => setShowCompleted(e.target.checked)}
                  className="rounded w-3 h-3"
                />
                <span className="text-xs font-medium text-gray-700">Completed</span>
              </label>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {filteredMilestones.length} / {milestones.length}
            </div>
          </div>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
            <div className="bg-red-50 border border-red-200 rounded p-2 flex items-start">
              <span className="text-red-600 text-sm mr-2">⚠️</span>
              <div>
                <h3 className="text-red-800 font-medium text-xs">Error</h3>
                <p className="text-red-700 text-xs">{errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Ultra-Compact Content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          {isLoading ? (
            <div className="text-center py-6">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              <p className="text-gray-600 text-xs">Loading...</p>
            </div>
          ) : filteredMilestones.length === 0 ? (
            <div className="text-center py-6">
              <div className="text-3xl mb-2">🎯</div>
              <h2 className="text-base font-semibold text-gray-900 mb-1">
                {milestones.length === 0 ? 'No milestones yet' : 'No matching milestones'}
              </h2>
              <p className="text-gray-600 text-xs mb-2">
                {milestones.length === 0 
                  ? 'Create your first milestone or upload board decks to get started.'
                  : 'Try adjusting your search or filters.'}
              </p>
              {milestones.length === 0 && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded font-medium transition-colors"
                >
                  Create First Milestone
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredMilestones.map((milestone) => (
                <div 
                  key={milestone.id}
                  className={`bg-white border rounded shadow-sm hover:shadow transition-shadow p-2 ${
                    milestone.completed ? 'border-gray-200 opacity-70' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    {/* Left: Company, Priority, Description - All in one line */}
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <button
                        onClick={() => router.push(`/company/${milestone.company_id}`)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline transition-colors flex-shrink-0"
                      >
                        {milestone.company_name || `Company #${milestone.company_id}`}
                      </button>
                      <span className={`px-1.5 py-0.5 text-xs font-medium rounded border flex-shrink-0 ${getPriorityBadge(milestone.priority)}`}>
                        {milestone.priority.toUpperCase()}
                      </span>
                      {milestone.completed && (
                        <span className="text-xs text-gray-500 flex-shrink-0">✓</span>
                      )}
                      <p className={`text-xs truncate ${milestone.completed ? 'text-gray-500 line-through' : 'text-gray-700'}`}>
                        {milestone.description}
                      </p>
                    </div>
                    
                    {/* Right: Date and Actions - Compact inline */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className={`text-right ${isPastDate(milestone.milestone_date) && !milestone.completed ? 'text-red-600' : 'text-gray-700'}`}>
                        <div className="text-xs font-semibold whitespace-nowrap">
                          {formatDate(milestone.milestone_date)}
                          {isPastDate(milestone.milestone_date) && !milestone.completed && (
                            <span className="ml-0.5 text-xs">⚠️</span>
                          )}
                        </div>
                      </div>
                      
                      {/* Ultra-Compact Action Buttons */}
                      <div className="flex gap-0.5">
                        <button
                          onClick={() => handleToggleCompleted(milestone)}
                          className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                            milestone.completed
                              ? 'bg-gray-50 text-gray-600 border-gray-300 hover:bg-gray-100'
                              : 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100'
                          }`}
                          title={milestone.completed ? 'Mark incomplete' : 'Mark complete'}
                        >
                          {milestone.completed ? '↩️' : '✓'}
                        </button>
                        <button
                          onClick={() => openEditModal(milestone)}
                          className="px-1.5 py-0.5 text-xs rounded border bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100 transition-colors"
                          title="Edit"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDeleteMilestone(milestone.id)}
                          className="px-1.5 py-0.5 text-xs rounded border bg-red-50 text-red-600 border-red-200 hover:bg-red-100 transition-colors"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Footer - Now on a second line but still compact */}
                  <div className="mt-0.5 pt-0.5 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                    <div>
                      Added {formatDate(milestone.created_at)}
                      {milestone.completed && milestone.completed_at && (
                        <span> • Done {formatDate(milestone.completed_at)}</span>
                      )}
                    </div>
                    {milestone.report_file_name ? (
                      <div title={`From board deck: ${milestone.report_file_name}`} className="truncate max-w-xs">
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
        </div>

        {/* Email Modal */}
        {showEmailModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-4">
                <h2 className="text-base font-bold mb-3">📧 Send Milestone Reminder</h2>
                
                <p className="text-xs text-gray-600 mb-3">
                  This will send an email with all incomplete and upcoming milestones to the address below.
                </p>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Email Address *</label>
                  <input
                    type="email"
                    value={emailRecipient}
                    onChange={(e) => setEmailRecipient(e.target.value)}
                    placeholder="example@domain.com"
                    className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                    disabled={isSendingEmail}
                  />
                </div>
                
                <div className="mt-3 flex justify-end space-x-1.5">
                  <button
                    onClick={() => {
                      setShowEmailModal(false)
                      setEmailRecipient('')
                    }}
                    disabled={isSendingEmail}
                    className="px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSendEmail}
                    disabled={isSendingEmail}
                    className="px-2.5 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors disabled:opacity-50"
                  >
                    {isSendingEmail ? 'Sending...' : 'Send Email'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Compact Modal */}
        {(showCreateModal || editingMilestone) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-4">
                <h2 className="text-base font-bold mb-3">
                  {editingMilestone ? 'Edit Milestone' : 'Create Milestone'}
                </h2>
                
                <div className="space-y-2.5">
                  {!editingMilestone && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Company *</label>
                      <select
                        value={formData.company_id}
                        onChange={(e) => setFormData({ ...formData, company_id: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    <label className="block text-xs font-medium text-gray-700 mb-1">Target Date *</label>
                    <input
                      type="date"
                      value={formData.milestone_date}
                      onChange={(e) => setFormData({ ...formData, milestone_date: e.target.value })}
                      className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      required
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Priority *</label>
                    <select
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                      className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      required
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={3}
                      className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Describe the milestone..."
                      required
                    />
                  </div>
                </div>
                
                <div className="mt-3 flex justify-end space-x-1.5">
                  <button
                    onClick={() => {
                      setShowCreateModal(false)
                      setEditingMilestone(null)
                      resetForm()
                    }}
                    className="px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={editingMilestone ? handleUpdateMilestone : handleCreateMilestone}
                    className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                  >
                    {editingMilestone ? 'Update' : 'Create'}
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
