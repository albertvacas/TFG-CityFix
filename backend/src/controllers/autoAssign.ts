import { Response } from 'express';
import type { AuthRequest } from '../types';
import * as autoAssignService from '../services/autoAssign';

/**
 * POST /api/reports/auto-assign
 * Body: { reportIds: string[] }
 *
 * Només admins. Auto-assigna cada report al tècnic que (a) tingui la
 * `workCategory` que coincideixi amb la categoria del report i (b) tingui
 * menys càrrega de feina actual.
 *
 * Resposta: { assigned: [...], skipped: [...] }
 *   - `assigned`: reports assignats correctament (amb tècnic triat)
 *   - `skipped`: reports que no s'han pogut assignar amb la raó (no OPEN, sense
 *     categoria, cap tècnic compatible, etc.)
 */
export const autoAssign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { reportIds } = req.body ?? {};

    if (!Array.isArray(reportIds) || reportIds.length === 0) {
      res.status(400).json({ error: 'reportIds ha de ser un array no buit de strings' });
      return;
    }
    if (reportIds.some((id) => typeof id !== 'string')) {
      res.status(400).json({ error: 'Tots els reportIds han de ser strings' });
      return;
    }
    if (reportIds.length > 50) {
      // Límit defensiu per evitar abús accidental. 50 és més que suficient
      // per al volum demostrable d'un TFG.
      res.status(400).json({ error: 'Màxim 50 reports per crida' });
      return;
    }

    const result = await autoAssignService.autoAssignReports({
      reportIds,
      actorId: req.user!.userId,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
