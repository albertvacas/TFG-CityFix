import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';
import { envs } from '../config/env';
import { RegisterDTO, LoginDTO, JwtPayload } from '../types';
import { onInviteUsed } from './notification';

const SALT_ROUNDS = 10;

const ALLOWED_EMAIL_DOMAINS = ['uab.cat', 'autonoma.cat'];

const isUabEmail = (email: string): boolean => {
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && ALLOWED_EMAIL_DOMAINS.includes(domain);
};

export const registerUser = async (data: RegisterDTO) => {
  const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);

  const requestedRole = data.role;
  const isPrivileged = requestedRole === 'ADMIN' || requestedRole === 'TECHNICAL';

  // Registre privilegiat: requereix invitació vàlida + transacció atòmica
  if (isPrivileged) {
    if (!data.token) {
      throw new Error('Es requereix un token d\'invitació per registrar-se com a ADMIN o TECHNICAL');
    }

    const invite = await prisma.invite.findFirst({
      where: { email: data.email, token: data.token, status: 'PENDING' },
    });

    if (!invite) {
      throw new Error('Invitació no vàlida, ja utilitzada o no coincideix amb l\'email');
    }

    // Comprovació d'expiració: les invitacions són vàlides 7 dies per defecte
    if (invite.expiresAt < new Date()) {
      throw new Error('Aquesta invitació ha caducat. Demana\'n una de nova a l\'administrador.');
    }

    // Domini UAB obligatori només per a ADMIN (personal intern). Els TECHNICAL
    // sovint són contractistes externs (Eulen, Ferrovial, jardineria...) i el
    // que els avala és la invitació mateixa, generada per un admin.
    if (invite.role === 'ADMIN' && !isUabEmail(data.email)) {
      throw new Error(
        `El correu d'un administrador ha de pertànyer a un domini institucional de la UAB (${ALLOWED_EMAIL_DOMAINS.join(', ')})`,
      );
    }

    // Camps de tècnic: només s'apliquen si la invitació és per a un TECHNICAL.
    // Per a ADMIN els ignorem encara que el client els enviï (defensiu).
    const technicalFields =
      invite.role === 'TECHNICAL'
        ? {
            position: data.position?.trim() || null,
            company: data.company?.trim() || null,
            workCategory: data.workCategory ?? null,
          }
        : {};

    // Transacció atòmica: crear usuari (amb inviteId) + marcar invitació com USED
    const [user] = await prisma.$transaction([
      prisma.user.create({
        data: {
          email: data.email,
          name: data.name,
          surname: data.surname,
          password: hashedPassword,
          nickname: data.nickname,
          role: invite.role,
          inviteId: invite.id,
          ...technicalFields,
        },
      }),
      prisma.invite.update({
        where: { id: invite.id },
        data: { status: 'USED' },
      }),
    ]);

    // Avisem els admins connectats perquè el panell d'accessos es refresqui:
    // la invitació passa a "Utilitzada" i el nou usuari apareix a la taula de
    // privilegiats sense haver de recarregar la pàgina.
    onInviteUsed(invite.id);

    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  // Registre públic: forçar rol STUDENT (sanitització) + domini UAB obligatori
  // (sense invitació, és l'única defensa contra registres oberts a qualsevol).
  if (!isUabEmail(data.email)) {
    throw new Error(
      `El correu ha de pertànyer a un domini institucional de la UAB (${ALLOWED_EMAIL_DOMAINS.join(', ')})`,
    );
  }

  const user = await prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      surname: data.surname,
      password: hashedPassword,
      nickname: data.nickname,
      role: 'STUDENT',
    },
  });

  const { password, ...userWithoutPassword } = user;
  return userWithoutPassword;
};

export const loginUser = async (data: LoginDTO) => {
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) throw new Error('Credencials incorrectes');

  if (!user.active) {
    throw new Error('Compte desactivat. Contacta amb un administrador.');
  }

  const valid = await bcrypt.compare(data.password, user.password);
  if (!valid) throw new Error('Credencials incorrectes');

  const payload: JwtPayload = { userId: user.user_id, role: user.role };
  const token = jwt.sign(payload, envs.JWT_SECRET as string, { expiresIn: '24h' });

  const { password, ...userWithoutPassword } = user;
  return { token, user: userWithoutPassword };
};
