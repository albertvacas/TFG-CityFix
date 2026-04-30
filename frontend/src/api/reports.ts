import client from './client';
import type { Report, IncidentEvent, State } from '../types';

export interface ReportFilters {
  q?: string;
  state?: State;
  createdById?: string;
  assignedToId?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
}

export const getReports = async (filters: ReportFilters = {}): Promise<Report[]> => {
  const params: Record<string, string> = {};
  if (filters.q) params.q = filters.q;
  if (filters.state) params.state = filters.state;
  if (filters.createdById) params.createdById = filters.createdById;
  if (filters.assignedToId) params.assignedToId = filters.assignedToId;
  if (filters.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters.dateTo) params.dateTo = filters.dateTo;
  const { data } = await client.get<{ reports: Report[] }>('/reports', { params });
  return data.reports;
};

export const getReportById = async (id: string): Promise<Report> => {
  const { data } = await client.get<{ report: Report }>(`/reports/${id}`);
  return data.report;
};

export const transitionReport = async (
  id: string,
  event: IncidentEvent,
  assignedToId?: string,
): Promise<Report> => {
  const body: { event: IncidentEvent; assignedToId?: string } = { event };
  if (assignedToId) body.assignedToId = assignedToId;
  const { data } = await client.patch<{ report: Report }>(`/reports/${id}/transition`, body);
  return data.report;
};
