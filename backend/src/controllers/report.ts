import { Response } from 'express';
import { AuthRequest, IncidentEvent } from '../types';
import * as reportService from '../services/report';
import { Priority, State, TypeImage } from '../../generated/prisma/client';
import { parsePagination, hasPagination } from '../utils/pagination';

const VALID_PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

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
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
    const state = typeof req.query.state === 'string' ? (req.query.state as State) : undefined;
    const createdById = typeof req.query.createdById === 'string' ? req.query.createdById : undefined;
    const assignedToId = typeof req.query.assignedToId === 'string' ? req.query.assignedToId : undefined;
    const dateFrom = typeof req.query.dateFrom === 'string' ? new Date(req.query.dateFrom) : undefined;
    const dateTo = typeof req.query.dateTo === 'string' ? new Date(req.query.dateTo) : undefined;

    // Paginació opt-in: si el client envia `page`, retornem metadades; si no
    // (p. ex. el mòbil, que ja filtra per usuari), retornem totes les coincidències.
    const paginate = hasPagination(req.query);
    const { page, pageSize } = parsePagination(req.query);

    const result = await reportService.getAllReports({
      q,
      state,
      createdById,
      assignedToId,
      dateFrom: dateFrom && !isNaN(dateFrom.getTime()) ? dateFrom : undefined,
      dateTo: dateTo && !isNaN(dateTo.getTime()) ? dateTo : undefined,
      // Visibilitat per rol: STUDENT veu només les seves; TECHNICAL només les
      // assignades; ADMIN veu tot. Es força al backend per evitar que un usuari
      // pugui llegir incidències d'altres cridant l'API directament.
      viewer: { role: req.user!.role, userId: req.user!.userId },
      ...(paginate ? { page, pageSize } : {}),
    });

    if (paginate) {
      res.json({ reports: result.reports, total: result.total, page, pageSize });
    } else {
      res.json({ reports: result.reports });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updatePriority = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { priority } = req.body ?? {};
    if (!priority || !VALID_PRIORITIES.includes(priority)) {
      res.status(400).json({
        error: `Prioritat invàlida. Vàlides: ${VALID_PRIORITIES.join(', ')}`,
      });
      return;
    }

    const report = await reportService.updateReportPriority(req.params.id as string, priority);
    res.json({ report });
  } catch (error: any) {
    if (error.message?.includes('no encontrada') || error.message?.includes('no trobada')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message });
  }
};

export const transition = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { event, assignedToId, comment } = req.body;

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

    // REJECT obliga a deixar constància del motiu — el comentari és la traça
    // que l'autor i el tècnic veuran al timeline.
    if (event === 'REJECT' && (typeof comment !== 'string' || !comment.trim())) {
      res.status(400).json({ error: 'REJECT requereix un comentari amb el motiu del rebuig' });
      return;
    }

    if (comment !== undefined && typeof comment !== 'string') {
      res.status(400).json({ error: '"comment" ha de ser una cadena de text' });
      return;
    }

    const report = await reportService.transitionReport(
      req.params.id as string,
      event,
      req.user!.userId,
      req.user!.role,
      { assignedToId, comment },
    );
    res.json({ report });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

const VALID_IMAGE_TYPES: TypeImage[] = ['INITIAL', 'RESOLUTION', 'PROGRESS'];
const ACCEPTED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export const uploadImage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: 'Falta el fitxer "image" al body multipart' });
      return;
    }
    if (!ACCEPTED_MIMETYPES.includes(file.mimetype)) {
      res.status(415).json({ error: `Tipus de fitxer no suportat: ${file.mimetype}` });
      return;
    }
    const type = (req.body?.type as TypeImage) ?? 'INITIAL';
    if (!VALID_IMAGE_TYPES.includes(type)) {
      res.status(400).json({ error: `Tipus d'imatge invàlid. Vàlids: ${VALID_IMAGE_TYPES.join(', ')}` });
      return;
    }

    const image = await reportService.addReportImage({
      reportId: req.params.id as string,
      type,
      buffer: file.buffer,
      mimetype: file.mimetype,
      userId: req.user!.userId,
      role: req.user!.role,
    });
    res.status(201).json({ image });
  } catch (error: any) {
    if (error.message?.includes('no encontrada') || error.message?.includes('no trobada')) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error.message?.includes('Només')) {
      res.status(403).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message });
  }
};

export const addComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { content } = req.body ?? {};
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'El camp "content" és obligatori i ha de ser una cadena' });
      return;
    }

    const comment = await reportService.addComment({
      reportId: req.params.id as string,
      content,
      userId: req.user!.userId,
      role: req.user!.role,
    });
    res.status(201).json({ comment });
  } catch (error: any) {
    if (error.message?.includes('no encontrada') || error.message?.includes('no trobada')) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error.message?.includes('Només')) {
      res.status(403).json({ error: error.message });
      return;
    }
    if (error.message?.includes('massa llarg') || error.message?.includes('buit')) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error.message });
  }
};
