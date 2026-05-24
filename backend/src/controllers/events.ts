import type { Request, Response } from 'express';
import type { AuthRequest } from '../types';
import { addClient } from '../services/sse';
import { issueTicket, consumeTicket } from '../services/streamTicket';

/**
 * POST /api/events/ticket
 *
 * Bescanvia el JWT (validat al middleware `authenticate`) per un ticket
 * efímer d'un sol ús. El client el farà servir a continuació per obrir el
 * stream SSE sense haver de posar el JWT a la query string.
 */
export const ticket = (req: AuthRequest, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticat' });
    return;
  }

  if (req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Només administradors poden obrir el stream' });
    return;
  }

  const value = issueTicket(req.user.userId, req.user.role);
  res.json({ ticket: value, expiresInSeconds: 60 });
};

/**
 * GET /api/events/stream?ticket=...
 *
 * Endpoint SSE: consumeix el ticket i, si és vàlid, manté la connexió oberta
 * i registra el client al hub perquè rebi els broadcasts (`broadcastToRole`).
 */
export const stream = (req: Request, res: Response): void => {
  const value = typeof req.query.ticket === 'string' ? req.query.ticket : undefined;
  if (!value) {
    res.status(401).json({ error: 'Ticket requerit' });
    return;
  }

  const data = consumeTicket(value);
  if (!data) {
    res.status(401).json({ error: 'Ticket invàlid o caducat' });
    return;
  }

  const removeClient = addClient(data.userId, data.role, res);

  // Quan el navegador tanca la pestanya, canvia de pàgina o perd connexió,
  // Express dispara 'close' i netegem el registre.
  req.on('close', () => {
    removeClient();
  });
};
