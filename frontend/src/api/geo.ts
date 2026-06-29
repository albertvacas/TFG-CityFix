import client from './client';
import type { State, Category } from '../types';

interface GeoFilters {
  state?: State;
  category?: Category;
  days?: number;
}

export interface GeoJsonFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    title: string;
    state: string;
    priority: string;
    category: string | null;
    createdAt: string;
  };
}

export interface GeoJsonCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

export interface HeatmapPoint {
  lat: number;
  lng: number;
  weight: number;
}

export const getGeoJson = async (filters?: GeoFilters): Promise<GeoJsonCollection> => {
  const params: Record<string, string> = {};
  if (filters?.state) params.state = filters.state;
  if (filters?.category) params.category = filters.category;
  if (filters?.days) params.days = String(filters.days);

  const { data } = await client.get<GeoJsonCollection>('/geo/geojson', { params });
  return data;
};

export const getHeatmapData = async (
  weightBy: 'priority' | 'density' | 'age',
  filters?: GeoFilters,
): Promise<HeatmapPoint[]> => {
  const params: Record<string, string> = { weightBy };
  if (filters?.state) params.state = filters.state;
  if (filters?.category) params.category = filters.category;
  if (filters?.days) params.days = String(filters.days);

  const { data } = await client.get<{ points: HeatmapPoint[] }>('/geo/heatmap', { params });
  return data.points;
};
