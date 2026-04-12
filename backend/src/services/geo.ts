import { prisma } from '../config/db';
import { State, Category } from '../../generated/prisma';

interface GeoFilters {
  state?: State;
  category?: Category;
  daysAgo?: number;
}

interface GeoJsonFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    title: string;
    state: string;
    priority: string;
    category: string | null;
    createdBy: string;
    assignedTo: string | null;
    createdAt: string;
  };
}

interface GeoJsonCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

/**
 * Retorna les incidències en format GeoJSON FeatureCollection.
 * Compatible directament amb Leaflet i qualsevol client GIS.
 */
export const getReportsGeoJson = async (filters?: GeoFilters): Promise<GeoJsonCollection> => {
  const where: any = {};

  if (filters?.state) where.state = filters.state;
  if (filters?.category) where.category = filters.category;
  if (filters?.daysAgo) {
    const since = new Date();
    since.setDate(since.getDate() - filters.daysAgo);
    where.createdAt = { gte: since };
  }

  const reports = await prisma.report.findMany({
    where,
    include: {
      createdBy: { select: { name: true } },
      assignedTo: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const features: GeoJsonFeature[] = reports.map((r) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [r.longitude, r.latitude], // GeoJSON: [lng, lat]
    },
    properties: {
      id: r.report_id,
      title: r.title,
      state: r.state,
      priority: r.priority,
      category: r.category,
      createdBy: r.createdBy.name,
      assignedTo: r.assignedTo?.name ?? null,
      createdAt: r.createdAt.toISOString(),
    },
  }));

  return { type: 'FeatureCollection', features };
};

/**
 * Retorna dades optimitzades per al heatmap.
 * Cada punt porta un pes segons el criteri seleccionat.
 */
export const getHeatmapData = async (
  weightBy: 'priority' | 'density' | 'age',
  filters?: GeoFilters,
): Promise<{ lat: number; lng: number; weight: number }[]> => {
  const where: any = {};

  if (filters?.state) where.state = filters.state;
  if (filters?.category) where.category = filters.category;
  if (filters?.daysAgo) {
    const since = new Date();
    since.setDate(since.getDate() - filters.daysAgo);
    where.createdAt = { gte: since };
  }

  const reports = await prisma.report.findMany({
    where,
    select: { latitude: true, longitude: true, priority: true, createdAt: true },
  });

  const priorityWeights: Record<string, number> = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4,
  };

  const now = Date.now();

  return reports.map((r) => {
    let weight = 1;

    if (weightBy === 'priority') {
      weight = priorityWeights[r.priority] ?? 1;
    } else if (weightBy === 'age') {
      const daysOld = (now - r.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      weight = Math.min(Math.max(Math.ceil(daysOld / 7), 1), 10); // 1-10 per setmanes
    }
    // density: weight = 1 (per defecte)

    return { lat: r.latitude, lng: r.longitude, weight };
  });
};
