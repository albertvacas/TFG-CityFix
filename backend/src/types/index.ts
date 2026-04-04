import { Request } from 'express';
import { Role } from '../../generated/prisma';

// Payload que se almacena dentro del JWT
export interface JwtPayload {
  userId: string;
  role: Role;
}

// Request autenticado: extiende Express Request con el usuario decodificado del JWT
export interface AuthRequest extends Request {
  user?: JwtPayload;
}

// DTOs para autenticación
export interface RegisterDTO {
  email: string;
  name: string;
  surname: string;
  password: string;
  nickname: string;
  role?: Role;
  token?: string; // Token d'invitació, obligatori si role és ADMIN o TECHNICAL
}

export interface LoginDTO {
  email: string;
  password: string;
}

// DTO para crear un report/incidencia
export interface CreateReportDTO {
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  category?: string;
  priority?: string;
}

// Eventos válidos de la máquina de estados XState
export type IncidentEvent = 'ASSIGN' | 'START' | 'REASSIGN' | 'RESOLVE' | 'CLOSE' | 'REJECT';
