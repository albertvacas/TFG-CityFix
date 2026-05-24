import type { Response } from 'express';
import { Role } from '../../generated/prisma';

/**
 * Hub de connexions Server-Sent Events.
 *
 * Per a un projecte mono-instància (un sol procés Node) és suficient mantenir
 * els clients connectats en un Map en memòria. Si en el futur escalem a
 * múltiples instàncies cal substituir-ho per un canal Redis pub/sub.
 *
 * Cada client està lligat a un userId i un role, perquè l'enviament pugui
 * filtrar destinataris ("només admins") sense dependre de la identitat del
 * client.
 */

interface SseClient {
  id: string;
  userId: string;
  role: Role;
  res: Response;
}

// Tipus d'esdeveniments que pot rebre el dashboard admin via SSE.
// Aquests són esdeveniments de domini (no row diffs de Postgres) — així el
// frontend reacciona a "què ha passat" enlloc d'"això ha canviat a la BD".
export type SseEvent =
  | { type: 'report.created'; reportId: string }
  | { type: 'report.transitioned'; reportId: string; from: string; to: string; event: string }
  | { type: 'report.priority_changed'; reportId: string; priority: string }
  | { type: 'report.comment_added'; reportId: string; commentId: string }
  | { type: 'report.classified'; reportId: string; category: string; priority: string }
  | { type: 'heartbeat'; timestamp: number };

const clients = new Map<string, SseClient>();

/**
 * Registra un client SSE i li envia el handshake inicial.
 * Retorna una funció de cleanup que cal cridar quan el client es desconnecti.
 */
export const addClient = (userId: string, role: Role, res: Response): (() => void) => {
  const id = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Capçaleres SSE: text/event-stream + no-cache + keep-alive.
  // L'últim és imprescindible perquè els proxies (nginx, etc.) no tallin la
  // connexió per inactivitat.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Desactiva buffering en nginx
  res.flushHeaders?.();

  // Comentari inicial (línia que comença per ":") perquè EventSource consideri
  // la connexió oberta de seguida.
  res.write(`: connected ${id}\n\n`);

  clients.set(id, { id, userId, role, res });

  return () => {
    clients.delete(id);
  };
};

/**
 * Envia un esdeveniment a tots els clients amb el rol indicat.
 * Per ara només els ADMIN escolten el stream del dashboard.
 */
export const broadcastToRole = (role: Role, event: SseEvent): void => {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

  for (const client of clients.values()) {
    if (client.role !== role) continue;
    try {
      client.res.write(payload);
    } catch {
      // Si l'escriptura falla (client mort), eliminem el registre.
      clients.delete(client.id);
    }
  }
};

/**
 * Heartbeat periòdic perquè els proxies i el navegador no tanquin la connexió.
 * S'envia com a comentari (línia ":"), no com a esdeveniment, per no soroll
 * al client.
 */
const HEARTBEAT_MS = 25_000;
setInterval(() => {
  for (const client of clients.values()) {
    try {
      client.res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clients.delete(client.id);
    }
  }
}, HEARTBEAT_MS).unref();

export const getConnectedCount = (): number => clients.size;
