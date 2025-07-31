'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Company } from '../types'

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
}

export default function CompanyCard({ company, onClick, enrichmentData }: CompanyCardProps) {
  const router = useRouter()
  const latestReport = company.latestReport;
  const reportCount = company.reports.length;
  const hasCapTable = !!company.capTable;

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

  return (
    <div
      onClick={handleClick}
      className="bg-white rounded-xl border border-gray-200 p-6 cursor-pointer hover:border-gray-300 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group"
    >
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-start space-x-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
            {enrichmentData?.logo_url ? (
              <img 
                src={enrichmentData.logo_url} 
                alt={`${displayName} logo`}
                className="w-12 h-12 rounded-xl object-contain bg-white border border-gray-200 p-1"
                onError={(e) => {
                  // Fallback to letter avatar if logo fails to load
                  e.currentTarget.style.display = 'none'
                  e.currentTarget.nextElementSibling.style.display = 'flex'
                }}
              />
            ) : null}
            <div 
              className={`w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center ${
                enrichmentData?.logo_url ? 'hidden' : 'flex'
              }`}
            >
              <span className="text-white font-bold text-lg">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-blue-700 transition-colors">{displayName}</h3>
            <div className="flex items-center gap-2">
              {company.sector && (
                <span className={`inline-flex items-center space-x-1 px-3 py-1 text-xs font-semibold rounded-lg whitespace-nowrap ${
                  company.sector.toLowerCase() === 'healthcare' ? 'bg-red-50 text-red-700 border border-red-200' :
                  company.sector.toLowerCase() === 'enterprise' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                  company.sector.toLowerCase() === 'consumer' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                  company.sector.toLowerCase() === 'manufacturing' ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                  'bg-gray-50 text-gray-700 border border-gray-200'
                }`}>
                  <span>{
                    company.sector.toLowerCase() === 'healthcare' ? '🏥' :
                    company.sector.toLowerCase() === 'enterprise' ? '🏢' :
                    company.sector.toLowerCase() === 'consumer' ? '🛒' :
                    company.sector.toLowerCase() === 'manufacturing' ? '🏭' :
                    '🏢'
                  }</span>
                  <span>{company.sector.charAt(0).toUpperCase() + company.sector.slice(1)}</span>
                </span>
              )}
              <span className={`inline-flex items-center space-x-1 px-3 py-1 text-xs font-semibold rounded-lg whitespace-nowrap border ${
                companyStage === 'Early Stage' ? 'bg-green-50 text-green-700 border-green-200' :
                companyStage === 'Growth Stage' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                companyStage === 'Late Stage' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                'bg-slate-100 text-slate-700 border-slate-200'
              }`}>
                <span>{
                  companyStage === 'Early Stage' ? '🌱' :
                  companyStage === 'Growth Stage' ? '📈' :
                  companyStage === 'Late Stage' ? '🚀' :
                  '❓'
                }</span>
                <span>{companyStage}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      {hasCapTable ? (
        <div className="space-y-4">
          {/* Top Row - Valuation and Last Round */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Valuation</p>
              <p className="text-xl font-bold text-gray-900">
                {formatCurrency(company.capTable!.valuation)}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Last Round</p>
              <p className="text-xl font-bold text-gray-900">
                {formatCurrency(company.capTable!.amount_raised)}
              </p>
            </div>
          </div>

          {/* Second Row - Total KV Investment and KV Ownership */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">KV Investment</p>
              <p className="text-xl font-bold text-gray-900">
                {formatCurrency(kvTotalInvestment)}
              </p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">KV Ownership</p>
              <p className="text-xl font-bold text-blue-700">
                {kvStake > 0 ? `${(kvStake * 100).toFixed(1)}%` : 'N/A'}
              </p>
            </div>
          </div>

          {/* KV Funds */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-3 border border-blue-100">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">KV Funds</p>
            <p className="text-sm font-medium text-blue-900 truncate">
              {kvFundNames || 'N/A'}
            </p>
          </div>

          {/* Needs Help With */}
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Needs help with:</p>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg">
                recruiting
              </span>
              <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg">
                GTM
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-200">
          <div className="w-14 h-14 bg-gradient-to-br from-gray-200 to-gray-300 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-gray-500 text-xl">📊</span>
          </div>
          <p className="text-gray-700 font-semibold mb-1">No cap table data available</p>
          <p className="text-sm text-gray-500">Upload cap table to see portfolio details</p>
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-emerald-400 rounded-full"></div>
            <span className="text-sm font-medium text-gray-600">
              {latestReport ? `${reportCount} report${reportCount !== 1 ? 's' : ''}` : 'No reports'}
            </span>
          </div>
          <button 
            onClick={handleViewDetails}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transform hover:scale-105 transition-all duration-200 shadow-sm"
          >
            View Details
          </button>
        </div>
      </div>
    </div>
  )
} 