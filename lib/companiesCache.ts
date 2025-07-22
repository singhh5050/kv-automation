import { Company } from '@/types'

const CACHE_KEY = 'portfolio_companies_cache'
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes in milliseconds

interface CachedData {
  companies: Company[]
  timestamp: number
}

export const companiesCache = {
  set: (companies: Company[]) => {
    try {
      const cacheData: CachedData = {
        companies,
        timestamp: Date.now()
      }
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheData))
      console.log('📦 Companies cached:', companies.length, 'companies at', new Date().toLocaleTimeString())
    } catch (error) {
      console.warn('Failed to cache companies data:', error)
    }
  },

  get: (): Company[] | null => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY)
      if (!cached) {
        console.log('📦 No cache found')
        return null
      }

      const cacheData: CachedData = JSON.parse(cached)
      const now = Date.now()
      const age = now - cacheData.timestamp
      
      console.log('📦 Cache check:', {
        age: Math.round(age / 1000) + 's',
        maxAge: Math.round(CACHE_DURATION / 1000) + 's',
        expired: age > CACHE_DURATION,
        companies: cacheData.companies.length
      })
      
      // Check if cache is still valid (within 5 minutes)
      if (age > CACHE_DURATION) {
        console.log('📦 Cache expired, clearing')
        sessionStorage.removeItem(CACHE_KEY)
        return null
      }

      console.log('📦 Using cached data:', cacheData.companies.length, 'companies')
      return cacheData.companies
    } catch (error) {
      console.warn('Failed to read companies cache:', error)
      return null
    }
  },

  clear: () => {
    try {
      sessionStorage.removeItem(CACHE_KEY)
      console.log('📦 Cache cleared')
    } catch (error) {
      console.warn('Failed to clear companies cache:', error)
    }
  },

  isValid: (): boolean => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY)
      if (!cached) return false

      const cacheData: CachedData = JSON.parse(cached)
      const now = Date.now()
      const age = now - cacheData.timestamp
      
      return age <= CACHE_DURATION
    } catch (error) {
      return false
    }
  },

  getInfo: () => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY)
      if (!cached) return { exists: false }

      const cacheData: CachedData = JSON.parse(cached)
      const now = Date.now()
      const age = now - cacheData.timestamp
      
      return {
        exists: true,
        companies: cacheData.companies.length,
        ageSeconds: Math.round(age / 1000),
        maxAgeSeconds: Math.round(CACHE_DURATION / 1000),
        expired: age > CACHE_DURATION,
        cachedAt: new Date(cacheData.timestamp).toLocaleString()
      }
    } catch (error) {
      return { exists: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
} 