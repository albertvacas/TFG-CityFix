import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import { geojson, heatmap } from '../controllers/geo';

export const geoRouter = Router();

// Totes les rutes GIS requereixen autenticació + rol ADMIN
geoRouter.use(authenticate, authorize('ADMIN'));

// GET /api/geo/geojson — Incidències en format GeoJSON
geoRouter.get('/geojson', geojson);

// GET /api/geo/heatmap — Dades per al mapa de calor
geoRouter.get('/heatmap', heatmap);
