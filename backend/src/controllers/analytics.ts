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
