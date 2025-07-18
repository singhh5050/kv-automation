'use client'

import React from 'react'
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
  onClick: () => void
}

export default function CompanyCard({ company, onClick }: CompanyCardProps) {
  const latestReport = company.latestReport;
  const reportCount = company.reports.length;
  const hasCapTable = !!company.capTable;

  // Get clean display name
  const displayName = normalizeCompanyName(company.name);

  // Dynamically find KV funds and calculate total stake
  const kvInvestors = company.capTable?.investors?.filter(investor => investor.investor_name.startsWith('KV')) || [];
  const kvStake = kvInvestors.reduce((total, investor) => total + (investor.final_fds || 0), 0);
  const kvFundNames = kvInvestors.map(investor => investor.investor_name).join(', ');

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 p-6 cursor-pointer card-hover"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <span className="text-blue-600 font-semibold text-lg">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{displayName}</h3>
            <div className="flex items-center space-x-2 flex-wrap">
              <span className="inline-block px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                {reportCount} Report{reportCount !== 1 ? 's' : ''}
              </span>
              {hasCapTable && (
                <span className="inline-block px-2 py-1 text-xs bg-green-100 text-green-700 rounded">
                  📊 Cap Table
                </span>
              )}
              {latestReport && (
                <span className="text-xs text-gray-500">
                  Latest: {latestReport.reportPeriod}
                </span>
              )}
            </div>
          </div>
        </div>
        <button className="text-gray-400 hover:text-gray-600">
          <span className="text-sm">View Details →</span>
        </button>
      </div>

      {/* Financial Metrics */}
      <div className="space-y-4">
        {hasCapTable ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Valuation</p>
                <p className="font-semibold text-lg text-gray-900">
                  {company.capTable!.valuation ? `$${(company.capTable!.valuation / 1000000).toFixed(1)}M` : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">KV Ownership</p>
                <p className="font-semibold text-lg text-blue-600">
                  {kvStake > 0 ? `${(kvStake * 100).toFixed(1)}%` : 'N/A'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Series</p>
                <p className="font-semibold text-lg text-gray-900">{company.capTable!.round_name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Cash Out Date</p>
                <p className="font-semibold text-lg text-gray-900">
                  {latestReport ? latestReport.cashOutDate : 'N/A'}
                </p>
              </div>
            </div>
            {kvFundNames && (
              <div>
                <p className="text-sm text-gray-500">KV Funds</p>
                <p className="text-sm font-medium text-gray-700 truncate" title={kvFundNames}>
                  {kvFundNames}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500">No cap table data available</p>
            <p className="text-sm text-gray-400 mt-1">Upload cap table to see details</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="flex justify-between items-center text-sm text-gray-500">
          <span>
            {latestReport ? `Uploaded: ${latestReport.uploadDate}` : hasCapTable ? 'Cap table available' : 'No data'}
          </span>
          <span className="text-blue-600 hover:text-blue-700">View Details</span>
        </div>
      </div>
    </div>
  )
} 