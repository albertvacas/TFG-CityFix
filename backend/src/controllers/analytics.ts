import { Response } from 'express';
import { AuthRequest } from '../types';
import * as analyticsService from '../services/analytics';

export const getDashboardData = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const granularity = (req.query.granularity as 'day' | 'week' | 'month') || 'week';
    const days = req.query.days ? Number(req.query.days) : 90;

    const [
      stateCounts,
      criticalHigh,
      historyByCategory,
      createdVsResolved,
      technicianWorkload,
      resolutionTime,
      categoryDistribution,
      topReporters,
    ] = await Promise.all([
      analyticsService.getStateCounts(),
      analyticsService.getCriticalHighPercentage(),
      analyticsService.getHistoryByCategory(granularity, days),
      analyticsService.getCreatedVsResolved(days),
      analyticsService.getTechnicianWorkload(),
      analyticsService.getResolutionTimeVsPriority(),
      analyticsService.getCategoryDistribution(),
      analyticsService.getTopReporters(),
    ]);

    res.json({
      stateCounts,
      criticalHigh,
      historyByCategory,
      createdVsResolved,
      technicianWorkload,
      resolutionTime,
      categoryDistribution,
      topReporters,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// GET /api/analytics/category-counts?from=YYYY-MM-DD&to=YYYY-MM-DD
export const getCategoryCounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const fromStr = req.query.from as string | undefined;
    const toStr = req.query.to as string | undefined;
    if (!fromStr || !toStr) {
      res.status(400).json({ error: 'Els paràmetres "from" i "to" són obligatoris' });
      return;
    }
    // Interpretem el rang com a dies complets en hora local del servidor.
    const from = new Date(`${fromStr}T00:00:00`);
    const to = new Date(`${toStr}T23:59:59.999`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.status(400).json({ error: 'Dates invàlides' });
      return;
    }

    const categoryCounts = await analyticsService.getCategoryCountsInRange(from, to);
    res.json({ categoryCounts });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
