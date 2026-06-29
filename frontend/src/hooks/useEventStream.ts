import { useEffect, useRef } from 'react';
import { requestStreamTicket } from '../api/events';
import { API_BASE } from '../api/client';

/**
 * Tipus dels esdeveniments que el backend pot enviar pel canal SSE.
 * Han de coincidir amb `SseEvent` de `backend/src/services/sse.ts`.
 */
export type DashboardEvent =
  | { type: 'report.created'; reportId: string }
  | {
      type: 'report.transitioned';
      reportId: string;
      from: string;
      to: string;
      event: string;
    }
  | { type: 'report.priority_changed'; reportId: string; priority: string }
  | { type: 'report.comment_added'; reportId: string; commentId: string }
  | {
      type: 'report.classified';
      reportId: string;
      category: string;
      priority: string;
    }
  | { type: 'points.awarded'; userId: string; reportId: string; amount: number }
  | { type: 'invite.created'; inviteId: string }
  | { type: 'invite.used'; inviteId: string }
  | { type: 'invite.revoked'; inviteId: string };

type Handler = (event: DashboardEvent) => void;

/**
 * Hook que obre una connexió SSE al backend i invoca `onEvent` cada vegada
 * que arriba un esdeveniment de domini.
 *
 * Flux:
 *   1. Demana un ticket d'un sol ús a /api/events/ticket (autenticat amb JWT).
 *   2. Obre `EventSource` cap a /api/events/stream?ticket=...
 *   3. Registra listeners per a cada tipus d'esdeveniment.
 *   4. Si la connexió cau, EventSource auto-reconnecta sol; nosaltres només
 *      hem de demanar un ticket nou (el ticket s'ha consumit) — fem servir
 *      l'event 'error' per detectar-ho i reciclar.
 *
 * Es desconnecta automàticament al desmuntar el component.
 *
 * Important: passem el handler a través d'un ref per no haver de recrear la
 * connexió cada vegada que el component re-renderitza amb un handler nou.
 */
export const useEventStream = (
  enabled: boolean,
  onEvent: Handler,
): void => {
  const handlerRef = useRef(onEvent);

  // Mantenim el handler actualitzat sense provocar reconnexions.
  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled) return;

    let source: EventSource | null = null;
    let cancelled = false;
    let reconnectTimer: number | null = null;

    const connect = async () => {
      try {
        const ticket = await requestStreamTicket();
        if (cancelled) return;

        // En dev, API_BASE és `/api` i el proxy de Vite redirigeix al backend.
        // En prod amb dominis separats (Vercel + Render), API_BASE és la URL
        // absoluta del backend, de manera que el SSE connecta directament i no
        // passa per cap proxy que el pugui bufferitzar.
        source = new EventSource(`${API_BASE}/events/stream?ticket=${encodeURIComponent(ticket)}`);

        const dispatch = (raw: MessageEvent) => {
          try {
            const data = JSON.parse(raw.data) as DashboardEvent;
            handlerRef.current(data);
          } catch {
            // Si el payload no és JSON vàlid, ignorem en silenci.
          }
        };

        // Cal registrar un listener per cada `type` perquè el backend els envia
        // amb la línia `event:` (necessari per a SSE tipats). Així evitem
        // un switch al `onmessage` genèric.
        source.addEventListener('report.created', dispatch);
        source.addEventListener('report.transitioned', dispatch);
        source.addEventListener('report.priority_changed', dispatch);
        source.addEventListener('report.comment_added', dispatch);
        source.addEventListener('report.classified', dispatch);
        source.addEventListener('points.awarded', dispatch);
        source.addEventListener('invite.created', dispatch);
        source.addEventListener('invite.used', dispatch);
        source.addEventListener('invite.revoked', dispatch);

        source.onerror = () => {
          // Si la connexió mor, EventSource intentarà reconnectar amb el mateix
          // URL — però el ticket ja està consumit, així que tancariem i
          // demanem un de nou. Backoff de 3s per no martellejar el servidor.
          if (cancelled) return;
          source?.close();
          source = null;
          reconnectTimer = window.setTimeout(connect, 3000);
        };
      } catch (err) {
        if (cancelled) return;
        // El ticket ha fallat (p. ex. JWT caducat). Reintentem en 5s.
        reconnectTimer = window.setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [enabled]);
};
