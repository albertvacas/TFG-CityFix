import express from 'express';
import cors from 'cors';
import { envs } from './config/env';
import { connectDB } from './config/db';
import { authRouter } from './routes/auth';
import { reportRouter } from './routes/reports';
import { userRouter } from './routes/users';
import { inviteRouter } from './routes/invites';
import { geoRouter } from './routes/geo';
import { analyticsRouter } from './routes/analytics';
import { notificationsRouter } from './routes/notifications';
import { eventsRouter } from './routes/events';
import { gamificationRouter } from './routes/gamification';

const app = express();

// Middleware global
// CORS: si FRONTEND_URL està definida, restringim als orígens permesos
// (separats per comes); si no, acceptem qualsevol origen (còmode en dev).
const allowedOrigins = envs.FRONTEND_URL?.split(',').map((o) => o.trim()).filter(Boolean);
app.use(
  cors(
    allowedOrigins && allowedOrigins.length > 0
      ? { origin: allowedOrigins }
      : undefined,
  ),
);
app.use(express.json());

// Rutas
app.use('/api/auth', authRouter);
app.use('/api/reports', reportRouter);
app.use('/api/users', userRouter);
app.use('/api/invites', inviteRouter);
app.use('/api/geo', geoRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/gamification', gamificationRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Arranque del servidor
const start = async () => {
  await connectDB();
  app.listen(envs.PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${envs.PORT}`);
  });
};

start();
