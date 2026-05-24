import { prisma } from '../config/db';
import { Role, State, Category } from '../../generated/prisma';
import { transitionReport } from './report';

/**
 * Resultat detallat d'una operació d'auto-assignació.
 *
 * Tornar `assigned[]` i `skipped[]` per separat permet que el frontend
 * pugui mostrar a l'admin un resum del què s'ha fet i del què no, en lloc
 * d'una resposta opaca tipus "OK".
 */
export interface AutoAssignResult {
  assigned: Array<{
    reportId: string;
    technicianId: string;
    technicianName: string;
  }>;
  skipped: Array<{
    reportId: string;
    reason: string;
  }>;
}

/**
 * Càrrega d'un tècnic = nombre de reports actius (ASSIGNED + IN_PROGRESS).
 * No comptem CLOSED ni VALIDATED perquè ja no requereixen feina.
 */
const ACTIVE_STATES: State[] = [State.ASSIGNED, State.IN_PROGRESS];

/**
 * Auto-assigna una llista de reports a tècnics basant-se en la categoria
 * i la càrrega de feina actual.
 *
 * Algoritme:
 *   1. Llegir tots els tècnics actius amb `workCategory != null` (els que no
 *      tenen categoria queden fora del pool — decisió del Sprint 6).
 *   2. Per cadascun, comptar la seva càrrega actual.
 *   3. Per cada report sol·licitat (en ordre, però sense ponderar per prioritat):
 *      a. Filtrar candidats amb `workCategory == report.category`.
 *      b. Si la llista és buida → skip ("cap tècnic per a aquesta categoria").
 *      c. Triar el de menys càrrega. Empat → el que fa més temps que no rep
 *         tasca (round-robin suau, evita que el mateix tècnic rebi totes les
 *         del mateix lot).
 *      d. Cridar `transitionReport` amb event=ASSIGN per fer la transició
 *         oficial via XState (manté la integritat del cicle de vida).
 *      e. Incrementar la càrrega en memòria perquè el següent report del lot
 *         vegi la càrrega actualitzada.
 *
 * Tot el processament es fa seqüencialment per evitar condicions de cursa
 * sobre el mateix tècnic. No és un coll d'ampolla: un lot típic d'auto-assign
 * són 5-20 reports.
 */
export const autoAssignReports = async (params: {
  reportIds: string[];
  actorId: string; // userId de l'admin que ha disparat l'acció (per a XState)
}): Promise<AutoAssignResult> => {
  const result: AutoAssignResult = { assigned: [], skipped: [] };

  // Carreguem reports candidats. Filtrem aquí (no a la query externa) perquè
  // volem retornar `skipped` amb una raó útil per als que no estiguin a OPEN.
  const reports = await prisma.report.findMany({
    where: { report_id: { in: params.reportIds } },
    select: {
      report_id: true,
      title: true,
      state: true,
      category: true,
    },
  });

  // Carreguem el pool de tècnics ELIGIBLES (active + amb workCategory).
  // Inclou recompte de feines actives per al càlcul de càrrega.
  const techs = await prisma.user.findMany({
    where: {
      role: Role.TECHNICAL,
      active: true,
      workCategory: { not: null },
    },
    select: {
      user_id: true,
      name: true,
      surname: true,
      workCategory: true,
      // Llegim els reports actius per comptar la càrrega.
      reportsAssigned: {
        where: { state: { in: ACTIVE_STATES } },
        select: { report_id: true, lastModified: true },
      },
    },
  });

  // Map de càrrega que actualitzarem incrementalment a mesura que assignem.
  // També guardem el "lastAssignedAt" per al round-robin (la marca temporal
  // del darrer report viu que té assignat — proxy raonable).
  const techState = new Map<
    string,
    {
      userId: string;
      name: string;
      workCategory: Category;
      load: number;
      lastAssignedAt: number; // ms epoch
    }
  >();

  for (const t of techs) {
    if (!t.workCategory) continue; // ja filtrat a la query, però TS no ho sap
    const lastAssigned = t.reportsAssigned.reduce(
      (max, r) => Math.max(max, new Date(r.lastModified).getTime()),
      0,
    );
    techState.set(t.user_id, {
      userId: t.user_id,
      name: `${t.name} ${t.surname}`,
      workCategory: t.workCategory,
      load: t.reportsAssigned.length,
      lastAssignedAt: lastAssigned,
    });
  }

  // Indexem reports per id (manteindrem l'ordre del param.reportIds per a
  // que el resultat sigui determinista).
  const reportsById = new Map(reports.map((r) => [r.report_id, r]));

  for (const reportId of params.reportIds) {
    const report = reportsById.get(reportId);
    if (!report) {
      result.skipped.push({ reportId, reason: 'Incidència no trobada' });
      continue;
    }
    if (report.state !== State.OPEN) {
      result.skipped.push({
        reportId,
        reason: `Estat actual ${report.state} — només es poden auto-assignar incidències OPEN`,
      });
      continue;
    }
    if (!report.category) {
      result.skipped.push({
        reportId,
        reason: 'Sense categoria — no es pot triar tècnic',
      });
      continue;
    }

    // Triem candidats amb la categoria correcta.
    const candidates = [...techState.values()].filter(
      (t) => t.workCategory === report.category,
    );

    if (candidates.length === 0) {
      result.skipped.push({
        reportId,
        reason: `Cap tècnic disponible per a categoria ${report.category}`,
      });
      continue;
    }

    // Ordenem: primer per càrrega ascendent, secundari per "fa més temps que
    // no se li ha assignat res" (timestamp ascendent → ha esperat més).
    candidates.sort((a, b) => {
      if (a.load !== b.load) return a.load - b.load;
      return a.lastAssignedAt - b.lastAssignedAt;
    });

    const chosen = candidates[0]!;

    try {
      await transitionReport(reportId, 'ASSIGN', params.actorId, Role.ADMIN, {
        assignedToId: chosen.userId,
      });

      // Actualitzem l'estat local perquè el següent report del lot vegi la
      // càrrega incrementada — és això el que evita que tots vagin al mateix.
      chosen.load += 1;
      chosen.lastAssignedAt = Date.now();

      result.assigned.push({
        reportId,
        technicianId: chosen.userId,
        technicianName: chosen.name,
      });
    } catch (err: any) {
      // Errors de XState (transició no permesa) o de BD: no aturem el lot.
      result.skipped.push({
        reportId,
        reason: err?.message ?? 'Error desconegut en assignar',
      });
    }
  }

  return result;
};
