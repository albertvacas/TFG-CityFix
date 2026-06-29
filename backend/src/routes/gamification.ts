import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import {
  getLeaderboard,
  getMyPoints,
  getAllTransactions,
} from '../controllers/gamification';

export const gamificationRouter = Router();

// Totes les rutes requereixen JWT vàlid.
gamificationRouter.use(authenticate);

// Públiques per a qualsevol usuari autenticat
gamificationRouter.get('/leaderboard', getLeaderboard);
gamificationRouter.get('/me', getMyPoints);

// Només ADMIN: historial complet d'auditoria
gamificationRouter.get('/transactions', authorize('ADMIN'), getAllTransactions);
