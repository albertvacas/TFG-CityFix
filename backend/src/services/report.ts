import { createActor } from 'xstate';
import { prisma } from '../config/db';
import { incidentMachine } from '../machines/stateMachine';
import { CreateReportDTO, IncidentEvent } from '../types';
import { Priority, Role, State, TypeImage } from '../../generated/prisma/client';
import { uploadReportImage } from './storage';
import * as notificationService from './notification';
import { classifyReport } from './classification';
import { awardPointsForClosedReport } from './gamification';

// Include compartit perquè totes les respostes de Report tinguin la mateixa forma
// (createdBy / assignedTo amb dades públiques + email per facilitar el contacte
// entre tècnic i reporter, images i comments amb el seu autor). Així el client
// no ha de fer "?? []" per defensar-se contra arrays absents.
const REPORT_INCLUDE = {
  createdBy: { select: { user_id: true, name: true, nickname: true, email: true, role: true } },
  assignedTo: { select: { user_id: true, name: true, nickname: true, email: true, role: true } },
  images: true,
  comments: {
    include: { author: { select: { user_id: true, name: true, nickname: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

// Versió més lleugera per llistats massius (sense email, images, comments —
// estalviem ample de banda i no exposem el correu en llistats).
const REPORT_LIST_INCLUDE = {
  createdBy: { select: { user_id: true, name: true, nickname: true } },
  assignedTo: { select: { user_id: true, name: true, nickname: true } },
} as const;

export const createReport = async (data: CreateReportDTO, userId: string) => {
  const report = await prisma.report.create({
    data: {
      title: data.title,
      description: data.description,
      latitude: data.latitude,
      longitude: data.longitude,
      category: data.category,
      createdById: userId,
    },
    include: REPORT_INCLUDE,
  });

  // SSE per al dashboard admin (no hi ha push: el creador és l'autor i no es
  // notifica a si mateix; els tècnics s'assabentaran al rebre l'ASSIGN).
  notificationService.onReportCreated(report.report_id);

  // Auto-classificació via Gemini. La disparem amb un petit delay perquè el
  // mòbil sol pujar la imatge inicial just després de crear el report (dues
  // crides HTTP separades). Si esperem 3s, normalment la imatge ja està a
  // BD i l'IA pot classificar amb text + imatge alhora. Si l'usuari no ha
  // pujat imatge, classificarà només amb text — fallback acceptable.
  // Fire-and-forget: cap error d'aquí trenca la creació del report.
  setTimeout(() => {
    void classifyReport(report.report_id);
  }, 3000).unref();

  return report;
};

export const getReportById = async (id: string) => {
  return prisma.report.findUnique({
    where: { report_id: id },
    include: REPORT_INCLUDE,
  });
};

export const getAllReports = async (filters?: {
  q?: string;
  state?: State;
  createdById?: string;
  assignedToId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  /** Visibilitat segons rol del peticionari. Si es passa, s'aplica un filtre
   *  implícit a la consulta perquè estudiants i tècnics només vegin les seves. */
  viewer?: { role: Role; userId: string };
  /** Paginació opt-in: si `page` està definit, es retorna {reports,total}
   *  amb skip/take; si no, es retornen totes les coincidències (mòbil). */
  page?: number;
  pageSize?: number;
}) => {
  // dateTo s'interpreta com a fi de dia (inclusiu)
  const dateToInclusive = filters?.dateTo
    ? new Date(filters.dateTo.getTime() + 24 * 60 * 60 * 1000 - 1)
    : undefined;

  // Filtre implícit per visibilitat segons rol. ADMIN no afegeix res (veu tot).
  // Per a STUDENT i TECHNICAL combinem els filtres explícits del client (que
  // l'admin pot fer servir des del dashboard) amb la restricció de propietat.
  const viewerScope =
    filters?.viewer?.role === 'STUDENT'
      ? { createdById: filters.viewer.userId }
      : filters?.viewer?.role === 'TECHNICAL'
      ? { assignedToId: filters.viewer.userId }
      : {};

  const where = {
    ...viewerScope,
    ...(filters?.state && { state: filters.state }),
    ...(filters?.createdById && { createdById: filters.createdById }),
    ...(filters?.assignedToId && { assignedToId: filters.assignedToId }),
    ...((filters?.dateFrom || dateToInclusive) && {
      createdAt: {
        ...(filters?.dateFrom && { gte: filters.dateFrom }),
        ...(dateToInclusive && { lte: dateToInclusive }),
      },
    }),
    ...(filters?.q && {
      OR: [
        { title: { contains: filters.q, mode: 'insensitive' as const } },
        { description: { contains: filters.q, mode: 'insensitive' as const } },
      ],
    }),
  };

  const orderBy = { createdAt: 'desc' as const };

  if (filters?.page !== undefined) {
    const pageSize = filters.pageSize ?? 20;
    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        include: REPORT_LIST_INCLUDE,
        orderBy,
        skip: (filters.page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.report.count({ where }),
    ]);
    return { reports, total };
  }

  const reports = await prisma.report.findMany({ where, include: REPORT_LIST_INCLUDE, orderBy });
  return { reports, total: reports.length };
};

/**
 * Actualitza només la prioritat d'una incidència. Pensat per a l'admin quan
 * revisa la incidència acabada de crear (els reports entren sempre amb el
 * default MEDIUM). No toca cap altre camp i no genera transició d'estat.
 */
export const updateReportPriority = async (reportId: string, priority: Priority) => {
  const exists = await prisma.report.findUnique({
    where: { report_id: reportId },
    select: { report_id: true },
  });
  if (!exists) throw new Error('Incidencia no encontrada');

  const report = await prisma.report.update({
    where: { report_id: reportId },
    data: { priority },
    include: REPORT_INCLUDE,
  });

  notificationService.onReportPriorityChanged(reportId, priority);

  return report;
};

/**
 * Transiciona el estado de una incidencia usando XState.
 * Valida que la transición sea legal según el estado actual y el rol del usuario.
 * Opcionalment, crea un Comment lligat a la transició dins la mateixa transacció.
 */
export const transitionReport = async (
  reportId: string,
  event: IncidentEvent,
  userId: string,
  role: Role,
  options?: { assignedToId?: string; comment?: string },
) => {
  const report = await prisma.report.findUnique({ where: { report_id: reportId } });
  if (!report) throw new Error('Incidencia no encontrada');

  // Recordem l'estat i l'assignat anteriors abans d'actualitzar — els
  // necessitarem per emetre la notificació amb dades correctes (per exemple,
  // saber a qui se li ha "retirat" la tasca en una REASSIGN).
  const previousState = report.state;
  const previousAssigneeId = report.assignedToId;

  // Crear actor XState con el estado actual del report
  const actor = createActor(incidentMachine, {
    input: { incidentId: reportId, role, userId },
    snapshot: incidentMachine.resolveState({ value: report.state, context: { incidentId: reportId, role, userId } }),
  });

  actor.start();

  const canTransition = actor.getSnapshot().can({ type: event });
  if (!canTransition) {
    actor.stop();
    throw new Error(
      `Transición '${event}' no permitida desde estado '${report.state}' con rol '${role}'`,
    );
  }

  actor.send({ type: event });
  const newState = actor.getSnapshot().value as State;
  actor.stop();

  // RF-05: la màquina d'estats valida el rol de QUI assigna; aquí validem el
  // rol de QUI rep la tasca. Una incidència només es pot assignar a un TÈCNIC
  // actiu (s'aplica tant a ASSIGN com a la REASSIGN que torna a ASSIGNED).
  if (options?.assignedToId) {
    const assignee = await prisma.user.findUnique({
      where: { user_id: options.assignedToId },
      select: { role: true, active: true },
    });
    if (!assignee || assignee.role !== Role.TECHNICAL || !assignee.active) {
      throw new Error('Només es pot assignar una incidència a un tècnic actiu');
    }
  }

  // RF-09: per validar una resolució (RESOLVE -> VALIDATED) cal haver adjuntat
  // com a mínim una foto de tipus RESOLUTION (l'evidència del "després"). Així
  // la traçabilitat fotogràfica de la resolució queda garantida pel backend.
  if (event === 'RESOLVE') {
    const resolutionImages = await prisma.image.count({
      where: { reportId, type: 'RESOLUTION' },
    });
    if (resolutionImages === 0) {
      throw new Error(
        'Cal adjuntar almenys una foto de resolució abans de validar la incidència',
      );
    }
  }

  const updateReport = prisma.report.update({
    where: { report_id: reportId },
    data: {
      state: newState,
      ...(event === 'ASSIGN' && options?.assignedToId ? { assignedToId: options.assignedToId } : {}),
      // REASSIGN des de IN_PROGRESS torna a ASSIGNED i ha d'apuntar al nou tècnic;
      // des de ASSIGNED torna a OPEN i alliberem l'assignació (assignedToId = null).
      ...(event === 'REASSIGN' && newState === 'ASSIGNED' && options?.assignedToId
        ? { assignedToId: options.assignedToId }
        : {}),
      ...(event === 'REASSIGN' && newState === 'OPEN' ? { assignedToId: null } : {}),
      ...(newState === 'CLOSED' ? { resolvedAt: new Date() } : {}),
    },
    include: REPORT_INCLUDE,
  });

  // Si hi ha comentari, crear-lo lligat a aquesta transició dins la mateixa transacció
  const trimmedComment = options?.comment?.trim();
  let updated;
  if (trimmedComment) {
    const [, , result] = await prisma.$transaction([
      prisma.comment.create({
        data: {
          content: trimmedComment,
          transitionEvent: event,
          reportId,
          authorId: userId,
        },
      }),
      // Touch implícit (re-emet la lastModified) per coherència; no és estrictament necessari
      prisma.report.update({ where: { report_id: reportId }, data: {} }),
      updateReport,
    ]);
    updated = result;
  } else {
    updated = await updateReport;
  }

  // Notificacions: dispatchades fora del camí crític (no s'espera).
  // Errors d'Expo o SSE no han de fer fallar la transició.
  void notificationService.onReportTransitioned({
    reportId,
    reportTitle: updated.title,
    fromState: previousState,
    toState: newState,
    event,
    actorId: userId,
    reportCreatorId: updated.createdById,
    newAssigneeId: updated.assignedToId,
    previousAssigneeId,
  });

  // Gamificació: si l'admin acaba de tancar la incidència, premiem l'autor
  // (estudiant) amb punts segons la prioritat. L'award és idempotent — si
  // la mateixa transició arribés dues vegades, només compta el primer cop.
  // Disparat fire-and-forget: un error aquí no ha de trencar la transició.
  if (newState === 'CLOSED') {
    void awardPointsForClosedReport(reportId)
      .then((result) => {
        if (result.awarded) {
          notificationService.onPointsEarned({
            userId: updated.createdById,
            reportId,
            reportTitle: updated.title,
            amount: result.amount,
            newTotal: result.newTotal,
          });
        }
      })
      .catch((err) => {
        console.error('[gamification] Error premiant punts:', err);
      });
  }

  return updated;
};

/**
 * Puja una imatge a Supabase Storage i crea la fila Image associada al report.
 * Aplica autoritzacions per tipus:
 *  - INITIAL: només l'autor del report
 *  - RESOLUTION / PROGRESS: només el tècnic assignat (o un ADMIN)
 */
export const addReportImage = async (params: {
  reportId: string;
  type: TypeImage;
  buffer: Buffer;
  mimetype: string;
  userId: string;
  role: Role;
}) => {
  const { reportId, type, buffer, mimetype, userId, role } = params;

  const report = await prisma.report.findUnique({ where: { report_id: reportId } });
  if (!report) throw new Error('Incidencia no encontrada');

  if (type === 'INITIAL' && report.createdById !== userId) {
    throw new Error('Només l\'autor de la incidència pot pujar la foto inicial');
  }
  if ((type === 'RESOLUTION' || type === 'PROGRESS') && role !== 'ADMIN') {
    if (report.assignedToId !== userId) {
      throw new Error('Només el tècnic assignat pot pujar fotos de progrés o resolució');
    }
  }

  const url = await uploadReportImage(reportId, buffer, mimetype);

  return prisma.image.create({
    data: {
      url,
      type,
      reportId,
      uploadedById: userId,
    },
  });
};

/**
 * Crea un comentari de discussió (transitionEvent = null) sobre una incidència.
 * Autoritzat només per als implicats: l'autor del report, el tècnic assignat i
 * els ADMIN. Així evitem soroll d'estudiants no relacionats.
 */
export const addComment = async (params: {
  reportId: string;
  content: string;
  userId: string;
  role: Role;
}) => {
  const { reportId, content, userId, role } = params;

  const trimmed = content.trim();
  if (!trimmed) throw new Error('El contingut del comentari no pot estar buit');
  if (trimmed.length > 2000) throw new Error('El comentari és massa llarg (màxim 2000 caràcters)');

  const report = await prisma.report.findUnique({
    where: { report_id: reportId },
    select: { report_id: true, createdById: true, assignedToId: true },
  });
  if (!report) throw new Error('Incidencia no encontrada');

  const isCreator = report.createdById === userId;
  const isAssignee = report.assignedToId === userId;
  const isAdmin = role === 'ADMIN';

  if (!isCreator && !isAssignee && !isAdmin) {
    throw new Error('Només l\'autor, el tècnic assignat o un administrador poden comentar');
  }

  const comment = await prisma.comment.create({
    data: {
      content: trimmed,
      reportId,
      authorId: userId,
      // transitionEvent queda null → comentari de discussió
    },
    include: { author: { select: { user_id: true, name: true, nickname: true } } },
  });

  // Necessitem el títol del report per al text del push. La fila que hem
  // llegit més amunt només tenia els camps mínims, així que demanem el títol
  // aquí (cost menyspreable, ja és a la cache de Postgres).
  const reportRow = await prisma.report.findUnique({
    where: { report_id: reportId },
    select: { title: true },
  });

  void notificationService.onCommentAdded({
    reportId,
    commentId: comment.id,
    authorId: userId,
    reportCreatorId: report.createdById,
    reportAssigneeId: report.assignedToId,
    reportTitle: reportRow?.title ?? '',
  });

  return comment;
};
