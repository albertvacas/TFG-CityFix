import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { envs } from '../config/env';
import { AuthRequest, JwtPayload } from '../types';
import { Role } from '../../generated/prisma';

/**
 * Middleware de autenticación: verifica el JWT del header Authorization.
 * Si es válido, añade req.user con { userId, role }.
 */
export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token no proporcionado' });
    return;
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, envs.JWT_SECRET as string) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
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
