import client from './client';
import type { Report, IncidentEvent, State, Priority, Paginated } from '../types';

export interface ReportFilters {
  q?: string;
  state?: State;
  createdById?: string;
  assignedToId?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
}

const buildReportParams = (filters: ReportFilters): Record<string, string> => {
  const params: Record<string, string> = {};
  if (filters.q) params.q = filters.q;
  if (filters.state) params.state = filters.state;
  if (filters.createdById) params.createdById = filters.createdById;
  if (filters.assignedToId) params.assignedToId = filters.assignedToId;
  if (filters.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters.dateTo) params.dateTo = filters.dateTo;
  return params;
};

// Sense paginació: retorna totes les coincidències (per mapes, validacions,
// assignacions… on es necessita el conjunt complet filtrat per estat).
export const getReports = async (filters: ReportFilters = {}): Promise<Report[]> => {
  const { data } = await client.get<{ reports: Report[] }>('/reports', {
    params: buildReportParams(filters),
  });
  return data.reports;
};

// Amb paginació: per a la taula d'incidències de l'admin.
export const getReportsPaginated = async (
  filters: ReportFilters,
  page: number,
  pageSize: number,
): Promise<Paginated<Report>> => {
  const { data } = await client.get<{ reports: Report[]; total: number; page: number; pageSize: number }>(
    '/reports',
    { params: { ...buildReportParams(filters), page, pageSize } },
  );
  return { items: data.reports, total: data.total, page: data.page, pageSize: data.pageSize };
};

export const getReportById = async (id: string): Promise<Report> => {
  const { data } = await client.get<{ report: Report }>(`/reports/${id}`);
  return data.report;
};

export const transitionReport = async (
  id: string,
  event: IncidentEvent,
  assignedToId?: string,
  comment?: string,
): Promise<Report> => {
  const body: { event: IncidentEvent; assignedToId?: string; comment?: string } = { event };
  if (assignedToId) body.assignedToId = assignedToId;
  if (comment) body.comment = comment;
  const { data } = await client.patch<{ report: Report }>(`/reports/${id}/transition`, body);
  return data.report;
};

export const updateReportPriority = async (id: string, priority: Priority): Promise<Report> => {
  const { data } = await client.patch<{ report: Report }>(`/reports/${id}/priority`, { priority });
  return data.report;
};

export interface AutoAssignResult {
  assigned: Array<{
    reportId: string;
    reportTitle: string;
    technicianId: string;
    technicianName: string;
  }>;
  skipped: Array<{
    reportId: string;
    reportTitle: string;
    reason: string;
  }>;
}

export const autoAssignReports = async (reportIds: string[]): Promise<AutoAssignResult> => {
  const { data } = await client.post<AutoAssignResult>('/reports/auto-assign', { reportIds });
  return data;
};
