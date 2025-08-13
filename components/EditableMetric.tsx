'use client'

import React, { useState } from 'react'
import { updateFinancialMetrics, updateCapTableRound } from '@/lib/api'

interface EditableMetricProps {
  label: string
  value: string | number | null
  reportId?: number
  field: string
  onUpdate?: () => void
  formatValue?: (value: number) => string
  parseValue?: (value: string) => number
  className?: string
  isManuallyEdited?: boolean
  editable?: boolean
  inputType?: 'number' | 'date' | 'monthYear' | 'percent'
  saveTarget?: 'report' | 'round'
  roundId?: number
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
  formatValue = (field === 'cash_on_hand' || field === 'monthly_burn_rate') ? defaultFormatCurrency : defaultFormatNumber,
  parseValue = (field === 'cash_on_hand' || field === 'monthly_burn_rate') ? defaultParseCurrency : defaultParseNumber,
  className = '',
  isManuallyEdited = false,
  editable = true,
  inputType,
  saveTarget = 'report',
  roundId
}: EditableMetricProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [input, setInput] = useState<string>(value == null ? '' : String(value))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCurrencyField = field === 'cash_on_hand' || field === 'monthly_burn_rate' || ['valuation', 'amount_raised'].includes(field)
  const isStrictDateField = field === 'report_date' || inputType === 'date'
  const isMonthYearField = field === 'cash_out_date' || inputType === 'monthYear'
  const isPercentField = inputType === 'percent' || ['total_pool_size', 'options_outstanding', 'pool_available', 'pool_utilization'].includes(field)

  const numericValue = isCurrencyField ? parseValue(String(value ?? '')) : 0

  const displayValue = (() => {
    if (value == null || value === '' || (isCurrencyField && Number(value) === 0)) return 'N/A'
    if (!isEditing) {
      if (isCurrencyField) return formatValue(Number(value))
      if (isStrictDateField) {
        try {
          const d = new Date(String(value))
          if (!isNaN(d.getTime())) {
            return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
          }
        } catch {}
      }
      if (isPercentField && typeof value === 'number') {
        return `${(value * 100).toFixed(1)}%`
      }
      if (isMonthYearField) return String(value)
    }
    return String(value)
  })()

  const validate = (raw: string): string | null => {
    // Enforce formats per PDF system prompt
    if (isCurrencyField || inputType === 'number') {
      // raw USD number only, no symbols, commas, or units
      return /^\d+(\.\d+)?$/.test(raw.trim()) ? null : 'Enter a raw USD number (e.g., 3100000)'
    }
    if (field === 'report_date' || inputType === 'date') {
      // YYYY-MM-DD strict
      return /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? null : 'Use YYYY-MM-DD (e.g., 2025-05-01)'
    }
    if (field === 'cash_out_date' || inputType === 'monthYear') {
      // Month YYYY (full month name)
      const monthNames = '(January|February|March|April|May|June|July|August|September|October|November|December)'
      const re = new RegExp(`^${monthNames}\\s+\\d{4}$`)
      return re.test(raw.trim()) ? null : 'Use Month YYYY (e.g., April 2025)'
    }
    if (isPercentField) {
      // accept 8.3, 8.3%, or 0.083
      const t = raw.trim()
      if (/^\d{1,3}(\.\d+)?%$/.test(t) || /^\d{1,3}(\.\d+)?$/.test(t) || /^0?\.\d+$/.test(t)) return null
      return 'Enter percent like 8.3, 8.3%, or 0.083'
    }
    return null
  }

  const handleSave = async () => {
    if (!editable) return
    const err = validate(input)
    setError(err)
    if (err) return
    setSaving(true)
    try {
      let payloadValue: any = input
      if (isCurrencyField || inputType === 'number') {
        payloadValue = parseFloat(input)
      }
      if (isPercentField) {
        let s = input.trim().replace('%', '')
        const num = parseFloat(s)
        // If >= 1 assume percent (e.g., 8.3) else assume decimal (0.083)
        payloadValue = num >= 1 ? (num / 100) : num
      }
      let result
      if (saveTarget === 'round') {
        if (!roundId) { setError('Round id missing'); setSaving(false); return }
        result = await updateCapTableRound(roundId, { [field]: payloadValue })
      } else {
        if (!reportId) { setError('Report id missing'); setSaving(false); return }
        result = await updateFinancialMetrics(reportId, { [field]: payloadValue })
      }
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

  if (!editable) {
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

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-1">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {isManuallyEdited && (
          <span className="text-amber-500 text-xs" title="Manually edited">✏️</span>
        )}
      </div>
      {isEditing ? (
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
            placeholder={label}
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-2 py-1 bg-green-600 text-white rounded text-xs disabled:opacity-50"
          >Save</button>
          <button
            onClick={() => { setIsEditing(false); setInput(value == null ? '' : String(value)) }}
            disabled={saving}
            className="px-2 py-1 text-gray-600 border border-gray-300 rounded text-xs"
          >Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => { setInput(value == null ? '' : String(value)); setIsEditing(true) }}
          className="text-left text-xl font-bold text-gray-900 hover:underline"
          title="Click to edit"
        >{displayValue}</button>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}