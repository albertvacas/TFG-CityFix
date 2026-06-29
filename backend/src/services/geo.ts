import { prisma } from '../config/db';
import { State, Category } from '../../generated/prisma/client';

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

  // Seleccionem només els camps que el mapa renderitza (marker + popup).
  // Evitem els JOINs amb createdBy/assignedTo: el mapa no els mostra, i
  // arrossegar-los multiplicava el cost de la consulta i la mida del payload.
  const reports = await prisma.report.findMany({
    where,
    select: {
      report_id: true,
      title: true,
      state: true,
      priority: true,
      category: true,
      latitude: true,
      longitude: true,
      createdAt: true,
    },
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

/**
 * Consulta espacial PostGIS (RNF-03): per a un punt objectiu i un conjunt de
 * tècnics, retorna la distància (en metres) de cada tècnic a la seva incidència
 * ACTIVA més propera. El càlcul es delega a PostGIS amb `ST_Distance` sobre la
 * columna `location` (geography 4326), accelerada per l'índex GiST
 * (002_location_gist_index.sql).
 *
 * A diferència del càlcul haversine en memòria, això aprofita la capacitat
 * geoespacial nativa de la base de dades i s'usa al desempat de l'auto-assignació.
 * Els tècnics sense cap incidència activa no apareixen al resultat (el cridant
 * els tracta com a distància infinita).
 */
export const getNearestActiveDistances = async (
  target: { lat: number; lng: number },
  techIds: string[],
): Promise<Map<string, number>> => {
  if (techIds.length === 0) return new Map();

  const rows: { tech: string; dist: number | null }[] = await prisma.$queryRaw`
    SELECT "assignedToId" AS tech,
           MIN(
             ST_Distance(
               location,
               ST_SetSRID(ST_MakePoint(${target.lng}, ${target.lat}), 4326)::geography
             )
           ) AS dist
    FROM reports
    WHERE "assignedToId" = ANY(${techIds}::text[])
      AND state IN ('ASSIGNED', 'IN_PROGRESS')
      AND location IS NOT NULL
    GROUP BY "assignedToId"
  `;

  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.dist !== null) map.set(r.tech, Number(r.dist));
  }
  return map;
};
