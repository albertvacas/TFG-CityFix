/**
 * Benchmark RNF-03 — Rendiment de les consultes geoespacials i analítiques.
 *
 * Mesura la latència de les operacions de la capa de servei que alimenten el
 * mapa (markers + heatmap) i el dashboard, executades contra la BD real
 * (PostgreSQL/PostGIS a Supabase). El temps inclou el round-trip de xarxa cap
 * a Supabase, que és el cost dominant; NO inclou la serialització HTTP final
 * ni la latència del navegador (vegeu la nota de límits al final).
 *
 * Ús:
 *   npx tsx bench/perf-geo.ts            # 100 iteracions per operació (default)
 *   ITER=200 WARMUP=10 npx tsx bench/perf-geo.ts
 *
 * Requereix un .env amb DATABASE_URL vàlida i la BD poblada amb dades realistes.
 */

import { prisma } from '../src/config/db';
import { getReportsGeoJson, getHeatmapData, getNearestActiveDistances } from '../src/services/geo';
import {
  getHistoryByCategory,
  getCreatedVsResolved,
  getResolutionTimeVsPriority,
  getStateCounts,
} from '../src/services/analytics';
import { summarize, printStatsTable, timeIt, type LatencyStats } from './stats';

const ITER = Number(process.env.ITER ?? 100);
const WARMUP = Number(process.env.WARMUP ?? 5);

async function main() {
  const totalReports = await prisma.report.count();
  console.log('===========================================================');
  console.log(' Benchmark RNF-03 — consultes geoespacials i analítiques');
  console.log('===========================================================');
  console.log(`Mida del dataset : ${totalReports} incidències a la BD`);
  console.log(`Iteracions       : ${ITER} (+ ${WARMUP} de warm-up, descartades)`);
  console.log(`Llindar objectiu : < 500 ms (RNF-03)\n`);

  if (totalReports < 50) {
    console.warn(
      `⚠  Només hi ha ${totalReports} incidències. Per a una mesura representativa\n` +
        `   convé poblar la BD amb un volum realista (centenars o més).\n`,
    );
  }

  // Per a la consulta espacial PostGIS necessitem un punt objectiu i un conjunt
  // de tècnics. Agafem fins a 10 tècnics elegibles (els que tenen workCategory).
  const sampleTechs = await prisma.user.findMany({
    where: { role: 'TECHNICAL', active: true, workCategory: { not: null } },
    select: { user_id: true },
    take: 10,
  });
  const techIds = sampleTechs.map((t) => t.user_id);
  const CAMPUS_TARGET = { lat: 41.5012, lng: 2.1043 };

  // Cada entrada: etiqueta + funció a mesurar. Les primeres alimenten el mapa
  // SIG (RF-11) i la consulta espacial PostGIS (ST_Distance) — el nucli del RNF-03.
  const benches: Array<[string, () => Promise<unknown>]> = [
    ['PostGIS ST_Distance (proximitat auto-assign)', () => getNearestActiveDistances(CAMPUS_TARGET, techIds)],
    ['GET /geo/geojson (mapa, tots)', () => getReportsGeoJson()],
    ['GET /geo/geojson (filtre 30 dies)', () => getReportsGeoJson({ daysAgo: 30 })],
    ['GET /geo/heatmap (weightBy=priority)', () => getHeatmapData('priority')],
    ['GET /geo/heatmap (weightBy=age)', () => getHeatmapData('age')],
    ['analytics: stateCounts', () => getStateCounts()],
    ['analytics: historyByCategory (90d)', () => getHistoryByCategory('week', 90)],
    ['analytics: createdVsResolved (90d)', () => getCreatedVsResolved(90)],
    ['analytics: resolutionTimeVsPriority', () => getResolutionTimeVsPriority()],
  ];

  if (techIds.length === 0) {
    console.warn(
      '⚠  No hi ha tècnics amb workCategory: la consulta PostGIS es mesurarà\n' +
        '   amb un pool buit (latència mínima). Executa bench/seed.ts primer.\n',
    );
  }

  const rows: LatencyStats[] = [];
  for (const [label, fn] of benches) {
    process.stdout.write(`  Mesurant: ${label} ... `);
    const samples = await timeIt(fn, ITER, WARMUP);
    const stats = summarize(label, samples);
    rows.push(stats);
    console.log(`p95 = ${stats.p95.toFixed(1)} ms`);
  }

  console.log('\n--- Resultats (RNF-03) -----------------------------------\n');
  printStatsTable(rows);

  const worstP95 = Math.max(...rows.map((r) => r.p95));
  const allPass = rows.every((r) => r.p95 < 500);
  console.log(
    `\nVeredicte: p95 màxim = ${worstP95.toFixed(1)} ms — ` +
      (allPass ? '✓ totes < 500 ms' : '✗ alguna operació supera 500 ms'),
  );
  console.log(
    '\nNota de límits: mesura a nivell de servei (consulta + round-trip a\n' +
      'Supabase). No inclou serialització de resposta HTTP ni render al client.',
  );
}

main()
  .catch((err) => {
    console.error('Error executant el benchmark:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
