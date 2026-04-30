import client from './client';
import type {
  IncidentEvent,
  Report,
  ReportCategory,
  ReportComment,
  ReportImage,
  ReportState,
} from '../types';

export type { IncidentEvent } from '../types';

export interface ReportFilters {
  state?: ReportState;
}

export const getAllReports = async (filters?: ReportFilters): Promise<Report[]> => {
  const params: Record<string, string> = {};
  if (filters?.state) params.state = filters.state;
  const { data } = await client.get<{ reports: Report[] }>('/reports', { params });
  return data.reports;
};

export const getReportById = async (id: string): Promise<Report> => {
  const { data } = await client.get<{ report: Report }>(`/reports/${id}`);
  return data.report;
};

export interface CreateReportPayload {
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  category?: ReportCategory;
}

export const createReport = async (payload: CreateReportPayload): Promise<Report> => {
  const { data } = await client.post<{ report: Report }>('/reports', payload);
  return data.report;
};

export interface TransitionPayload {
  event: IncidentEvent;
  assignedToId?: string;
  comment?: string;
}

export const transitionReport = async (
  id: string,
  payload: TransitionPayload,
): Promise<Report> => {
  const { data } = await client.patch<{ report: Report }>(
    `/reports/${id}/transition`,
    payload,
  );
  return data.report;
};

export type ImageType = 'INITIAL' | 'RESOLUTION' | 'PROGRESS';

/**
 * Puja una imatge capturada amb expo-image-picker (té un URI local file://)
 * al backend, que la guardarà a Supabase Storage i crearà la fila Image.
 */
export const uploadReportImage = async (
  reportId: string,
  imageUri: string,
  type: ImageType,
): Promise<ReportImage> => {
  const filename = imageUri.split('/').pop() ?? `photo-${Date.now()}.jpg`;
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimetype =
    ext === 'png'
      ? 'image/png'
      : ext === 'webp'
      ? 'image/webp'
      : ext === 'heic' || ext === 'heif'
      ? 'image/heic'
      : 'image/jpeg';

  const form = new FormData();
  // React Native serialitza objectes amb { uri, name, type } com a fitxer multipart.
  form.append('image', {
    uri: imageUri,
    name: filename,
    type: mimetype,
  } as any);
  form.append('type', type);

  const { data } = await client.post<{ image: ReportImage }>(
    `/reports/${reportId}/images`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      transformRequest: (d) => d,
      timeout: 30000,
    },
  );
  return data.image;
};

/**
 * Crea un comentari de discussió (no lligat a cap transició).
 * El backend autoritza només l'autor del report, el tècnic assignat o un admin.
 */
export const addComment = async (
  reportId: string,
  content: string,
): Promise<ReportComment> => {
  const { data } = await client.post<{ comment: ReportComment }>(
    `/reports/${reportId}/comments`,
    { content },
  );
  return data.comment;
};