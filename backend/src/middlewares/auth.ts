import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { envs } from '../config/env';
import { prisma } from '../config/db';
import { AuthRequest, JwtPayload } from '../types';
import { Role } from '../../generated/prisma';

/**
 * Middleware de autenticación: verifica el JWT del header Authorization.
 * Si es válido, añade req.user con { userId, role }.
 *
 * A més de validar la signatura del token, comprova a la BD que el compte
 * segueix actiu. Així, si un admin bloqueja o elimina un compte, la propera
 * petició d'aquell usuari (encara amb token vàlid) retorna 401 i els clients
 * (web i app) el desconnecten automàticament.
 */
export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token no proporcionado' });
    return;
  }

  let decoded: JwtPayload;
  try {
    const token = header.split(' ')[1];
    decoded = jwt.verify(token, envs.JWT_SECRET as string) as JwtPayload;
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
    return;
  }

  try {
    const account = await prisma.user.findUnique({
      where: { user_id: decoded.userId },
      select: { active: true },
    });
    if (!account || !account.active) {
      res.status(401).json({ error: 'Compte desactivat o eliminat' });
      return;
    }
    req.user = decoded;
    next();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Middleware RBAC: restringe el acceso a los roles indicados.
 * Uso: authorize('ADMIN', 'TECHNICAL')
 */
export const authorize = (...allowedRoles: Role[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'No tienes permisos para esta acción' });
      return;
    }

    next();
  };
};
