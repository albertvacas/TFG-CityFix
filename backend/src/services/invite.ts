import { randomBytes } from 'crypto';
import { prisma } from '../config/db';
import { Role } from '../../generated/prisma';

const INVITE_TTL_DAYS = 7;

/**
 * Crea una invitació per registrar un usuari amb rol privilegiat (ADMIN o TECHNICAL).
 * Genera un token criptogràfic de 64 caràcters hex i estableix `expiresAt` a 7 dies.
 */
export const createInvite = async (email: string, role: Role) => {
  if (role === 'STUDENT') {
    throw new Error('No es poden crear invitacions per al rol STUDENT');
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invite = await prisma.invite.create({
    data: { email, role, token, expiresAt },
  });

  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    token: invite.token,
    status: invite.status,
    expiresAt: invite.expiresAt,
  };
};

/**
 * Revoca una invitació pendent. Només es pot revocar si està PENDING;
 * les que estiguin USED o REVOKED no es poden tocar.
 */
export const revokeInvite = async (id: string) => {
  const invite = await prisma.invite.findUnique({ where: { id } });
  if (!invite) throw new Error('Invitació no trobada');
  if (invite.status !== 'PENDING') {
    throw new Error(`No es pot revocar una invitació amb estat '${invite.status}'`);
  }
  return prisma.invite.update({
    where: { id },
    data: { status: 'REVOKED' },
  });
};

/**
 * Retorna totes les invitacions, ordenades per data de creació descendent.
 */
export const getAllInvites = async (opts: { page?: number; pageSize?: number } = {}) => {
  const { page = 1, pageSize = 20 } = opts;

  const [invites, total] = await Promise.all([
    prisma.invite.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        token: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invite.count(),
  ]);

  return { invites, total };
};
