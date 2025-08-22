'use client'

import { useState, useEffect } from 'react'
import { CompanyNote } from '@/types'
import { getCompanyNotes, createCompanyNote, updateCompanyNote, deleteCompanyNote } from '@/lib/api'

interface CompanyNotesProps {
  companyId: string
}

export default function CompanyNotes({ companyId }: CompanyNotesProps) {
  const [notes, setNotes] = useState<CompanyNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewNoteForm, setShowNewNoteForm] = useState(false)
  const [editingNote, setEditingNote] = useState<CompanyNote | null>(null)

  // New note form state
  const [newNoteSubject, setNewNoteSubject] = useState('')
  const [newNoteContent, setNewNoteContent] = useState('')
  const [saving, setSaving] = useState(false)

  // Load notes on component mount
  useEffect(() => {
    loadNotes()
  }, [companyId])

  const loadNotes = async () => {
    try {
      setLoading(true)
      const response = await getCompanyNotes(companyId)
      if (response.data && !response.error) {
        setNotes(response.data.data || [])
      } else {
        setError(response.error || 'Failed to load notes')
      }
    } catch (err) {
      setError('Failed to load notes')
      console.error('Error loading notes:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateNote = async () => {
    if (!newNoteSubject.trim()) return

    try {
      setSaving(true)
      const response = await createCompanyNote(companyId, {
        subject: newNoteSubject.trim(),
        content: newNoteContent.trim()
      })

      if (response.data && !response.error) {
        setNotes([response.data.data, ...notes])
        setNewNoteSubject('')
        setNewNoteContent('')
        setShowNewNoteForm(false)
      } else {
        setError(response.error || 'Failed to create note')
      }
    } catch (err) {
      setError('Failed to create note')
      console.error('Error creating note:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateNote = async (noteId: number, updates: { subject?: string; content?: string }) => {
    try {
      const response = await updateCompanyNote(noteId, updates)
      if (response.data && !response.error) {
        setNotes(notes.map(note => 
          note.id === noteId ? { ...note, ...updates } : note
        ))
        setEditingNote(null)
      } else {
        setError(response.error || 'Failed to update note')
      }
    } catch (err) {
      setError('Failed to update note')
      console.error('Error updating note:', err)
    }
  }

  const handleDeleteNote = async (noteId: number) => {
    if (!confirm('Are you sure you want to delete this note?')) return

    try {
      const response = await deleteCompanyNote(noteId)
      if (response.data && !response.error) {
        setNotes(notes.filter(note => note.id !== noteId))
      } else {
        setError(response.error || 'Failed to delete note')
      }
    } catch (err) {
      setError('Failed to delete note')
      console.error('Error deleting note:', err)
    }
  }

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString)
      // Check if the date is valid
      if (isNaN(date.getTime())) {
        return null // Return null for invalid dates instead of showing them
      }
      
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles' // Pacific Time
      })
    } catch {
      return null // Return null for any formatting errors
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-gray-500">Loading notes...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Company Notes</h2>
        <button
          onClick={() => setShowNewNoteForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          📝 Add Note
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-red-700 text-sm">{error}</p>
          <button 
            onClick={() => setError(null)}
            className="text-red-600 underline text-xs mt-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* New Note Form */}
      {showNewNoteForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
          <h3 className="font-medium text-gray-900">Add New Note</h3>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subject *
            </label>
            <input
              type="text"
              value={newNoteSubject}
              onChange={(e) => setNewNoteSubject(e.target.value)}
              placeholder="Note subject..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Content
            </label>
            <textarea
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              placeholder="Note content..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex space-x-2">
            <button
              onClick={handleCreateNote}
              disabled={!newNoteSubject.trim() || saving}
              className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Note'}
            </button>
            <button
              onClick={() => {
                setShowNewNoteForm(false)
                setNewNoteSubject('')
                setNewNoteContent('')
              }}
              className="bg-gray-300 text-gray-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-400 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Notes List */}
      {notes.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-gray-400 text-4xl mb-2">📝</div>
          <p className="text-gray-500 text-lg">No notes yet</p>
          <p className="text-gray-400 text-sm">Add your first note to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {notes.map((note) => (
            <div key={note.id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              {editingNote?.id === note.id ? (
                <EditNoteForm 
                  note={note}
                  onSave={(updates) => handleUpdateNote(note.id, updates)}
                  onCancel={() => setEditingNote(null)}
                />
              ) : (
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-medium text-gray-900">{note.subject}</h3>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setEditingNote(note)}
                        className="text-gray-400 hover:text-blue-600 text-sm"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="text-gray-400 hover:text-red-600 text-sm"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                  
                  {note.content && (
                    <div className="text-gray-700 text-sm mb-3 whitespace-pre-wrap">
                      {note.content}
                    </div>
                  )}
                  
                  <div className="text-xs text-gray-500">
                    {formatDate(note.created_at) && (
                      <span>Created {formatDate(note.created_at)}</span>
                    )}
                    {note.updated_at !== note.created_at && formatDate(note.updated_at) && (
                      <span>{formatDate(note.created_at) ? ' • ' : ''}Updated {formatDate(note.updated_at)}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Simple inline edit form component
function EditNoteForm({ 
  note, 
  onSave, 
  onCancel 
}: { 
  note: CompanyNote
  onSave: (updates: { subject?: string; content?: string }) => void
  onCancel: () => void
}) {
  const [subject, setSubject] = useState(note.subject)
  const [content, setContent] = useState(note.content)

  const handleSave = () => {
    const updates: { subject?: string; content?: string } = {}
    if (subject !== note.subject) updates.subject = subject
    if (content !== note.content) updates.content = content
    
    if (Object.keys(updates).length > 0) {
      onSave(updates)
    } else {
      onCancel()
    }
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
      />
      
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
      />
      
      <div className="flex space-x-2">
        <button
          onClick={handleSave}
          className="bg-blue-600 text-white px-3 py-1 rounded text-sm font-medium hover:bg-blue-700"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="bg-gray-300 text-gray-700 px-3 py-1 rounded text-sm font-medium hover:bg-gray-400"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
