export interface FinancialReport {
    id: string
    fileName: string
    reportDate: string
    reportPeriod: string
    cashOnHand: string
    monthlyBurnRate: string
    cashOutDate: string
    runway: string
    budgetVsActual: string
    financialSummary: string
    clinicalProgress: string
    researchDevelopment: string
    uploadDate: string
  }
  
  export interface Company {
    id: string
    name: string
    reports: FinancialReport[]
    latestReport: FinancialReport
  } 