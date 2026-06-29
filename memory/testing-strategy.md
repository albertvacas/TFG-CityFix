---
name: testing-strategy
description: How automated tests are set up in the monorepo (runner, layout, tiers, deploy gate)
metadata:
  type: project
---

Testing approach agreed for the CityFix/CampusFix TFG monorepo (decided 2026-06-14).

**Runner:** Tests live **per package** (not a single root `/tests`), because the 3 runtimes need different configs. Backend + web use **Vitest**; the Expo app uses **jest-expo** (Vitest+RN is too fragile). Run with `npm test` in each package.

**Backend — Tier 1 (unit):** `backend/tests/unit/` with `vitest.config.ts` (node env) + `tests/setup.ts` injecting fake `DATABASE_URL`/`JWT_SECRET` (env.ts throws without them). Prisma always mocked via `vi.mock('../../src/config/db')`. Covers `stateMachine.ts` (full RF-04 matrix), `auth.middleware.ts`, `auth.service.ts`. 43 tests.

**Web (frontend) — Tier 3 (render):** Vitest + @testing-library/react + jsdom. `vitest.config.ts` (jsdom, plugin-react) + `src/test/setup.ts` (jest-dom). Covers `LoginPage` + `ProtectedRoute` (mock useAuth/react-i18next/react-router). 7 tests.

**App (mobile) — render tests:** jest-expo + @testing-library/react-native **v13** (v14 breaks: "Cannot find module test-renderer"). Pin jest-expo `~54` + jest `^29` to match Expo SDK 54. `jest.config.js` must keep jest-expo's default `transformIgnorePatterns` and only ADD `nativewind|react-native-css-interop` (don't replace it, or expo-modules-core fails to parse). jest.mock factory vars MUST be `mock`-prefixed. Tests in `app/__tests__/`: ReportCard, leaderboard (points), incidentDetail (START/RESOLVE), createReport. 8 tests. `app/tsconfig.json` needs `"types":["jest","node"]` for editor.

**Roadmap (not built yet):**
- Tier 2 backend integration: `supertest` against ephemeral **Postgres in Docker**, `.env.test` + `prisma migrate deploy`, in `backend/tests/integration/`.
- Deploy gate: GitHub Actions running typecheck + lint + test on PR.

See [[branding-theming]] for the rebrand context.
