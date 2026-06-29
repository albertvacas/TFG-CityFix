import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del client Prisma abans d'importar el servei (evita crear l'adapter real).
vi.mock('../../src/config/db', () => ({
  prisma: {
    report: { findUnique: vi.fn() },
    pointsTransaction: { create: vi.fn() },
    user: { update: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import {
  awardPointsForClosedReport,
  getUserRank,
  POINTS_BY_PRIORITY,
} from '../../src/services/gamification';
import { prisma } from '../../src/config/db';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('awardPointsForClosedReport', () => {
  it('no premia si la incidència no existeix', async () => {
    vi.mocked(prisma.report.findUnique).mockResolvedValue(null as never);

    const result = await awardPointsForClosedReport('r1');

    expect(result).toMatchObject({ awarded: false, reason: 'report_not_found' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no premia si l\'autor no és estudiant (admin/tècnic no acumulen punts)', async () => {
    vi.mocked(prisma.report.findUnique).mockResolvedValue({
      report_id: 'r1',
      priority: 'HIGH',
      createdById: 'u1',
      createdBy: { role: 'TECHNICAL', points: 0 },
    } as never);

    const result = await awardPointsForClosedReport('r1');

    expect(result).toMatchObject({ awarded: false, reason: 'not_student' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('premia l\'estudiant amb els punts segons la prioritat (CRITICAL = 40)', async () => {
    vi.mocked(prisma.report.findUnique).mockResolvedValue({
      report_id: 'r1',
      priority: 'CRITICAL',
      createdById: 'u1',
      createdBy: { role: 'STUDENT', points: 10 },
    } as never);
    // $transaction retorna [pointsTransaction, usuari actualitzat]
    vi.mocked(prisma.$transaction).mockResolvedValue([null, { points: 50 }] as never);

    const result = await awardPointsForClosedReport('r1');

    expect(result).toEqual({ awarded: true, amount: POINTS_BY_PRIORITY.CRITICAL, newTotal: 50 });
    expect(result.amount).toBe(40);
  });

  it('és idempotent: si ja s\'havien concedit els punts (P2002) no torna a premiar', async () => {
    vi.mocked(prisma.report.findUnique).mockResolvedValue({
      report_id: 'r1',
      priority: 'LOW',
      createdById: 'u1',
      createdBy: { role: 'STUDENT', points: 15 },
    } as never);
    vi.mocked(prisma.$transaction).mockRejectedValue({ code: 'P2002' } as never);

    const result = await awardPointsForClosedReport('r1');

    expect(result).toMatchObject({ awarded: false, reason: 'already_awarded', newTotal: 15 });
  });
});

describe('getUserRank', () => {
  it('retorna null si l\'usuari no és un estudiant actiu', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      points: 30,
      role: 'ADMIN',
      active: true,
    } as never);

    expect(await getUserRank('u1')).toBeNull();
  });

  it('calcula la posició com (estudiants amb més punts) + 1', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      points: 30,
      role: 'STUDENT',
      active: true,
    } as never);
    // Promise.all: primer count = quants en tenen més (2), segon = total (10)
    vi.mocked(prisma.user.count)
      .mockResolvedValueOnce(2 as never)
      .mockResolvedValueOnce(10 as never);

    const result = await getUserRank('u1');

    expect(result).toEqual({ rank: 3, total: 10, points: 30 });
  });
});
