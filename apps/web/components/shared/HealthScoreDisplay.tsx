'use client'

import React from 'react'

interface HealthScoreDisplayProps {
  content: string
}

export default function HealthScoreDisplay({ content }: HealthScoreDisplayProps) {
  // Extract health score from markdown content
  const extractHealthScore = (text: string): { score: 'GREEN' | 'YELLOW' | 'RED' | null, justification: string } => {
    // Look for health score patterns
    const greenPattern = /🟢\s*(GREEN|green)/i
    const yellowPattern = /🟡\s*(YELLOW|yellow)/i
    const redPattern = /🔴\s*(RED|red)/i
    
    let score: 'GREEN' | 'YELLOW' | 'RED' | null = null
    
    if (greenPattern.test(text)) {
      score = 'GREEN'
    } else if (yellowPattern.test(text)) {
      score = 'YELLOW'
    } else if (redPattern.test(text)) {
      score = 'RED'
    }
    
    // Extract the justification (text after the score until next section)
    const healthSectionMatch = text.match(/🏥.*?Company Health Score.*?\n(.*?)(?=\n##|\n\d+\.|\n�|$)/s)
    const justification = healthSectionMatch ? healthSectionMatch[1].trim() : ''
    
    return { score, justification }
  }

  const { score, justification } = extractHealthScore(content)

  if (!score) {
    return null // Don't render if no health score found
  }

  const getScoreConfig = (score: 'GREEN' | 'YELLOW' | 'RED') => {
    switch (score) {
      case 'GREEN':
        return {
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          textColor: 'text-green-800',
          iconBg: 'bg-green-100',
          icon: '🟢',
          label: 'Healthy'
        }
      case 'YELLOW':
        return {
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200',
          textColor: 'text-yellow-800',
          iconBg: 'bg-yellow-100',
          icon: '🟡',
          label: 'Caution'
        }
      case 'RED':
        return {
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          textColor: 'text-red-800',
          iconBg: 'bg-red-100',
          icon: '🔴',
          label: 'Critical'
        }
    }
  }

  const config = getScoreConfig(score)

  return (
    <div className={`rounded-xl border-2 ${config.borderColor} ${config.bgColor} p-4 mb-6`}>
      <div className="flex items-start space-x-3">
        <div className={`w-12 h-12 ${config.iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
          <span className="text-2xl">{config.icon}</span>
        </div>
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <h3 className={`text-lg font-bold ${config.textColor}`}>
              Company Health: {config.label}
            </h3>
          </div>
          <div 
            className={`text-sm ${config.textColor} leading-relaxed`}
            dangerouslySetInnerHTML={{ 
              __html: justification
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`(.*?)`/g, '<code class="bg-white bg-opacity-60 px-1 py-0.5 rounded text-xs font-mono">$1</code>')
                .replace(/\n/g, '<br>')
            }}
          />
        </div>
      </div>
    </div>
  )
}
