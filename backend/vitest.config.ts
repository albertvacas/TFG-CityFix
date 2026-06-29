import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // El backend corre sobre Node, no sobre un DOM de navegador.
    environment: 'node',
    // Carrega variables d'entorn de test (DATABASE_URL, JWT_SECRET) abans
    // que qualsevol mòdul importi config/env.ts, que llançaria error sense elles.
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // 'unit' no toca BD real; la integració (Tier 2) viurà en tests/integration.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/config/db.ts', '**/*.d.ts'],
    },
  },
});
