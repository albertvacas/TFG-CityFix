import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Response, NextFunction } from 'express';

// Mock del client Prisma ABANS d'importar el middleware (config/db crearia
// un adapter real cap a Postgres). authenticate() consulta user.findUnique
// per verificar que el compte segueix actiu.
vi.mock('../../src/config/db', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { authenticate, authorize } from '../../src/middlewares/auth';
import { prisma } from '../../src/config/db';
import type { AuthRequest } from '../../src/types';

const SECRET = process.env.JWT_SECRET as string;

/** Construeix un trio req/res/next fals per provar middlewares aïlladament. */
function mockHttp(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as AuthRequest;
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  const next = vi.fn() as unknown as NextFunction;
  return { req, res: res as unknown as Response & typeof res, next };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authenticate', () => {
  it('retorna 401 si no hi ha header Authorization', async () => {
    const { req, res, next } = mockHttp();
    await authenticate(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('retorna 401 si el header no comença per "Bearer "', async () => {
    const { req, res, next } = mockHttp({ authorization: 'Token abc' });
    await authenticate(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('retorna 401 si el token és invàlid o manipulat', async () => {
    const { req, res, next } = mockHttp({ authorization: 'Bearer token-fals' });
    await authenticate(req, res, next);
    expect(res.statusCode).toBe(401);
    expect((res.body as { error: string }).error).toBe('Token inválido o expirado');
  });

  it('retorna 401 si el compte està desactivat', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ active: false } as never);
    const token = jwt.sign({ userId: 'u1', role: 'STUDENT' }, SECRET);
    const { req, res, next } = mockHttp({ authorization: `Bearer ${token}` });
    await authenticate(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('crida next() i injecta req.user amb un token vàlid i compte actiu', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ active: true } as never);
    const token = jwt.sign({ userId: 'u1', role: 'ADMIN' }, SECRET);
    const { req, res, next } = mockHttp({ authorization: `Bearer ${token}` });
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ userId: 'u1', role: 'ADMIN' });
  });
});

describe('authorize', () => {
  it('retorna 401 si no hi ha usuari autenticat', () => {
    const { req, res, next } = mockHttp();
    authorize('ADMIN')(req, res, next);
    expect(res.statusCode).toBe(401);
  });

  it('retorna 403 si el rol no està a la llista permesa', () => {
    const { req, res, next } = mockHttp();
    req.user = { userId: 'u1', role: 'STUDENT' };
    authorize('ADMIN')(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('crida next() si el rol està permès', () => {
    const { req, res, next } = mockHttp();
    req.user = { userId: 'u1', role: 'TECHNICAL' };
    authorize('ADMIN', 'TECHNICAL')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
