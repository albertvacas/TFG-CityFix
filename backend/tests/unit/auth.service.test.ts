import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks de dependències externes ABANS d'importar el servei.
vi.mock('../../src/config/db', () => ({
  prisma: {
    user: { create: vi.fn(), findUnique: vi.fn() },
    invite: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(async () => 'hashed-password'),
    compare: vi.fn(),
  },
}));

import bcrypt from 'bcrypt';
import { registerUser, loginUser } from '../../src/services/auth';
import { prisma } from '../../src/config/db';
import type { RegisterDTO } from '../../src/types';

const baseUser: RegisterDTO = {
  email: 'alumne@uab.cat',
  name: 'Anna',
  surname: 'Soler',
  password: 'secret123',
  nickname: 'anna',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerUser — registre públic (STUDENT)', () => {
  it('rebutja correus fora del domini institucional UAB', async () => {
    await expect(registerUser({ ...baseUser, email: 'algu@gmail.com' })).rejects.toThrow(/UAB/);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('accepta correus @uab.cat i força el rol STUDENT', async () => {
    vi.mocked(prisma.user.create).mockResolvedValue({
      user_id: 'u1', ...baseUser, role: 'STUDENT', password: 'hashed-password',
    } as never);

    const result = await registerUser(baseUser);

    expect(prisma.user.create).toHaveBeenCalledOnce();
    const createArg = vi.mocked(prisma.user.create).mock.calls[0][0] as { data: { role: string } };
    expect(createArg.data.role).toBe('STUDENT');
    // El password mai s'ha de retornar (RGPD).
    expect(result).not.toHaveProperty('password');
  });

  it('hasheja la contrasenya abans de desar-la', async () => {
    vi.mocked(prisma.user.create).mockResolvedValue({ user_id: 'u1', password: 'hashed-password' } as never);
    await registerUser(baseUser);
    expect(bcrypt.hash).toHaveBeenCalledWith('secret123', 10);
  });
});

describe('registerUser — registre privilegiat (ADMIN / TECHNICAL)', () => {
  it('exigeix un token d\'invitació', async () => {
    await expect(registerUser({ ...baseUser, role: 'ADMIN' })).rejects.toThrow(/token d'invitació/);
  });

  it('rebutja una invitació inexistent o ja utilitzada', async () => {
    vi.mocked(prisma.invite.findFirst).mockResolvedValue(null as never);
    await expect(
      registerUser({ ...baseUser, role: 'TECHNICAL', token: 'tok' }),
    ).rejects.toThrow(/Invitació no vàlida/);
  });

  it('rebutja una invitació caducada', async () => {
    vi.mocked(prisma.invite.findFirst).mockResolvedValue({
      id: 'inv1', role: 'TECHNICAL', expiresAt: new Date('2020-01-01'),
    } as never);
    await expect(
      registerUser({ ...baseUser, role: 'TECHNICAL', token: 'tok' }),
    ).rejects.toThrow(/caducat/);
  });

  it('exigeix domini UAB per a un ADMIN encara que la invitació sigui vàlida', async () => {
    vi.mocked(prisma.invite.findFirst).mockResolvedValue({
      id: 'inv1', role: 'ADMIN', expiresAt: new Date('2999-01-01'),
    } as never);
    await expect(
      registerUser({ ...baseUser, email: 'admin@gmail.com', role: 'ADMIN', token: 'tok' }),
    ).rejects.toThrow(/UAB/);
  });
});

describe('loginUser', () => {
  it('rebutja credencials d\'un usuari inexistent amb missatge genèric', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);
    await expect(loginUser({ email: 'no@uab.cat', password: 'x' })).rejects.toThrow('Credencials incorrectes');
  });

  it('rebutja l\'accés a un compte desactivat', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      user_id: 'u1', active: false, password: 'hashed', role: 'STUDENT',
    } as never);
    await expect(loginUser({ email: 'a@uab.cat', password: 'x' })).rejects.toThrow(/desactivat/);
  });

  it('rebutja una contrasenya incorrecta', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      user_id: 'u1', active: true, password: 'hashed', role: 'STUDENT',
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    await expect(loginUser({ email: 'a@uab.cat', password: 'bad' })).rejects.toThrow('Credencials incorrectes');
  });

  it('retorna token + usuari (sense password) amb credencials correctes', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      user_id: 'u1', active: true, password: 'hashed', role: 'ADMIN', email: 'a@uab.cat',
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const result = await loginUser({ email: 'a@uab.cat', password: 'good' });

    expect(result.token).toBeTypeOf('string');
    expect(result.user).not.toHaveProperty('password');
    expect(result.user).toMatchObject({ user_id: 'u1', role: 'ADMIN' });
  });
});
