import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import * as analyticsController from '../controllers/analytics';

export const analyticsRouter = Router();

// GET /api/analytics/dashboard?granularity=week&days=90
analyticsRouter.get(
  '/dashboard',
  authenticate,
  authorize('ADMIN'),
  analyticsController.getDashboardData,
);

// GET /api/analytics/category-counts?from=YYYY-MM-DD&to=YYYY-MM-DD
analyticsRouter.get(
  '/category-counts',
  authenticate,
  authorize('ADMIN'),
  analyticsController.getCategoryCounts,
);
