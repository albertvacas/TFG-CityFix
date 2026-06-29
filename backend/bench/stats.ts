/**
 * Utilitats estadístiques compartides pels scripts de benchmark.
 *
 * Cap dependència externa: només Math. Calculem percentils amb interpolació
 * lineal sobre la mostra ordenada (mètode "nearest-rank" arrodonit), suficient
 * per a una mostra de centenars d'iteracions.
 */

export interface LatencyStats {
  label: string;
  n: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const percentile = (sortedAsc: number[], p: number): number => {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = rank - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
};

/** Construeix l'objecte d'estadístiques a partir d'una llista de mostres (ms). */
export const summarize = (label: string, samplesMs: number[]): LatencyStats => {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    label,
    n: sorted.length,
    min: sorted[0] ?? NaN,
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? NaN,
  };
};

const fmt = (ms: number): string => (Number.isFinite(ms) ? ms.toFixed(1) : 'n/a');

/** Imprimeix una taula alineada amb les estadístiques de cada mètrica. */
export const printStatsTable = (rows: LatencyStats[]): void => {
  const headers = ['Operació', 'n', 'min', 'mitjana', 'p50', 'p95', 'p99', 'max'];
  const data = rows.map((r) => [
    r.label,
    String(r.n),
    fmt(r.min),
    fmt(r.mean),
    fmt(r.p50),
    fmt(r.p95),
    fmt(r.p99),
    fmt(r.max),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => row[i]!.length)),
  );

  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');

  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of data) console.log(line(row));
  console.log('\n(Tots els valors en mil·lisegons.)');
};

/**
 * Executa `fn` `iterations` cops mesurant cada crida amb el rellotge monotònic
 * (process.hrtime.bigint). Fa `warmup` crides prèvies que es descarten per no
 * comptar el cost de l'establiment de connexió / JIT.
 */
export const timeIt = async (
  fn: () => Promise<unknown>,
  iterations: number,
  warmup: number,
): Promise<number[]> => {
  for (let i = 0; i < warmup; i++) await fn();

  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6); // ns -> ms
  }
  return samples;
};
