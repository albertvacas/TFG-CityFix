import { Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../types';
import { revokeUser, getPrivilegedUsers, updateOwnProfile } from '../services/user';
import { Category } from '../../generated/prisma';

const VALID_CATEGORIES: Category[] = [
  'LIGHTING',
  'URBAN_FURNITURE',
  'PAVEMENT',
  'CLEANING',
  'GREEN_AREAS',
  'SIGNAGE',
  'ACCESSIBILITY',
  'TECHNOLOGY',
  'OTHER',
];

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
        position: true,
        workCategory: true,
        company: true,
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

/**
 * PATCH /api/users/profile — Actualitza el perfil propi.
 * Per al mòbil: el tècnic pot modificar position/company/workCategory; tots els
 * usuaris poden modificar name/surname. Camps no enviats es deixen com estan.
 */
export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, surname, position, company, workCategory } = req.body ?? {};

    if (workCategory !== undefined && workCategory !== null && !VALID_CATEGORIES.includes(workCategory)) {
      res.status(400).json({ error: `workCategory invàlida. Vàlides: ${VALID_CATEGORIES.join(', ')}` });
      return;
    }

    const user = await updateOwnProfile(req.user!.userId, {
      name,
      surname,
      position,
      company,
      workCategory,
    });
    res.json({ user });
  } catch (error: any) {
    if (error.message?.includes('no trobat')) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error.message?.includes('buit') || error.message?.includes('buits')) {
      res.status(400).json({ error: error.message });
      return;
    }
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
        position: true,
        workCategory: true,
        company: true,
        // Càrrega actual: comptem tasques assignades en estat ASSIGNED o IN_PROGRESS
        _count: {
          select: {
            reportsAssigned: { where: { state: { in: ['ASSIGNED', 'IN_PROGRESS'] } } },
          },
        },
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
 * GET /api/users/students — Llista tots els estudiants actius.
 * Pensat per al filtre "creador" del llistat d'incidències al panel admin.
 */
export const getAllStudents = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT', active: true },
      select: { user_id: true, name: true, surname: true, nickname: true },
      orderBy: { name: 'asc' },
    });
    res.json({ students });
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
