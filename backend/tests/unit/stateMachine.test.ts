import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { incidentMachine, type IncidentInput } from '../../src/machines/stateMachine';
import type { Role } from '../../generated/prisma/client';

/**
 * Tests de la màquina d'estats de les incidències (RF-04).
 *
 * És el cor de la lògica de negoci i és 100% determinista: no toca BD ni xarxa.
 * Validem la matriu completa estat × esdeveniment × rol tal com la fa servir
 * el servei report.ts (resolveState per restaurar l'estat de la BD + can()
 * per comprovar si la transició és permesa abans d'executar-la).
 */

type IncidentState = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'VALIDATED' | 'CLOSED';
type IncidentEventType = 'ASSIGN' | 'START' | 'REASSIGN' | 'RESOLVE' | 'CLOSE' | 'REJECT';

/** Restaura la màquina en un estat concret i comprova si l'esdeveniment és permès per a aquest rol. */
function canTransition(from: IncidentState, event: IncidentEventType, role: Role): boolean {
  const context = { incidentId: 'report-1', role, userId: 'user-1' };
  const input: IncidentInput = context;
  const snapshot = incidentMachine.resolveState({ value: from, context });
  const actor = createActor(incidentMachine, { snapshot, input });
  actor.start();
  const allowed = actor.getSnapshot().can({ type: event });
  actor.stop();
  return allowed;
}

/** Executa la transició i retorna l'estat destí (o el mateix estat si es rebutja). */
function nextState(from: IncidentState, event: IncidentEventType, role: Role): string {
  const context = { incidentId: 'report-1', role, userId: 'user-1' };
  const input: IncidentInput = context;
  const snapshot = incidentMachine.resolveState({ value: from, context });
  const actor = createActor(incidentMachine, { snapshot, input });
  actor.start();
  actor.send({ type: event });
  const state = actor.getSnapshot().value as string;
  actor.stop();
  return state;
}

describe('incidentMachine — transicions vàlides (camí feliç)', () => {
  // Matriu de la documentació: [estat origen, esdeveniment, estat destí, rol permès]
  const happyPath: Array<[IncidentState, IncidentEventType, IncidentState, Role]> = [
    ['OPEN', 'ASSIGN', 'ASSIGNED', 'TECHNICAL'],
    ['OPEN', 'ASSIGN', 'ASSIGNED', 'ADMIN'],
    ['ASSIGNED', 'START', 'IN_PROGRESS', 'TECHNICAL'],
    ['ASSIGNED', 'REASSIGN', 'OPEN', 'ADMIN'],
    ['IN_PROGRESS', 'RESOLVE', 'VALIDATED', 'TECHNICAL'],
    ['IN_PROGRESS', 'REASSIGN', 'ASSIGNED', 'ADMIN'],
    ['VALIDATED', 'CLOSE', 'CLOSED', 'ADMIN'],
    ['VALIDATED', 'REJECT', 'IN_PROGRESS', 'ADMIN'],
  ];

  it.each(happyPath)('%s --%s(%s)--> %s', (from, event, to, role) => {
    expect(canTransition(from, event, role)).toBe(true);
    expect(nextState(from, event, role)).toBe(to);
  });
});

describe('incidentMachine — RBAC: rols sense permís', () => {
  it('un STUDENT no pot assignar una incidència', () => {
    expect(canTransition('OPEN', 'ASSIGN', 'STUDENT')).toBe(false);
  });

  it('un STUDENT no pot iniciar la feina', () => {
    expect(canTransition('ASSIGNED', 'START', 'STUDENT')).toBe(false);
  });

  it('un TECHNICAL no pot reassignar (només ADMIN)', () => {
    expect(canTransition('ASSIGNED', 'REASSIGN', 'TECHNICAL')).toBe(false);
  });

  it('un TECHNICAL no pot tancar una incidència (només ADMIN)', () => {
    expect(canTransition('VALIDATED', 'CLOSE', 'TECHNICAL')).toBe(false);
  });

  it('un STUDENT no pot resoldre una incidència', () => {
    expect(canTransition('IN_PROGRESS', 'RESOLVE', 'STUDENT')).toBe(false);
  });

  it('un TECHNICAL no pot rebutjar una validació (només ADMIN)', () => {
    expect(canTransition('VALIDATED', 'REJECT', 'TECHNICAL')).toBe(false);
  });
});

describe('incidentMachine — transicions impossibles (esdeveniment fora d\'estat)', () => {
  const invalid: Array<[IncidentState, IncidentEventType]> = [
    ['OPEN', 'START'],
    ['OPEN', 'RESOLVE'],
    ['OPEN', 'CLOSE'],
    ['ASSIGNED', 'RESOLVE'],
    ['ASSIGNED', 'CLOSE'],
    ['IN_PROGRESS', 'ASSIGN'],
    ['IN_PROGRESS', 'CLOSE'],
    ['VALIDATED', 'ASSIGN'],
    ['VALIDATED', 'START'],
  ];

  it.each(invalid)('no es pot fer %s des de l\'estat %s ni essent ADMIN', (from, event) => {
    expect(canTransition(from, event, 'ADMIN')).toBe(false);
  });
});

describe('incidentMachine — CLOSED és estat final', () => {
  it('cap esdeveniment és permès des de CLOSED', () => {
    const events: IncidentEventType[] = ['ASSIGN', 'START', 'REASSIGN', 'RESOLVE', 'CLOSE', 'REJECT'];
    for (const event of events) {
      expect(canTransition('CLOSED', event, 'ADMIN')).toBe(false);
    }
  });
});
