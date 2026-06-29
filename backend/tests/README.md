# Tests del backend (CityFix)

Suite de proves automàtiques del backend, executada amb [Vitest](https://vitest.dev).
Pensada per córrer **abans de qualsevol desplegament** com a porta de qualitat.

## Com executar-les

```bash
cd backend
npm test            # tots els tests, un sol cop (mode CI)
npm run test:watch  # mode interactiu, re-executa en desar
npm run test:coverage  # informe de cobertura
```

## Estructura

```
tests/
  setup.ts              ← injecta env vars de test abans d'importar mòduls
  unit/                 ← Tier 1: lògica pura, sense BD ni xarxa
    stateMachine.test.ts    màquina d'estats XState (RF-04): matriu estat×event×rol
    auth.middleware.test.ts authenticate / authorize (JWT + RBAC), Prisma mockejat
    auth.service.test.ts    registre (UAB, invitacions) i login, Prisma+bcrypt mockejats
  integration/          ← Tier 2 (pendent): endpoints HTTP reals contra BD de test
```

## Tier 1 — Unit (implementat)

No toquen base de dades: el client Prisma sempre està mockejat amb `vi.mock`.
Són ràpids (<1s) i deterministes, ideals per a la porta de CI.

## Tier 2 — Integració HTTP (roadmap)

Provar els endpoints reals amb [`supertest`](https://github.com/ladjs/supertest)
contra una **base de dades Postgres efímera en Docker** (decisió de l'equip):

1. `docker run --rm -e POSTGRES_PASSWORD=test -e POSTGRES_DB=cityfix_test -p 5433:5432 postgres:16`
2. `.env.test` amb `DATABASE_URL` apuntant a aquest contenidor.
3. `prisma migrate deploy` per crear l'esquema abans dels tests.
4. Tests a `tests/integration/*.test.ts` que arrenquen l'app Express i fan
   peticions reals (register → login → crear report → transició → RBAC 401/403).

Es recomana un fitxer `tests/integration/setup.ts` que netegi les taules
(`TRUNCATE ... CASCADE`) entre tests per garantir aïllament.
