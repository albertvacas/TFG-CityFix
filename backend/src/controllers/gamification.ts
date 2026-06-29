import { Response } from 'express';
import type { AuthRequest } from '../types';
import * as gamification from '../services/gamification';
import { parsePagination } from '../utils/pagination';

/**
 * GET /api/gamification/leaderboard?limit=10
 * Top N estudiants per punts (públic per a qualsevol usuari autenticat: tots
 * poden mirar el rànquing, no és informació sensible).
 */
export const getLeaderboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const limit =
      typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;

    const leaderboard = await gamification.getLeaderboard(
      Number.isFinite(limit) ? (limit as number) : undefined,
    );

    res.json({ leaderboard });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/gamification/me
 * Historial de punts + posició + total de l'usuari autenticat.
 * Pensat per al perfil mòbil de l'estudiant.
 */
export const getMyPoints = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const [history, rank] = await Promise.all([
      gamification.getUserPointsHistory(userId, 50),
      gamification.getUserRank(userId),
    ]);

    res.json({ history, rank });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/gamification/transactions?userId=<uuid>&limit=N
 * Historial complet — ADMIN ONLY. Filtrable per usuari concret per a
 * auditoria. La protecció per rol s'aplica al router amb authorize('ADMIN').
 */
export const getAllTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId =
      typeof req.query.userId === 'string' && req.query.userId.trim() !== ''
        ? req.query.userId
        : undefined;
    const { page, pageSize } = parsePagination(req.query, 25);

    const { transactions, total, totalAmount, uniqueUsers } =
      await gamification.getAllPointsTransactions({ userId, page, pageSize });

    res.json({ transactions, total, totalAmount, uniqueUsers, page, pageSize });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
