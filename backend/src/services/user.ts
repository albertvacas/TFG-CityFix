import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { prisma } from '../config/db';
import { envs } from '../config/env';
import { UpdateProfileDTO } from '../types';
import { uploadAvatarImage } from './storage';
import { Role, State } from '../../generated/prisma';

// Camps públics d'un usuari que es poden retornar al client (sense password ni inviteId).
const PUBLIC_USER_SELECT = {
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
} as const;

/**
 * Canvia l'estat actiu d'un usuari (bloqueig / reactivació). Serveix per a
 * qualsevol rol (STUDENT, TECHNICAL, ADMIN).
 *
 * Regles de protecció (només en DESACTIVAR):
 * - REGLA 1 (Root intocable): no es pot desactivar l'admin root (ROOT_ADMIN_EMAIL)
 * - REGLA 2 (Últim supervivent): no es pot desactivar l'últim admin actiu del sistema
 *
 * En desactivar un usuari privilegiat amb invitació associada, la invitació es
 * marca com REVOKED dins la mateixa transacció. En reactivar no es toca la invitació.
 */
export const setUserActive = async (userId: string, active: boolean) => {
  const user = await prisma.user.findUnique({ where: { user_id: userId } });
  if (!user) throw new Error('Usuari no trobat');

  if (!active) {
    // REGLA 1: Root admin intocable
    if (user.email === envs.ROOT_ADMIN_EMAIL) {
      throw new Error('No es pot desactivar l\'administrador root del sistema');
    }

    // REGLA 2: Últim supervivent
    if (user.role === 'ADMIN') {
      const activeAdmins = await prisma.user.count({
        where: { role: 'ADMIN', active: true },
      });
      if (activeAdmins <= 1) {
        throw new Error('No es pot desactivar l\'últim administrador actiu del sistema');
      }
    }
  }

  // Desactivació amb invitació associada: revocar també la invitació (atòmic).
  if (!active && user.inviteId) {
    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { user_id: userId },
        data: { active: false },
        select: PUBLIC_USER_SELECT,
      }),
      prisma.invite.update({
        where: { id: user.inviteId },
        data: { status: 'REVOKED' },
      }),
    ]);
    return updatedUser;
  }

  return prisma.user.update({
    where: { user_id: userId },
    data: { active },
    select: PUBLIC_USER_SELECT,
  });
};

/**
 * Revoca l'accés d'un usuari (compatibilitat amb l'endpoint antic /revoke).
 * És un cas particular de setUserActive amb active=false; afegeix el guard
 * "ja està desactivat" que tenia la implementació original.
 */
export const revokeUser = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { user_id: userId }, select: { active: true } });
  if (!user) throw new Error('Usuari no trobat');
  if (!user.active) throw new Error('L\'usuari ja està desactivat');
  return setUserActive(userId, false);
};

/**
 * "Elimina" un compte aplicant anonimització in-place (GDPR-friendly).
 *
 * No esborrem la fila perquè reports, comentaris i imatges hi tenen FK
 * obligatòries; perdre-les destruiria l'històric d'incidències. En lloc d'això:
 *  - Esborrem tota la PII (nom, cognoms, email, nickname, avatar, dades de tècnic)
 *  - Invalidem les credencials (password aleatori) i posem active=false
 *  - Esborrem push tokens i notificacions (dades efímeres del compte)
 *  - Marquem la invitació com REVOKED si en tenia
 *
 * Resultat: el "compte real" desapareix (login impossible, no pot tornar a
 * entrar), però els reports queden atribuïts a una fila anònima.
 *
 * Mateixes proteccions que setUserActive (root + últim admin).
 */
export const deleteUser = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { user_id: userId } });
  if (!user) throw new Error('Usuari no trobat');

  if (user.email === envs.ROOT_ADMIN_EMAIL) {
    throw new Error('No es pot eliminar l\'administrador root del sistema');
  }
  if (user.role === 'ADMIN') {
    const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
    if (activeAdmins <= 1) {
      throw new Error('No es pot eliminar l\'últim administrador actiu del sistema');
    }
  }

  // Credencials inservibles: hash d'un valor aleatori que ningú coneix.
  const scrambledPassword = await bcrypt.hash(randomUUID(), 10);
  const anonId = userId.slice(0, 8);

  await prisma.$transaction([
    prisma.pushToken.deleteMany({ where: { userId } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { user_id: userId },
      data: {
        name: 'Usuari',
        surname: 'eliminat',
        nickname: `deleted_${anonId}_${Date.now()}`,
        email: `deleted_${anonId}_${Date.now()}@deleted.local`,
        password: scrambledPassword,
        active: false,
        avatarUrl: null,
        position: null,
        company: null,
        workCategory: null,
      },
    }),
    ...(user.inviteId
      ? [prisma.invite.update({ where: { id: user.inviteId }, data: { status: 'REVOKED' } })]
      : []),
  ]);

  return { user_id: userId, deleted: true };
};

/**
 * Actualitza la foto de perfil de l'usuari: puja la imatge a Supabase Storage
 * i desa la URL pública a User.avatarUrl. Retorna l'usuari públic actualitzat.
 */
export const updateAvatar = async (userId: string, buffer: Buffer, mimetype: string) => {
  const user = await prisma.user.findUnique({ where: { user_id: userId }, select: { user_id: true } });
  if (!user) throw new Error('Usuari no trobat');

  const avatarUrl = await uploadAvatarImage(userId, buffer, mimetype);

  return prisma.user.update({
    where: { user_id: userId },
    data: { avatarUrl },
    select: PUBLIC_USER_SELECT,
  });
};

/**
 * Cerca d'usuaris per nom, cognoms o nickname. Només retorna STUDENT i
 * TECHNICAL actius (els admins són gestió, no apareixen com a fitxes).
 *
 * Inclou `solvedCount`: per a un estudiant, els seus reports creats que han
 * arribat a VALIDATED/CLOSED ("reports trobats amb solució"); per a un tècnic,
 * els reports que té assignats i s'han resolt ("reports solucionats").
 */
export const searchUsers = async (
  q: string,
  opts: { includeInactive?: boolean; page?: number; pageSize?: number } = {},
) => {
  const term = q.trim();
  const { includeInactive = false, page = 1, pageSize = 20 } = opts;

  const solvedStates: State[] = ['VALIDATED', 'CLOSED'];

  const where = {
    role: { in: ['STUDENT', 'TECHNICAL'] as Role[] },
    ...(includeInactive ? {} : { active: true }),
    ...(term
      ? {
          OR: [
            { name: { contains: term, mode: 'insensitive' as const } },
            { surname: { contains: term, mode: 'insensitive' as const } },
            { nickname: { contains: term, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        ...PUBLIC_USER_SELECT,
        _count: {
          select: {
            reportsCreated: { where: { state: { in: solvedStates } } },
            reportsAssigned: { where: { state: { in: solvedStates } } },
          },
        },
      },
      orderBy: [{ name: 'asc' }, { surname: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  const users = rows.map(({ _count, ...u }) => ({
    ...u,
    // `isRoot` marca l'admin master (ROOT_ADMIN_EMAIL): el client l'ha de tractar
    // com a intocable (no mostrar accions de bloquejar/eliminar), coherent amb
    // les proteccions del backend a setUserActive/deleteUser.
    isRoot: u.email === envs.ROOT_ADMIN_EMAIL,
    solvedCount: u.role === 'TECHNICAL' ? _count.reportsAssigned : _count.reportsCreated,
  }));

  return { users, total };
};

/**
 * Actualitza el perfil propi de l'usuari autenticat (ús des del mòbil).
 * Els camps de tècnic (position, company, workCategory) només es persisteixen
 * si l'usuari té rol TECHNICAL — per a STUDENT i ADMIN s'ignoren silenciosament.
 * Els camps `null` esborren explícitament el valor; els `undefined` no toquen res.
 */
export const updateOwnProfile = async (userId: string, data: UpdateProfileDTO) => {
  const user = await prisma.user.findUnique({ where: { user_id: userId } });
  if (!user) throw new Error('Usuari no trobat');

  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) throw new Error('El nom no pot estar buit');
    updateData.name = trimmed;
  }
  if (data.surname !== undefined) {
    const trimmed = data.surname.trim();
    if (!trimmed) throw new Error('Els cognoms no poden estar buits');
    updateData.surname = trimmed;
  }

  // Camps de tècnic: només els apliquem si l'usuari és TECHNICAL.
  if (user.role === 'TECHNICAL') {
    if (data.position !== undefined) {
      updateData.position = data.position === null ? null : data.position.trim() || null;
    }
    if (data.company !== undefined) {
      updateData.company = data.company === null ? null : data.company.trim() || null;
    }
    if (data.workCategory !== undefined) {
      updateData.workCategory = data.workCategory;
    }
  }

  const updated = await prisma.user.update({
    where: { user_id: userId },
    data: updateData,
    select: PUBLIC_USER_SELECT,
  });

  return updated;
};

/**
 * Retorna tots els usuaris ADMIN i TECHNICAL (per la gestió d'usuaris del panell admin).
 * No inclou camps sensibles (password, inviteId).
 */
export const getPrivilegedUsers = async (opts: { page?: number; pageSize?: number } = {}) => {
  const { page = 1, pageSize = 20 } = opts;
  const where = { role: { in: ['ADMIN', 'TECHNICAL'] as Role[] } };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        user_id: true,
        email: true,
        name: true,
        surname: true,
        nickname: true,
        role: true,
        active: true,
        avatarUrl: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  // `isRoot` marca l'admin master perquè el client n'amagui les accions de
  // bloqueig/eliminació (l'únic compte que no es pot tocar mai).
  const users = rows.map((u) => ({ ...u, isRoot: u.email === envs.ROOT_ADMIN_EMAIL }));

  return { users, total };
};
