// Shared stage detection logic for KV fund classification
// Based on user requirements: Growth > Main > Early priority

export type CompanyStage = 'Growth Stage' | 'Main Stage' | 'Early Stage' | 'Unknown'

export interface Investor {
  investor_name: string
}

/**
 * Detects company stage based on KV fund names
 * Priority order: Growth Stage > Main Stage > Early Stage
 * 
 * Growth Stage: KV Opp or KV Excelsior funds
 * Main Stage: KV Roman numeral funds (KV I, KV II, KV III, etc.)
 * Early Stage: Any KV fund with "seed" in the name
 */
export function detectCompanyStage(investors: Investor[] | undefined): CompanyStage {
  if (!Array.isArray(investors) || investors.length === 0) {
    return 'Unknown'
  }

  const kvInvestors = investors.filter(inv => 
    typeof inv.investor_name === 'string' && inv.investor_name.startsWith('KV')
  )
  
  if (kvInvestors.length === 0) {
    return 'Unknown'
  }

  let hasGrowthStage = false
  let hasMainStage = false
  let hasEarlyStage = false

  for (const investor of kvInvestors) {
    const name = String(investor.investor_name || '').toLowerCase()
    
    // Check for KV Opp or KV Excelsior (Growth Stage) - highest priority
    if (name.includes('opp') || name.includes('excelsior')) {
      hasGrowthStage = true
      continue
    }
    
    // Check for any fund with "seed" in the name (Early Stage) - lowest priority
    if (name.includes('seed')) {
      hasEarlyStage = true
      continue
    }
    
    // Check for KV [Roman Numeral] (Main Stage) - but not if it contains "opp", "excelsior", or "seed"
    if (!name.includes('opp') && !name.includes('excelsior') && !name.includes('seed')) {
      const romanNumeralPattern = /kv\s+(i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3}|xiv|xv)(\s|$)/i
      if (romanNumeralPattern.test(name)) {
        hasMainStage = true
      }
    }
  }

  // Return the highest stage found (Growth > Main > Early)
  if (hasGrowthStage) return 'Growth Stage'
  if (hasMainStage) return 'Main Stage'
  if (hasEarlyStage) return 'Early Stage'
  
  return 'Unknown'
}
