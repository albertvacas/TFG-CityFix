import { prisma } from '../config/db';
import { Priority } from '../../generated/prisma/client';

/**
 * Servei de gamificació: premia l'autor d'una incidència quan es tanca
 * definitivament (CLOSED). L'escala s'amplifica amb la prioritat — un report
 * crític val molt més que un de baix — perquè el sistema valori l'aportació
 * relativa a l'impacte real al campus.
 *
 * Disseny:
 *  - Award disparat per `transitionReport` quan la nova state és CLOSED.
 *  - `PointsTransaction.reportId` és UNIQUE: si per qualsevol motiu el flux
 *    intentés premiar dues vegades el mateix report, Postgres ho rebutjaria
 *    (P2002). Capturem aquest cas i el tractem com a no-op idempotent.
 *  - L'increment de User.points i la inserció a points_transactions van DINS
 *    una mateixa $transaction Prisma. O les dues operacions tenen èxit o cap.
 *  - Només es premia si el creador és STUDENT (admins i tècnics no acumulen
 *    punts per reports propis — no és el seu rol).
 */

export const POINTS_BY_PRIORITY: Record<Priority, number> = {
  LOW: 5,
  MEDIUM: 10,
  HIGH: 20,
  CRITICAL: 40,
};

export interface AwardResult {
  awarded: boolean;
  amount: number;
  newTotal: number;
  reason?: 'not_student' | 'already_awarded' | 'report_not_found';
}

/**
 * Concedeix els punts per un report tancat. Idempotent gràcies a la UNIQUE
 * constraint sobre PointsTransaction.reportId.
 *
 * Retorna `awarded: true` només si la transacció ha creat una fila nova.
 * Els casos retornats com a no-op (not_student, already_awarded) no llencen
 * error — el caller (transitionReport) no s'ha d'amoïnar pel motiu, només
 * decidir si emet la notificació de "punts guanyats" o no.
 */
export const awardPointsForClosedReport = async (
  reportId: string,
): Promise<AwardResult> => {
  const report = await prisma.report.findUnique({
    where: { report_id: reportId },
    select: {
      report_id: true,
      priority: true,
      createdById: true,
      createdBy: { select: { role: true, points: true } },
    },
  });

  if (!report) {
    return { awarded: false, amount: 0, newTotal: 0, reason: 'report_not_found' };
  }

  // Només estudiants acumulen punts. Si l'autor és ADMIN o TECHNICAL (poden
  // crear reports per testing o casos especials), no se'ls premia.
  if (report.createdBy.role !== 'STUDENT') {
    return {
      awarded: false,
      amount: 0,
      newTotal: report.createdBy.points,
      reason: 'not_student',
    };
  }

  const amount = POINTS_BY_PRIORITY[report.priority];

  try {
    const [, updatedUser] = await prisma.$transaction([
      prisma.pointsTransaction.create({
        data: {
          userId: report.createdById,
          reportId: report.report_id,
          amount,
          priority: report.priority,
        },
      }),
      prisma.user.update({
        where: { user_id: report.createdById },
        data: { points: { increment: amount } },
        select: { points: true },
      }),
    ]);

    return { awarded: true, amount, newTotal: updatedUser.points };
  } catch (err: any) {
    // P2002 = unique constraint violation → ja existeix la transacció per
    // aquest report (premi ja entregat). No és un error real.
    if (err?.code === 'P2002') {
      return {
        awarded: false,
        amount: 0,
        newTotal: report.createdBy.points,
        reason: 'already_awarded',
      };
    }
    throw err;
  }
};

/**
 * Retorna els N estudiants amb més punts. S'usa per al "leaderboard" del mòbil
 * i el rànquing del dashboard admin. Filtrem actius perquè un usuari revocat
 * no ha d'aparèixer al podi.
 */
export const getLeaderboard = async (limit = 10) => {
  return prisma.user.findMany({
    where: { role: 'STUDENT', active: true },
    select: {
      user_id: true,
      name: true,
      surname: true,
      nickname: true,
      points: true,
      avatarUrl: true,
    },
    orderBy: [{ points: 'desc' }, { name: 'asc' }],
    take: Math.min(limit, 50),
  });
};

/**
 * Historial de punts d'un usuari concret. El mòbil ho fa servir per mostrar
 * "darreres incidències premiades" al perfil de l'estudiant.
 */
export const getUserPointsHistory = async (userId: string, limit = 20) => {
  return prisma.pointsTransaction.findMany({
    where: { userId },
    include: {
      report: {
        select: {
          report_id: true,
          title: true,
          priority: true,
          category: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
  });
};

/**
 * Historial complet de transaccions — admin only. Permet filtrar per usuari
 * concret. Pensat per a la pàgina d'auditoria del panel admin.
 */
export const getAllPointsTransactions = async (params?: {
  userId?: string;
  page?: number;
  pageSize?: number;
}) => {
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 25;
  const where = params?.userId ? { userId: params.userId } : undefined;

  const [transactions, total, sum, distinctUsers] = await Promise.all([
    prisma.pointsTransaction.findMany({
      where,
      include: {
        user: {
          select: { user_id: true, name: true, surname: true, nickname: true },
        },
        report: {
          select: { report_id: true, title: true, priority: true, category: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.pointsTransaction.count({ where }),
    // Agregats globals (no només la pàgina) per a les KPIs del dashboard.
    prisma.pointsTransaction.aggregate({ where, _sum: { amount: true } }),
    prisma.pointsTransaction.groupBy({ by: ['userId'], where }),
  ]);

  return {
    transactions,
    total,
    totalAmount: sum._sum.amount ?? 0,
    uniqueUsers: distinctUsers.length,
  };
};

/**
 * Posició d'un usuari concret al rànquing global. Útil al perfil mòbil per
 * mostrar "ets el #N de M estudiants".
 *
 * Implementació senzilla: comptem quants estudiants tenen estrictament més
 * punts. Per a volums TFG (centenars d'usuaris) és prou eficient. Si en algun
 * moment el cost crida l'atenció, una window function (RANK() OVER ...) en
 * SQL cru seria la millora natural.
 */
export const getUserRank = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: { points: true, role: true, active: true },
  });
  if (!user || user.role !== 'STUDENT' || !user.active) return null;

  const [higher, total] = await Promise.all([
    prisma.user.count({
      where: {
        role: 'STUDENT',
        active: true,
        points: { gt: user.points },
      },
    }),
    prisma.user.count({ where: { role: 'STUDENT', active: true } }),
  ]);

  return { rank: higher + 1, total, points: user.points };
};
