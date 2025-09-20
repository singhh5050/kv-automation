'use client'

import { useState } from 'react'
import { saveCompanyManualOverride } from '@/lib/api'

interface EditablePersonFieldProps {
  label: string
  person: any
  companyId: string
  fieldPrefix: string
  onUpdate: () => void
  index?: number // For leadership members
}

export default function EditablePersonField({ 
  label, 
  person, 
  companyId, 
  fieldPrefix, 
  onUpdate,
  index 
}: EditablePersonFieldProps) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  
  // Get current values
  const currentName = person?.enriched_person?.full_name || ''
  const currentTitle = person?.title || person?.enriched_person?.current_position?.title || ''
  const currentLinkedinUrl = person?.enriched_person?.contact?.linkedin_url || ''
  
  const [name, setName] = useState(currentName)
  const [title, setTitle] = useState(currentTitle)
  const [linkedinUrl, setLinkedinUrl] = useState(currentLinkedinUrl)

  const handleEdit = () => {
    setName(currentName)
    setTitle(currentTitle)
    setLinkedinUrl(currentLinkedinUrl)
    setEditing(true)
    setError('')
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    
    try {
      // Determine field name prefix based on whether this is CEO or leadership
      const prefix = fieldPrefix === 'ceo' ? 'ceo' : `leadership_${index}`
      
      // Save each field as a manual override (only if changed)
      const promises = []
      
      if (name !== currentName) {
        promises.push(saveCompanyManualOverride(companyId, `${prefix}_name`, name))
      }
      if (title !== currentTitle) {
        promises.push(saveCompanyManualOverride(companyId, `${prefix}_title`, title))
      }
      if (linkedinUrl !== currentLinkedinUrl) {
        promises.push(saveCompanyManualOverride(companyId, `${prefix}_linkedin`, linkedinUrl))
      }
      
      // Wait for all saves to complete
      const results = await Promise.all(promises)
      
      // Check for errors
      const errors = results.filter(result => result.error)
      if (errors.length > 0) {
        setError(errors.map(e => e.error).join(', '))
        return
      }
      
      setEditing(false)
      onUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    setError('')
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between group">
        <div className="flex items-center space-x-1 flex-1">
          <span className="text-xs bg-blue-600 text-white px-1 py-0.5 rounded font-medium">
            {label}
          </span>
          {currentLinkedinUrl ? (
            <a 
              href={currentLinkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-blue-700 hover:text-blue-900 hover:underline truncate"
            >
              {currentName || currentTitle}
            </a>
          ) : (
            <span className="text-xs font-bold text-gray-900 truncate">
              {currentName || currentTitle || 'No data'}
            </span>
          )}
          {currentLinkedinUrl && (
            <span className="text-xs text-blue-600">🔗</span>
          )}
        </div>
        <button 
          onClick={handleEdit}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 ml-2 text-xs"
          title="Edit"
        >
          ✏️
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2 p-3 border rounded-lg bg-gray-50">
      <div className="flex items-center space-x-2 mb-2">
        <span className="text-xs bg-blue-600 text-white px-1 py-0.5 rounded font-medium">
          {label}
        </span>
        <span className="text-xs text-gray-500">Editing</span>
      </div>
      
      <div className="space-y-2">
        <input 
          value={name} 
          onChange={(e) => setName(e.target.value)}
          placeholder="Full Name"
          className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input 
          value={title} 
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input 
          value={linkedinUrl} 
          onChange={(e) => setLinkedinUrl(e.target.value)}
          placeholder="LinkedIn URL (https://linkedin.com/in/...)"
          className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      
      {error && (
        <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
          {error}
        </div>
      )}
      
      <div className="flex gap-2 pt-2">
        <button 
          onClick={handleSave} 
          disabled={saving}
          className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button 
          onClick={handleCancel} 
          disabled={saving}
          className="px-3 py-1 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
