import { prisma } from '../config/db';
import { Role, State, Category } from '../../generated/prisma';
import { transitionReport } from './report';
import { getNearestActiveDistances } from './geo';

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
    reportTitle: string;
    technicianId: string;
    technicianName: string;
  }>;
  skipped: Array<{
    reportId: string;
    reportTitle: string;
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
 *      c. Triar el de menys càrrega. Empat → el més PROPER (distància, calculada
 *         per PostGIS amb ST_Distance, a la seva incidència activa més propera;
 *         un tècnic amb feina just al costat de la nova incidència agrupa millor
 *         els desplaçaments). Empat de nou → el que fa més temps que no rep tasca
 *         (round-robin suau, evita que el mateix tècnic rebi totes les del lot).
 *      d. Cridar `transitionReport` amb event=ASSIGN per fer la transició
 *         oficial via XState (manté la integritat del cicle de vida).
 *      e. Incrementar la càrrega en memòria perquè el següent report del lot
 *         vegi la càrrega actualitzada.
 *
 * La proximitat es delega a PostGIS (`getNearestActiveDistances`), que llegeix
 * la columna geography `location` indexada amb GiST. Com que la transició de
 * cada report es confirma a la BD abans del següent, la consulta de distàncies
 * del següent report ja reflecteix l'assignació anterior (coherència dins del lot).
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
      latitude: true,
      longitude: true,
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
      // Llegim els reports actius només per comptar la càrrega i el round-robin.
      // La proximitat ja no es calcula aquí: la resol PostGIS sota demanda.
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
      result.skipped.push({ reportId, reportTitle: 'Incidència desconeguda', reason: 'Incidència no trobada' });
      continue;
    }
    if (report.state !== State.OPEN) {
      result.skipped.push({
        reportId,
        reportTitle: report.title,
        reason: `Estat actual ${report.state} — només es poden auto-assignar incidències OPEN`,
      });
      continue;
    }
    if (!report.category) {
      result.skipped.push({
        reportId,
        reportTitle: report.title,
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
        reportTitle: report.title,
        reason: `Cap tècnic disponible per a categoria ${report.category}`,
      });
      continue;
    }

    // Distàncies dels candidats a la nova incidència, calculades per PostGIS
    // (ST_Distance sobre `location`). Una sola consulta espacial per report.
    // Els tècnics sense incidència activa no surten al map => distància Infinity.
    const distances = await getNearestActiveDistances(
      { lat: report.latitude, lng: report.longitude },
      candidates.map((t) => t.userId),
    );

    const ranked = candidates.map((t) => ({
      tech: t,
      distance: distances.get(t.userId) ?? Infinity,
    }));

    // Ordenem: (1) càrrega ascendent; (2) proximitat ascendent (més a prop
    // primer); (3) "fa més temps que no se li ha assignat res" (round-robin).
    ranked.sort((a, b) => {
      if (a.tech.load !== b.tech.load) return a.tech.load - b.tech.load;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.tech.lastAssignedAt - b.tech.lastAssignedAt;
    });

    const chosen = ranked[0]!.tech;

    try {
      await transitionReport(reportId, 'ASSIGN', params.actorId, Role.ADMIN, {
        assignedToId: chosen.userId,
      });

      // Actualitzem l'estat local perquè el següent report del lot vegi la
      // càrrega incrementada — és això el que evita que tots vagin al mateix.
      // La proximitat del següent report ja la recalcularà PostGIS amb
      // l'assignació que acabem de confirmar a la BD.
      chosen.load += 1;
      chosen.lastAssignedAt = Date.now();

      result.assigned.push({
        reportId,
        reportTitle: report.title,
        technicianId: chosen.userId,
        technicianName: chosen.name,
      });
    } catch (err: any) {
      // Errors de XState (transició no permesa) o de BD: no aturem el lot.
      result.skipped.push({
        reportId,
        reportTitle: report.title,
        reason: err?.message ?? 'Error desconegut en assignar',
      });
    }
  }

  return result;
};
