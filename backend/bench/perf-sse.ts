/**
 * Benchmark RNF-07 — Latència de les notificacions en temps real (SSE).
 *
 * Mesura el temps que passa des que el backend emet un esdeveniment de domini
 * (broadcastToRole) fins que un client connectat el rep i el parseja. Per
 * fer-ho aïlla el hub SSE real (src/services/sse.ts) dins d'un servidor Express
 * mínim, hi connecta un client EventSource (implementat sobre http natiu) i
 * cronometra l'entrega de N esdeveniments.
 *
 * La mesura és sobre loopback (127.0.0.1): reflecteix el cost del servidor +
 * la pila TCP local, però NO el RTT de xarxa real entre el navegador de l'admin
 * i el servidor desplegat (vegeu la nota de límits al final).
 *
 * Ús:
 *   npx tsx bench/perf-sse.ts
 *   ITER=500 npx tsx bench/perf-sse.ts
 */

import express from 'express';
import http from 'node:http';
import { addClient, broadcastToRole } from '../src/services/sse';
import { Role } from '../generated/prisma/client';
import { summarize, printStatsTable } from './stats';

const ITER = Number(process.env.ITER ?? 300);

/**
 * Parser SSE mínim sobre un stream de text. Acumula línies fins a una línia
 * en blanc (fi d'event) i emet el bloc 'data:'. Ignora els comentaris (':').
 */
class SseReader {
  private buffer = '';
  private dataLines: string[] = [];
  onData: (data: string) => void = () => {};

  feed(chunk: string) {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);

      if (line === '') {
        // Fi d'un event: emetem la data acumulada.
        if (this.dataLines.length > 0) {
          this.onData(this.dataLines.join('\n'));
          this.dataLines = [];
        }
        continue;
      }
      if (line.startsWith(':')) continue; // comentari / heartbeat
      if (line.startsWith('data:')) {
        this.dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      // (Ignorem 'event:' i 'id:' — només ens cal el payload.)
    }
  }
}

/** Cua d'esdeveniments rebuts amb un waiter per consum seqüencial. */
class EventQueue {
  private queue: number[] = []; // timestamps de recepció (ms, Date.now base)
  private resolver: ((recvAt: number) => void) | null = null;

  push(recvAt: number) {
    if (this.resolver) {
      const r = this.resolver;
      this.resolver = null;
      r(recvAt);
    } else {
      this.queue.push(recvAt);
    }
  }

  next(): Promise<number> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }
}

async function main() {
  console.log('===========================================================');
  console.log(' Benchmark RNF-07 — latència SSE (broadcast -> recepció)');
  console.log('===========================================================');
  console.log(`Iteracions       : ${ITER}`);
  console.log(`Llindar objectiu : < 200 ms (RNF-07)\n`);

  // 1. Servidor Express mínim que registra un client SSE amb rol ADMIN.
  const app = express();
  app.get('/sse-bench', (_req, res) => {
    addClient('bench-admin', Role.ADMIN, res);
    // No tanquem: el client viu mentre duri el benchmark.
  });

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as import('net').AddressInfo).port;

  // 2. Client SSE sobre http natiu.
  const queue = new EventQueue();
  const reader = new SseReader();
  reader.onData = () => queue.push(Date.now());

  await new Promise<void>((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/sse-bench', headers: { Accept: 'text/event-stream' } },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => reader.feed(chunk));
        res.on('error', reject);
        // Donem un instant perquè el handshake (": connected") arribi.
        setTimeout(resolve, 100);
      },
    );
    req.on('error', reject);
  });

  // 3. Bucle de mesura: emet un heartbeat amb timestamp i espera la recepció.
  const samples: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const recvPromise = queue.next();
    const sentAt = Date.now();
    broadcastToRole(Role.ADMIN, { type: 'heartbeat', timestamp: sentAt });
    const recvAt = await recvPromise;
    samples.push(recvAt - sentAt);
  }

  console.log('\n--- Resultats (RNF-07) -----------------------------------\n');
  const stats = summarize('SSE broadcast -> recepció client', samples);
  printStatsTable([stats]);

  console.log(
    `\nVeredicte: p95 = ${stats.p95.toFixed(1)} ms — ` +
      (stats.p95 < 200 ? '✓ < 200 ms' : '✗ supera 200 ms'),
  );
  console.log(
    '\nNota de límits: mesura sobre loopback (127.0.0.1). La latència percebuda\n' +
      "en producció hi afegeix el RTT de xarxa entre el navegador i el servidor.",
  );

  server.close();
  // El setInterval de heartbeat de sse.ts té .unref(), però forcem la sortida.
  process.exit(0);
}

main().catch((err) => {
  console.error('Error executant el benchmark:', err);
  process.exit(1);
});
