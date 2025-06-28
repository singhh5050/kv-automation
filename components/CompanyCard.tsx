'use client'

import React from 'react'
import { Company } from '../types'

interface CompanyCardProps {
  company: Company
  onClick: () => void
}

export default function CompanyCard({ company, onClick }: CompanyCardProps) {
  const latestReport = company.latestReport
  const reportCount = company.reports.length
  
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
              {company.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{company.name}</h3>
            <div className="flex items-center space-x-2">
              <span className="inline-block px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                {reportCount} Report{reportCount !== 1 ? 's' : ''}
              </span>
              <span className="text-xs text-gray-500">
                Latest: {latestReport.reportPeriod}
              </span>
            </div>
          </div>
        </div>
        <button className="text-gray-400 hover:text-gray-600">
          <span className="text-sm">View Details →</span>
        </button>
      </div>

      {/* Financial Metrics */}
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Cash on Hand</p>
            <p className="font-semibold text-lg text-gray-900">{latestReport.cashOnHand}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Monthly Burn</p>
            <p className="font-semibold text-lg text-gray-900">{latestReport.monthlyBurnRate}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Latest Deck Date</p>
            <p className="font-semibold text-lg text-gray-900">{new Date(latestReport.reportDate).toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric', 
              year: 'numeric' 
            })}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Cash Out Date</p>
            <p className="font-semibold text-lg text-gray-900">{latestReport.cashOutDate}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500">Runway</p>
            <p className="font-semibold text-gray-900">{latestReport.runway}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Budget vs Actual</p>
            <p className="font-semibold text-gray-900">{latestReport.budgetVsActual}</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="flex justify-between items-center text-sm text-gray-500">
          <span>Uploaded: {latestReport.uploadDate}</span>
          <span className="text-blue-600 hover:text-blue-700">View Summary</span>
        </div>
      </div>
    </div>
  )
} 