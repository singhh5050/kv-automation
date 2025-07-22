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

interface CompanyCardProps {
  company: Company
  onClick?: () => void
}

export default function CompanyCard({ company, onClick }: CompanyCardProps) {
  const router = useRouter()
  const latestReport = company.latestReport;
  const reportCount = company.reports.length;
  const hasCapTable = !!company.capTable;

  // Get clean display name
  const displayName = normalizeCompanyName(company.name);

  // Dynamically find KV funds and calculate total stake
  const kvInvestors = company.capTable?.investors?.filter(investor => investor.investor_name.startsWith('KV')) || [];
  const kvStake = kvInvestors.reduce((total, investor) => total + (investor.final_fds || 0), 0);
  const kvFundNames = kvInvestors.map(investor => investor.investor_name).join(', ');

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
      className="bg-white rounded-lg border border-gray-200 p-6 cursor-pointer hover:border-gray-300 hover:shadow-sm transition-all duration-200"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start space-x-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-blue-600 font-bold text-lg">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{displayName}</h3>
            <div className="flex items-center space-x-2 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                API
              </span>
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                Main
              </span>
              {hasCapTable && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full">
                  GTM
                </span>
              )}
            </div>
          </div>
        </div>
        <button 
          onClick={handleViewDetails}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <span className="text-sm font-medium">View Details →</span>
        </button>
      </div>

      {/* Key Metrics Grid */}
      {hasCapTable ? (
        <div className="space-y-4">
          {/* Top Row - Valuation and Last Round */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-500 mb-1">Valuation</p>
              <p className="text-xl font-bold text-gray-900">
                {company.capTable!.valuation ? `$${(company.capTable!.valuation / 1000000).toFixed(1)}M` : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 mb-1">Last Round</p>
              <p className="text-xl font-bold text-gray-900">
                {company.capTable!.amount_raised ? `$${(company.capTable!.amount_raised / 1000000).toFixed(1)}M` : 'N/A'}
              </p>
            </div>
          </div>

          {/* Second Row - ARR and KV Ownership */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-500 mb-1">ARR</p>
              <p className="text-xl font-bold text-gray-900">$1.8M</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 mb-1">KV Ownership</p>
              <p className="text-xl font-bold text-blue-600">
                {kvStake > 0 ? `${(kvStake * 100).toFixed(1)}%` : 'N/A'}
              </p>
            </div>
          </div>

          {/* KV Funds */}
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">KV Funds</p>
            <p className="text-sm font-medium text-gray-900 truncate">
              {kvFundNames || 'N/A'}
            </p>
          </div>

          {/* Needs Help With */}
          <div>
            <p className="text-sm font-medium text-gray-500 mb-1">Needs help with:</p>
            <div className="flex flex-wrap gap-1">
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                recruiting
              </span>
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                GTM
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3">
            <span className="text-gray-400 text-lg">📄</span>
          </div>
          <p className="text-gray-500 font-medium">No cap table data available</p>
          <p className="text-sm text-gray-400 mt-1">Upload cap table to see portfolio details</p>
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-500">
            {latestReport ? `${reportCount} report${reportCount !== 1 ? 's' : ''}` : 'No reports'}
          </span>
          <button 
            onClick={handleViewDetails}
            className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
          >
            View Details
          </button>
        </div>
      </div>
    </div>
  )
} 