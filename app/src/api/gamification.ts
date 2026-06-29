import client from './client';
import type { LeaderboardEntry, PointsTransactionItem, UserRank } from '../types';

/**
 * Top N estudiants per punts. Accessible a qualsevol usuari autenticat.
 * Per defecte 10 entrades, suficient per al podi mòbil.
 */
export const getLeaderboard = async (limit = 10): Promise<LeaderboardEntry[]> => {
  const { data } = await client.get<{ leaderboard: LeaderboardEntry[] }>(
    '/gamification/leaderboard',
    { params: { limit } },
  );
  return data.leaderboard;
};

/**
 * Historial de punts + posició al rànquing de l'usuari autenticat.
 * `rank` és null si no és estudiant (admins/tècnics no acumulen).
 */
export const getMyPoints = async (): Promise<{
  history: PointsTransactionItem[];
  rank: UserRank | null;
}> => {
  const { data } = await client.get<{
    history: PointsTransactionItem[];
    rank: UserRank | null;
  }>('/gamification/me');
  return data;
};
