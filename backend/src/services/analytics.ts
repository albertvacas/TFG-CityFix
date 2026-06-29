import { prisma } from '../config/db';
import { State, Priority, Category } from '../../generated/prisma';

/** Bloc 1: Comptatge per estat */
export const getStateCounts = async () => {
  const groups = await prisma.report.groupBy({
    by: ['state'],
    _count: { report_id: true },
  });

  const counts: Record<string, number> = {
    OPEN: 0, ASSIGNED: 0, IN_PROGRESS: 0, VALIDATED: 0, CLOSED: 0,
  };
  for (const g of groups) {
    counts[g.state] = g._count.report_id;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total };
};

/** Bloc 1: Percentatge d'incidències crítiques + altes */
export const getCriticalHighPercentage = async () => {
  const [total, criticalHigh] = await Promise.all([
    prisma.report.count(),
    prisma.report.count({
      where: { priority: { in: ['HIGH', 'CRITICAL'] } },
    }),
  ]);
  return {
    total,
    criticalHigh,
    percentage: total > 0 ? Math.round((criticalHigh / total) * 100) : 0,
  };
};

/** Bloc 2: Històric de creació agrupat per categoria i interval temporal */
export const getHistoryByCategory = async (
  granularity: 'day' | 'week' | 'month' = 'week',
  days = 90,
) => {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const truncExpr =
    granularity === 'day'
      ? `date_trunc('day', "createdAt")`
      : granularity === 'week'
        ? `date_trunc('week', "createdAt")`
        : `date_trunc('month', "createdAt")`;

  const rows: { period: Date; category: Category; count: bigint }[] =
    await prisma.$queryRawUnsafe(`
      SELECT ${truncExpr} AS period, category, COUNT(*)::bigint AS count
      FROM reports
      WHERE "createdAt" >= $1 AND category IS NOT NULL
      GROUP BY period, category
      ORDER BY period
    `, since);

  return rows.map((r) => ({
    period: r.period.toISOString().split('T')[0],
    category: r.category,
    count: Number(r.count),
  }));
};

/** Bloc 2: Creades vs Tancades per setmana */
export const getCreatedVsResolved = async (days = 90) => {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const created: { period: Date; count: bigint }[] =
    await prisma.$queryRawUnsafe(`
      SELECT date_trunc('week', "createdAt") AS period, COUNT(*)::bigint AS count
      FROM reports
      WHERE "createdAt" >= $1
      GROUP BY period ORDER BY period
    `, since);

  const resolved: { period: Date; count: bigint }[] =
    await prisma.$queryRawUnsafe(`
      SELECT date_trunc('week', "resolvedAt") AS period, COUNT(*)::bigint AS count
      FROM reports
      WHERE "resolvedAt" IS NOT NULL AND "resolvedAt" >= $1
      GROUP BY period ORDER BY period
    `, since);

  // Merge ambdues sèries per període
  const map = new Map<string, { created: number; resolved: number }>();
  for (const r of created) {
    const key = r.period.toISOString().split('T')[0];
    map.set(key, { created: Number(r.count), resolved: 0 });
  }
  for (const r of resolved) {
    const key = r.period.toISOString().split('T')[0];
    const existing = map.get(key) || { created: 0, resolved: 0 };
    existing.resolved = Number(r.count);
    map.set(key, existing);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, data]) => ({ period, ...data }));
};

/** Bloc 3: Workload per tècnic */
export const getTechnicianWorkload = async () => {
  const rows = await prisma.report.groupBy({
    by: ['assignedToId', 'state'],
    where: { assignedToId: { not: null } },
    _count: { report_id: true },
  });

  // Agrupar per tècnic
  const techMap = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const id = r.assignedToId!;
    if (!techMap.has(id)) techMap.set(id, {});
    techMap.get(id)![r.state] = r._count.report_id;
  }

  // Obtenir noms dels tècnics
  const techIds = Array.from(techMap.keys());
  const users = await prisma.user.findMany({
    where: { user_id: { in: techIds } },
    select: { user_id: true, name: true, surname: true },
  });

  const nameMap = new Map(users.map((u) => [u.user_id, `${u.name} ${u.surname}`]));

  return techIds.map((id) => ({
    technicianId: id,
    name: nameMap.get(id) || 'Desconegut',
    ...techMap.get(id)!,
    total: Object.values(techMap.get(id)!).reduce((a, b) => a + b, 0),
  }));
};

/** Bloc 3: Temps de resolució vs Prioritat (scatter) */
export const getResolutionTimeVsPriority = async () => {
  const reports = await prisma.report.findMany({
    where: { resolvedAt: { not: null } },
    select: {
      priority: true,
      createdAt: true,
      resolvedAt: true,
    },
  });

  return reports.map((r) => {
    const hours = Math.round(
      (r.resolvedAt!.getTime() - r.createdAt.getTime()) / (1000 * 60 * 60),
    );
    return {
      priority: r.priority,
      hoursToResolve: hours,
    };
  });
};

/** Bloc 3: Distribució per categoria */
export const getCategoryDistribution = async () => {
  const groups = await prisma.report.groupBy({
    by: ['category'],
    where: { category: { not: null } },
    _count: { report_id: true },
  });

  return groups
    .map((g) => ({
      category: g.category!,
      count: g._count.report_id,
    }))
    .sort((a, b) => b.count - a.count);
};

/** Recompte d'incidències per categoria dins d'un rang de dates [from, to]
 *  (tots dos inclosos). Permet el filtre manual per calendari del dashboard. */
export const getCategoryCountsInRange = async (from: Date, to: Date) => {
  const groups = await prisma.report.groupBy({
    by: ['category'],
    where: {
      category: { not: null },
      createdAt: { gte: from, lte: to },
    },
    _count: { report_id: true },
  });

  return groups
    .map((g) => ({
      category: g.category!,
      count: g._count.report_id,
    }))
    .sort((a, b) => b.count - a.count);
};

/** Bloc 4: Top reporters (estudiants amb més incidències creades).
 *  Filtrem per role=STUDENT perquè admins i tècnics poden crear reports de
 *  prova/manuals però no formen part del rànquing de gamificació. */
export const getTopReporters = async (limit = 10) => {
  const groups = await prisma.report.groupBy({
    by: ['createdById'],
    where: { createdBy: { role: 'STUDENT' } },
    _count: { report_id: true },
    orderBy: { _count: { report_id: 'desc' } },
    take: limit,
  });

  const userIds = groups.map((g) => g.createdById);
  const users = await prisma.user.findMany({
    where: { user_id: { in: userIds } },
    select: { user_id: true, name: true, surname: true, nickname: true, points: true },
  });

  const userMap = new Map(users.map((u) => [u.user_id, u]));

  return groups.map((g) => {
    const u = userMap.get(g.createdById);
    return {
      userId: g.createdById,
      name: u ? `${u.name} ${u.surname}` : 'Desconegut',
      nickname: u?.nickname || '',
      points: u?.points || 0,
      reportCount: g._count.report_id,
    };
  });
};
