import { prisma } from '../../config/db';
import { envs } from '../../config/env';
import { runClassificationGraph } from './graph';
import { broadcastToRole } from '../sse';
import { Role } from '../../../generated/prisma';

/**
 * Punt d'entrada únic del sistema d'auto-classificació.
 *
 * Convenció: aquesta funció és **fire-and-forget** — el creador del report
 * la dispara amb `void` i no l'espera. Capturem qualsevol error aquí dins
 * perquè un fallada de Gemini no propagui mai a la response HTTP.
 */
export const classifyReport = async (reportId: string): Promise<void> => {
  // Si no tenim API key, sortim silenciosament. Hem avisat per consola al
  // boot (env.ts), no cal contaminar els logs cada vegada que es crea un report.
  if (!envs.GEMINI_API_KEY) return;

  try {
    const report = await prisma.report.findUnique({
      where: { report_id: reportId },
      include: {
        // Necessitem només la imatge INITIAL (la que ha pujat l'usuari al crear).
        // Les RESOLUTION/PROGRESS són del tècnic — no apliquen a la classificació
        // inicial. Si en el futur volem re-classificar amb noves imatges,
        // canviarem aquesta política.
        images: { where: { type: 'INITIAL' }, take: 1 },
      },
    });
    if (!report) return;

    const result = await runClassificationGraph({
      title: report.title,
      description: report.description,
      userCategory: report.category,
      imageUrl: report.images[0]?.url ?? null,
    });

    // Auto-aplicar sempre (decisió del Sprint 6, sense llindar de confiança).
    // L'`aiClassifiedAt` deixa traça d'auditoria — sabem que aquests valors
    // els ha posat l'IA i quan.
    await prisma.report.update({
      where: { report_id: reportId },
      data: {
        category: result.category,
        priority: result.priority,
        aiSummary: result.summary || null,
        aiClassifiedAt: new Date(),
      },
    });

    // Esdeveniment SSE perquè el dashboard admin es refresqui en viu (la
    // categoria, prioritat i resum poden haver canviat). Tanca el cercle
    // amb el sistema de notificacions del Sprint 5.
    broadcastToRole(Role.ADMIN, {
      type: 'report.classified',
      reportId,
      category: result.category,
      priority: result.priority,
    });
  } catch (err) {
    // Ni un fallada de Gemini ni un error de validació han d'aturar res.
    // El report queda amb la categoria/prioritat que hagi triat l'usuari
    // i l'admin sempre pot rectificar manualment.
    console.error(`[classification] Error classificant ${reportId}:`, err);
  }
};
