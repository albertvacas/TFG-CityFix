import { Response } from 'express';
import { AuthRequest } from '../types';
import { createInvite, getAllInvites } from '../services/invite';

/**
 * POST /api/invites — Crea una invitació per a un rol privilegiat.
 * Només accessible per ADMIN (protegit per middleware authorize).
 */
export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, role } = req.body;

    if (!email || !role) {
      res.status(400).json({ error: 'Els camps email i role són obligatoris' });
      return;
    }

    if (role !== 'ADMIN' && role !== 'TECHNICAL') {
      res.status(400).json({ error: 'Només es poden crear invitacions per a ADMIN o TECHNICAL' });
      return;
    }

    const invite = await createInvite(email, role);
    res.status(201).json({ invite });
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'Ja existeix una invitació per a aquest email' });
      return;
    }
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/invites — Llista totes les invitacions.
 * Només accessible per ADMIN.
 */
export const getAll = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const invites = await getAllInvites();
    res.json({ invites });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
