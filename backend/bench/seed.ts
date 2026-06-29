/**
 * Seed reversible per a mesurar RNF-03 amb un volum d'incidències realista.
 *
 * Inserta COUNT incidències sintètiques (default 800) repartides per categoria,
 * prioritat, estat i data (últims ~180 dies), amb coordenades disperses pel
 * campus de la UAB. TOTES queden marcades de dues maneres per poder revertir-les
 * netament amb `unseed.ts`:
 *   1. Atribuïdes a usuaris dedicats amb email @SEED_DOMAIN.
 *   2. El títol comença pel prefix `[SEED]`.
 *
 * NO toca cap dada real. És idempotent: cada execució esborra primer els reports
 * de seed previs i torna a generar COUNT, de manera que el volum és determinista.
 *
 * Ús (des de backend/):
 *   npx tsx bench/seed.ts
 *   COUNT=1500 npx tsx bench/seed.ts
 *
 * Per revertir:  npx tsx bench/unseed.ts
 */

import { prisma } from '../src/config/db';
import { Category, Priority, State, Role } from '../generated/prisma/client';

export const SEED_DOMAIN = 'seed.cityfix.local';
export const SEED_TITLE_PREFIX = '[SEED]';
const COUNT = Number(process.env.COUNT ?? 800);

// Centre aproximat del campus de la UAB (Bellaterra) i dispersió.
const CAMPUS = { lat: 41.5012, lng: 2.1043 };
const SPREAD = 0.012; // ~1.3 km

const CATEGORIES = Object.values(Category);
const PRIORITIES: Priority[] = [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL];

// Distribució d'estats realista: moltes obertes i tancades, menys al mig.
const STATE_WEIGHTS: Array<[State, number]> = [
  [State.OPEN, 0.30],
  [State.ASSIGNED, 0.15],
  [State.IN_PROGRESS, 0.15],
  [State.VALIDATED, 0.10],
  [State.CLOSED, 0.30],
];

// Plantilles breus de títol/descripció per categoria (per a dades llegibles).
const TEMPLATES: Record<Category, { title: string; desc: string }> = {
  LIGHTING: { title: 'Fanal avariat', desc: 'Punt de llum que no funciona correctament.' },
  URBAN_FURNITURE: { title: 'Mobiliari malmès', desc: 'Banc o paperera en mal estat.' },
  PAVEMENT: { title: 'Defecte al paviment', desc: 'Irregularitat o forat a la vorera.' },
  CLEANING: { title: 'Brutícia acumulada', desc: 'Residus o pintades a la via.' },
  GREEN_AREAS: { title: 'Zona verda a revisar', desc: 'Vegetació o arbrat que requereix manteniment.' },
  SIGNAGE: { title: 'Senyalització afectada', desc: 'Senyal o semàfor amb problemes.' },
  ACCESSIBILITY: { title: 'Barrera d\'accessibilitat', desc: 'Rampa o accés per a mobilitat reduïda afectat.' },
  TECHNOLOGY: { title: 'Equipament digital avariat', desc: 'Pantalla o sensor que no respon.' },
  OTHER: { title: 'Incidència diversa', desc: 'No encaixa clarament en cap categoria.' },
};

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

const weightedState = (): State => {
  const r = Math.random();
  let acc = 0;
  for (const [state, w] of STATE_WEIGHTS) {
    acc += w;
    if (r <= acc) return state;
  }
  return State.OPEN;
};

const randomDateWithin = (daysBack: number): Date => {
  const now = Date.now();
  const offset = Math.random() * daysBack * 24 * 60 * 60 * 1000;
  return new Date(now - offset);
};

async function main() {
  console.log(`Sembrant ${COUNT} incidències de prova (marca: ${SEED_TITLE_PREFIX} / @${SEED_DOMAIN})...`);

  // 1. Usuaris de seed: 1 estudiant creador + 1 tècnic per categoria.
  const student = await prisma.user.upsert({
    where: { email: `student@${SEED_DOMAIN}` },
    update: {},
    create: {
      email: `student@${SEED_DOMAIN}`,
      name: 'Seed',
      surname: 'Student',
      nickname: `seed-student`,
      password: 'seed-no-login',
      role: Role.STUDENT,
    },
  });

  const technicians = [];
  for (const cat of CATEGORIES) {
    const tech = await prisma.user.upsert({
      where: { email: `tech-${cat.toLowerCase()}@${SEED_DOMAIN}` },
      update: {},
      create: {
        email: `tech-${cat.toLowerCase()}@${SEED_DOMAIN}`,
        name: 'Seed',
        surname: `Tech ${cat}`,
        nickname: `seed-tech-${cat.toLowerCase()}`,
        password: 'seed-no-login',
        role: Role.TECHNICAL,
        workCategory: cat,
      },
    });
    technicians.push(tech);
  }
  const seedUserIds = [student.user_id, ...technicians.map((t) => t.user_id)];

  // 2. Netejem reports de seed previs (idempotència).
  const deleted = await prisma.report.deleteMany({
    where: { createdById: { in: seedUserIds } },
  });
  if (deleted.count > 0) console.log(`  (esborrats ${deleted.count} reports de seed anteriors)`);

  // 3. Generem els reports.
  const rows = [];
  for (let i = 0; i < COUNT; i++) {
    const category = pick(CATEGORIES);
    const state = weightedState();
    const priority = pick(PRIORITIES);
    const createdAt = randomDateWithin(180);

    const isResolved = state === State.VALIDATED || state === State.CLOSED;
    const isAssigned = state !== State.OPEN;
    // El tècnic assignat és el de la categoria (realista per a workload per tècnic).
    const tech = technicians.find((t) => t.workCategory === category)!;

    const tpl = TEMPLATES[category];
    rows.push({
      title: `${SEED_TITLE_PREFIX} ${tpl.title} #${i + 1}`,
      description: tpl.desc,
      state,
      priority,
      category,
      latitude: CAMPUS.lat + (Math.random() - 0.5) * 2 * SPREAD,
      longitude: CAMPUS.lng + (Math.random() - 0.5) * 2 * SPREAD,
      createdById: student.user_id,
      assignedToId: isAssigned ? tech.user_id : null,
      createdAt,
      resolvedAt: isResolved
        ? new Date(createdAt.getTime() + Math.random() * 10 * 24 * 60 * 60 * 1000)
        : null,
      // Simulem que ~la meitat ja han passat per la classificació IA.
      aiSummary: Math.random() < 0.5 ? `${tpl.title} (resum automàtic)` : null,
      aiClassifiedAt: Math.random() < 0.5 ? createdAt : null,
    });
  }

  // createMany és molt més ràpid que N inserts; el trigger de `location` (si
  // existeix) s'executa igualment a nivell de BD.
  const result = await prisma.report.createMany({ data: rows });
  console.log(`✓ Inserits ${result.count} reports de seed.`);

  const total = await prisma.report.count();
  console.log(`Total d'incidències a la BD ara: ${total}`);
  console.log('\nJa pots executar:  npx tsx bench/perf-geo.ts');
  console.log('Per revertir:      npx tsx bench/unseed.ts');
}

main()
  .catch((err) => {
    console.error('Error sembrant:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
