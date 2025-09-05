'use client'

import { useState } from 'react'
import { CompanyOverview } from '@/types'
import MDEditor from '@uiw/react-md-editor'

interface PdfExportModalProps {
  company: CompanyOverview
  isOpen: boolean
  onClose: () => void
  onExport: (config: ExportConfig) => void
}

export interface ExportConfig {
  customHeader: string
  sections: {
    summary: {
      enabled: boolean
      subsections: {
        cashMetrics: boolean
        runway: boolean
        milestones: boolean
        team: boolean
        teamLinkedIn: boolean
        sectorHighlights: boolean
        companyLogo: boolean
      }
    }
    financials: {
      enabled: boolean
      subsections: {
        overview: boolean
        reports: boolean
        charts: boolean
        kpiAnalysis: boolean
        trends: boolean
      }
    }
    updates: {
      enabled: boolean
      subsections: {
        enrichment: boolean
        keyHighlights: boolean
        sectorDetails: boolean
        companyHealth: boolean
        executiveSummary: boolean
      }
    }
    capTable: {
      enabled: boolean
      subsections: {
        investors: boolean
        rounds: boolean
        ownership: boolean
        optionPool: boolean
        valuation: boolean
      }
    }
  }
}

export default function PdfExportModal({ company, isOpen, onClose, onExport }: PdfExportModalProps) {
  const [customHeader, setCustomHeader] = useState('')
  const [config, setConfig] = useState<ExportConfig>({
    customHeader: '',
    sections: {
      summary: {
        enabled: true,
        subsections: {
          cashMetrics: true,
          runway: true,
          milestones: true,
          team: true,
          teamLinkedIn: true,
          sectorHighlights: true,
          companyLogo: true
        }
      },
      financials: {
        enabled: true,
        subsections: {
          overview: true,
          reports: true,
          charts: true,
          kpiAnalysis: true,
          trends: true
        }
      },
      updates: {
        enabled: true,
        subsections: {
          enrichment: true,
          keyHighlights: true,
          sectorDetails: true,
          companyHealth: true,
          executiveSummary: true
        }
      },
      capTable: {
        enabled: true,
        subsections: {
          investors: true,
          rounds: true,
          ownership: true,
          optionPool: true,
          valuation: true
        }
      }
    }
  })

  const handleSectionToggle = (section: keyof ExportConfig['sections']) => {
    setConfig(prev => ({
      ...prev,
      sections: {
        ...prev.sections,
        [section]: {
          ...prev.sections[section],
          enabled: !prev.sections[section].enabled
        }
      }
    }))
  }

  const handleSubsectionToggle = (
    section: keyof ExportConfig['sections'], 
    subsection: string
  ) => {
    setConfig(prev => ({
      ...prev,
      sections: {
        ...prev.sections,
        [section]: {
          ...prev.sections[section],
          subsections: {
            ...prev.sections[section].subsections,
            [subsection]: !prev.sections[section].subsections[subsection as keyof typeof prev.sections[typeof section]['subsections']]
          }
        }
      }
    }))
  }

  const handleExport = () => {
    const exportConfig = {
      ...config,
      customHeader
    }
    onExport(exportConfig)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Export PDF Report</h2>
              <p className="text-sm text-gray-600 mt-1">
                Create a custom PDF report for {company.company.name}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
            >
              ×
            </button>
          </div>

          <div className="space-y-6">
            {/* Custom Header Section */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Custom Introduction</h3>
              <p className="text-sm text-gray-600 mb-3">
                Add your own analysis, summary, or notes to appear at the top of the PDF
              </p>
              <div data-color-mode="light">
                <MDEditor
                  value={customHeader}
                  onChange={(value) => setCustomHeader(value || '')}
                  preview="edit"
                  height={200}
                  visibleDragbar={false}
                />
              </div>
            </div>

            {/* Section Selection */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Sections to Include</h3>
              
              <div className="space-y-4">
                {/* Summary Section */}
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center space-x-3 mb-3">
                    <input
                      type="checkbox"
                      id="summary"
                      checked={config.sections.summary.enabled}
                      onChange={() => handleSectionToggle('summary')}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="summary" className="flex items-center space-x-2 text-base font-medium text-gray-900">
                      <span>💰</span>
                      <span>Summary</span>
                    </label>
                  </div>
                  
                  {config.sections.summary.enabled && (
                    <div className="ml-7 space-y-2">
                      {Object.entries({
                        cashMetrics: 'Cash Metrics',
                        runway: 'Runway Progress Bar',
                        milestones: 'Upcoming Milestones',
                        team: 'Team Information',
                        teamLinkedIn: 'Team LinkedIn Links',
                        sectorHighlights: 'Sector Highlights',
                        companyLogo: 'Company Logo'
                      }).map(([key, label]) => (
                        <div key={key} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`summary-${key}`}
                            checked={config.sections.summary.subsections[key as keyof typeof config.sections.summary.subsections]}
                            onChange={() => handleSubsectionToggle('summary', key)}
                            className="h-3 w-3 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <label htmlFor={`summary-${key}`} className="text-sm text-gray-700">
                            {label}
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Financials Section */}
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center space-x-3 mb-3">
                    <input
                      type="checkbox"
                      id="financials"
                      checked={config.sections.financials.enabled}
                      onChange={() => handleSectionToggle('financials')}
                      className="h-4 w-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
                    />
                    <label htmlFor="financials" className="flex items-center space-x-2 text-base font-medium text-gray-900">
                      <span>📊</span>
                      <span>Financials</span>
                    </label>
                  </div>
                  
                  {config.sections.financials.enabled && (
                    <div className="ml-7 space-y-2">
                      {Object.entries({
                        overview: 'Financial Overview',
                        reports: 'Financial Reports Table',
                        charts: 'Financial Charts',
                        kpiAnalysis: 'KPI Analysis',
                        trends: 'Trend Analysis'
                      }).map(([key, label]) => (
                        <div key={key} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`financials-${key}`}
                            checked={config.sections.financials.subsections[key as keyof typeof config.sections.financials.subsections]}
                            onChange={() => handleSubsectionToggle('financials', key)}
                            className="h-3 w-3 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
                          />
                          <label htmlFor={`financials-${key}`} className="text-sm text-gray-700">
                            {label}
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Latest Updates Section */}
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center space-x-3 mb-3">
                    <input
                      type="checkbox"
                      id="updates"
                      checked={config.sections.updates.enabled}
                      onChange={() => handleSectionToggle('updates')}
                      className="h-4 w-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                    />
                    <label htmlFor="updates" className="flex items-center space-x-2 text-base font-medium text-gray-900">
                      <span>📈</span>
                      <span>Latest Updates</span>
                    </label>
                  </div>
                  
                  {config.sections.updates.enabled && (
                    <div className="ml-7 space-y-2">
                      {Object.entries({
                        enrichment: 'Company Enrichment Data',
                        keyHighlights: 'Key Highlights',
                        sectorDetails: 'Sector Details',
                        companyHealth: 'Company Health Score',
                        executiveSummary: 'Executive Summary'
                      }).map(([key, label]) => (
                        <div key={key} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`updates-${key}`}
                            checked={config.sections.updates.subsections[key as keyof typeof config.sections.updates.subsections]}
                            onChange={() => handleSubsectionToggle('updates', key)}
                            className="h-3 w-3 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                          />
                          <label htmlFor={`updates-${key}`} className="text-sm text-gray-700">
                            {label}
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Cap Table Section */}
                <div className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center space-x-3 mb-3">
                    <input
                      type="checkbox"
                      id="capTable"
                      checked={config.sections.capTable.enabled}
                      onChange={() => handleSectionToggle('capTable')}
                      className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                    />
                    <label htmlFor="capTable" className="flex items-center space-x-2 text-base font-medium text-gray-900">
                      <span>🏦</span>
                      <span>Cap Table</span>
                    </label>
                  </div>
                  
                  {config.sections.capTable.enabled && (
                    <div className="ml-7 space-y-2">
                      {Object.entries({
                        investors: 'Investor Information',
                        rounds: 'Funding Rounds',
                        ownership: 'Ownership Breakdown',
                        optionPool: 'Employee Option Pool',
                        valuation: 'Valuation Details'
                      }).map(([key, label]) => (
                        <div key={key} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`capTable-${key}`}
                            checked={config.sections.capTable.subsections[key as keyof typeof config.sections.capTable.subsections]}
                            onChange={() => handleSubsectionToggle('capTable', key)}
                            className="h-3 w-3 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                          />
                          <label htmlFor={`capTable-${key}`} className="text-sm text-gray-700">
                            {label}
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end space-x-3 mt-8 pt-6 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
            >
              <span>📄</span>
              <span>Export PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
