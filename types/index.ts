export interface FinancialReport {
    id: string
    fileName: string
    reportDate: string
    reportPeriod: string
    sector: string
    cashOnHand: string
    monthlyBurnRate: string
    cashOutDate: string
    runway: string
    budgetVsActual: string
    financialSummary: string
    sectorHighlightA: string
    sectorHighlightB: string
    keyRisks: string
    personnelUpdates: string
    nextMilestones: string
    uploadDate: string
  }

  export interface CapTableInvestor {
    investor_name: string
    total_invested: number | null
    final_fds: number | null
    final_round_investment: number | null
  }

  export interface CapTableData {
    round_id: number
    round_name: string
    valuation: number | null
    amount_raised: number | null
    round_date: string | null
    total_pool_size: number | null
    pool_available: number | null
    investors: CapTableInvestor[]
  }

  // Helper function to calculate KV stake dynamically
  export const calculateKVStake = (investors: CapTableInvestor[]): number => {
    return investors
      .filter(investor => investor.investor_name.startsWith('KV'))
      .reduce((total, investor) => total + (investor.final_fds || 0), 0)
  }

  export interface Company {
    id: string
    name: string
    reports: FinancialReport[]
    latestReport: FinancialReport | null
    capTable?: CapTableData | null
  }

  export interface CompanyOverview {
    company: {
      id: number
      name: string
      normalized_name: string
      sector?: string
      created_at: string | null
      updated_at: string | null
    }
    current_cap_table: CapTableData | null
    financial_reports: FinancialReport[]
    summary: {
      has_cap_table: boolean
      financial_reports_count: number
      latest_financial_report: FinancialReport | null
    }
  } 