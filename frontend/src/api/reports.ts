import client from './client';
import type { Report, IncidentEvent, State } from '../types';

export const getReports = async (state?: State): Promise<Report[]> => {
  const params = state ? { state } : {};
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
