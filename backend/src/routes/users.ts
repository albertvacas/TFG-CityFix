import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import { getProfile, getAllTechnicians, getPrivileged, revoke } from '../controllers/user';

export const userRouter = Router();

// Totes les rutes d'users requereixen autenticació
userRouter.use(authenticate);

// GET /api/users/profile — Perfil de l'usuari autenticat
userRouter.get('/profile', getProfile);

// GET /api/users/technicians — Llistar tècnics actius (només ADMIN)
userRouter.get('/technicians', authorize('ADMIN'), getAllTechnicians);

// GET /api/users/privileged — Llistar ADMIN + TECHNICAL (només ADMIN)
userRouter.get('/privileged', authorize('ADMIN'), getPrivileged);

// PATCH /api/users/:id/revoke — Revocar accés d'un usuari (només ADMIN)
userRouter.patch('/:id/revoke', authorize('ADMIN'), revoke);
