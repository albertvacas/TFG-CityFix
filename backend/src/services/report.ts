import { createActor } from 'xstate';
import { prisma } from '../config/db';
import { incidentMachine } from '../machines/stateMachine';
import { CreateReportDTO, IncidentEvent } from '../types';
import { Role, State } from '../../generated/prisma';

export const createReport = async (data: CreateReportDTO, userId: string) => {
  return prisma.report.create({
    data: {
      title: data.title,
      description: data.description,
      latitude: data.latitude,
      longitude: data.longitude,
      category: data.category,
      createdById: userId,
    },
    include: { createdBy: { select: { user_id: true, name: true, nickname: true } } },
  });
};

export const getReportById = async (id: string) => {
  return prisma.report.findUnique({
    where: { report_id: id },
    include: {
      createdBy: { select: { user_id: true, name: true, nickname: true, role: true } },
      assignedTo: { select: { user_id: true, name: true, nickname: true, role: true } },
      images: true,
      comments: true,
    },
  });
};

export const getAllReports = async (filters?: { state?: State; priority?: string }) => {
  return prisma.report.findMany({
    where: {
      ...(filters?.state && { state: filters.state }),
    },
    include: {
      createdBy: { select: { user_id: true, name: true, nickname: true } },
      assignedTo: { select: { user_id: true, name: true, nickname: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Transiciona el estado de una incidencia usando XState.
 * Valida que la transición sea legal según el estado actual y el rol del usuario.
 */
export const transitionReport = async (
  reportId: string,
  event: IncidentEvent,
  userId: string,
  role: Role,
  assignedToId?: string,
) => {
  const report = await prisma.report.findUnique({ where: { report_id: reportId } });
  if (!report) throw new Error('Incidencia no encontrada');

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

  // Actualizar en DB con el nuevo estado
  return prisma.report.update({
    where: { report_id: reportId },
    data: {
      state: newState,
      ...(event === 'ASSIGN' && assignedToId ? { assignedToId } : {}),
      ...(newState === 'CLOSED' ? { resolvedAt: new Date() } : {}),
    },
    include: {
      createdBy: { select: { user_id: true, name: true, nickname: true } },
      assignedTo: { select: { user_id: true, name: true, nickname: true } },
    },
  });
};
