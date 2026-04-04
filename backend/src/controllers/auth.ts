import { Request, Response } from 'express';
import { registerUser, loginUser } from '../services/auth';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, name, surname, password, nickname, role, token } = req.body;

    if (!email || !name || !surname || !password || !nickname) {
      res.status(400).json({ error: 'Faltan campos obligatorios' });
      return;
    }

    // Si demana rol privilegiat sense token → error 400
    if ((role === 'ADMIN' || role === 'TECHNICAL') && !token) {
      res.status(400).json({ error: 'Es requereix un token d\'invitació per a aquest rol' });
      return;
    }

    const user = await registerUser({ email, name, surname, password, nickname, role, token });
    res.status(201).json(user);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(409).json({ error: 'Email o nickname ya registrado' });
      return;
    }
    // Invitació no vàlida → 403
    if (error.message.includes('Invitació no vàlida')) {
      res.status(403).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email y password son obligatorios' });
      return;
    }

    const result = await loginUser({ email, password });
    res.json(result);
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
};
