'use client'

import React, { useState, useRef, useEffect } from 'react'
import { updateFinancialMetrics } from '@/lib/api'
import MarkdownContent from '@/components/shared/MarkdownContent'

interface EditableTextFieldProps {
  value: string | null | undefined
  reportId?: number
  field: string
  onUpdate?: () => void
  placeholder?: string
  emptyStateIcon?: string
  emptyStateText?: string
  gradientClassName?: string
  borderClassName?: string
  editable?: boolean
}

export default function EditableTextField({
  value,
  reportId,
  field,
  onUpdate,
  placeholder = 'Add content...',
  emptyStateIcon = '📝',
  emptyStateText = 'No content available',
  gradientClassName = 'from-gray-50 to-gray-100',
  borderClassName = 'border-gray-200',
  editable = true
}: EditableTextFieldProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [input, setInput] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Update input when value changes externally
  useEffect(() => {
    if (!isEditing) {
      setInput(value || '')
    }
  }, [value, isEditing])

  // Auto-resize textarea and focus when editing
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [isEditing, input])

  const handleSave = async () => {
    if (!editable || !reportId) {
      setError('Cannot save: missing report ID')
      return
    }

    setSaving(true)
    setError(null)
    
    try {
      const result = await updateFinancialMetrics(reportId, { [field]: input.trim() || null })
      if (result.error) {
        setError(result.error)
      } else {
        setIsEditing(false)
        onUpdate?.()
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    setInput(value || '')
    setError(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel()
    }
    // Cmd/Ctrl + Enter to save
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSave()
    }
  }

  const hasContent = value && value.trim() !== '' && value !== 'N/A'

  // Editing mode
  if (isEditing) {
    return (
      <div className={`bg-gradient-to-br ${gradientClassName} p-3 rounded border ${borderClassName} relative`}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            // Auto-resize
            e.target.style.height = 'auto'
            e.target.style.height = `${e.target.scrollHeight}px`
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full min-h-[120px] p-3 text-sm leading-relaxed bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
          style={{ overflow: 'hidden' }}
        />
        
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-gray-500">
            Supports markdown • ⌘/Ctrl+Enter to save
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              disabled={saving}
              className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {saving ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Saving...
                </>
              ) : (
                <>
                  <span>✓</span>
                  Save
                </>
              )}
            </button>
          </div>
        </div>
        
        {error && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            ⚠️ {error}
          </div>
        )}
      </div>
    )
  }

  // Display mode with content
  if (hasContent) {
    return (
      <div 
        className={`bg-gradient-to-br ${gradientClassName} p-3 rounded border ${borderClassName} relative group`}
      >
        <MarkdownContent content={value!} className="text-sm leading-7" />
        
        {editable && reportId && (
          <button
            onClick={() => setIsEditing(true)}
            className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-white/80 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-sm"
            title="Edit this section"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}
      </div>
    )
  }

  // Empty state
  return (
    <div 
      className={`bg-gradient-to-br from-gray-50 to-gray-100 p-4 rounded border-2 border-dashed border-gray-200 text-center relative group ${
        editable && reportId ? 'cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-all duration-200' : ''
      }`}
      onClick={() => editable && reportId && setIsEditing(true)}
    >
      <div className="text-lg mb-1">{emptyStateIcon}</div>
      <p className="text-gray-500 text-sm font-medium mb-1">{emptyStateText}</p>
      {editable && reportId && (
        <p className="text-indigo-500 text-xs mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          Click to add content
        </p>
      )}
    </div>
  )
}

