'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownContentProps {
  content: string
  className?: string
}

export default function MarkdownContent({ content, className = '' }: MarkdownContentProps) {
  // Handle legacy content that might not be markdown yet
  const processedContent = content || 'N/A'
  
  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          // Style tables nicely
          table: ({ children }) => (
            <div className="overflow-x-auto mb-4">
              <table className="min-w-full border border-gray-200 text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-gray-50">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left border-b border-gray-200 font-medium text-gray-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 border-b border-gray-100 text-gray-800">
              {children}
            </td>
          ),
          // Style lists with proper spacing
          ul: ({ children }) => (
            <ul className="list-disc list-outside pl-5 space-y-2 mb-4">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-outside pl-5 space-y-2 mb-4">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-gray-700 leading-relaxed">
              {children}
            </li>
          ),
          // Style paragraphs
          p: ({ children }) => (
            <p className="text-gray-700 leading-relaxed mb-3">
              {children}
            </p>
          ),
          // Style strong/bold text to highlight metrics
          strong: ({ children }) => (
            <strong className="font-semibold text-gray-900 bg-gray-100 px-1 py-0.5 rounded-sm">
              {children}
            </strong>
          ),
          // Style emphasis/italic text
          em: ({ children }) => (
            <em className="italic text-gray-600">
              {children}
            </em>
          ),
          // Style headings if any
          h3: ({ children }) => (
            <h3 className="font-semibold text-gray-900 mb-2 mt-4">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="font-medium text-gray-800 mb-2 mt-3">
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
        {processedContent}
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