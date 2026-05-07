import { setup } from 'xstate';
import { Role } from '../../generated/prisma';

// Contexto de la máquina: datos que acompañan cada ejecución
interface IncidentContext {
  incidentId: string;
  role: Role;
  userId: string;
}

// Input que se pasa al crear el actor
export interface IncidentInput {
  incidentId: string;
  role: Role;
  userId: string;
}

export const incidentMachine = setup({
  types: {
    context: {} as IncidentContext,
    input: {} as IncidentInput,
    events: {} as
      | { type: 'ASSIGN' }
      | { type: 'START' }
      | { type: 'REASSIGN' }
      | { type: 'RESOLVE' }
      | { type: 'CLOSE' }
      | { type: 'REJECT' },
  },
  guards: {
    isNotStudent: ({ context }) => context.role !== 'STUDENT',
    isTechnicalOrAdmin: ({ context }) => context.role === 'TECHNICAL' || context.role === 'ADMIN',
    isAdmin: ({ context }) => context.role === 'ADMIN',
  },
}).createMachine({
  id: 'incident',
  initial: 'OPEN',
  context: ({ input }) => ({
    incidentId: input.incidentId,
    role: input.role,
    userId: input.userId,
  }),
  states: {
    OPEN: {
      on: {
        ASSIGN: {
          target: 'ASSIGNED',
          guard: 'isNotStudent',
        },
      },
    },
    ASSIGNED: {
      on: {
        START: {
          target: 'IN_PROGRESS',
          guard: 'isNotStudent',
        },
        REASSIGN: {
          target: 'OPEN',
          guard: 'isAdmin',
        },
      },
    },
    IN_PROGRESS: {
      on: {
        RESOLVE: {
          target: 'VALIDATED',
          guard: 'isTechnicalOrAdmin',
        },
        // Reassignació en marxa: si el tècnic actual no pot completar la feina,
        // l'admin pot tornar-la a 'ASSIGNED' apuntant a un altre tècnic.
        REASSIGN: {
          target: 'ASSIGNED',
          guard: 'isAdmin',
        },
      },
    },
    VALIDATED: {
      on: {
        CLOSE: {
          target: 'CLOSED',
          guard: 'isAdmin',
        },
        REJECT: {
          target: 'IN_PROGRESS',
          guard: 'isAdmin',
        },
      },
    },
    CLOSED: {
      type: 'final',
    },
  },
});
