import { Response } from 'express';
import { AuthRequest } from '../types';
import { getReportsGeoJson, getHeatmapData } from '../services/geo';
import { State, Category } from '../../generated/prisma';

/**
 * GET /api/geo/geojson — Retorna incidències en format GeoJSON FeatureCollection.
 * Query params opcionals: state, category, days
 */
export const geojson = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const state = req.query.state as State | undefined;
    const category = req.query.category as Category | undefined;
    const days = req.query.days ? parseInt(req.query.days as string, 10) : undefined;

    const data = await getReportsGeoJson({ state, category, daysAgo: days });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/geo/heatmap — Retorna dades per al mapa de calor.
 * Query params: weightBy (priority|density|age), state, category, days
 */
export const heatmap = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const weightBy = (req.query.weightBy as string) || 'priority';
    if (!['priority', 'density', 'age'].includes(weightBy)) {
      res.status(400).json({ error: 'weightBy ha de ser: priority, density o age' });
      return;
    }

    const state = req.query.state as State | undefined;
    const category = req.query.category as Category | undefined;
    const days = req.query.days ? parseInt(req.query.days as string, 10) : undefined;

    const data = await getHeatmapData(
      weightBy as 'priority' | 'density' | 'age',
      { state, category, daysAgo: days },
    );
    res.json({ points: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
