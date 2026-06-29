/**
 * Benchmark RNF-03 (variant HTTP end-to-end) — latència del cicle complet de
 * petició tal com l'experimenta un client de l'API.
 *
 * A diferència de `perf-geo.ts` (que crida les funcions de servei directament),
 * aquest script fa peticions HTTP reals contra el servidor en marxa, de manera
 * que la mesura inclou TOT el camí del backend: routing d'Express, middleware
 * d'autenticació (que fa una comprovació a la BD que el compte segueix actiu),
 * autorització RBAC, controlador, servei, consulta a la BD i serialització
 * JSON de la resposta. És el valor més proper a la "latència de l'usuari final"
 * (només queda fora el RTT de la xarxa real del navegador i el render del client).
 *
 * Requisits:
 *   - El servidor ha d'estar EN MARXA (npm run dev) i accessible.
 *   - Hi ha d'haver com a mínim un usuari ADMIN actiu a la BD.
 *
 * Ús (des de backend/):
 *   npm run dev               # en una altra terminal
 *   npx tsx bench/perf-geo-http.ts
 *   BASE_URL=http://localhost:3000 ITER=200 npx tsx bench/perf-geo-http.ts
 */

import jwt from 'jsonwebtoken';
import { prisma } from '../src/config/db';
import { envs } from '../src/config/env';
import { summarize, printStatsTable, timeIt, type LatencyStats } from './stats';

const ITER = Number(process.env.ITER ?? 100);
const WARMUP = Number(process.env.WARMUP ?? 5);
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${envs.PORT}`;

async function main() {
  // 1. Busquem un admin actiu real (el middleware comprova l'estat a la BD).
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', active: true },
    select: { user_id: true },
  });
  if (!admin) {
    console.error('✗ No hi ha cap usuari ADMIN actiu a la BD. No es pot generar el token.');
    process.exit(1);
  }

  // 2. Signem un JWT amb el mateix format que el backend (auth.ts).
  const token = jwt.sign(
    { userId: admin.user_id, role: 'ADMIN' },
    envs.JWT_SECRET as string,
    { expiresIn: '1h' },
  );
  const headers = { Authorization: `Bearer ${token}` };

  // 3. Comprovem que el servidor respon abans de mesurar.
  try {
    const health = await fetch(`${BASE_URL}/api/health`);
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (err: any) {
    console.error(
      `✗ No s'ha pogut connectar a ${BASE_URL}. Està el servidor en marxa (npm run dev)?\n  ${err?.message ?? err}`,
    );
    process.exit(1);
  }

  console.log('===========================================================');
  console.log(' Benchmark RNF-03 (HTTP end-to-end) — latència de petició');
  console.log('===========================================================');
  console.log(`Servidor         : ${BASE_URL}`);
  console.log(`Iteracions       : ${ITER} (+ ${WARMUP} de warm-up)`);
  console.log(`Llindar objectiu : < 500 ms (RNF-03)\n`);

  // Fa una petició GET i consumeix el cos (perquè la serialització i la
  // transferència comptin dins de la mesura).
  const get = (path: string) => async () => {
    const res = await fetch(`${BASE_URL}${path}`, { headers });
    if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
    await res.text();
  };

  const benches: Array<[string, () => Promise<unknown>]> = [
    ['GET /api/geo/geojson (mapa, tots)', get('/api/geo/geojson')],
    ['GET /api/geo/geojson?days=30', get('/api/geo/geojson?days=30')],
    ['GET /api/geo/heatmap?weightBy=priority', get('/api/geo/heatmap?weightBy=priority')],
    ['GET /api/analytics/dashboard', get('/api/analytics/dashboard?granularity=week&days=90')],
  ];

  const rows: LatencyStats[] = [];
  for (const [label, fn] of benches) {
    process.stdout.write(`  Mesurant: ${label} ... `);
    try {
      const samples = await timeIt(fn, ITER, WARMUP);
      const stats = summarize(label, samples);
      rows.push(stats);
      console.log(`p95 = ${stats.p95.toFixed(1)} ms`);
    } catch (err: any) {
      console.log(`OMÈS (${err?.message ?? err})`);
    }
  }

  if (rows.length === 0) {
    console.error('\nCap endpoint mesurat. Revisa les rutes o l\'estat del servidor.');
    return;
  }

  console.log('\n--- Resultats (RNF-03, HTTP end-to-end) ------------------\n');
  printStatsTable(rows);

  const worstP95 = Math.max(...rows.map((r) => r.p95));
  console.log(
    `\nVeredicte: p95 màxim = ${worstP95.toFixed(1)} ms — ` +
      (rows.every((r) => r.p95 < 500) ? '✓ totes < 500 ms' : '✗ alguna supera 500 ms'),
  );
  console.log(
    '\nNota: mesura el cicle HTTP complet (Express + auth + BD + serialització)\n' +
      'sobre localhost. En producció s\'hi afegeix el RTT real navegador--servidor.',
  );
}

main()
  .catch((err) => {
    console.error('Error executant el benchmark:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
