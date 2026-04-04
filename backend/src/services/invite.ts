import { randomBytes } from 'crypto';
import { prisma } from '../config/db';
import { Role } from '../../generated/prisma';

/**
 * Crea una invitació per registrar un usuari amb rol privilegiat (ADMIN o TECHNICAL).
 * Genera un token criptogràfic de 64 caràcters hexadecimals.
 */
export const createInvite = async (email: string, role: Role) => {
  if (role === 'STUDENT') {
    throw new Error('No es poden crear invitacions per al rol STUDENT');
  }

  const token = randomBytes(32).toString('hex');

  const invite = await prisma.invite.create({
    data: { email, role, token },
  });

  return { id: invite.id, email: invite.email, role: invite.role, token: invite.token };
};

/**
 * Retorna totes les invitacions, ordenades per data de creació descendent.
 */
export const getAllInvites = async () => {
  return prisma.invite.findMany({
    select: { id: true, email: true, role: true, token: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
};
