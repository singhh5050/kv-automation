'use client'

import React, { useState } from 'react'
import { updateFinancialMetrics } from '@/lib/api'

interface EditableMetricProps {
  label: string
  value: string | number
  reportId?: number
  field: string
  onUpdate?: () => void
  formatValue?: (value: number) => string
  parseValue?: (value: string) => number
  className?: string
  isManuallyEdited?: boolean
}

// Default formatters
const defaultFormatCurrency = (value: number): string => {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`
  } else {
    return `$${value.toLocaleString()}`
  }
}

const defaultParseCurrency = (value: string): number => {
  if (!value || value === "N/A" || value === "Unknown") return 0
  
  const numericValue = parseFloat(value.replace(/[\$,MK]/g, ''))
  if (value.includes('M') || value.includes('m')) {
    return numericValue * 1000000
  } else if (value.includes('K') || value.includes('k')) {
    return numericValue * 1000
  }
  return numericValue
}

const defaultFormatNumber = (value: number): string => {
  return value.toString()
}

const defaultParseNumber = (value: string): number => {
  const parsed = parseFloat(value.replace(/[^\d.-]/g, ''))
  return isNaN(parsed) ? 0 : parsed
}

export default function EditableMetric({
  label,
  value,
  reportId,
  field,
  onUpdate,
  formatValue = field.includes('cash') || field.includes('burn') ? defaultFormatCurrency : defaultFormatNumber,
  parseValue = field.includes('cash') || field.includes('burn') ? defaultParseCurrency : defaultParseNumber,
  className = '',
  isManuallyEdited = false
}: EditableMetricProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleStartEdit = () => {
    const numericValue = parseValue(String(value))
    setEditValue(numericValue.toString())
    setIsEditing(true)
    setError(null)
  }

  const handleSave = async () => {
    if (!reportId) {
      setError('No report ID available for editing')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const numericValue = parseFloat(editValue)
      if (isNaN(numericValue)) {
        throw new Error('Please enter a valid number')
      }

      const updates: Record<string, any> = {}
      updates[field] = numericValue

      const result = await updateFinancialMetrics(reportId, updates)
      
      if (result.error) {
        throw new Error(result.error)
      }

      setIsEditing(false)
      if (onUpdate) {
        onUpdate()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update metric')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditValue('')
    setError(null)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  if (isEditing) {
    return (
      <div className={className}>
        <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyPress}
            className="text-xl font-bold text-gray-900 bg-transparent border-b-2 border-blue-500 focus:outline-none focus:border-blue-600 min-w-0 flex-1"
            placeholder="Enter value"
            disabled={isLoading}
            autoFocus
          />
          <div className="flex gap-1">
            <button
              onClick={handleSave}
              disabled={isLoading}
              className="px-2 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600 disabled:opacity-50"
            >
              ✓
            </button>
            <button
              onClick={handleCancel}
              disabled={isLoading}
              className="px-2 py-1 bg-gray-500 text-white rounded text-sm hover:bg-gray-600 disabled:opacity-50"
            >
              ✕
            </button>
          </div>
        </div>
        {error && (
          <p className="text-red-500 text-sm mt-1">{error}</p>
        )}
      </div>
    )
  }

  const numericValue = parseValue(String(value))
  const displayValue = numericValue > 0 ? formatValue(numericValue) : value

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {isManuallyEdited && (
          <span className="text-amber-500 text-xs" title="Manually edited">✏️</span>
        )}
      </div>
      <div 
        className="group cursor-pointer"
        onClick={handleStartEdit}
        title="Click to edit"
      >
        <p className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
          {displayValue}
        </p>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <p className="text-xs text-gray-400">Click to edit</p>
        </div>
      </div>
    </div>
  )
} 