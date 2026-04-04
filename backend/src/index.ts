import express from 'express';
import cors from 'cors';
import { envs } from './config/env';
import { connectDB } from './config/db';
import { authRouter } from './routes/auth';
import { reportRouter } from './routes/reports';
import { userRouter } from './routes/users';
import { inviteRouter } from './routes/invites';

const app = express();

// Middleware global
app.use(cors());
app.use(express.json());

// Rutas
app.use('/api/auth', authRouter);
app.use('/api/reports', reportRouter);
app.use('/api/users', userRouter);
app.use('/api/invites', inviteRouter);

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
