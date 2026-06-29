/**
 * Reverteix el seed de `seed.ts`: esborra tots els reports de prova i els
 * usuaris dedicats, deixant la BD com estava. No toca cap dada real.
 *
 * Doble criteri de seguretat: només esborra reports atribuïts als usuaris de
 * seed (email @SEED_DOMAIN) o amb el títol marcat amb el prefix de seed.
 *
 * Ús (des de backend/):  npx tsx bench/unseed.ts
 */

import { prisma } from '../src/config/db';
import { SEED_DOMAIN, SEED_TITLE_PREFIX } from './seed';

async function main() {
  const seedUsers = await prisma.user.findMany({
    where: { email: { endsWith: `@${SEED_DOMAIN}` } },
    select: { user_id: true },
  });
  const seedUserIds = seedUsers.map((u) => u.user_id);

  // 1. Esborrem els reports de seed (per autor de seed O per títol marcat).
  const deletedReports = await prisma.report.deleteMany({
    where: {
      OR: [
        { createdById: { in: seedUserIds } },
        { title: { startsWith: SEED_TITLE_PREFIX } },
      ],
    },
  });
  console.log(`✓ Esborrats ${deletedReports.count} reports de seed.`);

  // 2. Esborrem els usuaris de seed (push tokens / notifications cauen en cascada).
  const deletedUsers = await prisma.user.deleteMany({
    where: { email: { endsWith: `@${SEED_DOMAIN}` } },
  });
  console.log(`✓ Esborrats ${deletedUsers.count} usuaris de seed.`);

  const total = await prisma.report.count();
  console.log(`Total d'incidències a la BD ara: ${total}`);
}

main()
  .catch((err) => {
    console.error('Error revertint el seed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
