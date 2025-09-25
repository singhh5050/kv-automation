'use client'

import { useState, useEffect } from 'react'
import { getCompanyExecutives, saveCompanyExecutive, deleteCompanyExecutive } from '@/lib/api'

interface Executive {
  id?: number
  full_name?: string
  title?: string
  linkedin_url?: string
  display_order?: number
  is_ceo?: boolean
  is_active?: boolean
  source?: string
}

interface SimpleExecutivesListProps {
  companyId: string
}

export default function SimpleExecutivesList({ companyId }: SimpleExecutivesListProps) {
  const [executives, setExecutives] = useState<Executive[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)
  const [editForm, setEditForm] = useState<Executive>({})

  // Load executives
  const loadExecutives = async () => {
    try {
      const result = await getCompanyExecutives(companyId)
      if (result.data?.data) {
        setExecutives(result.data.data)
      }
    } catch (error) {
      console.error('Failed to load executives:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadExecutives()
  }, [companyId])

  const handleEdit = (exec: Executive) => {
    setEditingId(exec.id!)
    setEditForm(exec)
  }

  const handleAdd = () => {
    const maxOrder = Math.max(...executives.map(e => e.display_order || 0), -1)
    setEditingId('new')
    setEditForm({
      display_order: maxOrder + 1,
      is_ceo: false
    })
  }

  const handleSave = async () => {
    try {
      const dataToSave = {
        company_id: companyId,
        ...editForm
      }
      
      const result = await saveCompanyExecutive(dataToSave)
      if (result.data) {
        await loadExecutives() // Reload the list
        setEditingId(null)
        setEditForm({})
      }
    } catch (error) {
      console.error('Failed to save executive:', error)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this executive?')) return
    
    try {
      const result = await deleteCompanyExecutive(id)
      if (result.data) {
        await loadExecutives()
      }
    } catch (error) {
      console.error('Failed to delete executive:', error)
    }
  }

  const handleCancel = () => {
    setEditingId(null)
    setEditForm({})
  }

  if (loading) {
    return <div className="text-gray-500">Loading executives...</div>
  }

  return (
    <div className="space-y-2">
      {/* CEO Section */}
      {executives.filter(e => e.is_ceo).map(exec => (
        <div key={exec.id} className="p-3 rounded-lg border-2 border-blue-200 bg-blue-50">
          {editingId === exec.id ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded font-medium">CEO</span>
                <span className="text-xs text-gray-500">Editing</span>
              </div>
              <input
                value={editForm.full_name || ''}
                onChange={(e) => setEditForm({...editForm, full_name: e.target.value})}
                placeholder="Full Name"
                className="w-full px-2 py-1 border rounded text-sm"
              />
              <input
                value={editForm.title || ''}
                onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                placeholder="Title"
                className="w-full px-2 py-1 border rounded text-sm"
              />
              <input
                value={editForm.linkedin_url || ''}
                onChange={(e) => setEditForm({...editForm, linkedin_url: e.target.value})}
                placeholder="LinkedIn URL"
                className="w-full px-2 py-1 border rounded text-sm"
              />
              <div className="flex gap-2">
                <button onClick={handleSave} className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">
                  Save
                </button>
                <button onClick={handleCancel} className="px-3 py-1 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded font-medium">CEO</span>
                <div className="flex items-center space-x-1">
                  <button onClick={() => handleEdit(exec)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 text-xs">
                    ✏️
                  </button>
                  <button onClick={() => handleDelete(exec.id!)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs">
                    🗑️
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {exec.linkedin_url ? (
                  <a href={exec.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-blue-700 hover:text-blue-900 hover:underline">
                    {exec.full_name || 'No name'}
                  </a>
                ) : (
                  <div className="text-sm font-bold text-gray-900">{exec.full_name || 'No name'}</div>
                )}
                {exec.title && <div className="text-xs text-gray-600">{exec.title}</div>}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Other Executives */}
      {executives.filter(e => !e.is_ceo).map((exec, index) => (
        <div key={exec.id} className="p-3 rounded-lg border border-gray-200">
          {editingId === exec.id ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded font-medium">Executive {index + 1}</span>
                <span className="text-xs text-gray-500">Editing</span>
              </div>
              <input
                value={editForm.full_name || ''}
                onChange={(e) => setEditForm({...editForm, full_name: e.target.value})}
                placeholder="Full Name"
                className="w-full px-2 py-1 border rounded text-sm"
              />
              <input
                value={editForm.title || ''}
                onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                placeholder="Title"
                className="w-full px-2 py-1 border rounded text-sm"
              />
              <input
                value={editForm.linkedin_url || ''}
                onChange={(e) => setEditForm({...editForm, linkedin_url: e.target.value})}
                placeholder="LinkedIn URL"
                className="w-full px-2 py-1 border rounded text-sm"
              />
              <div className="flex gap-2">
                <button onClick={handleSave} className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">
                  Save
                </button>
                <button onClick={handleCancel} className="px-3 py-1 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded font-medium">Executive {index + 1}</span>
                <div className="flex items-center space-x-1">
                  <button onClick={() => handleEdit(exec)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 text-xs">
                    ✏️
                  </button>
                  <button onClick={() => handleDelete(exec.id!)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 text-xs">
                    🗑️
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {exec.linkedin_url ? (
                  <a href={exec.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-blue-700 hover:text-blue-900 hover:underline">
                    {exec.full_name || 'No name'}
                  </a>
                ) : (
                  <div className="text-sm font-bold text-gray-900">{exec.full_name || 'No name'}</div>
                )}
                {exec.title && <div className="text-xs text-gray-600">{exec.title}</div>}
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Add New Executive */}
      {editingId === 'new' ? (
        <div className="p-3 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 space-y-2">
          <div className="text-xs bg-green-600 text-white px-2 py-1 rounded font-medium inline-block">Add New Executive</div>
          <input
            value={editForm.full_name || ''}
            onChange={(e) => setEditForm({...editForm, full_name: e.target.value})}
            placeholder="Full Name"
            className="w-full px-2 py-1 border rounded text-sm"
          />
          <input
            value={editForm.title || ''}
            onChange={(e) => setEditForm({...editForm, title: e.target.value})}
            placeholder="Title"
            className="w-full px-2 py-1 border rounded text-sm"
          />
          <input
            value={editForm.linkedin_url || ''}
            onChange={(e) => setEditForm({...editForm, linkedin_url: e.target.value})}
            placeholder="LinkedIn URL"
            className="w-full px-2 py-1 border rounded text-sm"
          />
          <label className="flex items-center space-x-2 text-sm">
            <input
              type="checkbox"
              checked={editForm.is_ceo || false}
              onChange={(e) => setEditForm({...editForm, is_ceo: e.target.checked})}
            />
            <span>Is CEO?</span>
          </label>
          <div className="flex gap-2">
            <button onClick={handleSave} className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600">
              Add Executive
            </button>
            <button onClick={handleCancel} className="px-3 py-1 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={handleAdd}
          className="w-full p-3 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-600 text-sm font-medium"
        >
          + Add Executive
        </button>
      )}
    </div>
  )
}
