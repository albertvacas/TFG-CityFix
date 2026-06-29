/**
 * Avaluació empírica de la classificació automàtica per IA (RF-14 / RF-15).
 *
 * Executa cada cas del conjunt d'avaluació (ai-dataset.ts) pel mateix graf
 * LangGraph + Gemini que fa servir producció (runClassificationGraph) i compara
 * la sortida amb la golden label. Reporta:
 *   - Exactitud de CATEGORIA (encert exacte).
 *   - Exactitud de PRIORITAT (exacte i "± 1 nivell", perquè la prioritat és
 *     intrínsecament subjectiva).
 *   - Taula cas a cas, per a la discussió qualitativa de l'informe.
 *   - Una matriu de confusió compacta de categories.
 *
 * Ús:
 *   npx tsx bench/eval-ai.ts
 *   DELAY_MS=7000 npx tsx bench/eval-ai.ts   # respecta el free tier (10 RPM)
 *
 * Requereix GEMINI_API_KEY al .env. NOMÉS fa crides al model; no toca la BD.
 */

import { runClassificationGraph } from '../src/services/classification/graph';
import { Priority } from '../generated/prisma/client';
import { EVAL_CASES, type EvalCase } from './ai-dataset';
import { envs } from '../src/config/env';

// Free tier de gemini-2.5-flash: 10 RPM. Per defecte esperem 7s entre crides
// per no xocar amb el límit. Si tens un compte de pagament, posa DELAY_MS=0.
const DELAY_MS = Number(process.env.DELAY_MS ?? 7000);

const PRIORITY_ORDER: Record<Priority, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CaseResult {
  c: EvalCase;
  predCategory: string;
  predPriority: string;
  summary: string;
  catOk: boolean;
  prioExact: boolean;
  prioWithin1: boolean;
  error?: string;
}

async function main() {
  if (!envs.GEMINI_API_KEY) {
    console.error('✗ GEMINI_API_KEY no configurada al .env. No es pot avaluar.');
    process.exit(1);
  }

  console.log('===========================================================');
  console.log(' Avaluació classificació IA (RF-14) — Gemini 2.5 Flash');
  console.log('===========================================================');
  console.log(`Casos: ${EVAL_CASES.length} | Retard entre crides: ${DELAY_MS} ms\n`);

  const results: CaseResult[] = [];

  for (const [i, c] of EVAL_CASES.entries()) {
    process.stdout.write(`  [${i + 1}/${EVAL_CASES.length}] ${c.id} ... `);
    try {
      const out = await runClassificationGraph({
        title: c.title,
        description: c.description,
        userCategory: c.userCategory,
        imageUrl: null,
      });

      const catOk = out.category === c.expectedCategory;
      const prioExact = out.priority === c.expectedPriority;
      const prioWithin1 =
        Math.abs(PRIORITY_ORDER[out.priority] - PRIORITY_ORDER[c.expectedPriority]) <= 1;

      results.push({
        c,
        predCategory: out.category,
        predPriority: out.priority,
        summary: out.summary,
        catOk,
        prioExact,
        prioWithin1,
      });
      console.log(`cat ${catOk ? 'OK' : 'X'} | prio ${prioExact ? 'OK' : prioWithin1 ? '~' : 'X'}`);
    } catch (err: any) {
      results.push({
        c,
        predCategory: 'ERROR',
        predPriority: 'ERROR',
        summary: '',
        catOk: false,
        prioExact: false,
        prioWithin1: false,
        error: err?.message ?? String(err),
      });
      console.log(`ERROR: ${err?.message ?? err}`);
    }

    if (DELAY_MS > 0 && i < EVAL_CASES.length - 1) await sleep(DELAY_MS);
  }

  // --- Taula cas a cas ------------------------------------------------------
  console.log('\n--- Detall per cas ---------------------------------------\n');
  const header = ['Cas', 'Cat esperada', 'Cat predita', 'OK', 'Prio esp.', 'Prio pred.', 'OK'];
  const rows = results.map((r) => [
    r.c.id,
    r.c.expectedCategory,
    r.predCategory,
    r.catOk ? 'OK' : 'X',
    r.c.expectedPriority,
    r.predPriority,
    r.prioExact ? 'OK' : r.prioWithin1 ? '~' : 'X',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));

  // --- Resums generats (RF-15) ---------------------------------------------
  console.log('\n--- Resums generats (aiSummary) --------------------------\n');
  for (const r of results) {
    if (r.summary) console.log(`  ${r.c.id}: "${r.summary}"`);
  }

  // --- Mètriques agregades --------------------------------------------------
  const n = results.length;
  const errors = results.filter((r) => r.error).length;
  const valid = n - errors;
  const catHits = results.filter((r) => r.catOk).length;
  const prioExactHits = results.filter((r) => r.prioExact).length;
  const prioWithin1Hits = results.filter((r) => r.prioWithin1).length;
  const correctionCases = results.filter(
    (r) => r.c.userCategory !== null && r.c.userCategory !== r.c.expectedCategory,
  );
  const correctionHits = correctionCases.filter((r) => r.catOk).length;

  const pct = (x: number, total: number) => (total > 0 ? ((x / total) * 100).toFixed(1) : 'n/a');

  console.log('\n--- Mètriques agregades ----------------------------------\n');
  console.log(`Casos avaluats              : ${n} (errors de crida: ${errors})`);
  console.log(`Exactitud CATEGORIA         : ${catHits}/${n}  (${pct(catHits, n)} %)`);
  console.log(`Exactitud PRIORITAT (exacte): ${prioExactHits}/${n}  (${pct(prioExactHits, n)} %)`);
  console.log(`Exactitud PRIORITAT (± 1)   : ${prioWithin1Hits}/${n}  (${pct(prioWithin1Hits, n)} %)`);
  console.log(
    `Correcció de categoria errònia: ${correctionHits}/${correctionCases.length}  ` +
      `(casos on l'usuari havia triat malament i el model ho corregeix)`,
  );

  // --- Matriu de confusió de categories ------------------------------------
  console.log('\n--- Errors de categoria (esperada -> predita) ------------\n');
  const misses = results.filter((r) => !r.catOk && !r.error);
  if (misses.length === 0) {
    console.log('  Cap error de categoria.');
  } else {
    for (const r of misses) {
      console.log(`  ${r.c.id}: ${r.c.expectedCategory} -> ${r.predCategory}   (${r.c.note})`);
    }
  }

  console.log('\nNota: la prioritat és subjectiva; per això es reporta també');
  console.log("l'encert dins de ± 1 nivell. Avaluació text-only.");
}

main().catch((err) => {
  console.error('Error executant l\'avaluació:', err);
  process.exit(1);
});
