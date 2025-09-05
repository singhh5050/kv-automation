'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import HealthScoreDisplay from './HealthScoreDisplay'

interface MarkdownContentProps {
  content: string
  className?: string
}

export default function MarkdownContent({ content, className = '' }: MarkdownContentProps) {
  // Handle legacy content that might not be markdown yet
  const processedContent = content || 'N/A'
  
  // Check if this is KPI analysis content for special styling
  const isKpiAnalysis = className.includes('kpi-analysis')
  
  // Normalize common non-markdown bullets like "•" that often arrive inline with no newlines
  const normalizeLegacyBullets = (text: string): string => {
    if (!text) return text
    let t = text.replace(/\r\n/g, '\n')
    // Replace any occurrence of the bullet dot "•" followed by spaces with a markdown list item
    // Example: "• Item A • Item B" -> "\n- Item A\n- Item B"
    if (t.includes('•')) {
      // Insert a newline before every bullet, then convert to hyphen list
      t = t
        .replace(/\s*•\s*/g, '\n- ')
        // Collapse accidental multiple newlines
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    }
    // Normalize middle-dot separators "·" as soft separators to newlines as well
    if (t.includes('·')) {
      t = t.replace(/\s*·\s*/g, '\n')
    }
    return t
  }
  
  const markdownText = normalizeLegacyBullets(processedContent)
  
  return (
    <div className={`markdown-content ${className}`}>
      {/* Show health score if this is KPI analysis */}
      {isKpiAnalysis && <HealthScoreDisplay content={processedContent} />}
      
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          // Style tables nicely with enhanced KPI styling
          table: ({ children }) => (
            <div className="overflow-x-auto mb-6">
              <table className={`min-w-full border border-gray-200 text-sm rounded-lg overflow-hidden ${
                isKpiAnalysis ? 'shadow-sm' : ''
              }`}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className={isKpiAnalysis ? "bg-gradient-to-r from-blue-50 to-purple-50" : "bg-gray-50"}>
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className={`px-4 py-3 text-left border-b font-medium ${
              isKpiAnalysis 
                ? 'border-blue-200 text-blue-900 text-xs uppercase tracking-wider' 
                : 'border-gray-200 text-gray-700'
            }`}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className={`px-4 py-3 border-b ${
              isKpiAnalysis 
                ? 'border-gray-100 text-gray-800 text-sm' 
                : 'border-gray-100 text-gray-800'
            }`}>
              {children}
            </td>
          ),
          // Style lists with proper spacing
          ul: ({ children }) => (
            <ul className={`list-disc list-outside pl-5 space-y-2 mb-4 ${
              isKpiAnalysis ? 'space-y-3' : ''
            }`}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className={`list-decimal list-outside pl-5 space-y-2 mb-4 ${
              isKpiAnalysis ? 'space-y-3' : ''
            }`}>
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className={`text-gray-700 leading-relaxed ${
              isKpiAnalysis ? 'text-sm leading-relaxed' : ''
            }`}>
              {children}
            </li>
          ),
          // Style paragraphs
          p: ({ children }) => (
            <p className={`text-gray-700 leading-relaxed mb-3 ${
              isKpiAnalysis ? 'text-sm leading-6' : ''
            }`}>
              {children}
            </p>
          ),
          // Style strong/bold text to highlight metrics
          strong: ({ children }) => (
            <strong className={`font-semibold text-gray-900 px-1 py-0.5 rounded-sm ${
              isKpiAnalysis 
                ? 'bg-blue-50 border border-blue-200 text-blue-900' 
                : 'bg-gray-100'
            }`}>
              {children}
            </strong>
          ),
          // Style emphasis/italic text
          em: ({ children }) => (
            <em className={`italic ${
              isKpiAnalysis ? 'text-gray-600 font-medium' : 'text-gray-600'
            }`}>
              {children}
            </em>
          ),
          // Enhanced headings for KPI sections
          h1: ({ children }) => (
            <h1 className={`font-bold mb-4 mt-6 flex items-center ${
              isKpiAnalysis 
                ? 'text-xl text-gray-900 border-l-4 border-blue-500 pl-4 bg-blue-50 py-2 rounded-r-lg' 
                : 'text-lg text-gray-900'
            }`}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className={`font-semibold mb-3 mt-5 ${
              isKpiAnalysis 
                ? 'text-lg text-gray-900 border-l-3 border-purple-400 pl-3 bg-purple-50 py-1.5 rounded-r' 
                : 'text-base text-gray-900'
            }`}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className={`font-semibold mb-2 mt-4 ${
              isKpiAnalysis 
                ? 'text-base text-gray-800 border-l-2 border-gray-300 pl-2' 
                : 'text-sm text-gray-900'
            }`}>
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className={`font-medium mb-2 mt-3 ${
              isKpiAnalysis 
                ? 'text-sm text-gray-700 uppercase tracking-wide' 
                : 'text-sm text-gray-800'
            }`}>
              {children}
            </h4>
          ),
          // Handle code spans for metrics
          code: ({ children }) => (
            <code className="bg-blue-50 text-blue-800 px-1 py-0.5 rounded text-sm font-mono">
              {children}
            </code>
          ),
        }}
      >
        {markdownText}
      </ReactMarkdown>
    </div>
  )
}

// Helper component for legacy bullet-separated content
export function LegacyBulletList({ content }: { content: string }) {
  if (!content || content === 'N/A') {
    return <p className="text-gray-500 italic">No information available</p>
  }

  // Split on bullets or semicolons, filter empty strings
  const bullets = content
    .split(/[•;]\s*/)
    .filter(item => item.trim().length > 0)
    .map(item => item.trim())

  if (bullets.length <= 1) {
    // Single item or not bullet-separated, render as paragraph
    return (
      <p className="text-gray-700 leading-relaxed">
        {content}
      </p>
    )
  }

  // Multiple bullets, render as list
  return (
    <ul className="list-disc list-outside pl-5 space-y-2">
              {bullets.map((bullet, index: number) => (
        <li key={index} className="text-gray-700 leading-relaxed">
          {bullet}
        </li>
      ))}
    </ul>
  )
} 