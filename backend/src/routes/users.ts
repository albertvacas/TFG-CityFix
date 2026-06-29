import { Router } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middlewares/auth';
import {
  getProfile,
  updateProfile,
  getAllTechnicians,
  getTechnicianById,
  getAllStudents,
  getPrivileged,
  revoke,
  setActive,
  remove,
  search,
  uploadAvatar,
} from '../controllers/user';

export const userRouter = Router();

// Multer en memòria: el buffer va directament a Supabase Storage, no toquem disc.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB per imatge
});

// Totes les rutes d'users requereixen autenticació
userRouter.use(authenticate);

// GET /api/users/profile — Perfil de l'usuari autenticat
userRouter.get('/profile', getProfile);

// PATCH /api/users/profile — Actualitza el perfil propi (qualsevol rol autenticat)
userRouter.patch('/profile', updateProfile);

// POST /api/users/avatar — Pujar/actualitzar la foto de perfil pròpia
userRouter.post('/avatar', upload.single('image'), uploadAvatar);

// GET /api/users/search — Cerca d'usuaris (STUDENT/TECHNICAL) per qualsevol autenticat
userRouter.get('/search', search);

// GET /api/users/technicians — Llistar tècnics actius (només ADMIN)
userRouter.get('/technicians', authorize('ADMIN'), getAllTechnicians);

// GET /api/users/technicians/:id — Detall + stats d'un tècnic (només ADMIN)
userRouter.get('/technicians/:id', authorize('ADMIN'), getTechnicianById);

// GET /api/users/students — Llistar estudiants actius (només ADMIN)
userRouter.get('/students', authorize('ADMIN'), getAllStudents);

// GET /api/users/privileged — Llistar ADMIN + TECHNICAL (només ADMIN)
userRouter.get('/privileged', authorize('ADMIN'), getPrivileged);

// PATCH /api/users/:id/revoke — Revocar accés d'un usuari (només ADMIN)
userRouter.patch('/:id/revoke', authorize('ADMIN'), revoke);

// PATCH /api/users/:id/active — Bloquejar/reactivar un compte (només ADMIN)
userRouter.patch('/:id/active', authorize('ADMIN'), setActive);

// DELETE /api/users/:id — Eliminar (anonimitzar) un compte (només ADMIN)
userRouter.delete('/:id', authorize('ADMIN'), remove);
