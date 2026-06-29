import client from './client';
import type { LeaderboardEntry, PointsTransaction, Paginated } from '../types';

export const getLeaderboard = async (limit = 10): Promise<LeaderboardEntry[]> => {
  const { data } = await client.get<{ leaderboard: LeaderboardEntry[] }>(
    '/gamification/leaderboard',
    { params: { limit } },
  );
  return data.leaderboard;
};

export interface PointsTransactionsPage extends Paginated<PointsTransaction> {
  totalAmount: number;
  uniqueUsers: number;
}

export const getAllPointsTransactions = async (params?: {
  userId?: string;
  page?: number;
  pageSize?: number;
}): Promise<PointsTransactionsPage> => {
  const { data } = await client.get<{
    transactions: PointsTransaction[];
    total: number;
    totalAmount: number;
    uniqueUsers: number;
    page: number;
    pageSize: number;
  }>('/gamification/transactions', { params });
  return {
    items: data.transactions,
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
    totalAmount: data.totalAmount,
    uniqueUsers: data.uniqueUsers,
  };
};
