import { Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../types';
import { revokeUser, getPrivilegedUsers } from '../services/user';

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { user_id: req.user!.userId },
      select: {
        user_id: true,
        email: true,
        name: true,
        surname: true,
        nickname: true,
        role: true,
        active: true,
        points: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'Usuari no trobat' });
      return;
    }
    res.json({ user });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getAllTechnicians = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const technicians = await prisma.user.findMany({
      where: { role: 'TECHNICAL', active: true },
      select: {
        user_id: true,
        name: true,
        surname: true,
        nickname: true,
        points: true,
      },
    });
    res.json({ technicians });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/users/privileged — Llista tots els ADMIN i TECHNICAL.
 * Només accessible per ADMIN.
 */
export const getPrivileged = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await getPrivilegedUsers();
    res.json({ users });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * PATCH /api/users/:id/revoke — Revoca l'accés d'un usuari.
 * Només accessible per ADMIN. Protegit per regles de negoci (root + últim admin).
 */
export const revoke = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await revokeUser(req.params.id as string);
    res.json({ user });
  } catch (error: any) {
    if (error.message.includes('root') || error.message.includes('últim')) {
      res.status(403).json({ error: error.message });
      return;
    }
    if (error.message.includes('no trobat')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error.message });
  }
};
