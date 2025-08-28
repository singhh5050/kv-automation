import { useState, useEffect, useCallback } from 'react'
import { analyzeCompanyKPIsAsync, getAnalysisJobStatus } from '@/lib/api'

export interface AnalysisJob {
  job_id: string
  company_id: number
  stage: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  results?: string
  error_message?: string
  reports_analyzed?: number
  started_at?: string
  completed_at?: string
  created_at?: string
}

export interface UseAsyncAnalysisReturn {
  currentJob: AnalysisJob | null
  isLoading: boolean
  error: string | null
  progress: number
  results: string | null
  startAnalysis: (companyId: number, stage: string) => Promise<void>
  clearJob: () => void
}

export function useAsyncAnalysis(): UseAsyncAnalysisReturn {
  const [currentJob, setCurrentJob] = useState<AnalysisJob | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null)

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
    }
  }, [pollingInterval])

  // Poll job status
  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      const result = await getAnalysisJobStatus(jobId)
      
      if (result.error) {
        setError(result.error)
        setIsLoading(false)
        if (pollingInterval) {
          clearInterval(pollingInterval)
          setPollingInterval(null)
        }
        return
      }

      if (result.data) {
        setCurrentJob(result.data)
        
        // Stop polling if job is completed or failed
        if (result.data.status === 'completed' || result.data.status === 'failed') {
          setIsLoading(false)
          if (pollingInterval) {
            clearInterval(pollingInterval)
            setPollingInterval(null)
          }
          
          if (result.data.status === 'failed') {
            setError(result.data.error_message || 'Analysis failed')
          }
        }
      }
    } catch (err) {
      console.error('Polling error:', err)
      setError(err instanceof Error ? err.message : 'Failed to check job status')
      setIsLoading(false)
      if (pollingInterval) {
        clearInterval(pollingInterval)
        setPollingInterval(null)
      }
    }
  }, [pollingInterval])

  // Start analysis
  const startAnalysis = useCallback(async (companyId: number, stage: string) => {
    setIsLoading(true)
    setError(null)
    setCurrentJob(null)

    try {
      console.log(`🚀 Starting async analysis for company ${companyId}, stage: ${stage}`)
      
      const result = await analyzeCompanyKPIsAsync(companyId, stage)
      
      if (result.error) {
        throw new Error(result.error)
      }

      if (result.data?.success && result.data?.job_id) {
        const jobData: AnalysisJob = {
          job_id: result.data.job_id,
          company_id: companyId,
          stage: stage,
          status: 'queued',
          progress: 0
        }
        
        setCurrentJob(jobData)
        
        // Start polling every 2 seconds
        const interval = setInterval(() => {
          pollJobStatus(result.data.job_id)
        }, 2000)
        
        setPollingInterval(interval)
        
        // Poll immediately for first status
        await pollJobStatus(result.data.job_id)
        
        console.log(`✅ Analysis job created: ${result.data.job_id}`)
      } else {
        throw new Error('Failed to create analysis job')
      }
      
    } catch (err) {
      console.error('❌ Failed to start analysis:', err)
      setError(err instanceof Error ? err.message : 'Failed to start analysis')
      setIsLoading(false)
    }
  }, [pollJobStatus])

  // Clear job
  const clearJob = useCallback(() => {
    setCurrentJob(null)
    setError(null)
    setIsLoading(false)
    if (pollingInterval) {
      clearInterval(pollingInterval)
      setPollingInterval(null)
    }
  }, [pollingInterval])

  return {
    currentJob,
    isLoading,
    error,
    progress: currentJob?.progress || 0,
    results: currentJob?.results || null,
    startAnalysis,
    clearJob
  }
}
