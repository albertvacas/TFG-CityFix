import { Router } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middlewares/auth';
import { create, getById, getAll, transition, updatePriority, uploadImage, addComment } from '../controllers/report';

export const reportRouter = Router();

// Multer en memòria: el buffer va directament a Supabase Storage, no toquem disc.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB per imatge
});

// Totes les rutes de reports requereixen autenticació
reportRouter.use(authenticate);

// POST /api/reports - Crear incidencia (cualquier usuario autenticado)
reportRouter.post('/', create);

// GET /api/reports - Listar incidencias (cualquier usuario autenticado)
reportRouter.get('/', getAll);

// GET /api/reports/:id - Detalle de incidencia
reportRouter.get('/:id', getById);

// PATCH /api/reports/:id/transition - Transicionar estado (RBAC validado por XState)
reportRouter.patch('/:id/transition', transition);

// PATCH /api/reports/:id/priority - Actualitzar prioritat (només ADMIN)
reportRouter.patch('/:id/priority', authorize('ADMIN'), updatePriority);

// POST /api/reports/:id/images - Pujar una imatge (INITIAL / RESOLUTION / PROGRESS)
reportRouter.post('/:id/images', upload.single('image'), uploadImage);

// POST /api/reports/:id/comments - Afegir comentari de discussió (autor, assignat o admin)
reportRouter.post('/:id/comments', addComment);
