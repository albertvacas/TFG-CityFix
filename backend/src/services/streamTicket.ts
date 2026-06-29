import crypto from 'node:crypto';
import { Role } from '../../generated/prisma/client';

/**
 * Tickets efímers per autoritzar la connexió SSE.
 *
 * Per què: EventSource del navegador no admet capçaleres personalitzades, així
 * que no podem enviar el JWT al header `Authorization` quan obrim el stream.
 * Solució estàndard: el client (autenticat amb JWT) demana primer un ticket
 * d'un sol ús i curta durada, i el passa com a query param a l'endpoint SSE.
 *
 * Si el ticket es filtra (logs, Referer, etc.) caduca al minut. El JWT mai
 * viatja al query string.
 */

interface Ticket {
  userId: string;
  role: Role;
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();
const TICKET_TTL_MS = 60_000; // 1 minut

/**
 * Crea un ticket lligat a l'usuari autenticat. Retorna l'string que el
 * client ha de passar a `/api/events/stream?ticket=...`.
 */
export const issueTicket = (userId: string, role: Role): string => {
  const ticket = crypto.randomBytes(32).toString('base64url');
  tickets.set(ticket, {
    userId,
    role,
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return ticket;
};

/**
 * Consumeix un ticket: el valida, l'esborra i retorna les dades de l'usuari.
 * Un ticket només és vàlid una vegada — així evitem replays si algun proxy
 * el cau-cacheja.
 */
export const consumeTicket = (ticket: string): { userId: string; role: Role } | null => {
  const data = tickets.get(ticket);
  if (!data) return null;

  // Sempre l'esborrem (un sol ús) encara que hagi caducat.
  tickets.delete(ticket);

  if (Date.now() > data.expiresAt) return null;

  return { userId: data.userId, role: data.role };
};

// Neteja periòdica de tickets caducats no consumits, per no acumular memòria
// si un client demana ticket i mai el fa servir.
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tickets.entries()) {
    if (now > value.expiresAt) tickets.delete(key);
  }
}, 60_000).unref();
