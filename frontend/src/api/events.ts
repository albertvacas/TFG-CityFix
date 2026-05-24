import client from './client';

/**
 * Bescanvi del JWT (a localStorage, gestionat per axios) per un ticket
 * efímer d'un sol ús, que sí pot viatjar com a query param a EventSource.
 */
export const requestStreamTicket = async (): Promise<string> => {
  const { data } = await client.post<{ ticket: string; expiresInSeconds: number }>(
    '/events/ticket',
  );
  return data.ticket;
};
