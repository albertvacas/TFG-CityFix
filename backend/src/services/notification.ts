import { prisma } from '../config/db';
import { NotificationType, Role } from '../../generated/prisma';
import { sendPushBatch, isValidExpoPushToken, type ExpoPushMessage } from './expoPush';
import { broadcastToRole, type SseEvent } from './sse';

/**
 * NotificationService — punt únic d'orquestració de notificacions.
 *
 * Cada vegada que passa alguna cosa rellevant en una incidència (transició,
 * creació, comentari, canvi de prioritat...), els controladors / serveis
 * criden aquí. Aquesta capa s'encarrega de:
 *
 *   1. Persistir la notificació a la taula `notifications` (historial in-app
 *      del mòbil: campana, badge, llista).
 *   2. Enviar el push a Expo per als tokens actius del destinatari.
 *   3. Emetre un esdeveniment SSE a tots els admins connectats al dashboard
 *      perquè la UI web es refresqui en temps real.
 *
 * Regla universal de destinataris: l'actor que provoca l'esdeveniment
 * (qui fa la transició, qui escriu el comentari) MAI rep notificació de la
 * seva pròpia acció.
 *
 * Tot el que sigui xarxa externa (Expo, SSE) s'executa amb `Promise.allSettled`
 * sense bloquejar el camí crític de la request — així una caiguda temporal
 * d'Expo no afecta la latència de la transició d'estat.
 */

// ────────────────────────────────────────────────────────────────────────────
// Helpers interns
// ────────────────────────────────────────────────────────────────────────────

/**
 * Crea una entrada a `notifications` i envia push als dispositius actius del
 * destinatari. No emet SSE (això es fa a part, vegeu `notifyAdminsSse`).
 */
const persistAndPush = async (params: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  reportId?: string | null;
}): Promise<void> => {
  const notification = await prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      reportId: params.reportId ?? null,
    },
  });

  const tokens = await prisma.pushToken.findMany({
    where: { userId: params.userId, active: true },
    select: { token: true },
  });

  if (tokens.length === 0) return;

  const messages: ExpoPushMessage[] = tokens
    .filter((t) => isValidExpoPushToken(t.token))
    .map((t) => ({
      to: t.token,
      title: params.title,
      body: params.body,
      sound: 'default',
      data: {
        notificationId: notification.id,
        type: params.type,
        reportId: params.reportId ?? null,
      },
    }));

  if (messages.length === 0) return;

  try {
    const tickets = await sendPushBatch(messages);
    // Si Expo retorna immediatament `DeviceNotRegistered`, marquem el token
    // com a inactiu per no tornar a intentar enviar-li res.
    await Promise.all(
      tickets.map(async (ticket, idx) => {
        if (
          ticket.status === 'error' &&
          ticket.details?.error === 'DeviceNotRegistered'
        ) {
          const badToken = messages[idx]?.to;
          if (badToken) {
            await prisma.pushToken.updateMany({
              where: { token: badToken },
              data: { active: false },
            });
          }
        }
      }),
    );
  } catch (err) {
    // No volem que un error d'Expo trenqui la transició d'estat: només loggegem.
    console.error('[NotificationService] Error enviant push:', err);
  }
};

/**
 * Emet un SseEvent a tots els admins connectats. Pensat per refrescar el
 * dashboard / mapa en temps real.
 */
const notifyAdminsSse = (event: SseEvent): void => {
  try {
    broadcastToRole(Role.ADMIN, event);
  } catch (err) {
    console.error('[NotificationService] Error emetent SSE:', err);
  }
};

// ────────────────────────────────────────────────────────────────────────────
// API pública: una funció per cada esdeveniment de domini
// ────────────────────────────────────────────────────────────────────────────

/**
 * Una incidència s'ha creat. Per requisit, no es notifica al propi autor.
 * Només emetem SSE perquè el dashboard admin la mostri al moment.
 */
export const onReportCreated = (reportId: string): void => {
  notifyAdminsSse({ type: 'report.created', reportId });
};

/**
 * Una incidència ha canviat de prioritat (acció admin). SSE per al dashboard.
 */
export const onReportPriorityChanged = (reportId: string, priority: string): void => {
  notifyAdminsSse({ type: 'report.priority_changed', reportId, priority });
};

/**
 * Hi ha un comentari nou en una incidència.
 *
 * Política: notifiquem el tècnic assignat i l'autor del report. L'autor del
 * comentari (sigui qui sigui) no es notifica mai a si mateix.
 *
 * El SSE va sempre per als admins (per refrescar el detall obert al panell).
 */
export const onCommentAdded = async (params: {
  reportId: string;
  commentId: string;
  authorId: string;
  reportCreatorId: string;
  reportAssigneeId: string | null;
  reportTitle: string;
}): Promise<void> => {
  notifyAdminsSse({
    type: 'report.comment_added',
    reportId: params.reportId,
    commentId: params.commentId,
  });

  const recipients = new Set<string>();
  recipients.add(params.reportCreatorId);
  if (params.reportAssigneeId) recipients.add(params.reportAssigneeId);
  recipients.delete(params.authorId); // l'autor mai es notifica

  await Promise.allSettled(
    [...recipients].map((userId) =>
      persistAndPush({
        userId,
        type: NotificationType.REPORT_STATE_CHANGED,
        title: 'Nou comentari',
        body: `Hi ha un missatge nou a "${params.reportTitle}"`,
        reportId: params.reportId,
      }),
    ),
  );
};

/**
 * Una incidència ha transicionat d'estat. Funció central que decideix qui rep
 * push segons l'esdeveniment XState.
 *
 * Regles:
 *  - L'autor del report SEMPRE rep notificació en QUALSEVOL transició
 *    (excepte si l'actor és ell mateix, cas que no es dóna perquè els
 *    estudiants no poden transicionar).
 *  - ASSIGN → tècnic nou rep "tasca assignada".
 *  - REASSIGN → tècnic anterior rep "tasca retirada"; tècnic nou (si n'hi ha)
 *    rep "tasca reassignada".
 *  - L'actor (qui fa la transició) MAI es notifica a si mateix.
 *
 * Sempre emetem SSE per als admins, independentment del rol de l'actor.
 */
export const onReportTransitioned = async (params: {
  reportId: string;
  reportTitle: string;
  fromState: string;
  toState: string;
  event: string;
  actorId: string;
  reportCreatorId: string;
  newAssigneeId: string | null;
  previousAssigneeId: string | null;
}): Promise<void> => {
  notifyAdminsSse({
    type: 'report.transitioned',
    reportId: params.reportId,
    from: params.fromState,
    to: params.toState,
    event: params.event,
  });

  const tasks: Promise<void>[] = [];

  // Missatges que rebrà l'autor del report segons l'esdeveniment.
  const studentMessages: Record<string, { title: string; body: string }> = {
    ASSIGN: {
      title: "S'ha assignat la teva incidència",
      body: `Un tècnic s'encarregarà de: ${params.reportTitle}`,
    },
    START: {
      title: 'La teva incidència està en procés',
      body: `Un tècnic ha començat: ${params.reportTitle}`,
    },
    REASSIGN: {
      title: "S'ha reassignat la teva incidència",
      body: `Canvi de tècnic a: ${params.reportTitle}`,
    },
    RESOLVE: {
      title: 'Incidència resolta',
      body: `Pendent de validació: ${params.reportTitle}`,
    },
    REJECT: {
      title: 'Resolució rebutjada',
      body: `S'ha tornat a obrir la teva incidència: ${params.reportTitle}`,
    },
    CLOSE: {
      title: 'Incidència tancada',
      body: `S'ha tancat: ${params.reportTitle}`,
    },
  };

  // Notificació per a l'autor del report en QUALSEVOL transició.
  const studentMsg = studentMessages[params.event];
  if (studentMsg && params.reportCreatorId !== params.actorId) {
    tasks.push(
      persistAndPush({
        userId: params.reportCreatorId,
        type: NotificationType.REPORT_STATE_CHANGED,
        title: studentMsg.title,
        body: studentMsg.body,
        reportId: params.reportId,
      }),
    );
  }

  // Lògica específica de tècnics per ASSIGN i REASSIGN.
  switch (params.event) {
    case 'ASSIGN': {
      if (params.newAssigneeId && params.newAssigneeId !== params.actorId) {
        tasks.push(
          persistAndPush({
            userId: params.newAssigneeId,
            type: NotificationType.REPORT_ASSIGNED,
            title: 'Nova tasca assignada',
            body: `T'han assignat: ${params.reportTitle}`,
            reportId: params.reportId,
          }),
        );
      }
      break;
    }
    case 'REASSIGN': {
      if (
        params.previousAssigneeId &&
        params.previousAssigneeId !== params.actorId
      ) {
        tasks.push(
          persistAndPush({
            userId: params.previousAssigneeId,
            type: NotificationType.REPORT_UNASSIGNED,
            title: 'Tasca retirada',
            body: `Se t'ha retirat: ${params.reportTitle}`,
            reportId: params.reportId,
          }),
        );
      }
      if (
        params.newAssigneeId &&
        params.newAssigneeId !== params.actorId &&
        params.newAssigneeId !== params.previousAssigneeId
      ) {
        tasks.push(
          persistAndPush({
            userId: params.newAssigneeId,
            type: NotificationType.REPORT_REASSIGNED,
            title: 'Tasca reassignada a tu',
            body: `T'han reassignat: ${params.reportTitle}`,
            reportId: params.reportId,
          }),
        );
      }
      break;
    }
    case 'CLOSE': {
      if (params.newAssigneeId && params.newAssigneeId !== params.actorId) {
        tasks.push(
          persistAndPush({
            userId: params.newAssigneeId,
            type: NotificationType.REPORT_STATE_CHANGED,
            title: 'Resolució validada',
            body: `L'admin ha validat i tancat: ${params.reportTitle}`,
            reportId: params.reportId,
          }),
        );
      }
      break;
    }
  }

  await Promise.allSettled(tasks);
};

/**
 * Un estudiant ha guanyat punts perquè la seva incidència s'ha tancat.
 * Push + entrada a notifications + SSE perquè el dashboard admin pugui
 * refrescar el rànquing/historial de punts en temps real si la vista és oberta.
 */
export const onPointsEarned = (params: {
  userId: string;
  reportId: string;
  reportTitle: string;
  amount: number;
  newTotal: number;
}): void => {
  // SSE per al dashboard admin: la pàgina de punts pot refrescar-se.
  notifyAdminsSse({
    type: 'points.awarded',
    userId: params.userId,
    reportId: params.reportId,
    amount: params.amount,
  });

  void persistAndPush({
    userId: params.userId,
    type: NotificationType.POINTS_EARNED,
    title: `Has guanyat ${params.amount} punts!`,
    body: `S'ha tancat la teva incidència "${params.reportTitle}". Total: ${params.newTotal} punts.`,
    reportId: params.reportId,
  });
};

/**
 * Esdeveniments del cicle de vida d'una invitació. Només emeten SSE als admins
 * perquè el panell d'accessos (InvitesPage) es refresqui a l'instant sense
 * polling. El cas clau és `onInviteUsed`: quan algú es registra amb el token,
 * l'admin que té la pantalla oberta veu l'invitació passar a "Utilitzada" i el
 * nou usuari aparèixer a la taula de privilegiats immediatament.
 */
export const onInviteCreated = (inviteId: string): void => {
  notifyAdminsSse({ type: 'invite.created', inviteId });
};

export const onInviteUsed = (inviteId: string): void => {
  notifyAdminsSse({ type: 'invite.used', inviteId });
};

export const onInviteRevoked = (inviteId: string): void => {
  notifyAdminsSse({ type: 'invite.revoked', inviteId });
};

// ────────────────────────────────────────────────────────────────────────────
// API pública: gestió de tokens i historial
// ────────────────────────────────────────────────────────────────────────────

export const registerPushToken = async (params: {
  userId: string;
  token: string;
  platform: string;
}): Promise<void> => {
  // Si el token ja existia (mateix dispositiu, mateix usuari), només actualitzem
  // `lastSeenAt` i el reactivem si havia estat marcat com a inactiu.
  await prisma.pushToken.upsert({
    where: { token: params.token },
    create: {
      token: params.token,
      platform: params.platform,
      userId: params.userId,
    },
    update: {
      userId: params.userId,
      platform: params.platform,
      active: true,
      lastSeenAt: new Date(),
    },
  });
};

export const unregisterPushToken = async (token: string): Promise<void> => {
  await prisma.pushToken.updateMany({
    where: { token },
    data: { active: false },
  });
};

export const listNotifications = async (
  userId: string,
  options?: { unreadOnly?: boolean; limit?: number },
) => {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(options?.unreadOnly ? { read: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options?.limit ?? 50, 100),
  });
};

export const countUnreadNotifications = async (userId: string): Promise<number> => {
  return prisma.notification.count({ where: { userId, read: false } });
};

export const markNotificationRead = async (
  notificationId: string,
  userId: string,
): Promise<void> => {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
};

export const markAllNotificationsRead = async (userId: string): Promise<void> => {
  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
};
