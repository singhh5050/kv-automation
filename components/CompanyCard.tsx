'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Company } from '../types'
import { deleteCompany } from '../lib/api'
import { X } from 'lucide-react'

// Company name normalization for display (removes legal suffixes but preserves case)
const normalizeCompanyName = (name: string): string => {
  return name
    .replace(/\b(corp|corporation|inc|incorporated|ltd|limited|llc|co\.?)\b/gi, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Currency formatting utility
const formatCurrency = (value: string | number | null | undefined): string => {
  if (!value || value === 'N/A' || value === '') return 'N/A'
  
  const numValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[$,M\s]/gi, ''))
  
  if (isNaN(numValue) || numValue === 0) return 'N/A'
  
  if (numValue >= 1000000000) {
    return `$${(numValue / 1000000000).toFixed(1)}B`
  } else if (numValue >= 1000000) {
    return `$${(numValue / 1000000).toFixed(1)}M`
  } else if (numValue >= 1000) {
    return `$${(numValue / 1000).toFixed(0)}K`
  } else {
    return `$${numValue.toLocaleString()}`
  }
}

// Cash out date formatting and risk assessment
const formatCashOutDate = (cashOutDate: string | null | undefined) => {
  if (!cashOutDate || cashOutDate === 'N/A' || cashOutDate === '') {
    return 'N/A'
  }
  
  try {
    let date: Date
    
    // Handle "Month Year" format like "May 2027"
    const monthYearMatch = cashOutDate.match(/^([A-Za-z]+)\s+(\d{4})$/)
    if (monthYearMatch) {
      const [, monthName, year] = monthYearMatch
      // Use the 1st day of the month for consistent parsing
      const dateString = `${monthName} 1, ${year}`
      date = new Date(dateString)
    } else {
      // Try to parse as regular date
      date = new Date(cashOutDate)
    }
    
    if (isNaN(date.getTime())) {
      return 'N/A'
    }
    
    const now = new Date()
    const diffTime = date.getTime() - now.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    if (diffDays < 0) {
      return { display: 'OVERDUE', risk: 'critical', days: Math.abs(diffDays) }
    } else if (diffDays <= 90) {
      return { display: `${diffDays}d`, risk: 'high', days: diffDays }
    } else if (diffDays <= 270) {
      return { display: `${diffDays}d`, risk: 'medium', days: diffDays }
    } else {
      return { display: `${diffDays}d`, risk: 'low', days: diffDays }
    }
  } catch {
    return 'N/A'
  }
}

// Stage detection based on KV fund names - choose the latest stage
const detectCompanyStage = (investors: any[]): string => {
  const kvInvestors = investors?.filter(inv => inv.investor_name.startsWith('KV')) || []
  
  let hasLateStage = false
  let hasGrowthStage = false
  let hasEarlyStage = false
  
  for (const investor of kvInvestors) {
    const name = investor.investor_name.toLowerCase()
    
    // Check for KV Opp (Late Stage) - highest priority
    if (name.includes('opp')) {
      hasLateStage = true
    }
    // Check for KV [Roman Numeral] (Growth Stage) - but not if it contains "opp" or "seed"
    else if (!name.includes('opp') && !name.includes('seed')) {
      const romanNumeralPattern = /kv\s+(i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3}|xiv|xv)(\s|$)/i
      if (romanNumeralPattern.test(name)) {
        hasGrowthStage = true
      }
    }
    // Check for KV Seed [A-Z] (Early Stage) - lowest priority
    else if (name.includes('seed')) {
      const seedPattern = /kv\s+seed\s+[a-z]/i
      if (seedPattern.test(name)) {
        hasEarlyStage = true
      }
    }
  }
  
  // Return the latest stage found (Late > Growth > Early)
  if (hasLateStage) return 'Late Stage'
  if (hasGrowthStage) return 'Growth Stage'
  if (hasEarlyStage) return 'Early Stage'
  
  return 'Unknown'
}

interface CompanyCardProps {
  company: Company
  onClick?: () => void
  enrichmentData?: any
  onDelete?: (companyId: string) => void
}

export default function CompanyCard({ company, onClick, enrichmentData, onDelete }: CompanyCardProps) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  
  // Debug enrichment data
  console.log(`CompanyCard for ${company.name} - enrichmentData:`, enrichmentData)
  
  const latestReport = company.latestReport;
  const reportCount = company.reports.length;
  const hasCapTable = !!company.capTable;
  
  // Get cash out date from latest report
  const cashOutDateInfo = formatCashOutDate(latestReport?.cashOutDate);

  // Get clean display name
  const displayName = normalizeCompanyName(company.name);

  // Dynamically find KV funds and calculate total stake and investment
  const kvInvestors = company.capTable?.investors?.filter(investor => investor.investor_name.startsWith('KV')) || [];
  const kvStake = kvInvestors.reduce((total, investor) => total + (investor.final_fds || 0), 0);
  const kvTotalInvestment = kvInvestors.reduce((total, investor) => total + (investor.total_invested || 0), 0);
  const kvFundNames = kvInvestors.map(investor => investor.investor_name).join(', ');
  
  // Detect company stage based on KV fund names
  const companyStage = hasCapTable ? detectCompanyStage(company.capTable!.investors) : 'Unknown';

  const handleClick = () => {
    if (onClick) {
      onClick()
    } else {
      router.push(`/company/${company.id}`)
    }
  }

  const handleViewDetails = (e: React.MouseEvent) => {
    e.stopPropagation()
    router.push(`/company/${company.id}`)
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent card click
    
    const displayName = normalizeCompanyName(company.name)
    if (!confirm(`Are you sure you want to delete "${displayName}" and all its data? This action cannot be undone.`)) {
      return
    }

    setDeleting(true)
    try {
      const result = await deleteCompany(company.id.toString())
      if (result.error) {
        alert(`Failed to delete company: ${result.error}`)
      } else {
        // Notify parent component to remove from list
        onDelete?.(company.id.toString())
        alert(`Company "${displayName}" and all associated data have been deleted successfully.`)
      }
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      onClick={handleClick}
      className="relative bg-white rounded-lg border border-gray-200 p-4 cursor-pointer hover:border-gray-300 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group"
    >
      {/* Delete button */}
      {onDelete && (
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="absolute top-3 right-3 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors z-10"
          title="Delete company"
        >
          <X size={16} />
        </button>
      )}
      
      {/* Header */}
      <div className="mb-2">
        <div className="flex items-start space-x-2">
          <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0 shadow-sm">
            {enrichmentData?.enrichment?.extracted?.logo_url ? (
              <img 
                src={enrichmentData.enrichment.extracted.logo_url} 
                alt={`${displayName} logo`}
                className="w-8 h-8 rounded object-contain bg-white border border-gray-200 p-0.5"
                onError={(e) => {
                  // Fallback to letter avatar if logo fails to load
                  e.currentTarget.style.display = 'none'
                  const nextElement = e.currentTarget.nextElementSibling as HTMLElement
                  if (nextElement) {
                    nextElement.style.display = 'flex'
                  }
                }}
              />
            ) : null}
            <div 
              className={`w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded flex items-center justify-center ${
                enrichmentData?.enrichment?.extracted?.logo_url ? 'hidden' : 'flex'
              }`}
            >
              <span className="text-white font-bold text-sm">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
          <div className="min-w-0 flex-1 flex items-center">
            <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-700 transition-colors">{displayName}</h3>
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      {hasCapTable ? (
        <div className="space-y-2">
          {/* Top Row - Valuation and Cash Out Date */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 rounded p-2">
              <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-0.5">Valuation</p>
              <p className="text-sm font-bold text-gray-900">
                {formatCurrency(company.capTable!.valuation)}
              </p>
            </div>
            <div className={`rounded p-2 border ${
              cashOutDateInfo === 'N/A' ? 'bg-gray-50 border-gray-200' :
              cashOutDateInfo.risk === 'critical' ? 'bg-red-50 border-red-200' :
              cashOutDateInfo.risk === 'high' ? 'bg-orange-50 border-orange-200' :
              cashOutDateInfo.risk === 'medium' ? 'bg-yellow-50 border-yellow-200' :
              'bg-green-50 border-green-200'
            }`}>
              <p className={`text-xs font-medium uppercase tracking-wide mb-0.5 ${
                cashOutDateInfo === 'N/A' ? 'text-gray-600' :
                cashOutDateInfo.risk === 'critical' ? 'text-red-600' :
                cashOutDateInfo.risk === 'high' ? 'text-orange-600' :
                cashOutDateInfo.risk === 'medium' ? 'text-yellow-600' :
                'text-green-600'
              }`}>
                Cash Out Date
              </p>
              <p className={`text-xs font-bold ${
                cashOutDateInfo === 'N/A' ? 'text-gray-900' :
                cashOutDateInfo.risk === 'critical' ? 'text-red-700' :
                cashOutDateInfo.risk === 'high' ? 'text-orange-700' :
                cashOutDateInfo.risk === 'medium' ? 'text-yellow-700' :
                'text-green-700'
              }`}>
                {cashOutDateInfo === 'N/A' ? 'N/A' : latestReport?.cashOutDate || 'N/A'}
              </p>
            </div>
          </div>

          {/* Second Row - KV Ownership and KV Investment */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-blue-50 rounded p-2 border border-blue-100">
              <p className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-0.5">KV Ownership</p>
              <p className="text-sm font-bold text-blue-700">
                {kvStake > 0 ? `${(kvStake * 100).toFixed(1)}%` : 'N/A'}
              </p>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-0.5">KV Investment</p>
              <p className="text-sm font-bold text-gray-900">
                {formatCurrency(kvTotalInvestment)}
              </p>
            </div>
          </div>

          {/* KV Funds */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded p-2 border border-blue-100">
            <p className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-0.5">KV Funds</p>
            <p className="text-xs font-medium text-blue-900 truncate">
              {kvFundNames || 'N/A'}
            </p>
          </div>

          {/* Tags Row */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {company.sector && (
              <span className={`inline-flex items-center px-1.5 py-0.5 text-xs font-normal rounded-sm whitespace-nowrap flex-shrink-0 ${
                company.sector.toLowerCase() === 'healthcare' ? 'bg-red-50 text-red-600 border border-red-200' :
                company.sector.toLowerCase() === 'enterprise' ? 'bg-blue-50 text-blue-600 border border-blue-200' :
                company.sector.toLowerCase() === 'consumer' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                company.sector.toLowerCase() === 'manufacturing' ? 'bg-orange-50 text-orange-600 border border-orange-200' :
                company.sector.toLowerCase() === 'unknown' ? 'bg-gray-50 text-gray-500 border border-gray-200' :
                'bg-gray-50 text-gray-600 border border-gray-200'
              }`}>
                <span className="mr-0.5 text-xs">{
                  company.sector.toLowerCase() === 'healthcare' ? '🏥' :
                  company.sector.toLowerCase() === 'enterprise' ? '🏢' :
                  company.sector.toLowerCase() === 'consumer' ? '🛒' :
                  company.sector.toLowerCase() === 'manufacturing' ? '🏭' :
                  company.sector.toLowerCase() === 'unknown' ? '❓' :
                  '🏢'
                }</span>
                <span className="text-xs">{company.sector.charAt(0).toUpperCase() + company.sector.slice(1)}</span>
              </span>
            )}
            <span className={`inline-flex items-center px-1.5 py-0.5 text-xs font-normal rounded-sm whitespace-nowrap border flex-shrink-0 ${
              companyStage === 'Early Stage' ? 'bg-green-50 text-green-600 border-green-200' :
              companyStage === 'Growth Stage' ? 'bg-blue-50 text-blue-600 border-blue-200' :
              companyStage === 'Late Stage' ? 'bg-purple-50 text-purple-600 border-purple-200' :
              'bg-slate-100 text-slate-600 border-slate-200'
            }`}>
              <span className="mr-0.5 text-xs">{
                companyStage === 'Early Stage' ? '🌱' :
                companyStage === 'Growth Stage' ? '📈' :
                companyStage === 'Late Stage' ? '🚀' :
                '❓'
              }</span>
              <span className="text-xs">{companyStage}</span>
            </span>
          </div>

        </div>
      ) : (
        <div className="text-center py-4 bg-gradient-to-br from-gray-50 to-gray-100 rounded border-2 border-dashed border-gray-200">
          <div className="w-6 h-6 bg-gradient-to-br from-gray-200 to-gray-300 rounded flex items-center justify-center mx-auto mb-1.5 shadow-sm">
            <span className="text-gray-500 text-xs">📊</span>
          </div>
          <p className="text-gray-700 font-medium mb-0.5 text-xs">No cap table data</p>
          <p className="text-xs text-gray-500">Upload cap table to see details</p>
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-2 border-t border-gray-100">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-1.5">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full"></div>
            <span className="text-xs font-medium text-gray-600">
              {latestReport ? `${reportCount} report${reportCount !== 1 ? 's' : ''}` : 'No reports'}
            </span>
          </div>
          <button 
            onClick={handleViewDetails}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 transition-colors shadow-sm"
          >
            View Details
          </button>
        </div>
      </div>
    </div>
  )
} 