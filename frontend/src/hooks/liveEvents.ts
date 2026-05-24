import { useEffect } from 'react';
import type { DashboardEvent } from './useEventStream';

/**
 * Bus d'esdeveniments interns: un EventTarget singleton al que el hook
 * `useEventStream` (cridat un sol cop al Layout) emet, i al qual les pàgines
 * s'hi subscriuen sense haver de tornar a obrir cap connexió SSE.
 *
 * Per què un EventTarget i no un Context: les pàgines no necessiten
 * re-renderitzar quan arriba un esdeveniment; només necessiten una callback.
 * Un Context provocaria re-renders globals innecessaris.
 */

const bus = new EventTarget();

export const emitLiveEvent = (event: DashboardEvent): void => {
  bus.dispatchEvent(new CustomEvent(event.type, { detail: event }));
};

/**
 * Hook que registra un listener per a un tipus d'esdeveniment concret.
 * `handler` es passa per ref dins del hook, així que pots inline-jar la
 * funció sense provocar re-subscripcions.
 */
export const useLiveEvent = <T extends DashboardEvent['type']>(
  type: T,
  handler: (event: Extract<DashboardEvent, { type: T }>) => void,
): void => {
  useEffect(() => {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<DashboardEvent>).detail;
      handler(detail as Extract<DashboardEvent, { type: T }>);
    };
    bus.addEventListener(type, listener);
    return () => bus.removeEventListener(type, listener);
  }, [type, handler]);
};
