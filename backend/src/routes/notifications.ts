import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import {
  registerToken,
  unregisterToken,
  list,
  markRead,
  markAllRead,
} from '../controllers/notification';

export const notificationsRouter = Router();

// Totes les rutes requereixen autenticació (JWT al header Authorization).
notificationsRouter.use(authenticate);

// Tokens
notificationsRouter.post('/tokens', registerToken);
notificationsRouter.delete('/tokens/:token', unregisterToken);

// Historial / unread count
notificationsRouter.get('/', list);
notificationsRouter.patch('/read-all', markAllRead);
notificationsRouter.patch('/:id/read', markRead);
