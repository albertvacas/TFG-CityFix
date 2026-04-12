import { Response } from 'express';
import { AuthRequest, IncidentEvent } from '../types';
import * as reportService from '../services/report';
import { State } from '../../generated/prisma';

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, description, latitude, longitude, category } = req.body;

    if (!title || !description || latitude == null || longitude == null) {
      res.status(400).json({ error: 'Faltan campos obligatorios (title, description, latitude, longitude)' });
      return;
    }

    const report = await reportService.createReport(
      { title, description, latitude, longitude, category },
      req.user!.userId,
    );
    res.status(201).json({ report });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const report = await reportService.getReportById(req.params.id as string);
    if (!report) {
      res.status(404).json({ error: 'Incidencia no encontrada' });
      return;
    }
    res.json({ report });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state as State : undefined;
    const reports = await reportService.getAllReports({ state });
    res.json({ reports });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const transition = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { event, assignedToId } = req.body;

    if (!event) {
      res.status(400).json({ error: 'El campo "event" es obligatorio' });
      return;
    }

    const validEvents: IncidentEvent[] = ['ASSIGN', 'START', 'REASSIGN', 'RESOLVE', 'CLOSE', 'REJECT'];
    if (!validEvents.includes(event)) {
      res.status(400).json({ error: `Evento inválido. Eventos válidos: ${validEvents.join(', ')}` });
      return;
    }

    if (event === 'ASSIGN' && !assignedToId) {
      res.status(400).json({ error: 'ASSIGN requiere "assignedToId"' });
      return;
    }

    const report = await reportService.transitionReport(
      req.params.id as string,
      event,
      req.user!.userId,
      req.user!.role,
      assignedToId,
    );
    res.json({ report });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};
