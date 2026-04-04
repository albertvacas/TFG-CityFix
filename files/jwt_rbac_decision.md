# Decisió d'Arquitectura: Validació JWT i RBAC

## Context

Per implementar autenticació i control d'accés al backend de CityFix es van avaluar dues opcions principals. L'objectiu era protegir les rutes de l'API i garantir que cada rol (STUDENT, ADMIN, TECHNICAL) només pugui realitzar les accions que li corresponen, incloent les transicions de la màquina d'estats.

---

## Opció A: JWT propi al Middleware Express (escollida)

### Com funciona

El servidor Express genera i valida els tokens JWT de forma autònoma. La validació es realitza en un middleware que s'executa abans de cada petició protegida.

```
Client
  │
  ▼
POST /api/auth/login
  │
  ▼
Express → bcrypt.compare(password, hash)
  │
  ▼
jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '24h' })
  │
  ▼
Retorna token al client

─────────────────────────────────────────

Petició protegida:
GET /api/reports
Authorization: Bearer <token>
  │
  ▼
authenticate()  →  jwt.verify(token, JWT_SECRET)
                   ├── Verifica signatura (HMAC-SHA256)
                   └── Verifica expiració (exp claim)
  │
  ▼
req.user = { userId, role }
  │
  ▼
authorize('ADMIN')  →  comprova req.user.role
  │
  ▼
XState guards  →  valida transició d'estat + rol
  │
  ▼
Prisma → PostgreSQL (connexió directa)
```

### Payload del token

```json
{
  "userId": "cuid-de-prisma",
  "role": "ADMIN",
  "iat": 1710000000,
  "exp": 1710086400
}
```

El camp `role` és un claim de primera classe, directament accessible a tot el middleware sense consultes addicionals a la BD.

### Nivells de protecció implementats

| Nivell | Mecanisme | Responsabilitat |
|--------|-----------|-----------------|
| 1 | `authenticate()` | Verifica que el JWT és vàlid i no ha expirat |
| 2 | `authorize(...roles)` | Verifica que el rol té accés a la ruta |
| 3 | XState guards | Valida que la transició d'estat és permesa per aquest rol |

### Característiques

- **Autocontingut**: tota la lògica d'autenticació i autorització viu al codi del projecte
- **Stateless**: el servidor no guarda sessions, tota la informació necessària és al token
- **Expressiu**: el middleware és codi TypeScript, pot expressar qualsevol regla de negoci
- **Integrat amb XState**: el flux llegir→validar→escriure és atòmic dins d'un sol procés Node.js
- **Connexió directa**: Prisma connecta directament a PostgreSQL sense capes intermedies HTTP

### Avantatges

- Control total sobre el payload del token (camps, expiració, format)
- El camp `role` és accessible directament a tot el middleware sense queries addicionals
- Compatible amb XState: la validació de transicions i l'escriptura a la BD ocorren en el mateix procés
- No depèn de cap servei extern per autenticar; si Supabase tingués problemes, l'autenticació seguiria funcionant
- Permet implementar RBAC granular a tres nivells (ruta, rol, transició d'estat)
- Fàcil de depurar i testejar de forma aïllada

### Desavantatges

- Cal implementar i mantenir la lògica d'autenticació manualment (hashing, firma, expiració)
- No inclou refresh tokens per defecte; caldria implementar-los si es necessiten sessions llargues
- La gestió de revocació de tokens és manual (llista negra o reducció del temps d'expiració)
- El `JWT_SECRET` ha de ser custodiat correctament; si es filtra, tots els tokens queden compromesos
- No aprofita les RLS de Supabase (però en aquesta arquitectura tampoc és necessari)

---

## Opció B: Supabase Auth + REST API + RLS

### Com funciona

Supabase gestiona l'autenticació de forma externa. El client obté un token de Supabase Auth, que PostgREST valida automàticament. Les RLS (Row Level Security) policies a PostgreSQL restringeixen l'accés a les files.

```
Client
  │
  ▼
POST https://xyz.supabase.co/auth/v1/token
{ email, password }
  │
  ▼
Supabase Auth (servei extern)
  └── Retorna access_token signat amb SUPABASE_JWT_SECRET

─────────────────────────────────────────

Petició protegida:
GET https://xyz.supabase.co/rest/v1/reports
Authorization: Bearer <supabase_token>
  │
  ▼
PostgREST → valida JWT amb SUPABASE_JWT_SECRET
  │
  ▼
auth.uid() disponible → RLS policies s'apliquen
  │
  ▼
PostgreSQL retorna només les files permeses
```

### Payload del token de Supabase

```json
{
  "sub": "uuid-de-supabase",
  "email": "user@example.com",
  "role": "authenticated",
  "aud": "authenticated",
  "exp": 1710086400
}
```

El rol d'aplicació (ADMIN, STUDENT, TECHNICAL) **no és un claim natiu**. Per afegir-lo caldria un trigger PostgreSQL addicional que injecti `app_metadata.role` al token.

### Característiques

- **Servei gestionat**: Supabase s'encarrega de generar, signar i renovar els tokens automàticament
- **Integració nativa amb RLS**: `auth.uid()` funciona dins les policies SQL perquè PostgREST injecta el JWT a la sessió de PostgreSQL
- **Refresh tokens inclosos**: Supabase gestiona automàticament la renovació de sessions
- **Multi-proveïdor**: suporta OAuth (Google, GitHub...), magic links, OTP sense implementació addicional
- **Accés directe des del client**: dissenyat per a apps que accedeixen a la BD sense backend propi

### Avantatges

- Quasi zero codi d'autenticació: Supabase gestiona tot el cicle de vida del token
- Refresh tokens i revocació de sessions inclosos de sèrie
- RLS nativa: les policies SQL s'apliquen automàticament a totes les queries via PostgREST
- Suporta múltiples mètodes d'autenticació (email, OAuth, OTP) sense canvis al backend
- Dashboard visual a Supabase per gestionar usuaris i sessions

### Desavantatges

- **El rol d'aplicació no és un claim natiu**: afegir ADMIN/STUDENT/TECHNICAL requereix un trigger SQL (`custom_access_token_hook`)
- **Incompatible amb XState via Prisma**: Prisma usa connexió directa amb service role, que bypassa RLS; les policies no s'apliquen
- **Latència addicional**: cada query a la BD passa per una petició HTTP a Supabase REST en comptes d'una connexió TCP directa
- **Dependència externa**: si Supabase cau o canvia les seves APIs, l'autenticació queda bloquejada
- **No atòmic amb lògica de negoci complexa**: les transicions XState (llegir estat → validar → escriure) no es poden executar atòmicament via REST API
- Menys control sobre el format i contingut del token JWT

---

## Comparació directa

| Criteri | Opció A (Middleware) | Opció B (Supabase Auth + RLS) |
|---------|---------------------|-------------------------------|
| **Control del JWT** | Total (payload propi) | Limitat (claims fixes de Supabase) |
| **RBAC amb rols propis** | Natiu (`role` al token) | Requereix trigger addicional |
| **Validació de transicions XState** | Completa i atòmica | Impossible (no hi ha on executar XState) |
| **Connexió a BD** | Directa via Prisma | HTTP a Supabase REST per cada query |
| **Latència** | Baixa | Alta (capa HTTP addicional) |
| **Dependència externa** | Cap | Supabase (si cau, no hi ha accés) |
| **Atomicitat llegir→validar→escriure** | Garantida | No garantida (2 peticions HTTP) |
| **Valor acadèmic** | Alt (implementació pròpia) | Baix (delegació a servei extern) |

---

## Per què s'ha escollit l'Opció A

### 1. Compatibilitat amb XState

La màquina d'estats requereix un flux atòmic de tres passos:

```typescript
// 1. Llegir estat actual de la BD
const report = await prisma.report.findUnique({ where: { id } });

// 2. Validar transició amb XState (rol + estat actual + event)
const snapshot = incidentMachine.resolveState({ value: report.state });
const canTransition = snapshot.can({ type: event });

// 3. Escriure nou estat si és vàlid
await prisma.report.update({ data: { state: newState } });
```

Amb la Opció B, els passos 1 i 3 serien peticions HTTP separades a Supabase REST, sense garantia d'atomicitat i sense un lloc natural on executar el pas 2 (XState).

### 2. RBAC de tres nivells

L'Opció A permet expressar regles que RLS no pot representar:

```typescript
// Middleware: restricció per ruta
authorize('ADMIN', 'TECHNICAL')

// XState guard: restricció per transició d'estat + rol
OPEN → ASSIGNED   guard: isNotStudent
VALIDATED → CLOSED  guard: isAdmin
```

RLS només pot filtrar files per valors estàtics de columnes. No pot validar si una transició `OPEN → ASSIGNED` és vàlida per un rol determinat, perquè no té noció del graf de transicions.

### 3. Control total del payload JWT

Amb l'Opció A el token conté exactament el que necessita l'aplicació:

```typescript
jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '24h' })
// req.user.role disponible a tot el middleware sense cap query extra
```

Amb l'Opció B caldria afegir un trigger SQL per injectar el rol al token de Supabase, afegint complexitat d'infraestructura sense benefici real.

### 4. Valor acadèmic

Implementar JWT des de zero (generació, signatura HMAC-SHA256, verificació, expiració) i el middleware RBAC propi demostra comprensió dels mecanismes d'autenticació, a diferència de delegar-ho a un servei extern.

---

## Conclusió

L'Opció A és l'arquitectura adequada per a CityFix perquè el projecte disposa d'un backend Express complet amb lògica de negoci complexa (màquina d'estats XState) que requereix control total del flux de validació. L'Opció B tindria sentit en aplicacions sense backend propi on el client accedeix directament a Supabase, escenari que no és el cas d'aquest projecte.
