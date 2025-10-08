/**
 * Thin API client for AWS Lambda + Next API
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
if (!BACKEND_URL) throw new Error('NEXT_PUBLIC_BACKEND_URL environment variable is not set');

interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  metadata?: any;
}

const JSON_HDR = { 'Content-Type': 'application/json' as const };

const withJson = (body?: any, headers?: HeadersInit) => ({
  headers: { ...JSON_HDR, ...headers },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    // Use relative URLs for Next.js API routes (paths starting with /api)
    // Use BACKEND_URL for external API calls (paths not starting with /api)
    const url = path.startsWith('/api') ? path : `${BACKEND_URL}${path}`;
    
    const res = await fetch(url, {
      ...options,
      headers: { ...JSON_HDR, ...options.headers },
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(json?.error || `HTTP error! status: ${res.status}`);

    // Preserve original behavior: always wrap as { data: json }
    return { data: json };
  } catch (e: any) {
    console.error('API request error:', e);
    return { error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// Convenience helpers
const post = <T = any>(path: string, body?: any, headers?: HeadersInit) =>
  apiRequest<T>(path, { method: 'POST', ...withJson(body, headers) });

const op = <T = any>(operation: string, args?: Record<string, any>) => {
  const payload = { operation, ...(args || {}) };
  console.log('🔶 API.op:', operation, payload);
  return post<T>('/financial', payload);
};

/** ---------------- Core features ---------------- */

export async function extractPdf(pdfData: string, filename: string, companyName?: string) {
  const body: any = { pdf_data: pdfData, filename };
  if (companyName) Object.assign(body, { company_name_override: companyName, user_provided_name: true });
  return post('/analyze-pdf', body);
}

export async function uploadFile(file: File, companyName?: string) {
  try {
    const base64 = await fileToBase64(file);
    const clean = base64.replace(/^data:application\/pdf;base64,/, '');
    return await extractPdf(clean, file.name, companyName);
  } catch (e: any) {
    console.error('File upload error:', e);
    return { error: e instanceof Error ? e.message : 'File upload failed' };
  }
}

/** Direct S3 upload via presigned URL (Next API -> S3) */
export async function uploadToS3(file: File, companyId?: number, companyName?: string) {
  try {
    console.log(`🚀 Direct S3 upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    console.log(`📋 Company ID: ${companyId}, Company Name: ${companyName}`);

    const presignRes = await fetch('/api/presign-s3', {
      method: 'POST',
      ...withJson({
        fileName: file.name,
        fileType: file.type || 'application/pdf',
        companyId,
        companyName,
      }),
    });

    if (!presignRes.ok) {
      const err = await presignRes.json().catch(() => ({}));
      throw new Error(err.error || `Failed to get presigned URL: ${presignRes.status}`);
    }

    const presignData = await presignRes.json();
    console.log(`✅ Presigned URL obtained for key: ${presignData.s3Key}`);

    const up = await fetch(presignData.presignedUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/pdf' },
    });

    if (!up.ok) {
      let msg = `S3 upload failed (${up.status})`;
      try { msg += `: ${(await up.text()).slice(0, 200)}`; } catch {}
      throw new Error(msg);
    }

    const etag = up.headers.get('ETag');
    console.log('✅ Direct S3 upload successful!', '🆔 ETag:', etag);

    return {
      data: {
        success: true,
        s3Key: presignData.s3Key,
        bucket: presignData.bucket,
        message: 'PDF uploaded successfully to S3. Processing will begin automatically.',
        processingNote: 'Results will appear in the database shortly.',
        etag,
        uploadMethod: 'direct-s3',
      },
    };
  } catch (e: any) {
    console.error('❌ Direct S3 upload error:', e, 'type:', e?.constructor?.name);
    return {
      error: e instanceof Error ? e.message : 'S3 upload failed',
      fallbackSuggestion: 'Try refreshing and uploading again. Contact support if the issue persists.',
      errorDetails: e,
    };
  }
}

/** Utilities */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** ---------------- Financial ops ---------------- */

export const saveFinancialReport = (reportData: any) =>
  op('save_financial_report', reportData);

export const getCompanies = () => op('get_companies');

export const getPortfolioSummary = () => op('get_portfolio_summary');

export const getCompanyReports = (companyId: string) =>
  op('get_company_reports', { company_id: companyId });

export const getCompanyByName = (companyName: string) =>
  op('get_company_by_name', { company_name: companyName });

export async function createOrGetCompany(companyName: string): Promise<{ companyId: number; companyName: string; error?: string }> {
  try {
    const existing = await getCompanyByName(companyName);
    if (existing.data?.data?.found !== false) {
      return { companyId: existing.data.data.id, companyName: existing.data.data.name };
    }
    const dummy = {
      companyName,
      reportDate: new Date().toISOString().split('T')[0],
      reportPeriod: 'Placeholder',
      filename: '_company_creation_placeholder.pdf',
      sector: 'healthcare',
      cashOnHand: null,
      monthlyBurnRate: null,
      cashOutDate: null,
      runway: null,
      budgetVsActual: 'Company created via upload interface',
      financialSummary: 'Company created via upload interface - no financial data available',
      sectorHighlightA: 'N/A',
      sectorHighlightB: 'N/A',
      keyRisks: 'N/A',
      personnelUpdates: 'N/A',
      nextMilestones: 'N/A',
      user_provided_name: true,
    };
    const created = await saveFinancialReport(dummy);
    if (created.error) return { companyId: 0, companyName: '', error: created.error };

    const fetched = await getCompanyByName(companyName);
    if (fetched.data?.data?.id) {
      return { companyId: fetched.data.data.id, companyName: fetched.data.data.name };
    }
    return { companyId: 0, companyName: '', error: 'Failed to create company' };
  } catch (e: any) {
    console.error('Error creating/getting company:', e);
    return { companyId: 0, companyName: '', error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export const createDatabaseSchema = () => post('/schema');

export const testDatabaseConnection = () => op('test_connection');

export async function healthCheck() {
  try {
    // Use BACKEND_URL for external health check endpoint (not a Next.js API route)
    const res = await fetch(`${BACKEND_URL}/test`, { method: 'POST', headers: JSON_HDR });
    return res.ok;
  } catch {
    return false;
  }
}

export const saveCapTableRound = (capTableData: any) =>
  op('save_cap_table_round', capTableData);

export const getCompanyOverview = (companyId: string) =>
  op('get_company_overview', { company_id: companyId });

export function processCapTableXlsx(xlsxData: { xlsx_data: string; filename: string }, companyName?: string) {
  const body: any = { operation: 'process_cap_table_xlsx', ...xlsxData };
  if (companyName) Object.assign(body, { company_name_override: companyName, user_provided_name: true });
  return post('/process-cap-table', body);
}

export const getCompetitiveLandscape = (_financialData: any) =>
  ({ error: 'Competitive landscape analysis not yet implemented in Lambda backend' });

/** ---------------- KPI / Files ---------------- */

export async function listCompanyPDFs(companyId: number) {
  try {
    console.log(`📁 Listing PDF files for company ${companyId}`);
    console.log(`🔍 Making request to: /api/analyze-kpis (relative URL)`);
    console.log(`🔍 Request payload:`, { action: 'list_pdfs', company_id: companyId });
    
    const { data, error } = await post('/api/analyze-kpis', { action: 'list_pdfs', company_id: companyId });
    
    console.log(`🔍 API response - data:`, data);
    console.log(`🔍 API response - error:`, error);
    
    if (error) return { success: false, files: [], error };

    const files = data?.files ?? data?.data?.files ?? [];
    const success = data?.success ?? data?.data?.success ?? data?.status === 'success';
    console.log(`✅ Retrieved ${files.length} PDF files`);
    console.log(`🔍 Final files array:`, files);
    return { success, files, error: data?.error ?? data?.data?.error };
  } catch (e: any) {
    console.error('❌ Failed to list company PDFs:', e);
    return { success: false, files: [], error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

export async function analyzeCompanyKPIs(companyId: number, stage: string) {
  try {
    console.log(`🔍 KPI analysis (sync) for company ${companyId}, stage: ${stage}`);
    const res = await fetch('/api/analyze-kpis', { method: 'POST', ...withJson({ company_id: companyId, stage }) });
    if (!res.ok) throw new Error((await res.json()).error || `KPI analysis failed: ${res.status}`);
    return { data: await res.json() };
  } catch (e: any) {
    console.error('❌ KPI analysis error:', e);
    return { error: e instanceof Error ? e.message : 'KPI analysis failed' };
  }
}

export async function analyzeCompanyKPIsAsync(companyId: number, stage: string, customConfig?: any) {
  try {
    console.log(`🚀 KPI analysis (async) for company ${companyId}, stage: ${stage}`, customConfig ? '(custom)' : '(standard)');
    const res = await fetch('/api/analyze-kpis-async', {
      method: 'POST',
      ...withJson({ company_id: companyId, stage, ...(customConfig ? { custom_config: customConfig } : {}) }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `Async KPI analysis failed: ${res.status}`);
    const json = await res.json();
    console.log(`✅ Async job created: ${json.job_id}`);
    return { data: json };
  } catch (e: any) {
    console.error('❌ Async KPI analysis error:', e);
    return { error: e instanceof Error ? e.message : 'Async KPI analysis failed' };
  }
}

export async function getAnalysisJobStatus(jobId: string) {
  try {
    const res = await fetch(`/api/job-status/${jobId}`, { method: 'GET', headers: JSON_HDR });
    if (!res.ok) throw new Error((await res.json()).error || `Failed to get job status: ${res.status}`);
    return { data: await res.json() };
  } catch (e: any) {
    console.error('❌ Job status error:', e);
    return { error: e instanceof Error ? e.message : 'Failed to get job status' };
  }
}

/** ---------------- Updates ---------------- */

export const updateFinancialMetrics = (reportId: number, updates: Record<string, any>) =>
  op('update_financial_metrics', { report_id: reportId, updates });

export const updateCompany = (companyId: number, updates: Record<string, any>) =>
  op('update_company', { company_id: companyId, updates });

export const updateCapTableRound = (roundId: number, updates: Record<string, any>) =>
  op('update_cap_table_round', { round_id: roundId, updates });

export const updateCapTableInvestor = (investorId: number, updates: Record<string, any>) =>
  op('update_cap_table_investor', { investor_id: investorId, updates });

export const getAllCompanyData = (companyId: string) =>
  op('get_all_company_data', { company_id: companyId });

/** ---------------- Enrichment ---------------- */

export const enrichCompany = (companyId: string, identifier: { key: string; value: string }) =>
  post('/harmonic-enrichment', { company_id: companyId, [identifier.key]: identifier.value });

export const getCompanyEnrichment = (companyId: string) =>
  op('get_company_enrichment', { company_id: companyId });

export const enrichPerson = (personUrn: string) =>
  post('/harmonic-enrichment', { operation: 'enrich_person', person_urn: personUrn });

export const saveCompanyManualOverride = (companyId: string, fieldName: string, fieldValue: string) => {
  console.log('🔷 API.saveCompanyManualOverride:', { companyId, fieldName, fieldValue });
  return op('save_company_manual_override', { company_id: companyId, field_name: fieldName, field_value: fieldValue });
};

export const deleteCompanyManualOverride = (companyId: string, fieldName: string) =>
  op('delete_company_manual_override', { company_id: companyId, field_name: fieldName });

/** ---------------- Executives (New Simplified System) ---------------- */

export const getCompanyExecutives = (companyId: string) =>
  op('get_company_executives', { company_id: companyId });

export const saveCompanyExecutive = (data: {
  company_id: string;
  id?: number;
  full_name?: string;
  title?: string;
  linkedin_url?: string;
  display_order?: number;
  is_ceo?: boolean;
}) => op('save_company_executive', data);

export const deleteCompanyExecutive = (executiveId: number) =>
  op('delete_company_executive', { executive_id: executiveId });

/** ---------------- Deletions / names ---------------- */

export const deleteCompany = (companyId: string) =>
  op('delete_company', { company_id: companyId });

export const getCompanyNames = () => op('get_company_names');

/** ---------------- Notes ---------------- */

export const getCompanyNotes = (companyId: string) =>
  op('get_company_notes', { company_id: companyId });

export const createCompanyNote = (companyId: string, noteData: { subject: string; content: string }) =>
  op('create_company_note', { company_id: companyId, ...noteData });

export const updateCompanyNote = (noteId: number, updates: { subject?: string; content?: string }) =>
  op('update_company_note', { note_id: noteId, updates });

export const deleteCompanyNote = (noteId: number) =>
  op('delete_company_note', { note_id: noteId });

/** ---------------- Reports ---------------- */

export async function deleteFinancialReport(reportId: number) {
  try {
    console.log(`🗑️ Deleting financial report ${reportId}`);
    const res = await fetch('/api/delete-financial-report', { method: 'POST', ...withJson({ reportId }) });
    if (!res.ok) throw new Error((await res.json()).error || `Delete failed: ${res.status}`);
    return await res.json();
  } catch (e: any) {
    console.error('❌ Delete financial report error:', e);
    return { error: e instanceof Error ? e.message : 'Delete failed' };
  }
}

/** ---------------- KPI cache / latest ---------------- */

export const getCompanyKpiAnalysis = (companyId: number) =>
  op('get_company_kpi_analysis', { company_id: companyId });

export const getLatestAsyncKpiAnalysis = (companyId: number) =>
  post('/api/job-status/latest', { company_id: companyId });

/** ---------------- Health checks ---------------- */

export async function runHealthCheck(companyId: number, criticality_level?: number, manual_score?: 'GREEN' | 'YELLOW' | 'RED') {
  try {
    const res = await fetch('/api/health-check', { method: 'POST', ...withJson({ company_id: companyId, criticality_level, manual_score }) });
    if (!res.ok) throw new Error((await res.json()).error || `Health check failed: ${res.status}`);
    return await res.json();
  } catch (e: any) {
    console.error('❌ Health check error:', e);
    return { error: e instanceof Error ? e.message : 'Health check failed' };
  }
}

export async function getLatestHealthCheck(companyId: number) {
  try {
    const res = await fetch('/api/get-health-check', { method: 'POST', ...withJson({ company_id: companyId }) });
    if (!res.ok) throw new Error((await res.json()).error || `Get health check failed: ${res.status}`);
    return await res.json();
  } catch (e: any) {
    console.error('❌ Get health check error:', e);
    return { error: e instanceof Error ? e.message : 'Get health check failed' };
  }
}

/** ---------------- Milestones ---------------- */

export async function getMilestones(companyId?: number) {
  try {
    const url = companyId ? `/api/milestones?company_id=${companyId}` : '/api/milestones';
    const res = await fetch(url, { method: 'GET', headers: JSON_HDR });
    if (!res.ok) throw new Error((await res.json()).error || `Get milestones failed: ${res.status}`);
    const data = await res.json();
    return { data };
  } catch (e: any) {
    console.error('❌ Get milestones error:', e);
    return { error: e instanceof Error ? e.message : 'Get milestones failed' };
  }
}

export const createMilestone = (data: {
  company_id: number;
  milestone_date: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  financial_report_id?: number;
}) => op('create_milestone', data);

export const updateMilestone = (data: {
  milestone_id: number;
  milestone_date?: string;
  description?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
}) => op('update_milestone', data);

export const deleteMilestone = (milestoneId: number) =>
  op('delete_milestone', { milestone_id: milestoneId });

export const markMilestoneCompleted = (milestoneId: number, completed: boolean) =>
  op('mark_milestone_completed', { milestone_id: milestoneId, completed });
