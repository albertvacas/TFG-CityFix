// Setup global de Vitest (s'executa abans de cada fitxer de test).
//
// config/env.ts valida les variables d'entorn al moment d'importar-se i atura
// el procés si falten. Com que els tests unitaris importen mòduls que depenen
// d'env.ts (middlewares, serveis...), aquí injectem valors ficticis perquè la
// validació passi sense necessitat d'un .env real. Cap test unitari es connecta
// realment a aquesta BD: el client Prisma sempre està mockejat.

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/cityfix_test';
process.env.JWT_SECRET ||= 'test-secret-key-only-for-unit-tests';
