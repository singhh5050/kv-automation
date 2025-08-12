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
  // Inline editing disabled: render read-only
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
      <p className="text-xl font-bold text-gray-900">{displayValue}</p>
    </div>
  )
} 