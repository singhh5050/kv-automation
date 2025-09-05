'use client'

import React, { useState } from 'react'
import { X } from 'lucide-react'
import { KpiAnalysisConfig } from '../../types'

interface CustomKpiAnalysisModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (analysisConfig: KpiAnalysisConfig) => void
  isLoading: boolean
  companyName: string
}


const MOOD_OPTIONS = [
  { value: 'cheerleader', label: '📣 Cheerleader', description: 'Optimistic, encouraging tone' },
  { value: 'balanced', label: '⚖️ Balanced', description: 'Neutral, factual analysis' },
  { value: 'skeptical', label: '🤨 Wall Street Skeptic', description: 'Critical, detailed scrutiny' },
  { value: 'roast', label: '🔥 Roast Mode', description: 'Brutally honest (but constructive!)' }
]

export default function CustomKpiAnalysisModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  isLoading,
  companyName 
}: CustomKpiAnalysisModalProps) {
  const [config, setConfig] = useState<KpiAnalysisConfig>({
    targetKpis: '',
    tableFormat: '',
    analysisMood: 'balanced',
    previousIssues: '',
    previousPlan: '',
    competitiveContext: '',
    customPrompt: ''
  })

  const [showPromptEditor, setShowPromptEditor] = useState(false)
  
  // Generate the default system prompt for editing
  const generateDefaultPrompt = () => {
    const moodInstructions = {
      'cheerleader': "## TONE: CHEERLEADER 📣\nBe optimistic and encouraging. Highlight wins, frame challenges as opportunities.",
      'balanced': "## TONE: BALANCED ⚖️\nUse neutral, professional language. Present facts objectively.",
      'skeptical': "## TONE: WALL STREET SKEPTIC 🤨\nApply rigorous scrutiny. Question assumptions, highlight risks.",
      'roast': "## TONE: ROAST MODE 🔥\nBe direct and brutally honest (but professional). Call out issues without sugar-coating."
    }[config.analysisMood]

    return `You are a KV financial analyst. Analyze reports for ${companyName}.

${moodInstructions}

## USER REQUIREMENTS
**Target KPIs:** ${config.targetKpis || 'Standard financial metrics'}
**Table Format:** ${config.tableFormat || 'KPIs as columns, time as rows'}
**Previous Plan to benchmark against:** ${config.previousPlan || 'No previous plan provided'}
**Competitive Context:** ${config.competitiveContext || 'General market context'}
**Avoid These Issues:** ${config.previousIssues || 'None'}

## MULTI-DIMENSIONAL ANALYSIS FRAMEWORK
You will analyze across THREE key dimensions:
1. **PLANS DIMENSION**: Look for multiple adjusted plans/projections in the board decks (e.g., "Original Plan", "Revised Q2 Plan", "Updated Forecast") PLUS any user-provided plan above
2. **TIME DIMENSION**: Different time periods (months, quarters, years)  
3. **KPI DIMENSION**: The specific metrics requested by the user

**CRITICAL**: When you find multiple plans in the documents, treat each as a separate benchmark. Compare actual performance against each plan version to show how targets evolved over time.

## FORMATTING REQUIREMENTS
- Use **bold** for key metrics, company names, and important findings
- Use *italics* for emphasis and commentary
- Use \`code formatting\` for specific numbers and percentages
- Rich markdown formatting throughout (headers, bullets, etc.)
- Include emojis for visual appeal and section headers

## OUTPUT FORMAT
1. 🏥 **Company Health Score** 
   - Overall assessment: 🟢 GREEN / 🟡 YELLOW / 🔴 RED
   - Brief justification in **bold key points**

2. 📊 **Executive Summary** (3-4 key highlights with **bold** metrics)

3. 📋 **KPI Table** (MANDATORY as specified above)

4. 📈 **Trend Analysis** (quantified insights per KPI with *italicized* commentary)

5. 🆘 **What Company Needs Help With**
   - Primary areas: Recruiting, GTM, Fundraising, M&A, PR, Operations, etc.
   - **Bold** the top 2-3 priority areas

6. 🎯 **Key Diagnoses** (focus on diagnosis, minimal strategic advice)

Focus on user's specific KPIs, use their table format, identify and benchmark against ALL plans found in documents (treat each plan version as a separate dimension), consider competitive context, avoid mentioned issues. Use rich markdown formatting throughout.

**Remember**: This is a 3D analysis - Plans × Time × KPIs. Show how performance compares across multiple plan versions over time.`
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(config)
  }

  const handleReset = () => {
    setConfig({
      targetKpis: '',
      tableFormat: '',
      analysisMood: 'balanced',
      previousIssues: '',
      previousPlan: '',
      competitiveContext: '',
      customPrompt: ''
    })
    setShowPromptEditor(false)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-purple-50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-lg">📊</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Custom KPI Analysis</h2>
              <p className="text-sm text-gray-600">for {companyName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isLoading}
          >
            <X size={24} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Target KPIs */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              🎯 What KPIs do you want to analyze?
            </label>
            <textarea
              value={config.targetKpis}
              onChange={(e) => setConfig({ ...config, targetKpis: e.target.value })}
              placeholder="e.g., Monthly Recurring Revenue (MRR), Customer Acquisition Cost (CAC), Monthly Active Users (MAU), Gross Margin, Net Revenue Retention..."
              className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              required
            />
            <p className="text-xs text-gray-500">Be specific about the metrics you care about most</p>
          </div>

          {/* Table Format */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              📋 How do you want your results table structured?
            </label>
            <textarea
              value={config.tableFormat}
              onChange={(e) => setConfig({ ...config, tableFormat: e.target.value })}
              placeholder="e.g., Columns should be the KPIs I specified above, rows should be time periods (months/quarters). Include percentage changes between periods. Add a trend direction column with arrows..."
              className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              required
            />
            <p className="text-xs text-gray-500">Describe the exact table layout and calculations you want</p>
          </div>

          {/* Analysis Mood */}
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-gray-900">
              🎭 Analysis Personality
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MOOD_OPTIONS.map((mood) => (
                <label key={mood.value} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="analysisMood"
                    value={mood.value}
                    checked={config.analysisMood === mood.value}
                    onChange={(e) => setConfig({ ...config, analysisMood: e.target.value })}
                    className="sr-only"
                  />
                  <div className={`p-3 rounded-lg border-2 transition-all ${
                    config.analysisMood === mood.value
                      ? 'border-blue-500 bg-blue-50 shadow-md'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}>
                    <div className="font-medium text-sm text-gray-900">{mood.label}</div>
                    <div className="text-xs text-gray-600 mt-1">{mood.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Previous Issues */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              ⚠️ What went wrong in previous analyses? (Optional)
            </label>
            <textarea
              value={config.previousIssues}
              onChange={(e) => setConfig({ ...config, previousIssues: e.target.value })}
              placeholder="e.g., Last time it missed the seasonality in our Q4 metrics, or it didn't account for our pricing change in March..."
              className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
            <p className="text-xs text-gray-500">Help us avoid repeating past mistakes</p>
          </div>

          {/* Previous Plan */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              📋 Previous Plan/Targets (Optional)
            </label>
            <textarea
              value={config.previousPlan}
              onChange={(e) => setConfig({ ...config, previousPlan: e.target.value })}
              placeholder="e.g., Our Q3 plan was to reach $2M ARR, reduce CAC by 15%, achieve 95% gross retention. Board deck from last quarter projected 40% growth..."
              className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
            <p className="text-xs text-gray-500">Previous targets, board plans, or projections to benchmark against</p>
          </div>

          {/* Competitive Context */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-gray-900">
              🏆 Competitive Context (Optional)
            </label>
            <textarea
              value={config.competitiveContext}
              onChange={(e) => setConfig({ ...config, competitiveContext: e.target.value })}
              placeholder="e.g., Main competitors are X and Y. Industry benchmarks: typical CAC payback 18mo, NRR >110%. Recent market shifts include new entrants, pricing pressure..."
              className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
            <p className="text-xs text-gray-500">Competitive landscape, industry benchmarks, and market dynamics</p>
          </div>

          {/* Advanced: Prompt Editor */}
          <div className="border-t border-gray-200 pt-6">
            <button
              type="button"
              onClick={() => {
                if (!showPromptEditor && !config.customPrompt) {
                  setConfig({ ...config, customPrompt: generateDefaultPrompt() })
                }
                setShowPromptEditor(!showPromptEditor)
              }}
              className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              disabled={isLoading}
            >
              <span className="text-base">⚙️</span>
              <span className="font-medium">
                {showPromptEditor ? 'Hide' : 'Advanced: Edit System Prompt'}
              </span>
              <span className="text-xs text-gray-400">
                ({showPromptEditor ? 'collapse' : 'one-time override'})
              </span>
            </button>
            
            {showPromptEditor && (
              <div className="mt-4 space-y-2">
                <label className="block text-sm font-semibold text-gray-900">
                  🤖 System Prompt (Advanced)
                </label>
                <textarea
                  value={config.customPrompt || generateDefaultPrompt()}
                  onChange={(e) => setConfig({ ...config, customPrompt: e.target.value })}
                  className="w-full h-64 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none font-mono text-xs"
                  placeholder="Edit the system prompt that will be sent to GPT-5..."
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    Customize how the AI analyzes your data. Changes apply to this analysis only.
                  </p>
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, customPrompt: generateDefaultPrompt() })}
                    className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                    disabled={isLoading}
                  >
                    Reset to Default
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              disabled={isLoading}
            >
              Reset Form
            </button>
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !config.targetKpis.trim() || !config.tableFormat.trim()}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isLoading || !config.targetKpis.trim() || !config.tableFormat.trim()
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700 shadow-md hover:shadow-lg'
                }`}
              >
                {isLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    <span>Analyzing...</span>
                  </div>
                ) : (
                  'Start Analysis'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
