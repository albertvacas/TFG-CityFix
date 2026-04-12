import client from './client';
import type { State, Priority, Category } from '../types';

export interface DashboardData {
  stateCounts: {
    counts: Record<State, number>;
    total: number;
  };
  criticalHigh: {
    total: number;
    criticalHigh: number;
    percentage: number;
  };
  historyByCategory: {
    period: string;
    category: Category;
    count: number;
  }[];
  createdVsResolved: {
    period: string;
    created: number;
    resolved: number;
  }[];
  technicianWorkload: {
    technicianId: string;
    name: string;
    total: number;
    [state: string]: string | number; // dynamic state keys
  }[];
  resolutionTime: {
    priority: Priority;
    hoursToResolve: number;
  }[];
  categoryDistribution: {
    category: Category;
    count: number;
  }[];
  topReporters: {
    userId: string;
    name: string;
    nickname: string;
    points: number;
    reportCount: number;
  }[];
}

export const getDashboardData = async (
  granularity: 'day' | 'week' | 'month' = 'week',
  days = 90,
): Promise<DashboardData> => {
  const { data } = await client.get<DashboardData>('/analytics/dashboard', {
    params: { granularity, days },
  });
  return data;
};
