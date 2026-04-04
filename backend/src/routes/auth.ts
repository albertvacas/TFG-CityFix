import { Router } from 'express';
import { register, login } from '../controllers/auth';

export const authRouter = Router();

// POST /api/auth/register - Registro de usuario
authRouter.post('/register', register);

// POST /api/auth/login - Inicio de sesión (devuelve JWT)
authRouter.post('/login', login);
