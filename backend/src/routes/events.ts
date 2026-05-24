import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { ticket, stream } from '../controllers/events';

export const eventsRouter = Router();

// POST /api/events/ticket — bescanvi de JWT per ticket efímer (autenticat)
eventsRouter.post('/ticket', authenticate, ticket);

// GET /api/events/stream?ticket=... — connexió SSE (auth via ticket de query)
eventsRouter.get('/stream', stream);
