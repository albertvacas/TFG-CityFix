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

export interface CategoryCount {
  category: Category;
  count: number;
}

// Recompte d'incidències per categoria en un rang de dates [from, to] (inclosos),
// en format 'YYYY-MM-DD'. Per a un sol dia, passa from === to.
export const getCategoryCounts = async (
  from: string,
  to: string,
): Promise<CategoryCount[]> => {
  const { data } = await client.get<{ categoryCounts: CategoryCount[] }>(
    '/analytics/category-counts',
    { params: { from, to } },
  );
  return data.categoryCounts;
};
