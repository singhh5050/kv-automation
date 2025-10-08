import React from 'react'
import MarkdownContent from './MarkdownContent'

interface Milestone {
  date: string
  description: string
  priority: 'critical' | 'high' | 'medium' | 'low'
}

interface MilestoneDisplayProps {
  content: string | null
  className?: string
}

export default function MilestoneDisplay({ content, className = '' }: MilestoneDisplayProps) {
  if (!content) return null

  // Try to parse as JSON first (new format)
  let milestones: Milestone[] | null = null
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Validate structure
      const isValidMilestones = parsed.every(item => 
        typeof item === 'object' && 
        item !== null &&
        'date' in item && 
        'description' in item && 
        'priority' in item
      )
      if (isValidMilestones) {
        milestones = parsed
      }
    }
  } catch {
    // Not JSON, fall back to markdown
  }

  // If we have structured milestones, render them specially
  if (milestones) {
    return (
      <div className={`milestone-display ${className}`}>
        <div className="space-y-3">
          {milestones.map((milestone, index) => {
            const priorityConfig = getPriorityConfig(milestone.priority)
            const formattedDate = formatMilestoneDate(milestone.date)
            
            return (
              <div 
                key={index}
                className={`flex items-start space-x-3 p-3 rounded-lg border-l-4 ${priorityConfig.borderColor} ${priorityConfig.bgColor}`}
              >
                <div className={`flex-shrink-0 w-8 h-8 rounded-full ${priorityConfig.iconBg} flex items-center justify-center`}>
                  <span className="text-sm">{priorityConfig.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${priorityConfig.badgeColor}`}>
                      {milestone.priority.toUpperCase()}
                    </span>
                    <span className="text-sm font-medium text-gray-600">
                      {formattedDate}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 leading-relaxed">
                    {milestone.description}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Fall back to markdown rendering for legacy format
  return <MarkdownContent content={content} className={className} />
}

function getPriorityConfig(priority: string) {
  switch (priority) {
    case 'critical':
      return {
        icon: '🚨',
        borderColor: 'border-red-500',
        bgColor: 'bg-red-50',
        iconBg: 'bg-red-100',
        badgeColor: 'bg-red-100 text-red-800'
      }
    case 'high':
      return {
        icon: '🚀',
        borderColor: 'border-orange-500',
        bgColor: 'bg-orange-50',
        iconBg: 'bg-orange-100',
        badgeColor: 'bg-orange-100 text-orange-800'
      }
    case 'medium':
      return {
        icon: '📋',
        borderColor: 'border-blue-500',
        bgColor: 'bg-blue-50',
        iconBg: 'bg-blue-100',
        badgeColor: 'bg-blue-100 text-blue-800'
      }
    case 'low':
      return {
        icon: '📝',
        borderColor: 'border-gray-400',
        bgColor: 'bg-gray-50',
        iconBg: 'bg-gray-100',
        badgeColor: 'bg-gray-100 text-gray-800'
      }
    default:
      return {
        icon: '📋',
        borderColor: 'border-blue-500',
        bgColor: 'bg-blue-50',
        iconBg: 'bg-blue-100',
        badgeColor: 'bg-blue-100 text-blue-800'
      }
  }
}

function formatMilestoneDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    
    // Check if it's a quarter date (01-01, 04-01, 07-01, 10-01)
    const month = date.getMonth()
    const day = date.getDate()
    
    if (day === 1) {
      if (month === 2) return `Q1 ${date.getFullYear()}`      // March 1 -> Q1
      if (month === 5) return `Q2 ${date.getFullYear()}`      // June 1 -> Q2  
      if (month === 8) return `Q3 ${date.getFullYear()}`      // September 1 -> Q3
      if (month === 11) return `Q4 ${date.getFullYear()}`     // December 1 -> Q4
      
      // Month estimate (first of month)
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    }
    
    // Exact date
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    })
  } catch {
    return dateStr
  }
}
