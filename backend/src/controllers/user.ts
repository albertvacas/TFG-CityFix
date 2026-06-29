import { Response } from 'express';
import { prisma } from '../config/db';
import { AuthRequest } from '../types';
import {
  revokeUser,
  getPrivilegedUsers,
  updateOwnProfile,
  searchUsers,
  setUserActive,
  deleteUser,
  updateAvatar,
} from '../services/user';
import { Category } from '../../generated/prisma/client';
import { parsePagination } from '../utils/pagination';

const ACCEPTED_AVATAR_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

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
        avatarUrl: true,
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

/**
 * GET /api/users/technicians/:id — Detall complet d'un tècnic + stats de càrrega
 * per estat. Pensat per al desplegable del detall d'incidència al panell admin.
 */
export const getTechnicianById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const technician = await prisma.user.findFirst({
      where: { user_id: id, role: 'TECHNICAL' },
      select: {
        user_id: true,
        email: true,
        name: true,
        surname: true,
        nickname: true,
        active: true,
        avatarUrl: true,
        position: true,
        workCategory: true,
        company: true,
        createdAt: true,
      },
    });

    if (!technician) {
      res.status(404).json({ error: 'Tècnic no trobat' });
      return;
    }

    const counts = await prisma.report.groupBy({
      by: ['state'],
      where: { assignedToId: id },
      _count: { _all: true },
    });

    const stats = { assigned: 0, inProgress: 0, validated: 0, closed: 0, total: 0 };
    for (const row of counts) {
      const n = row._count._all;
      stats.total += n;
      if (row.state === 'ASSIGNED') stats.assigned = n;
      else if (row.state === 'IN_PROGRESS') stats.inProgress = n;
      else if (row.state === 'VALIDATED') stats.validated = n;
      else if (row.state === 'CLOSED') stats.closed = n;
    }

    res.json({ technician: { ...technician, stats } });
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
        avatarUrl: true,
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
export const getPrivileged = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const { users, total } = await getPrivilegedUsers({ page, pageSize });
    res.json({ users, total, page, pageSize });
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
      select: { user_id: true, name: true, surname: true, nickname: true, avatarUrl: true },
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

/**
 * PATCH /api/users/:id/active — Bloqueja (active=false) o reactiva (active=true)
 * un compte de qualsevol rol. Només ADMIN. Protegit per regles (root + últim admin).
 */
export const setActive = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { active } = req.body ?? {};
    if (typeof active !== 'boolean') {
      res.status(400).json({ error: 'El camp "active" és obligatori i ha de ser booleà' });
      return;
    }
    const user = await setUserActive(req.params.id as string, active);
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

/**
 * DELETE /api/users/:id — Elimina (anonimitza) un compte. Només ADMIN.
 * Conserva l'històric d'incidències; invalida credencials i desactiva el compte.
 */
export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await deleteUser(req.params.id as string);
    res.json(result);
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

/**
 * GET /api/users/search?q= — Cerca d'usuaris (STUDENT/TECHNICAL) per nom,
 * cognoms o nickname. Accessible per a qualsevol usuari autenticat.
 */
export const search = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    // Només els admins poden veure comptes inactius (per a la gestió/reactivació).
    const includeInactive = req.user!.role === 'ADMIN' && req.query.includeInactive === 'true';
    const { page, pageSize } = parsePagination(req.query);
    const { users, total } = await searchUsers(q, { includeInactive, page, pageSize });
    res.json({ users, total, page, pageSize });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/users/avatar — Puja/actualitza la foto de perfil de l'usuari
 * autenticat (qualsevol rol). Body multipart amb el camp "image".
 */
export const uploadAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: 'Falta el fitxer "image" al body multipart' });
      return;
    }
    if (!ACCEPTED_AVATAR_MIMETYPES.includes(file.mimetype)) {
      res.status(415).json({ error: `Tipus de fitxer no suportat: ${file.mimetype}` });
      return;
    }

    const user = await updateAvatar(req.user!.userId, file.buffer, file.mimetype);
    res.json({ user });
  } catch (error: any) {
    if (error.message?.includes('no trobat')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message });
  }
};
