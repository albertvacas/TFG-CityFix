import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import { create, getAll, revoke } from '../controllers/invite';

export const inviteRouter = Router();

// GET /api/invites — Llistar invitacions (només ADMIN)
inviteRouter.get('/', authenticate, authorize('ADMIN'), getAll);

// POST /api/invites — Crear invitació (només ADMIN)
inviteRouter.post('/', authenticate, authorize('ADMIN'), create);

// PATCH /api/invites/:id/revoke — Revocar invitació pendent (només ADMIN)
inviteRouter.patch('/:id/revoke', authenticate, authorize('ADMIN'), revoke);
