'use client'

import React, { useState } from 'react'
import { X, Heart, AlertTriangle, CheckCircle } from 'lucide-react'
import { HealthCheckConfig } from '../../types'

interface HealthCheckModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (config: HealthCheckConfig) => void
  isLoading: boolean
  companyName: string
}

const CRITICALITY_DESCRIPTIONS = {
  1: 'Very Lenient - Rose-colored glasses, focus on positives',
  2: 'Lenient - Generally optimistic perspective',
  3: 'Somewhat Lenient - Mild optimistic bias',
  4: 'Slightly Lenient - Slight positive lean',
  5: 'Balanced - Neutral, objective assessment',
  6: 'Slightly Critical - Slight negative lean',
  7: 'Somewhat Critical - Mild pessimistic bias',
  8: 'Critical - Generally pessimistic perspective',
  9: 'Very Critical - Harsh but fair assessment',
  10: 'Extremely Critical - Maximum scrutiny, find all issues'
}

export default function HealthCheckModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  isLoading,
  companyName 
}: HealthCheckModalProps) {
  const [config, setConfig] = useState<HealthCheckConfig>({
    criticality_level: 5
  })
  
  const [useManualScore, setUseManualScore] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(config)
  }

  const handleReset = () => {
    setConfig({ criticality_level: 5 })
    setUseManualScore(false)
  }

  const getScoreIcon = (score: 'GREEN' | 'YELLOW' | 'RED') => {
    switch (score) {
      case 'GREEN': return <CheckCircle className="w-5 h-5 text-green-600" />
      case 'YELLOW': return <AlertTriangle className="w-5 h-5 text-yellow-600" />
      case 'RED': return <Heart className="w-5 h-5 text-red-600" />
    }
  }

  const getScoreColor = (score: 'GREEN' | 'YELLOW' | 'RED') => {
    switch (score) {
      case 'GREEN': return 'border-green-200 bg-green-50 hover:bg-green-100'
      case 'YELLOW': return 'border-yellow-200 bg-yellow-50 hover:bg-yellow-100'
      case 'RED': return 'border-red-200 bg-red-50 hover:bg-red-100'
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-green-50 to-blue-50">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-lg">🏥</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Company Health Check</h2>
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
          {/* Analysis Mode Selection */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <span className="text-lg">🎯</span>
              <h3 className="text-lg font-semibold text-gray-900">Analysis Mode</h3>
            </div>
            
            <div className="grid grid-cols-1 gap-3">
              <label className="relative cursor-pointer">
                <input
                  type="radio"
                  name="analysisMode"
                  checked={!useManualScore}
                  onChange={() => setUseManualScore(false)}
                  className="sr-only"
                />
                <div className={`p-4 rounded-lg border-2 transition-all ${
                  !useManualScore
                    ? 'border-blue-500 bg-blue-50 shadow-md'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600">🤖</span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">AI Analysis</div>
                      <div className="text-sm text-gray-600">Let AI analyze the latest board deck and data</div>
                    </div>
                  </div>
                </div>
              </label>

              <label className="relative cursor-pointer">
                <input
                  type="radio"
                  name="analysisMode"
                  checked={useManualScore}
                  onChange={() => setUseManualScore(true)}
                  className="sr-only"
                />
                <div className={`p-4 rounded-lg border-2 transition-all ${
                  useManualScore
                    ? 'border-purple-500 bg-purple-50 shadow-md'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                      <span className="text-purple-600">✋</span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">Manual Override</div>
                      <div className="text-sm text-gray-600">Set the health score manually</div>
                    </div>
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* AI Analysis Configuration */}
          {!useManualScore && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <span className="text-lg">⚖️</span>
                <h3 className="text-lg font-semibold text-gray-900">Criticality Level</h3>
              </div>
              
              <div className="space-y-4">
                <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="text-sm text-blue-800">
                    <p className="font-semibold mb-1">How critical should the AI be?</p>
                    <p>Adjust how harshly the AI evaluates the company's performance and prospects.</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Criticality:</span>
                    <span className="text-lg font-bold text-blue-600">{config.criticality_level}/10</span>
                  </div>
                  
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={config.criticality_level || 5}
                    onChange={(e) => setConfig({ 
                      ...config, 
                      criticality_level: parseInt(e.target.value),
                      manual_score: undefined
                    })}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #10b981 0%, #f59e0b ${((config.criticality_level || 5) - 1) * 50 / 9}%, #ef4444 100%)`
                    }}
                  />
                  
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Lenient</span>
                    <span>Balanced</span>
                    <span>Critical</span>
                  </div>
                  
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">Level {config.criticality_level}:</span>{' '}
                      {CRITICALITY_DESCRIPTIONS[config.criticality_level as keyof typeof CRITICALITY_DESCRIPTIONS]}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Manual Score Selection */}
          {useManualScore && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <span className="text-lg">🎯</span>
                <h3 className="text-lg font-semibold text-gray-900">Manual Health Score</h3>
              </div>
              
              <div className="grid grid-cols-1 gap-3">
                {(['GREEN', 'YELLOW', 'RED'] as const).map((score) => (
                  <label key={score} className="relative cursor-pointer">
                    <input
                      type="radio"
                      name="manualScore"
                      value={score}
                      checked={config.manual_score === score}
                      onChange={(e) => setConfig({ 
                        ...config, 
                        manual_score: e.target.value as 'GREEN' | 'YELLOW' | 'RED',
                        criticality_level: undefined
                      })}
                      className="sr-only"
                    />
                    <div className={`p-4 rounded-lg border-2 transition-all ${
                      config.manual_score === score
                        ? `border-${score.toLowerCase()}-500 bg-${score.toLowerCase()}-50 shadow-md`
                        : getScoreColor(score)
                    }`}>
                      <div className="flex items-center space-x-3">
                        {getScoreIcon(score)}
                        <div>
                          <div className="font-medium text-gray-900">
                            {score === 'GREEN' ? 'Healthy' : score === 'YELLOW' ? 'Caution' : 'Critical'}
                          </div>
                          <div className="text-sm text-gray-600">
                            {score === 'GREEN' 
                              ? 'Company is performing well with strong fundamentals'
                              : score === 'YELLOW'
                              ? 'Company has some concerns but manageable risks'
                              : 'Company faces significant challenges requiring attention'
                            }
                          </div>
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              disabled={isLoading}
            >
              Reset
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
                disabled={isLoading || (useManualScore && !config.manual_score)}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isLoading || (useManualScore && !config.manual_score)
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-green-500 to-blue-600 text-white hover:from-green-600 hover:to-blue-700 shadow-md hover:shadow-lg'
                }`}
              >
                {isLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                    <span>Analyzing...</span>
                  </div>
                ) : (
                  'Run Health Check'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
