import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks de Prisma i de les dependències del servei.
vi.mock('../../src/config/db', () => ({
  prisma: {
    report: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock('../../src/services/report', () => ({ transitionReport: vi.fn() }));
vi.mock('../../src/services/geo', () => ({ getNearestActiveDistances: vi.fn() }));

import { autoAssignReports } from '../../src/services/autoAssign';
import { prisma } from '../../src/config/db';
import { transitionReport } from '../../src/services/report';
import { getNearestActiveDistances } from '../../src/services/geo';

// Helpers per construir dades de prova.
const makeReport = (over: Record<string, unknown>) => ({
  report_id: 'r1',
  title: 'Incidència',
  state: 'OPEN',
  category: 'LIGHTING',
  latitude: 41.5,
  longitude: 2.1,
  ...over,
});
const makeTech = (over: Record<string, unknown>) => ({
  user_id: 't1',
  name: 'Tec',
  surname: 'One',
  workCategory: 'LIGHTING',
  reportsAssigned: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Per defecte cap distància coneguda → la càrrega és qui decideix.
  vi.mocked(getNearestActiveDistances).mockResolvedValue(new Map());
  vi.mocked(transitionReport).mockResolvedValue({} as never);
});

describe('autoAssignReports — assignació', () => {
  it('assigna una incidència OPEN al tècnic de la categoria amb menys càrrega', async () => {
    vi.mocked(prisma.report.findMany).mockResolvedValue([makeReport({ report_id: 'r1' })] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      // t1 té 2 feines actives; t2 cap → ha de guanyar t2.
      makeTech({ user_id: 't1', reportsAssigned: [{ report_id: 'a', lastModified: new Date() }, { report_id: 'b', lastModified: new Date() }] }),
      makeTech({ user_id: 't2', name: 'Tec', surname: 'Two', reportsAssigned: [] }),
    ] as never);

    const result = await autoAssignReports({ reportIds: ['r1'], actorId: 'admin1' });

    expect(result.assigned).toHaveLength(1);
    expect(result.assigned[0]).toMatchObject({ reportId: 'r1', technicianId: 't2' });
    // La transició oficial es fa via XState amb event ASSIGN.
    expect(transitionReport).toHaveBeenCalledWith(
      'r1', 'ASSIGN', 'admin1', 'ADMIN', { assignedToId: 't2' },
    );
  });

  it('reparteix la càrrega dins d\'un lot (la segona va a l\'altre tècnic)', async () => {
    vi.mocked(prisma.report.findMany).mockResolvedValue([
      makeReport({ report_id: 'r1' }),
      makeReport({ report_id: 'r2' }),
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      makeTech({ user_id: 't1', reportsAssigned: [] }),
      makeTech({ user_id: 't2', name: 'Tec', surname: 'Two', reportsAssigned: [] }),
    ] as never);

    const result = await autoAssignReports({ reportIds: ['r1', 'r2'], actorId: 'admin1' });

    expect(result.assigned).toHaveLength(2);
    // Empat inicial → r1 al primer; en incrementar-li la càrrega en memòria,
    // r2 ha d'anar al segon tècnic.
    expect(result.assigned[0].technicianId).toBe('t1');
    expect(result.assigned[1].technicianId).toBe('t2');
  });
});

describe('autoAssignReports — casos omesos (skipped)', () => {
  it('omet una incidència que no està en estat OPEN', async () => {
    vi.mocked(prisma.report.findMany).mockResolvedValue([makeReport({ report_id: 'r1', state: 'ASSIGNED' })] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([makeTech({})] as never);

    const result = await autoAssignReports({ reportIds: ['r1'], actorId: 'admin1' });

    expect(result.assigned).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/OPEN/);
    expect(transitionReport).not.toHaveBeenCalled();
  });

  it('omet si no hi ha cap tècnic per a la categoria de la incidència', async () => {
    vi.mocked(prisma.report.findMany).mockResolvedValue([makeReport({ report_id: 'r1', category: 'PAVEMENT' })] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([makeTech({ workCategory: 'LIGHTING' })] as never);

    const result = await autoAssignReports({ reportIds: ['r1'], actorId: 'admin1' });

    expect(result.assigned).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/Cap tècnic/);
  });

  it('omet una incidència sol·licitada que no existeix', async () => {
    vi.mocked(prisma.report.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([makeTech({})] as never);

    const result = await autoAssignReports({ reportIds: ['rX'], actorId: 'admin1' });

    expect(result.skipped[0]).toMatchObject({ reportId: 'rX' });
    expect(result.skipped[0].reason).toMatch(/no trobada/);
  });
});
