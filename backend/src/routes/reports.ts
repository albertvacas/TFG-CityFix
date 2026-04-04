import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth';
import { create, getById, getAll, transition } from '../controllers/report';

export const reportRouter = Router();

// Todas las rutas de reports requieren autenticación
reportRouter.use(authenticate);

// POST /api/reports - Crear incidencia (cualquier usuario autenticado)
reportRouter.post('/', create);

// GET /api/reports - Listar incidencias (cualquier usuario autenticado)
reportRouter.get('/', getAll);

// GET /api/reports/:id - Detalle de incidencia
reportRouter.get('/:id', getById);

// PATCH /api/reports/:id/transition - Transicionar estado (RBAC validado por XState)
reportRouter.patch('/:id/transition', transition);
