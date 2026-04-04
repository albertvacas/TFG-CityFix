import { prisma } from '../config/db';
import { envs } from '../config/env';

/**
 * Revoca l'accés d'un usuari ADMIN o TECHNICAL.
 * Transacció atòmica: desactiva l'usuari + marca la invitació com REVOKED.
 *
 * Regles de protecció:
 * - REGLA 1 (Root intocable): no es pot revocar l'admin root (definit a ROOT_ADMIN_EMAIL)
 * - REGLA 2 (Últim supervivent): no es pot desactivar l'últim admin actiu del sistema
 */
export const revokeUser = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { user_id: userId } });
  if (!user) throw new Error('Usuari no trobat');
  if (!user.active) throw new Error('L\'usuari ja està desactivat');

  // REGLA 1: Root admin intocable
  if (user.email === envs.ROOT_ADMIN_EMAIL) {
    throw new Error('No es pot revocar l\'administrador root del sistema');
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

  // Transacció atòmica: desactivar usuari + revocar invitació
  if (user.inviteId) {
    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { user_id: userId },
        data: { active: false },
      }),
      prisma.invite.update({
        where: { id: user.inviteId },
        data: { status: 'REVOKED' },
      }),
    ]);
    const { password, ...result } = updatedUser;
    return result;
  }

  // Usuari sense invitació (STUDENT o admin root creat manualment)
  const updatedUser = await prisma.user.update({
    where: { user_id: userId },
    data: { active: false },
  });
  const { password, ...result } = updatedUser;
  return result;
};

/**
 * Retorna tots els usuaris ADMIN i TECHNICAL (per la gestió d'usuaris del panell admin).
 * No inclou camps sensibles (password, inviteId).
 */
export const getPrivilegedUsers = async () => {
  return prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'TECHNICAL'] } },
    select: {
      user_id: true,
      email: true,
      name: true,
      surname: true,
      nickname: true,
      role: true,
      active: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
};
