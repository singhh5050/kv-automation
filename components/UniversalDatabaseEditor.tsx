'use client'

import { useState, useEffect, useCallback } from 'react'
import { getAllCompanyData, updateCompany, updateCapTableRound, updateCapTableInvestor, updateFinancialMetrics, updateCompanyEnrichment } from '@/lib/api'

interface DatabaseField {
  name: string
  type: 'SERIAL' | 'VARCHAR' | 'TEXT' | 'NUMERIC' | 'INTEGER' | 'BOOLEAN' | 'DATE' | 'TIMESTAMP'
  editable: boolean
  value: any
  formattedValue?: string
}

interface DatabaseRecord {
  id: number
  table: string
  fields: DatabaseField[]
  manually_edited?: boolean
  edited_by?: string
  edited_at?: string
}

interface UniversalDatabaseEditorProps {
  companyId: string
  onUpdate?: () => void
}

export default function UniversalDatabaseEditor({ companyId, onUpdate }: UniversalDatabaseEditorProps) {
  const [allData, setAllData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ table: string, recordId: number, field: string } | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const loadAllData = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getAllCompanyData(companyId)
      if (result.data && !result.error) {
        setAllData(result.data.data)
      } else {
        setError(result.error || 'Failed to load data')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    loadAllData()
  }, [companyId, loadAllData])

  const handleEdit = (table: string, recordId: number, field: string, currentValue: any) => {
    setEditingCell({ table, recordId, field })
    setEditValue(formatValueForEdit(currentValue))
  }

  const handleSave = async () => {
    if (!editingCell) return
    
    setSaving(true)
    try {
      const { table, recordId, field } = editingCell
      const parsedValue = parseValueByType(editValue, getFieldType(table, field))
      
      let result
      switch (table) {
        case 'companies':
          result = await updateCompany(recordId, { [field]: parsedValue })
          break
        case 'financial_reports':
          result = await updateFinancialMetrics(recordId, { [field]: parsedValue })
          break
        case 'cap_table_rounds':
          result = await updateCapTableRound(recordId, { [field]: parsedValue })
          break
        case 'cap_table_investors':
          result = await updateCapTableInvestor(recordId, { [field]: parsedValue })
          break
        case 'company_enrichments':
          // For enrichment updates, we need to find the company_id and build proper enrichment data
          const enrichmentRecord = allData.company_enrichments?.find((r: any) => r.id === recordId)
          if (!enrichmentRecord) {
            throw new Error('Enrichment record not found')
          }
          
          // Build the enrichment data update
          const enrichmentUpdate: any = {}
          
          // For JSON fields (harmonic_data, extracted_data), parse and update
          if (field === 'harmonic_data' || field === 'extracted_data') {
            enrichmentUpdate[field] = parsedValue
          } else {
            // For individual structured fields, update the extracted_data JSON
            const currentExtracted = enrichmentRecord.extracted_data 
              ? (typeof enrichmentRecord.extracted_data === 'string' 
                ? JSON.parse(enrichmentRecord.extracted_data) 
                : enrichmentRecord.extracted_data)
              : {}
            
            // Update the specific field in extracted data
            if (field.startsWith('location_')) {
              const locationField = field.replace('location_', '')
              currentExtracted.location = currentExtracted.location || {}
              currentExtracted.location[locationField] = parsedValue
            } else if (field.startsWith('funding_')) {
              const fundingField = field.replace('funding_', '')
              currentExtracted.funding = currentExtracted.funding || {}
              currentExtracted.funding[fundingField] = parsedValue
            } else if (field.startsWith('ceo_')) {
              const ceoField = field.replace('ceo_', '')
              currentExtracted.ceo = currentExtracted.ceo || {}
              if (ceoField === 'name') {
                currentExtracted.ceo.full_name = parsedValue
              } else if (ceoField === 'linkedin') {
                currentExtracted.ceo.contact = currentExtracted.ceo.contact || {}
                currentExtracted.ceo.contact.linkedin_url = parsedValue
              } else if (ceoField === 'email') {
                currentExtracted.ceo.contact = currentExtracted.ceo.contact || {}
                currentExtracted.ceo.contact.email = parsedValue
              } else {
                currentExtracted.ceo[ceoField] = parsedValue
              }
            } else {
              currentExtracted[field] = parsedValue
            }
            
            enrichmentUpdate.extracted_data = currentExtracted
          }
          
          result = await updateCompanyEnrichment(enrichmentRecord.company_id.toString(), enrichmentUpdate)
          break
        default:
          throw new Error(`Unknown table: ${table}`)
      }
      
      if (result.error) {
        throw new Error(result.error)
      }
      
      setEditingCell(null)
      setEditValue('')
      await loadAllData()
      onUpdate?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setEditingCell(null)
    setEditValue('')
  }

  const formatValueForEdit = (value: any): string => {
    if (value === null || value === undefined) return ''
    return String(value)
  }

  const parseValueByType = (value: string, type: string): any => {
    if (!value.trim()) return null
    
    switch (type) {
      case 'INTEGER':
        return parseInt(value, 10) || 0
      case 'NUMERIC':
        return parseFloat(value) || 0
      case 'BOOLEAN':
        return value.toLowerCase() === 'true' || value === '1'
      case 'DATE':
      case 'TIMESTAMP':
        return value // Let backend handle date parsing
      default:
        return value
    }
  }

  const getFieldType = (table: string, field: string): string => {
    const fieldTypes: Record<string, Record<string, string>> = {
      companies: {
        id: 'SERIAL',
        name: 'VARCHAR',
        normalized_name: 'VARCHAR',
        sector: 'VARCHAR',
        manually_edited: 'BOOLEAN',
        edited_by: 'VARCHAR',
        edited_at: 'TIMESTAMP',
        created_at: 'TIMESTAMP',
        updated_at: 'TIMESTAMP'
      },
      financial_reports: {
        id: 'SERIAL',
        company_id: 'INTEGER',
        file_name: 'VARCHAR',
        report_date: 'DATE',
        report_period: 'VARCHAR',
        sector: 'VARCHAR',
        cash_on_hand: 'NUMERIC',
        monthly_burn_rate: 'NUMERIC',
        cash_out_date: 'TEXT',
        runway: 'INTEGER',
        budget_vs_actual: 'TEXT',
        financial_summary: 'TEXT',
        sector_highlight_a: 'TEXT',
        sector_highlight_b: 'TEXT',
        key_risks: 'TEXT',
        personnel_updates: 'TEXT',
        next_milestones: 'TEXT',
        manually_edited: 'BOOLEAN',
        edited_by: 'VARCHAR',
        edited_at: 'TIMESTAMP',
        upload_date: 'TIMESTAMP',
        processed_at: 'TIMESTAMP',
        processing_status: 'VARCHAR'
      },
      cap_table_rounds: {
        id: 'SERIAL',
        company_id: 'INTEGER',
        round_name: 'VARCHAR',
        valuation: 'NUMERIC',
        amount_raised: 'NUMERIC',
        round_date: 'DATE',
        total_pool_size: 'NUMERIC',
        pool_available: 'NUMERIC',
        pool_utilization: 'NUMERIC',
        options_outstanding: 'NUMERIC',
        manually_edited: 'BOOLEAN',
        edited_by: 'VARCHAR',
        edited_at: 'TIMESTAMP',
        created_at: 'TIMESTAMP',
        updated_at: 'TIMESTAMP'
      },
      cap_table_investors: {
        id: 'SERIAL',
        cap_table_round_id: 'INTEGER',
        investor_name: 'VARCHAR',
        total_invested: 'NUMERIC',
        final_fds: 'NUMERIC',
        final_round_investment: 'NUMERIC',
        manually_edited: 'BOOLEAN',
        edited_by: 'VARCHAR',
        edited_at: 'TIMESTAMP',
        created_at: 'TIMESTAMP'
      },
      company_enrichments: {
        id: 'SERIAL',
        company_id: 'INTEGER',
        harmonic_entity_urn: 'VARCHAR',
        harmonic_data: 'TEXT',
        extracted_data: 'TEXT',
        enrichment_status: 'VARCHAR',
        enriched_at: 'TIMESTAMP',
        created_at: 'TIMESTAMP',
        updated_at: 'TIMESTAMP',
        funding_total: 'NUMERIC',
        funding_stage: 'VARCHAR',
        valuation: 'NUMERIC',
        headcount: 'INTEGER',
        web_traffic: 'INTEGER',
        stage: 'VARCHAR',
        company_type: 'VARCHAR',
        location_city: 'VARCHAR',
        location_state: 'VARCHAR',
        location_country: 'VARCHAR',
        ceo_name: 'VARCHAR',
        ceo_title: 'VARCHAR',
        ceo_linkedin: 'VARCHAR',
        ceo_email: 'VARCHAR'
      }
    }
    
    return fieldTypes[table]?.[field] || 'TEXT'
  }

  const isFieldEditable = (table: string, field: string): boolean => {
    const readOnlyFields = ['id', 'company_id', 'cap_table_round_id', 'upload_date', 'processed_at', 'processing_status', 'created_at']
    const systemFields = ['manually_edited', 'edited_by', 'edited_at', 'updated_at']
    
    return !readOnlyFields.includes(field) && !systemFields.includes(field)
  }

  const getFieldStyle = (table: string, field: string, isEdited: boolean): string => {
    const fieldType = getFieldType(table, field)
    
    if (!isFieldEditable(table, field)) {
      return 'bg-gray-50 text-gray-600'
    }
    
    if (isEdited) {
      return 'bg-amber-50 border-amber-200'
    }
    
    switch (fieldType) {
      case 'NUMERIC':
      case 'INTEGER':
        return 'bg-blue-50 hover:bg-blue-100 cursor-pointer border-blue-200'
      case 'TEXT':
      case 'VARCHAR':
        return 'bg-green-50 hover:bg-green-100 cursor-pointer border-green-200'
      case 'BOOLEAN':
        return 'bg-purple-50 hover:bg-purple-100 cursor-pointer border-purple-200'
      case 'DATE':
      case 'TIMESTAMP':
        return 'bg-orange-50 hover:bg-orange-100 cursor-pointer border-orange-200'
      default:
        return 'bg-gray-50 hover:bg-gray-100 cursor-pointer'
    }
  }

  const formatDisplayValue = (value: any, type: string): string => {
    if (value === null || value === undefined) return 'NULL'
    
    switch (type) {
      case 'NUMERIC':
        if (typeof value === 'number') {
          return value >= 1000000 
            ? `${(value / 1000000).toFixed(1)}M (${value.toLocaleString()})`
            : value.toLocaleString()
        }
        return String(value)
      case 'BOOLEAN':
        return value ? 'TRUE' : 'FALSE'
      case 'DATE':
      case 'TIMESTAMP':
        return value ? new Date(value).toLocaleString() : 'NULL'
      default:
        return String(value)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2">Loading database data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium">Error</h3>
        <p className="text-red-600">{error}</p>
        <button 
          onClick={loadAllData} 
          className="mt-2 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!allData) {
    return (
      <div className="text-center p-8 text-gray-500">
        No data available
      </div>
    )
  }

  const renderTable = (tableName: string, records: any[], title: string) => {
    if (!records || records.length === 0) {
      return (
        <div key={tableName} className="mb-8">
          <h3 className="text-lg font-semibold mb-4">{title}</h3>
          <p className="text-gray-500 italic">No records found</p>
        </div>
      )
    }

    const sampleRecord = records[0]
    const fieldNames = Object.keys(sampleRecord)

    return (
      <div key={tableName} className="mb-8">
        <h3 className="text-lg font-semibold mb-4">{title} ({records.length} records)</h3>
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                {fieldNames.map(field => (
                  <th key={field} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">
                    <div className="flex flex-col">
                      <span>{field}</span>
                      <span className="text-gray-400 normal-case">({getFieldType(tableName, field)})</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
                              {records.map((record, recordIndex: number) => (
                <tr key={record.id || recordIndex} className="border-b">
                  {fieldNames.map(field => {
                    const value = record[field]
                    const fieldType = getFieldType(tableName, field)
                    const isEditable = isFieldEditable(tableName, field)
                    const isEdited = record.manually_edited && isEditable
                    const isCurrentlyEditing = editingCell?.table === tableName && 
                                             editingCell?.recordId === record.id && 
                                             editingCell?.field === field

                    return (
                      <td 
                        key={field} 
                        className={`px-3 py-2 text-sm border-r ${getFieldStyle(tableName, field, isEdited)}`}
                        onClick={() => isEditable && !isCurrentlyEditing && handleEdit(tableName, record.id, field, value)}
                      >
                        {isCurrentlyEditing ? (
                          <div className="flex items-center space-x-2">
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="flex-1 px-2 py-1 border rounded text-sm"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSave()
                                if (e.key === 'Escape') handleCancel()
                              }}
                            />
                            <button
                              onClick={handleSave}
                              disabled={saving}
                              className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
                            >
                              {saving ? '...' : '✓'}
                            </button>
                            <button
                              onClick={handleCancel}
                              className="px-2 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="min-h-[20px] flex items-center">
                            <span className="truncate max-w-xs" title={formatDisplayValue(value, fieldType)}>
                              {formatDisplayValue(value, fieldType)}
                            </span>
                            {isEdited && (
                              <span className="ml-2 text-xs text-amber-600" title={`Edited by ${record.edited_by} at ${record.edited_at}`}>
                                ✏️
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h2 className="text-xl font-bold text-blue-900 mb-2">Universal Database Editor</h2>
        <p className="text-blue-700 text-sm mb-3">
          Complete database view for {allData.company?.name}. Click any editable field to modify it.
        </p>
        
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-blue-100 border border-blue-200 rounded"></div>
            <span>Numeric fields</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-green-100 border border-green-200 rounded"></div>
            <span>Text fields</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-purple-100 border border-purple-200 rounded"></div>
            <span>Boolean fields</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-orange-100 border border-orange-200 rounded"></div>
            <span>Date/Time fields</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-gray-100 border border-gray-200 rounded"></div>
            <span>Read-only fields</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-3 h-3 bg-amber-100 border border-amber-200 rounded"></div>
            <span>Manually edited</span>
          </div>
        </div>
      </div>

      {renderTable('companies', [allData.company], 'Company Information')}
      {renderTable('financial_reports', allData.financial_reports, 'Financial Reports')}
      {renderTable('cap_table_rounds', allData.cap_table_rounds, 'Cap Table Rounds')}
      {renderTable('cap_table_investors', allData.cap_table_investors, 'Cap Table Investors')}
      {renderTable('company_enrichments', allData.company_enrichments, 'Company Enrichments')}

      <div className="bg-gray-50 border rounded-lg p-4">
        <h3 className="font-medium text-gray-900 mb-2">Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Financial Reports:</span>
            <span className="ml-2 font-medium">{allData.summary?.financial_reports_count || 0}</span>
          </div>
          <div>
            <span className="text-gray-500">Cap Table Rounds:</span>
            <span className="ml-2 font-medium">{allData.summary?.cap_table_rounds_count || 0}</span>
          </div>
          <div>
            <span className="text-gray-500">Investors:</span>
            <span className="ml-2 font-medium">{allData.summary?.cap_table_investors_count || 0}</span>
          </div>
          <div>
            <span className="text-gray-500">Total Records:</span>
            <span className="ml-2 font-medium">
              {1 + (allData.summary?.financial_reports_count || 0) + 
               (allData.summary?.cap_table_rounds_count || 0) + 
               (allData.summary?.cap_table_investors_count || 0)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
} 