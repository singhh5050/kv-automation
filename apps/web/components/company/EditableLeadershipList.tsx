'use client'

import { useState } from 'react'
import EditablePersonField from './EditablePersonField'

interface EditableLeadershipListProps {
  leadership: any[]
  companyId: string
  onUpdate: () => void
}

export default function EditableLeadershipList({ 
  leadership, 
  companyId, 
  onUpdate 
}: EditableLeadershipListProps) {
  const [nextIndex, setNextIndex] = useState(() => {
    // Find the highest index currently used
    const maxIndex = leadership?.length ? leadership.length : 0
    return maxIndex
  })

  // Filter out CEO and board members from leadership
  const filteredLeadership = (leadership || [])
    .map((leader: any, originalIndex: number) => ({ leader, originalIndex }))
    .filter(({ leader }) => {
      const titleLower = (leader.title || '').toLowerCase()
      const enrichedTitleLower = (leader.enriched_person?.current_position?.title || leader.title || '').toLowerCase()
      return !titleLower.includes('ceo') &&
             !titleLower.includes('chief executive') &&
             !(/\binvestor\b|\bboard\b/i.test(enrichedTitleLower))
    })
  
  const handleAddExecutive = () => {
    // This will be handled by creating a new EditablePersonField with the next available index
    setNextIndex(prev => prev + 1)
  }
  
  const handleDeleteExecutive = (index: number) => {
    // After deletion, refresh the data
    onUpdate()
  }
  
  return (
    <div className="space-y-2">
      {/* Existing Leadership */}
      {filteredLeadership.map(({ leader, originalIndex }: any, displayIndex: number) => (
        <div key={originalIndex} className="p-1.5 rounded border border-gray-100">
          <EditablePersonField
            label={`Executive ${displayIndex + 1}`}
            person={leader}
            companyId={companyId}
            fieldPrefix="leadership"
            index={originalIndex}
            allowDelete={true}
            onUpdate={onUpdate}
            onDelete={() => handleDeleteExecutive(originalIndex)}
          />
        </div>
      ))}
      
      {/* Add New Executive Button */}
      <div className="p-1.5 rounded border border-dashed border-gray-300 bg-gray-50">
        <EditablePersonField
          label={`Add Executive ${filteredLeadership.length + 1}`}
          person={null}
          companyId={companyId}
          fieldPrefix="leadership"
          index={nextIndex}
          onUpdate={() => {
            handleAddExecutive()
            onUpdate()
          }}
        />
      </div>
    </div>
  )
}


