import { Response } from 'express';
import type { AuthRequest } from '../types';
import * as notificationService from '../services/notification';
import { isValidExpoPushToken } from '../services/expoPush';

/**
 * POST /api/notifications/tokens
 * Registra (o actualitza) un Expo Push Token per al dispositiu de l'usuari.
 * Crida típica des de l'app mòbil al iniciar sessió o al rebre permisos.
 */
export const registerToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token, platform } = req.body ?? {};

    if (typeof token !== 'string' || !isValidExpoPushToken(token)) {
      res.status(400).json({ error: 'Token Expo invàlid' });
      return;
    }
    if (platform !== 'ios' && platform !== 'android') {
      res.status(400).json({ error: 'platform ha de ser "ios" o "android"' });
      return;
    }

    await notificationService.registerPushToken({
      userId: req.user!.userId,
      token,
      platform,
    });

    res.status(204).end();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * DELETE /api/notifications/tokens/:token
 * Desactiva un token (per exemple al fer logout). No esborrem la fila per
 * conservar traça històrica.
 */
export const unregisterToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const token = req.params.token as string;
    await notificationService.unregisterPushToken(token);
    res.status(204).end();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/notifications
 * Retorna les últimes notificacions de l'usuari autenticat (historial in-app).
 * Query params:
 *   - unreadOnly=true → només les no llegides
 *   - limit=N         → limita el nombre (per defecte 50, màxim 100)
 */
export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit =
      typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;

    const [items, unread] = await Promise.all([
      notificationService.listNotifications(req.user!.userId, {
        unreadOnly,
        limit: Number.isFinite(limit) ? (limit as number) : undefined,
      }),
      notificationService.countUnreadNotifications(req.user!.userId),
    ]);

    res.json({ notifications: items, unreadCount: unread });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * PATCH /api/notifications/:id/read
 * Marca una notificació com a llegida.
 */
export const markRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await notificationService.markNotificationRead(
      req.params.id as string,
      req.user!.userId,
    );
    res.status(204).end();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * PATCH /api/notifications/read-all
 * Marca totes les no llegides com a llegides (botó "marcar totes").
 */
export const markAllRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await notificationService.markAllNotificationsRead(req.user!.userId);
    res.status(204).end();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
