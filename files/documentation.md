# Sprint 2: Infraestructura Backend i Lògica de Control

## Resum

En aquest sprint s'ha configurat tota la infraestructura backend del projecte: servidor Express amb TypeScript, sistema d'autenticació amb JWT i bcrypt, control d'accés basat en rols (RBAC) mitjançant middlewares, i la integració de la màquina d'estats XState per governar el cicle de vida de les incidències. El resultat és una API REST funcional amb 8 endpoints que cobreixen autenticació, gestió d'incidències i consulta d'usuaris.

---

## Arquitectura del Backend

L'arquitectura segueix el patró **Routes → Middleware → Controller → Service → Database**, on cada capa té una responsabilitat única:

```
Client (HTTP Request)
    │
    ▼
index.ts (Express App)
    │
    ├─ express.json()          ← Parseja el body JSON de cada petició
    │
    ▼
routes/*.ts                    ← Defineix la URL i mètode HTTP de cada endpoint
    │
    ├─ authenticate            ← Middleware: verifica JWT i injecta req.user
    ├─ authorize('ADMIN')      ← Middleware: comprova que el rol és permès
    │
    ▼
controllers/*.ts               ← Valida el body/params de la petició, retorna HTTP response
    │
    ▼
services/*.ts                  ← Conté la lògica de negoci (bcrypt, XState, queries)
    │
    ▼
config/db.ts (Prisma Client)  ← Executa les queries contra PostgreSQL (Supabase)
```

---

## Mòduls en detall

### 1. Entry Point — `src/index.ts`

Punt d'entrada de l'aplicació. Configura l'aplicació Express, registra els middlewares globals, munta les rutes i arrenca el servidor.

**Flux d'arrencada:**
1. Crea la instància d'Express
2. Registra `express.json()` com a middleware global perquè totes les peticions amb body JSON siguin parsejades automàticament
3. Munta tres grups de rutes sota el prefix `/api`: auth, reports i users
4. Defineix un endpoint `GET /api/health` que retorna `{ status: 'ok' }` per verificar que el servidor està actiu
5. Crida `connectDB()` per establir la connexió amb Supabase i, si és exitosa, posa el servidor a escoltar al port configurat (per defecte 3000)

---

### 2. Configuració — `src/config/`

#### `env.ts`
Carrega les variables d'entorn amb `dotenv/config` i les exposa com a objecte tipat. Defineix tres variables:
- **PORT**: port del servidor (per defecte 3000)
- **DATABASE_URL**: cadena de connexió a PostgreSQL (obligatòria, llança error si no existeix)
- **JWT_SECRET**: clau secreta per signar els tokens JWT

La validació de `DATABASE_URL` es fa al moment de la importació del mòdul. Si no està definida, el procés s'atura immediatament amb un error descriptiu, evitant que el servidor arrenqui sense base de dades.

#### `db.ts`
Instancia el client Prisma v7 utilitzant el driver adapter `PrismaPg`. A diferència de versions anteriors de Prisma, la v7 no accepta una URL directa al constructor: requereix un adapter que encapsula la connexió amb el driver natiu `pg`.

La funció `connectDB()` intenta establir connexió amb `prisma.$connect()`. Si falla, registra l'error i finalitza el procés amb `process.exit(1)` per evitar que el servidor quedi en un estat inconsistent.

---

### 3. Tipus TypeScript — `src/types/index.ts`

Defineix les interfícies i tipus que s'utilitzen a tot el backend:

- **JwtPayload**: estructura que s'emmagatzema dins del token JWT (`userId` i `role`). Quan el middleware d'autenticació descodifica un token, el resultat és un objecte d'aquest tipus.
- **AuthRequest**: extensió de l'objecte `Request` d'Express que afegeix la propietat opcional `user: JwtPayload`. Tots els controladors que requereixen autenticació utilitzen aquest tipus en lloc del `Request` estàndard.
- **RegisterDTO / LoginDTO**: defineixen l'estructura esperada del body de les peticions de registre i login.
- **CreateReportDTO**: estructura del body per crear una incidència (title, description, latitude, longitude, category opcional).
- **IncidentEvent**: unió de tipus que enumera els 6 esdeveniments vàlids de la màquina d'estats: `ASSIGN`, `START`, `REASSIGN`, `RESOLVE`, `CLOSE` i `REJECT`.

---

### 4. Middlewares — `src/middlewares/auth.ts`

Aquest mòdul conté els dos middlewares que implementen la seguretat de l'API.

#### `authenticate` — Verificació JWT
S'executa abans de qualsevol controlador en rutes protegides. El seu flux és:

1. Llegeix el header `Authorization` de la petició
2. Si no existeix o no comença per `Bearer `, retorna **401** amb `"Token no proporcionado"`
3. Extreu el token (la part després de `Bearer `)
4. Crida `jwt.verify()` amb la clau secreta `JWT_SECRET` per descodificar i verificar la signatura del token
5. Si la verificació falla (token manipulat, expirat o invàlid), retorna **401** amb `"Token inválido o expirado"`
6. Si és vàlid, injecta el payload descodificat (`{ userId, role }`) a `req.user` i crida `next()` per continuar al següent middleware o controlador

#### `authorize(...allowedRoles)` — RBAC per rols
Funció d'ordre superior (higher-order function) que rep una llista de rols permesos i retorna un middleware. El seu flux és:

1. Comprova que `req.user` existeix (és a dir, que `authenticate` s'ha executat prèviament). Si no, retorna **401**
2. Comprova que el rol de l'usuari (`req.user.role`) està inclòs a la llista `allowedRoles`. Si no, retorna **403** amb `"No tienes permisos para esta acción"`
3. Si el rol és vàlid, crida `next()`

**Exemple d'ús combinat a les rutes:**
```
userRouter.get('/technicians', authorize('ADMIN'), getAllTechnicians)
```
Aquí, la petició passa per tres capes: primer `authenticate` (aplicat a nivell de router), després `authorize('ADMIN')`, i finalment el controlador `getAllTechnicians`.

---

### 5. Màquina d'estats — `src/machines/stateMachine.ts`

Implementa el cicle de vida de les incidències (RF-04) utilitzant XState v5 amb l'API `setup()`. Aquesta API permet definir guards amb noms tipats, millorant la llegibilitat i mantenibilitat respecte a guards inline.

#### Estats i transicions

```
OPEN ──ASSIGN──▶ ASSIGNED ──START──▶ IN_PROGRESS ──RESOLVE──▶ VALIDATED ──CLOSE──▶ CLOSED
                    │                                            │
                    │◀──REASSIGN──                               │◀──REJECT──
```

| Estat actual | Esdeveniment | Estat destí | Guard (qui pot fer-ho) |
|---|---|---|---|
| OPEN | ASSIGN | ASSIGNED | `isNotStudent` — qualsevol rol excepte STUDENT |
| ASSIGNED | START | IN_PROGRESS | `isNotStudent` — TECHNICAL o ADMIN |
| ASSIGNED | REASSIGN | OPEN | `isAdmin` — només ADMIN |
| IN_PROGRESS | RESOLVE | VALIDATED | `isTechnicalOrAdmin` — TECHNICAL o ADMIN |
| VALIDATED | CLOSE | CLOSED | `isAdmin` — només ADMIN |
| VALIDATED | REJECT | IN_PROGRESS | `isAdmin` — només ADMIN |
| CLOSED | — | — | Estat final, no admet transicions |

#### Context de la màquina
Cada execució de la màquina rep un `input` amb tres camps:
- `incidentId`: identificador de la incidència a la BD
- `role`: rol de l'usuari que sol·licita la transició
- `userId`: identificador de l'usuari

Els guards accedeixen al camp `role` del context per decidir si la transició és permesa.

---

### 6. Serveis — `src/services/`

#### `auth.ts` — Servei d'autenticació

**`registerUser(data: RegisterDTO)`**
1. Rep les dades del formulari de registre
2. Genera un hash de la contrasenya amb `bcrypt.hash()` utilitzant 10 salt rounds. Bcrypt genera automàticament un salt aleatori i l'incorpora al hash resultant, de manera que dues contrasenyes iguals produeixen hashos diferents
3. Crea l'usuari a la BD amb Prisma. Si no s'especifica rol, s'assigna `STUDENT` per defecte
4. Elimina el camp `password` de l'objecte retornat mitjançant destructuring (`{ password, ...userWithoutPassword }`) per complir amb el RGPD

**`loginUser(data: LoginDTO)`**
1. Cerca l'usuari per email a la BD. Si no existeix, llança error `"Credenciales incorrectas"` (missatge genèric per no revelar si l'email existeix o no)
2. Compara la contrasenya proporcionada amb el hash emmagatzemat usant `bcrypt.compare()`. Si no coincideix, llança el mateix error genèric
3. Construeix el payload JWT amb `userId` i `role`
4. Signa el token amb `jwt.sign()` establint una expiració de 24 hores
5. Retorna el token i les dades de l'usuari (sense password)

#### `report.ts` — Servei d'incidències

**`createReport(data, userId)`**
Crea una nova incidència a la BD vinculada a l'usuari creador. L'estat inicial és `OPEN` (definit com a default al schema Prisma) i la prioritat per defecte és `MEDIUM`. Retorna la incidència creada amb les dades bàsiques del creador.

**`getReportById(id)`**
Cerca una incidència per ID i inclou totes les relacions: creador, tècnic assignat, imatges i comentaris. Retorna `null` si no existeix.

**`getAllReports(filters?)`**
Llista totes les incidències ordenades per data de creació descendent. Accepta filtres opcionals per estat (per exemple, `?state=OPEN` per veure només les incidències obertes). Inclou les dades bàsiques del creador i del tècnic assignat.

**`transitionReport(reportId, event, userId, role, assignedToId?)`**
Aquest és el mètode central del Sprint 2. Integra XState amb Prisma per garantir que les transicions d'estat siguin vàlides. El seu flux és:

1. Cerca la incidència a la BD per obtenir l'estat actual
2. Crea un actor XState amb `createActor()`, passant-li la màquina i restaurant l'estat actual de la BD amb `resolveState()`. Això permet que la màquina "reprengui" des de l'estat emmagatzemat en lloc de començar sempre des d'OPEN
3. Arrenca l'actor i comprova amb `snapshot.can({ type: event })` si la transició és possible. Aquesta funció evalua els guards sense executar la transició, permetent validar-la prèviament
4. Si la transició no és permesa, atura l'actor i llança un error descriptiu: `"Transición 'CLOSE' no permitida desde estado 'OPEN' con rol 'STUDENT'"`
5. Si és permesa, envia l'esdeveniment amb `actor.send()`, obté el nou estat del snapshot i atura l'actor
6. Actualitza la incidència a la BD amb el nou estat. Si l'esdeveniment és `ASSIGN` i s'ha proporcionat `assignedToId`, també actualitza el tècnic assignat

---

### 7. Controladors — `src/controllers/`

Els controladors actuen com a capa intermèdia entre les rutes HTTP i els serveis. Validen l'entrada, criden al servei corresponent i retornen la resposta HTTP adequada.

#### `auth.ts`

**`register`**: Valida que els camps obligatoris (email, name, surname, password, nickname) estiguin presents. Si falten, retorna **400**. Crida `registerUser()` i retorna **201** amb les dades de l'usuari. Captura l'error de Prisma `P2002` (violació d'unicitat) per retornar **409** si l'email o nickname ja existeixen.

**`login`**: Valida email i password. Crida `loginUser()` i retorna el token JWT i les dades de l'usuari. Si les credencials són incorrectes, retorna **401**.

#### `report.ts`

**`create`**: Valida title, description, latitude i longitude. Utilitza `req.user!.userId` per vincular la incidència al creador autenticat. Retorna **201**.

**`getById`**: Cerca la incidència pel paràmetre `:id` de la URL. Retorna **404** si no existeix.

**`getAll`**: Llegeix el query parameter `state` (si existeix) i el passa com a filtre. Valida que sigui un string (Express 5 pot retornar arrays per query params duplicats).

**`transition`**: Valida que l'event existeixi i sigui un dels 6 vàlids. Si l'event és `ASSIGN`, exigeix el camp `assignedToId`. Crida `transitionReport()` i, si XState rebutja la transició, retorna **400** amb el missatge d'error descriptiu.

---

### 8. Rutes — `src/routes/`

Les rutes defineixen els endpoints HTTP i la cadena de middlewares que s'executen abans de cada controlador.

#### `auth.ts` — Rutes públiques (sense autenticació)

| Mètode | Ruta | Controlador | Descripció |
|---|---|---|---|
| POST | `/api/auth/register` | `register` | Crea un nou usuari amb contrasenya hashejada |
| POST | `/api/auth/login` | `login` | Retorna un JWT vàlid durant 24h |

Aquestes rutes no passen per cap middleware d'autenticació perquè l'usuari encara no té token.

#### `reports.ts` — Rutes protegides (requereixen JWT)

Totes les rutes d'aquest router passen primer per `authenticate` (definit amb `reportRouter.use(authenticate)`):

| Mètode | Ruta | Cadena de Middleware | Controlador | Descripció |
|---|---|---|---|---|
| POST | `/api/reports` | authenticate | `create` | Qualsevol usuari autenticat pot crear una incidència |
| GET | `/api/reports` | authenticate | `getAll` | Llistat amb filtre opcional `?state=OPEN` |
| GET | `/api/reports/:id` | authenticate | `getById` | Detall complet amb relacions |
| PATCH | `/api/reports/:id/transition` | authenticate | `transition` | Canvi d'estat validat per XState (RBAC dins la màquina) |

La ruta de transició no utilitza `authorize()` a nivell de middleware perquè el control de permisos es delega a la màquina d'estats XState. Això centralitza la lògica de qui pot fer què en un sol lloc.

#### `users.ts` — Rutes protegides amb RBAC addicional

| Mètode | Ruta | Cadena de Middleware | Controlador | Descripció |
|---|---|---|---|---|
| GET | `/api/users/profile` | authenticate | `getProfile` | Retorna el perfil de l'usuari autenticat (sense password) |
| GET | `/api/users/technicians` | authenticate → authorize('ADMIN') | `getAllTechnicians` | Només ADMIN pot llistar els tècnics disponibles |

---

## Fluxos complets de peticions

### Flux 1: Registre d'un alumne

```
POST /api/auth/register
Body: { email, name, surname, password, nickname }

1. express.json()         → parseja el body JSON
2. authRouter             → ruta pública, sense middleware d'auth
3. register (controller)  → valida camps obligatoris
4. registerUser (service) → bcrypt.hash(password, 10) → prisma.user.create()
5. Response 201           → { user_id, email, name, surname, nickname, role: "STUDENT", points: 0 }
```

### Flux 2: Login i obtenció del token

```
POST /api/auth/login
Body: { email, password }

1. express.json()        → parseja el body
2. login (controller)    → valida email i password presents
3. loginUser (service)   → prisma.user.findUnique(email)
                         → bcrypt.compare(password, hash)
                         → jwt.sign({ userId, role }, secret, { expiresIn: '24h' })
4. Response 200          → { token: "eyJhbG...", user: { user_id, email, name, ... } }
```

### Flux 3: Crear una incidència

```
POST /api/reports
Headers: { Authorization: "Bearer eyJhbG..." }
Body: { title, description, latitude, longitude }

1. express.json()           → parseja el body
2. authenticate (middleware) → extreu token → jwt.verify() → req.user = { userId, role }
3. create (controller)       → valida camps obligatoris
4. createReport (service)    → prisma.report.create({ createdById: req.user.userId })
5. Response 201              → { report_id, title, description, state: "OPEN", ... }
```

### Flux 4: Assignar una incidència a un tècnic (ADMIN)

```
PATCH /api/reports/:id/transition
Headers: { Authorization: "Bearer <token_admin>" }
Body: { event: "ASSIGN", assignedToId: "uuid-tecnic" }

1. express.json()              → parseja el body
2. authenticate (middleware)    → verifica JWT → req.user = { userId, role: "ADMIN" }
3. transition (controller)     → valida event vàlid, valida assignedToId present per ASSIGN
4. transitionReport (service)  → cerca report (state: "OPEN")
                               → crea actor XState amb state "OPEN" i role "ADMIN"
                               → snapshot.can({ type: "ASSIGN" }) → true (guard isNotStudent passa)
                               → actor.send({ type: "ASSIGN" }) → nou state: "ASSIGNED"
                               → prisma.report.update({ state: "ASSIGNED", assignedToId })
5. Response 200                → { report_id, state: "ASSIGNED", assignedTo: { name, nickname } }
```

### Flux 5: Transició rebutjada (STUDENT intenta tancar)

```
PATCH /api/reports/:id/transition
Headers: { Authorization: "Bearer <token_student>" }
Body: { event: "CLOSE" }

1. express.json()              → parseja el body
2. authenticate (middleware)    → verifica JWT → req.user = { userId, role: "STUDENT" }
3. transition (controller)     → valida event vàlid
4. transitionReport (service)  → cerca report (state: "VALIDATED")
                               → crea actor XState amb role "STUDENT"
                               → snapshot.can({ type: "CLOSE" }) → false (guard isAdmin falla)
                               → throw Error("Transición 'CLOSE' no permitida desde estado 'VALIDATED' con rol 'STUDENT'")
5. Response 400                → { error: "Transición 'CLOSE' no permitida..." }
```

### Flux 6: Accés denegat per RBAC (STUDENT intenta llistar tècnics)

```
GET /api/users/technicians
Headers: { Authorization: "Bearer <token_student>" }

1. authenticate (middleware)    → verifica JWT → req.user = { userId, role: "STUDENT" }
2. authorize('ADMIN')          → req.user.role ("STUDENT") no inclòs a ["ADMIN"]
3. Response 403                → { error: "No tienes permisos para esta acción" }
```

---

## Decisions tècniques

- **Prisma v7 amb Driver Adapter**: la versió 7 de Prisma no accepta `datasourceUrl` al constructor. Requereix un adapter (`PrismaPg`) que encapsula la connexió nativa amb `pg`, proporcionant millor rendiment i compatibilitat.
- **Express v5**: actualització major que canvia el tipus de `req.params` a `string | string[]`, requerint cast explícit a `string` quan s'accedeix a paràmetres de ruta.
- **XState v5 `setup()`**: permet definir guards amb noms (`isNotStudent`, `isAdmin`) en lloc de funcions inline. Això millora la llegibilitat de la màquina i facilita el testing i la documentació.
- **RBAC dual**: el control d'accés opera a dos nivells. El middleware `authorize()` protegeix rutes senceres (per exemple, llistar tècnics). La màquina XState controla permisos granulars per transició (per exemple, qui pot fer ASSIGN vs CLOSE).
- **JWT amb expiració 24h**: balanç entre seguretat i UX per a una aplicació universitària on els usuaris no haurien de fer login cada hora.
- **Missatges d'error genèrics al login**: tant si l'email no existeix com si la contrasenya és incorrecta, el missatge és sempre `"Credenciales incorrectas"` per evitar l'enumeració d'usuaris.

---

## Estructura de fitxers

```
src/
├── config/
│   ├── db.ts              # Client Prisma v7 amb adapter PrismaPg
│   └── env.ts             # Variables d'entorn validades (PORT, DATABASE_URL, JWT_SECRET)
├── controllers/
│   ├── auth.ts            # Validació d'entrada + resposta HTTP per registre i login
│   ├── report.ts          # Validació d'entrada + resposta HTTP per incidències
│   └── user.ts            # Validació d'entrada + resposta HTTP per perfil i tècnics
├── machines/
│   └── stateMachine.ts    # Màquina d'estats XState v5: 5 estats, 6 events, 3 guards
├── middlewares/
│   └── auth.ts            # authenticate (JWT) + authorize (RBAC per rols)
├── routes/
│   ├── auth.ts            # POST /register, POST /login (públiques)
│   ├── reports.ts         # CRUD incidències + transicions (autenticades)
│   └── users.ts           # Perfil + llistat tècnics (autenticades + RBAC)
├── services/
│   ├── auth.ts            # bcrypt hash/compare + jwt sign
│   └── report.ts          # CRUD Prisma + integració XState per transicions
├── types/
│   └── index.ts           # JwtPayload, AuthRequest, DTOs, IncidentEvent
└── index.ts               # Entry point: Express app + connectDB + listen
```

## Dependències afegides en aquest Sprint

| Paquet | Versió | Propòsit |
|---|---|---|
| `express` | 5.2 | Servidor HTTP i routing |
| `jsonwebtoken` | 9.0 | Generació i verificació de tokens JWT |
| `bcrypt` | 6.0 | Hashing de contrasenyes amb salt |
| `xstate` | 5.30 | Màquina d'estats finits per al cicle de vida d'incidències |
| `@types/express` | 5.0 | Tipus TypeScript per Express |
| `@types/jsonwebtoken` | 9.0 | Tipus TypeScript per JWT |
| `@types/bcrypt` | 6.0 | Tipus TypeScript per bcrypt |

---

# Sprint 3: Interfície Web d'Administració

## Resum

En aquest sprint s'ha desenvolupat la interfície web d'administració per al sistema CityFix. S'ha creat una Single Page Application (SPA) amb React, TypeScript i Tailwind CSS, servida per Vite. El panell permet als administradors visualitzar estadístiques, gestionar incidències i executar transicions d'estat directament des del navegador. L'accés està restringit exclusivament a usuaris amb rol `ADMIN` mitjançant doble verificació: client-side (AuthContext) i server-side (JWT + RBAC).

---

## Arquitectura del Frontend

L'arquitectura del frontend segueix el patró **Pages → Components → API Layer → Backend**, separant clarament la presentació de la comunicació amb el servidor:

```
Navegador (React SPA)
    │
    ▼
App.tsx (React Router)
    │
    ├─ /login              → LoginPage (pública)
    │
    ├─ ProtectedRoute      ← Verifica que l'usuari és ADMIN
    │   │
    │   ▼
    │   Layout             ← Sidebar + zona de contingut
    │       │
    │       ├─ /            → DashboardPage
    │       ├─ /reports     → ReportsListPage
    │       └─ /reports/:id → ReportDetailPage
    │
    └─ /*                  → NotFoundPage (404)

    ▼
api/ (Axios client)       ← Interceptors: JWT automàtic + redirect 401
    │
    ▼
Backend Express (:3000)   ← Proxy Vite en dev, CORS en producció
```

---

## Mòduls en detall

### 1. Configuració — Vite + Tailwind

#### `vite.config.ts`
Configura l'aplicació amb dos plugins principals:
- **`@vitejs/plugin-react`**: habilita JSX, Fast Refresh i el runtime de React
- **`@tailwindcss/vite`**: integra Tailwind CSS v4 directament al pipeline de Vite, eliminant la necessitat de PostCSS

El servidor de desenvolupament corre al port 5173 i configura un proxy que redirigeix totes les peticions `/api/*` al backend Express al port 3000. Això elimina problemes de CORS durant el desenvolupament, ja que el navegador sempre es comunica amb el mateix origen.

#### `index.css`
Importa Tailwind CSS amb la directiva `@import "tailwindcss"`. Tailwind v4 genera automàticament les classes d'utilitat a partir d'aquesta única directiva, sense necessitat de configuració addicional (`tailwind.config.js` no és necessari).

---

### 2. Tipus TypeScript — `src/types/index.ts`

Defineix els tipus del frontend que reflecteixen els models del backend:

- **`Role`, `State`, `Priority`, `IncidentEvent`**: unions de tipus que coincideixen amb els enums de Prisma
- **`User`**: interfície amb tots els camps retornats per l'API (`user_id`, `email`, `name`, `surname`, `nickname`, `role`, `points`)
- **`Report`**: interfície completa amb relacions (`createdBy`, `assignedTo`, `images`, `comments`)
- **`Image`, `Comment`**: interfícies per a les relacions anidades
- **`LoginResponse`**: estructura de la resposta de login (`token` + `user`)
- **`STATE_TRANSITIONS`**: mapa constant que defineix quins esdeveniments són vàlids per a cada estat. Aquesta estructura replica la lògica de la màquina XState del backend per renderitzar correctament els botons d'acció a la interfície

---

### 3. Capa API — `src/api/`

#### `client.ts` — Instància Axios
Crea una instància d'Axios centralitzada amb dues funcionalitats clau:

1. **Interceptor de petició**: abans de cada petició, llegeix el token JWT de `localStorage` i l'afegeix al header `Authorization: Bearer <token>`. Això evita duplicar la lògica d'autenticació a cada crida
2. **Interceptor de resposta**: si el backend retorna un **401** (token expirat o invàlid), esborra el token i redirigeix automàticament a `/login`

#### `auth.ts` — Servei d'autenticació
- **`login(email, password)`**: crida `POST /api/auth/login` i retorna el token i les dades de l'usuari
- **`getProfile()`**: crida `GET /api/users/profile` per validar el token existent en recarregar la pàgina

#### `reports.ts` — Servei d'incidències
- **`getReports(state?)`**: crida `GET /api/reports` amb filtre opcional per estat
- **`getReportById(id)`**: crida `GET /api/reports/:id` amb totes les relacions
- **`transitionReport(id, event, assignedToId?)`**: crida `PATCH /api/reports/:id/transition` per executar transicions d'estat

#### `users.ts` — Servei d'usuaris
- **`getTechnicians()`**: crida `GET /api/users/technicians` per obtenir la llista de tècnics (necessària per al selector d'assignació)

---

### 4. Context d'Autenticació — `src/context/AuthContext.tsx`

Implementa el patró React Context per gestionar l'estat d'autenticació de forma global. Exposa quatre valors:

- **`user`**: objecte `User` o `null` si no hi ha sessió
- **`loading`**: booleà que indica si s'està validant el token inicial
- **`login(email, password)`**: funció que autentica l'usuari. Verifica que el rol sigui `ADMIN` abans d'acceptar la sessió. Si l'usuari no és administrador, llança un error amb el missatge `"Només els administradors poden accedir a aquest panell"`
- **`logout()`**: esborra el token de `localStorage` i reseteja l'estat

**Flux de muntatge**: en carregar l'aplicació, comprova si existeix un token a `localStorage`. Si existeix, crida `getProfile()` per validar-lo amb el backend. Si el token és invàlid o l'usuari no és ADMIN, l'esborra automàticament.

---

### 5. Ruta Protegida — `src/components/ProtectedRoute.tsx`

Component wrapper que actua com a guarda de rutes. Implementa tres comportaments:

1. **Carregant**: mostra un spinner animat mentre `AuthContext` valida el token
2. **No autenticat o no ADMIN**: redirigeix a `/login` amb `<Navigate replace />`
3. **ADMIN autenticat**: renderitza `<Outlet />`, permetent que les rutes filles es mostrin

Aquesta és la primera capa de protecció (client-side). La segona capa és el backend, que valida el JWT i el rol en cada petició protegida.

---

### 6. Layout — `src/components/Layout.tsx`

Component que defineix l'estructura visual del panell d'administració amb un disseny de sidebar + contingut:

- **Sidebar esquerra** (264px fix): conté el logotip "CityFix", els enllaços de navegació (Dashboard i Incidències) i la informació de l'usuari amb botó de logout
- **Zona de contingut**: ocupa la resta de l'amplada i renderitza la pàgina activa mitjançant `<Outlet />`
- **Navegació**: utilitza `<NavLink>` de React Router per aplicar estils actius automàticament (fons índigo quan la ruta coincideix)

---

### 7. Pàgines — `src/pages/`

#### `LoginPage.tsx` — Autenticació d'administradors

Formulari de login amb email i contrasenya. El flux és:

1. L'usuari introdueix les credencials i envia el formulari
2. Es crida `authContext.login()`, que verifica que el rol sigui ADMIN
3. Si és correcte, redirigeix al Dashboard (`/`)
4. Si falla, mostra un missatge d'error (credencials incorrectes o permisos insuficients)

**Disseny**: pàgina completa centrada amb el logotip CityFix i un formulari amb estil card (fons blanc, ombra suau, vora arrodonida).

#### `DashboardPage.tsx` — Dashboard analític

Pàgina principal del panell d'administració, redissenyada amb visualitzacions professionals mitjançant la llibreria **Recharts**. Conté 9 components visuals organitzats en 4 blocs temàtics (veure secció "Mòdul d'Analítica i Visualització de Dades" per a la justificació completa).

**Controls globals**: selector de granularitat temporal (diari/setmanal/mensual) i rang temporal (30/90/180/365 dies) que afecten tots els gràfics temporals.

**Dades**: consumeix l'endpoint `GET /api/analytics/dashboard` que retorna totes les agregacions en una sola petició, calculades al servidor amb queries optimitzades.

#### `ReportsListPage.tsx` — Llistat d'incidències

Taula completa amb totes les incidències del sistema:

- **Filtre per estat**: selector desplegable que filtra les incidències. Utilitza `useSearchParams()` per sincronitzar el filtre amb la URL (`?state=OPEN`), permetent compartir enllaços filtrats
- **Taula**: mostra títol, estat (badge de color), prioritat (badge de color), creador, tècnic assignat i data
- **Navegació**: cada fila és clicable i porta a `/reports/:id`
- **Estat buit**: mostra un missatge centrat quan no hi ha incidències

#### `ReportDetailPage.tsx` — Detall i gestió d'una incidència

Pàgina més complexa del panell, dividida en dues columnes:

**Columna principal (2/3)**:
- **Descripció**: text complet de la incidència
- **Imatges**: galeria d'imatges adjuntes (si n'hi ha)
- **Comentaris**: llista de comentaris amb autor i data

**Columna lateral (1/3)**:
- **Detalls**: informació estructurada (creador, assignat, coordenades, dates)
- **Accions**: botons de transició d'estat segons l'estat actual, definits pel mapa `STATE_TRANSITIONS`:

| Estat actual | Accions disponibles |
|---|---|
| OPEN | Assignar (amb selector de tècnic) |
| ASSIGNED | Iniciar, Reassignar |
| IN_PROGRESS | Resoldre |
| VALIDATED | Tancar, Rebutjar |
| CLOSED | Cap (estat final) |

Quan l'estat és `OPEN`, apareix un selector desplegable amb la llista de tècnics (obtinguda de `GET /api/users/technicians`). L'administrador selecciona un tècnic i prem "Assignar", que executa `PATCH /api/reports/:id/transition` amb `event: "ASSIGN"` i `assignedToId`.

---

### 8. Components reutilitzables — `src/components/`

#### `ReportStatusBadge.tsx`
Badge visual que mostra l'estat d'una incidència amb el text en català i un color diferenciador:
- Oberta → blau
- Assignada → groc
- En procés → taronja
- Validada → verd
- Tancada → gris

#### `PriorityBadge.tsx`
Badge visual per a la prioritat amb codificació de color:
- Baixa → gris
- Mitjana → blau
- Alta → taronja
- Crítica → vermell

---

## Canvis al Backend

### Integració de CORS — `backend/src/index.ts`

S'ha afegit el middleware `cors` al backend per permetre peticions cross-origin en producció. En desenvolupament, el proxy de Vite fa que CORS no sigui necessari, però en desplegament real el frontend i el backend poden estar en orígens diferents.

La configuració actual (`cors()` sense opcions) permet peticions des de qualsevol origen. En producció, es recomanaria restringir-ho a l'origen específic del frontend.

---

## Flux complet de peticions (Frontend → Backend)

### Flux 1: Login d'un administrador

```
1. L'usuari introdueix email i password a LoginPage
2. LoginPage crida authContext.login(email, password)
3. AuthContext crida POST /api/auth/login via Axios
4. Axios → Vite proxy → Express backend
5. Backend valida credencials → retorna { token, user }
6. AuthContext verifica user.role === 'ADMIN'
7. Si és ADMIN: guarda token a localStorage, actualitza state
8. Si no és ADMIN: llança error, mostra missatge a l'usuari
9. React Router redirigeix a / (DashboardPage)
```

### Flux 2: Visualitzar el Dashboard

```
1. ProtectedRoute verifica que user existeix i és ADMIN
2. Layout renderitza sidebar + DashboardPage
3. DashboardPage crida getReports() al muntar-se
4. Axios afegeix JWT al header (interceptor)
5. GET /api/reports → backend retorna totes les incidències
6. DashboardPage calcula comptadors per estat
7. Renderitza targetes d'estat + taula d'incidències recents
```

### Flux 3: Assignar una incidència a un tècnic

```
1. Admin navega a ReportDetailPage (/reports/:id)
2. Component carrega report + llista de tècnics en paral·lel
3. Admin selecciona un tècnic al dropdown
4. Admin prem botó "Assignar"
5. Component crida transitionReport(id, 'ASSIGN', techId)
6. PATCH /api/reports/:id/transition → XState valida → actualitza BD
7. Backend retorna el report actualitzat (state: 'ASSIGNED')
8. Component actualitza l'estat local → UI es re-renderitza
9. Botons d'acció canvien a "Iniciar" i "Reassignar"
```

---

## Decisions tècniques

- **Vite amb proxy**: s'utilitza el proxy de Vite (`/api → localhost:3000`) per eliminar completament els problemes de CORS durant el desenvolupament. El navegador es comunica amb el port 5173 i Vite redirigeix les peticions API al backend. Això simplifica la configuració i evita headers CORS innecessaris
- **Tailwind CSS v4**: s'ha escollit la versió 4 de Tailwind amb la integració nativa de Vite (`@tailwindcss/vite`). Aquesta versió no requereix fitxer de configuració (`tailwind.config.js`) i detecta automàticament les classes utilitzades als fitxers del projecte
- **React Context per autenticació**: s'utilitza Context en lloc de Redux o Zustand perquè l'únic estat global necessari és la sessió de l'usuari. Afegir una llibreria de gestió d'estat seria sobreenginyeria per a aquesta necessitat
- **Axios amb interceptors**: l'interceptor de petició injecta el JWT automàticament a totes les crides, eliminant codi repetitiu. L'interceptor de resposta gestiona centralment els errors 401 (sessió expirada)
- **`STATE_TRANSITIONS` al frontend**: replicar el mapa de transicions vàlides de XState al frontend permet renderitzar correctament els botons d'acció sense fer una crida al backend per consultar les transicions disponibles. El backend continua validant cada transició amb XState, per la qual cosa la seguretat no es veu compromesa
- **Doble verificació de rol ADMIN**: l'accés d'administrador es verifica en dos nivells: (1) el frontend comprova el rol al `AuthContext` i al `ProtectedRoute`, impedint la navegació; (2) el backend verifica el JWT i el rol a cada petició protegida. Això garanteix que, fins i tot si algú manipula el frontend, el backend rebutjarà les peticions no autoritzades
- **`useSearchParams` per filtres**: el filtre d'estat de la llista d'incidències es sincronitza amb la URL (`/reports?state=OPEN`). Això permet que els filtres es mantinguin en recarregar la pàgina i que es puguin compartir enllaços filtrats directament

---

## Estructura de fitxers del Frontend

```
frontend/
├── index.html                     # HTML base amb títol "CityFix — Panel d'Administració"
├── package.json                   # Dependències React + Vite + Tailwind + Axios
├── tsconfig.json                  # Configuració TypeScript (project references)
├── vite.config.ts                 # Plugins (React, Tailwind) + proxy API
└── src/
    ├── main.tsx                   # Entry point: React 19 createRoot
    ├── App.tsx                    # Router: rutes públiques + protegides + 404
    ├── index.css                  # Import Tailwind CSS v4
    ├── api/
    │   ├── client.ts              # Axios instance amb interceptors JWT + 401
    │   ├── auth.ts                # login() + getProfile()
    │   ├── reports.ts             # getReports() + getReportById() + transitionReport()
    │   └── users.ts               # getTechnicians()
    ├── context/
    │   └── AuthContext.tsx         # Provider global: user, login, logout, loading
    ├── hooks/
    │   └── useAuth.ts             # Hook shortcut per useContext(AuthContext)
    ├── components/
    │   ├── ProtectedRoute.tsx     # Guard: redirigeix a /login si no és ADMIN
    │   ├── Layout.tsx             # Sidebar + contingut amb Outlet
    │   ├── ReportStatusBadge.tsx  # Badge estat amb color (Oberta, Assignada, etc.)
    │   └── PriorityBadge.tsx      # Badge prioritat amb color (Baixa, Mitjana, etc.)
    ├── pages/
    │   ├── LoginPage.tsx          # Formulari login amb verificació ADMIN
    │   ├── DashboardPage.tsx      # Targetes d'estat + incidències recents
    │   ├── ReportsListPage.tsx    # Taula filtrable per estat
    │   ├── ReportDetailPage.tsx   # Detall + accions de transició + selector tècnic
    │   └── NotFoundPage.tsx       # Pàgina 404
    └── types/
        └── index.ts               # Tipus mirall del backend + STATE_TRANSITIONS
```

## Dependències afegides en aquest Sprint

### Frontend (`frontend/package.json`)

| Paquet | Versió | Propòsit |
|---|---|---|
| `react` | 19.1 | Llibreria UI declarativa |
| `react-dom` | 19.1 | Renderització al DOM |
| `react-router-dom` | 7.6 | Routing client-side amb guards de ruta |
| `axios` | 1.9 | Client HTTP amb interceptors per JWT |
| `tailwindcss` | 4.1 | Framework CSS utility-first |
| `@tailwindcss/vite` | 4.1 | Plugin Vite per Tailwind sense PostCSS |

### Backend (noves)

| Paquet | Versió | Propòsit |
|---|---|---|
| `cors` | 2.8 | Middleware CORS per permetre peticions cross-origin |
| `@types/cors` | 2.8 | Tipus TypeScript per cors |

---

## Protecció del Registre d'Usuaris — Invitation-based Registration

### Problema detectat

El registre públic (`POST /api/auth/register`) acceptava el camp `role` directament del body de la petició, permetent que qualsevol persona es pogués autoassignar el rol `ADMIN` o `TECHNICAL`. Això és una vulnerabilitat de seguretat crítica: el client controlava l'assignació de privilegis.

### Solució implementada

S'ha implementat el patró **"Invitation-based Registration"** (o "Token-based Privileged Enrollment"), seguint el model de **Zero Trust**:

1. **Registre públic (STUDENT)**: si el rol sol·licitat és `STUDENT` (o no s'especifica), el backend **ignora** el camp `role` del body i **força** el rol a `STUDENT` programàticament. Això prevé el "Mass Assignment Attack".

2. **Registre privilegiat (ADMIN/TECHNICAL)**: requereix un `token` d'invitació generat prèviament per un administrador existent. El backend valida el token contra la taula `invites` i executa la creació de l'usuari i el marcatge de la invitació dins d'una **transacció atòmica** (`prisma.$transaction`), garantint consistència.

3. **Gestió d'invitacions**: nou endpoint `POST /api/invites` protegit amb `authenticate + authorize('ADMIN')`. Genera tokens criptogràfics de 64 caràcters hexadecimals amb `crypto.randomBytes(32)`, garantint entropia criptogràfica real (no UUID).

### Model de dades — Taula `invites`

```prisma
model Invite {
  id        String   @id @default(uuid())
  email     String   @unique
  role      Role     // ADMIN o TECHNICAL
  token     String   @unique
  used      Boolean  @default(false)
  createdAt DateTime @default(now())

  @@map("invites")
}
```

### Nous endpoints

| Mètode | Ruta | Protecció | Descripció |
|---|---|---|---|
| GET | `/api/invites` | authenticate + authorize('ADMIN') | Llistar totes les invitacions |
| POST | `/api/invites` | authenticate + authorize('ADMIN') | Crear una invitació nova |

### Flux de registre actualitzat

```
POST /api/auth/register { email, name, surname, password, nickname }
    └── role absent o 'STUDENT' → Crea usuari amb role = 'STUDENT' (forçat)

POST /api/auth/register { email, ..., role: 'ADMIN', token: 'abc...' }
    └── Cerca invite { email, token, used: false }
          ├── No existeix → 403 Forbidden
          └── Existeix → $transaction([
                prisma.user.create({ role: invite.role }),
                prisma.invite.update({ used: true })
              ])

POST /api/invites { email, role: 'TECHNICAL' }  [ADMIN only]
    └── Genera token = crypto.randomBytes(32).toString('hex')
    └── Crea registre a la taula invites
    └── Retorna { email, role, token } → L'admin l'envia a la persona
```

### Transacció atòmica

La creació de l'usuari i el marcatge de la invitació (`used: true`) s'executen dins de `prisma.$transaction()`. Si una de les dues operacions falla, cap de les dues s'aplica. Això prevé inconsistències com:
- Usuari creat però invitació encara vàlida → reutilització possible
- Invitació marcada com usada però usuari no creat → token perdut

### Prerequisit: primer administrador

Com que el sistema requereix un admin existent per crear invitacions, el primer administrador s'ha de crear **manualment a la base de dades** (Supabase):
1. Generar el hash bcrypt de la contrasenya (cost 10) a un generador en línia
2. Inserir directament a la taula `users` amb `role = 'ADMIN'`
3. Verificar que el login funciona via `POST /api/auth/login`

### Pàgina d'administració d'invitacions — `InvitesPage.tsx`

S'ha afegit una nova pàgina al panell d'administració (`/invites`) que permet:
- **Crear invitacions**: formulari amb email i selector de rol (Tècnic o Administrador). En crear-la, mostra el token generat perquè l'admin el pugui enviar
- **Llistar invitacions**: taula amb email, rol, token (truncat), estat (Pendent/Utilitzada) i data

### Fitxers creats o modificats

| Fitxer | Acció | Descripció |
|---|---|---|
| `backend/prisma/schema.prisma` | Modificat | Afegit model Invite |
| `backend/src/services/invite.ts` | Creat | Lògica de creació i llistat d'invitacions |
| `backend/src/controllers/invite.ts` | Creat | Validació i gestió HTTP per invitacions |
| `backend/src/routes/invites.ts` | Creat | Rutes GET i POST protegides amb RBAC |
| `backend/src/index.ts` | Modificat | Registrada la ruta `/api/invites` |
| `backend/src/services/auth.ts` | Modificat | Flux de registre amb validació d'invitació + $transaction |
| `backend/src/controllers/auth.ts` | Modificat | Accepta camp `token`, gestiona errors 403 |
| `backend/src/types/index.ts` | Modificat | Afegit camp `token?` a RegisterDTO |
| `frontend/src/types/index.ts` | Modificat | Afegit tipus Invite |
| `frontend/src/api/invites.ts` | Creat | Client API per invitacions |
| `frontend/src/pages/InvitesPage.tsx` | Creat | Pàgina de gestió d'invitacions |
| `frontend/src/App.tsx` | Modificat | Afegida ruta `/invites` |
| `frontend/src/components/Layout.tsx` | Modificat | Afegit enllaç "Invitacions" al sidebar |

### Correcció addicional: imports Prisma

S'ha corregit un error pre-existent als imports de tots els fitxers del backend: el path `../../backend/prisma` era incorrecte (el directori no existia). S'ha substituït per `../../generated/prisma`, que és el directori real on `prisma generate` escriu el client.

---

## Protecció de l'Administrador Crític i Revocació d'Usuaris

### Problema

Amb el sistema d'invitacions implementat, calia tancar el cercle de seguretat amb dues qüestions pendents:
1. **Anti-deadlock**: si tots els admins es revoquen mútuament, el sistema queda sense administradors i és irrecuperable.
2. **Revocació d'accés**: no existia cap mecanisme per treure l'accés a un tècnic o admin que ja no hauria de tenir-lo. Eliminar l'usuari de la BD trencaria la integritat referencial (incidències assignades, comentaris, etc.).

### Canvis al model de dades

#### Camp `active` a User
S'ha afegit un booleà `active` (per defecte `true`) al model `User`. Quan un admin revoca un usuari, `active` passa a `false`. L'usuari desactivat:
- **No pot fer login**: el servei d'autenticació comprova `active` abans de generar el JWT
- **No apareix a la llista de tècnics**: el query filtra per `active: true`
- **Manté la traçabilitat**: les incidències, comentaris i imatges associades queden intactes (soft delete)

#### Camp `inviteId` a User
S'ha afegit una relació `User.inviteId → Invite.id` (opcional, `@unique`). S'assigna automàticament durant el registre privilegiat i **mai s'exposa ni es pot modificar via API**. Permet vincular cada usuari privilegiat amb la invitació que va originar el seu accés i executar la revocació atòmica.

#### Enum `InviteStatus` (substitueix `used: Boolean`)
El booleà `used` de la taula `Invite` s'ha substituït per un enum amb tres estats:

| Estat | Significat |
|---|---|
| `PENDING` | Invitació creada, pendent d'ús |
| `USED` | L'usuari s'ha registrat correctament |
| `REVOKED` | L'admin ha revocat l'accés de l'usuari |

Això permet distingir entre una invitació consumida normalment i una revocada posteriorment, afegint traçabilitat completa al cicle de vida de cada accés.

### Regles de protecció Anti-Deadlock

#### REGLA 1: Administrador Root (Intocable)
El correu definit a la variable d'entorn `ROOT_ADMIN_EMAIL` (per defecte `admin.master@uab.cat`) està blindat. Qualsevol petició de revocació sobre aquest usuari és rebutjada amb **403 Forbidden**. Això garanteix que sempre existirà almenys un admin funcional al sistema.

#### REGLA 2: Últim Supervivent
Abans de revocar qualsevol usuari amb rol `ADMIN`, el sistema executa un comptatge:
```typescript
const activeAdmins = await prisma.user.count({
  where: { role: 'ADMIN', active: true },
});
if (activeAdmins <= 1) {
  throw new Error('No es pot desactivar l\'últim administrador actiu del sistema');
}
```
Si només queda un admin actiu, l'operació es cancel·la. Això protegeix contra la situació on l'últim admin es revoca a si mateix o és revocat per un procés automatitzat.

### Flux de revocació (transacció atòmica)

```
Admin clica "Revocar" → PATCH /api/users/:id/revoke
    │
    ├── Validació REGLA 1: És el root admin? → 403
    ├── Validació REGLA 2: És l'últim admin actiu? → 403
    │
    └── $transaction([
          prisma.user.update({ active: false }),
          prisma.invite.update({ status: 'REVOKED' })
        ])
    │
    └── L'usuari ja no pot fer login (Error 403 al intentar-ho)
```

### Nous endpoints

| Mètode | Ruta | Protecció | Descripció |
|---|---|---|---|
| GET | `/api/users/privileged` | authenticate + authorize('ADMIN') | Llistar tots els ADMIN i TECHNICAL |
| PATCH | `/api/users/:id/revoke` | authenticate + authorize('ADMIN') | Revocar accés d'un usuari |

### Protecció contra Mass Assignment

Els camps `active` i `inviteId` **no s'exposen ni s'accepten** en cap petició:
- El registre assigna `inviteId` internament (mai ve del body)
- Cap endpoint PATCH accepta `active` com a camp del body
- El camp `active` només es modifica mitjançant l'endpoint dedicat `/revoke`
- Les queries `select` del getProfile i altres endpoints controlen exactament quins camps es retornen

### Blocatge de login per usuaris inactius

Al servei `loginUser`, s'ha afegit una comprovació abans de generar el JWT:
```typescript
if (!user.active) {
  throw new Error('Compte desactivat. Contacta amb un administrador.');
}
```
Això garanteix que, fins i tot si un usuari revocat conserva un token JWT anterior, qualsevol intent de revalidació (quan el token caduca o es recarrega la pàgina) fallarà.

### Actualització de la pàgina d'Invitacions

La pàgina `/invites` del panell d'administració s'ha ampliat per incloure:
1. **Taula d'usuaris privilegiats**: mostra nom, email, rol, estat (Actiu/Revocat) i botó "Revocar" per cada usuari actiu
2. **Formulari de creació d'invitacions**: (sense canvis)
3. **Historial d'invitacions**: ara mostra l'estat amb tres valors (Pendent/Utilitzada/Revocada) en lloc del booleà anterior

### Fitxers creats o modificats

| Fitxer | Acció | Descripció |
|---|---|---|
| `backend/prisma/schema.prisma` | Modificat | Afegits `active`, `inviteId` a User + enum `InviteStatus` |
| `backend/src/config/env.ts` | Modificat | Afegida variable `ROOT_ADMIN_EMAIL` |
| `backend/src/services/auth.ts` | Modificat | Link `inviteId` al registre + bloqueig login si `!active` |
| `backend/src/services/user.ts` | Creat | `revokeUser()` amb regles anti-deadlock + `getPrivilegedUsers()` |
| `backend/src/controllers/user.ts` | Modificat | Afegits `getPrivileged()` i `revoke()` + filtre `active: true` a tècnics |
| `backend/src/routes/users.ts` | Modificat | Afegides rutes GET privileged + PATCH revoke |
| `backend/src/services/invite.ts` | Modificat | Usa `status` enum en lloc de `used` booleà |
| `frontend/src/types/index.ts` | Modificat | Afegits `active` a User, `InviteStatus`, actualitzat Invite |
| `frontend/src/api/users.ts` | Modificat | Afegits `getPrivilegedUsers()` i `revokeUser()` |
| `frontend/src/pages/InvitesPage.tsx` | Modificat | Taula d'usuaris amb botó revocar + status enum a invitacions |

---

## Tipificació de Categories — Enum `Category`

El camp `category` del model `Report` s'ha canviat de `String?` a un **enum Prisma**, eliminant l'ambigüitat de text lliure:

| Valor enum | Etiqueta (ca) | Descripció |
|---|---|---|
| `LIGHTING` | Il·luminació | Faroles, llums, electricitat exterior |
| `URBAN_FURNITURE` | Mobiliari urbà | Bancs, papereres, marquesines |
| `PAVEMENT` | Via pública | Voreres, escocells, asfalt, forats |
| `CLEANING` | Neteja | Contenidors, brossa, neteja general |
| `GREEN_AREAS` | Zones verdes | Arbres, jardineria, reg |
| `SIGNAGE` | Senyalització | Cartells, indicadors, senyals |
| `ACCESSIBILITY` | Accessibilitat | Rampes, baranes, passos adaptats |
| `TECHNOLOGY` | Tecnologia | Ordinadors, xarxes, equipament digital |
| `OTHER` | Altres | Qualsevol cosa que no encaixi |

Al frontend, el mapa `CATEGORY_LABELS` (a `types/index.ts`) tradueix cada valor enum a la seva etiqueta en català per a la interfície d'usuari.

---

## Mòdul SIG: Visualització Geogràfica d'Incidències

### Resum

S'ha implementat un mòdul de visualització cartogràfica que permet als administradors veure les incidències sobre un mapa interactiu del campus. El mòdul ofereix dues vistes: **markers amb clustering** (agrupació automàtica per proximitat) i **mapa de calor** (heatmap) amb pes configurable. Ambdues vistes suporten filtres per estat, categoria i rang temporal.

---

### Justificació de les tecnologies escollides

#### PostGIS — Extensió geoespacial per a PostgreSQL

PostGIS és l'extensió estàndard de la indústria per afegir capacitats geoespacials a PostgreSQL. S'ha escollit per tres raons:

1. **Integració nativa amb Supabase**: Supabase (la plataforma de base de dades del projecte) ofereix PostGIS com a extensió activable amb un sol clic. Això evita haver de configurar un servidor GIS separat o migrar a una base de dades especialitzada.

2. **Tipus `geography` amb SRID 4326**: PostGIS permet emmagatzemar punts geogràfics com a objectes binaris optimitzats (`geography(Point, 4326)`) que representen coordenades sobre l'el·lipsoide terrestre WGS 84 — el mateix sistema de referència que utilitzen GPS, Google Maps i OpenStreetMap. Emmagatzemar les coordenades com a `geography` en lloc de simples `Float` permet fer càlculs de distància reals en metres (no en graus decimals) si en el futur es necessiten consultes espacials com "incidències dins d'un radi de 500m".

3. **Trigger automàtic**: els camps `latitude` i `longitude` del model `Report` es mantenen com a `Float` per simplicitat a l'API (qualsevol client pot enviar coordenades decimals). Un trigger PL/pgSQL (`BEFORE INSERT OR UPDATE`) transforma automàticament aquests valors en el punt binari PostGIS dins la columna `location`. Aquesta decisió de disseny desacobla la interfície (lat/lng simples) de l'emmagatzematge optimitzat (geometria PostGIS), seguint el principi de responsabilitat única: l'aplicació no necessita conèixer PostGIS, la base de dades s'encarrega de la conversió.

**Alternativa descartada**: emmagatzemar les coordenades només com a `Float` i fer tots els càlculs al frontend. Això funcionaria per a visualització bàsica, però impossibilitaria qualsevol consulta espacial eficient (radi, bounding box, proximitat) al crèixer el sistema.

#### Leaflet — Llibreria de mapes interactius

S'ha escollit Leaflet (v1.9) com a motor de mapes per al frontend, amb la integració `react-leaflet` (v5.0) per a la compatibilitat amb React. Les raons són:

1. **Codi obert i gratuït**: a diferència de Google Maps (que requereix clau d'API de pagament) o Mapbox (que té límits d'ús gratuït), Leaflet és completament lliure sota llicència BSD. Per a un TFG acadèmic, això elimina costos i dependències de serveis externs.

2. **Lleugeresa**: Leaflet pesa ~42 KB (gzip), molt menys que OpenLayers (~180 KB) o l'SDK de Google Maps (~200 KB). En una SPA que ja carrega React, Axios i Tailwind, mantenir el pes del bundle reduït és important per al rendiment.

3. **Ecosistema de plugins**: Leaflet té un ecosistema madur de plugins per a funcionalitats avançades. S'han utilitzat dos plugins específics:
   - **`leaflet.markercluster`**: agrupació visual de markers per proximitat amb animacions de dispersió
   - **`leaflet.heat`**: generació de mapes de calor (heatmap) amb gradient configurable

4. **Capa base OpenStreetMap**: les tiles (imatges del mapa) provenen d'OpenStreetMap, que és gratuït i de codi obert. No cal API key ni configuració de facturació.

**Alternativa descartada**: Google Maps (cost per ús, API key obligatòria, termes de servei restrictius) i Mapbox (gratuït fins a un límit, després de pagament). Ambdues opcions introdueixen una dependència de servei extern innecessària per a un entorn acadèmic.

#### GeoJSON — Format d'intercanvi de dades geoespacials

L'endpoint `/api/geo/geojson` retorna les incidències en format **GeoJSON** (`FeatureCollection`), l'estàndard obert (RFC 7946) per a dades geoespacials. S'ha escollit perquè:

1. **Compatibilitat universal**: Leaflet, OpenLayers, Mapbox, Google Maps, QGIS i pràcticament qualsevol eina GIS consumeix GeoJSON nativament. Si en el futur es canvia la llibreria de mapes, l'API no cal modificar-la.

2. **Separació geometria/propietats**: cada `Feature` conté un objecte `geometry` (coordenades) i un objecte `properties` (metadades de la incidència). Això permet al frontend renderitzar els punts al mapa i alhora mostrar informació contextual als popups sense crides addicionals.

3. **Ordre de coordenades**: GeoJSON utilitza l'ordre `[longitude, latitude]`, que és el contrari de la convenció habitual `[lat, lng]`. Aquesta diferència és una font habitual d'errors; al servei `geo.ts` la conversió es fa explícitament: `coordinates: [r.longitude, r.latitude]`.

#### Clustering client-side vs. server-side — Decisió de disseny

El pla de desenvolupament inicial plantejava la possibilitat d'implementar clustering SQL al servidor (`ST_ClusterDBSCAN` o `ST_ClusterKMeans`). Aquesta opció s'ha **descartat intencionadament** en favor del clustering purament visual al frontend (`leaflet.markercluster`). La justificació és:

| Criteri | Clustering SQL (servidor) | Clustering Leaflet (client) |
|---|---|---|
| Complexitat | Alta (consultes SQL avançades) | Baixa (plugin configurable) |
| Volum de dades | Necessari per a >10.000 punts | Suficient per a centenars |
| Interactivitat | Estàtica (agrupa abans d'enviar) | Dinàmica (reagrupa al fer zoom) |
| Experiència d'usuari | Perd detall individual | Dispersió animada al clicar |

En un campus universitari, el volum esperat d'incidències és de centenars (no milions). Amb aquest volum, enviar tots els punts al client i deixar que `leaflet.markercluster` els agrupi visualment és la solució més eficient: l'usuari pot fer zoom i veure els markers individuals amb animacions de dispersió, cosa que no seria possible amb clustering pre-calculat al servidor.

Si en el futur el sistema s'escalés a escala de ciutat (desenes de milers d'incidències), es podria afegir clustering SQL com a capa d'optimització sense modificar el frontend — simplement substituint les Features individuals per centroids agrupats a l'endpoint GeoJSON.

#### Heatmap amb pes configurable — Anàlisi multidimensional

El mapa de calor (`leaflet.heat`) no es limita a mostrar densitat: l'administrador pot seleccionar el **criteri de pes** per obtenir perspectives analítiques diferents sobre les mateixes dades:

| Criteri | Càlcul del pes | Pregunta que respon |
|---|---|---|
| **Prioritat** | LOW=1, MEDIUM=2, HIGH=3, CRITICAL=4 | On es concentren els problemes més greus? |
| **Densitat** | Totes les incidències pesen 1 | Quines zones generen més incidències? |
| **Antiguitat** | Setmanes d'edat (1-10) | On hi ha problemes crònics sense resoldre? |

Aquesta decisió de disseny converteix el heatmap en una eina analítica real per a la presa de decisions, en comptes d'una simple visualització decorativa. Per exemple, un administrador pot detectar que una zona no té moltes incidències (densitat baixa) però les poques que té són crítiques (prioritat alta), o que una zona acumula incidències antigues sense resoldre (antiguitat alta).

El càlcul del pes es fa al **backend** (`services/geo.ts`), no al frontend, per dues raons:
1. El frontend no ha de conèixer la lògica de negoci (quant pesa cada prioritat)
2. Si es canvia la fórmula de pes, només cal modificar el servei — el frontend simplement renderitza els valors que rep

---

### Arquitectura

```
MapPage.tsx (React)
    │
    ├─ Vista "Markers" ──► MarkerClusterGroup.tsx ──► leaflet.markercluster
    │                           │
    │                           └─ getGeoJson() ──► GET /api/geo/geojson
    │
    └─ Vista "Heatmap" ──► HeatmapLayer.tsx ──► leaflet.heat
                                │
                                └─ getHeatmapData() ──► GET /api/geo/heatmap
                                        │
                                        ▼
                                Backend (Prisma queries amb filtres)
```

### Infraestructura PostGIS

#### Trigger PL/pgSQL — `backend/prisma/sql/001_postgis_trigger.sql`

S'ha creat un trigger que s'executa automàticament **BEFORE INSERT OR UPDATE** a la taula `reports`. La funció `sync_report_location()` transforma els camps decimals `latitude` i `longitude` en un punt binari PostGIS (`geography(Point, 4326)`) dins de la columna `location`.

Això desacobla la creació d'incidències (que treballa amb lat/lng simples) de la indexació geoespacial (que necessita geometries PostGIS per a consultes espacials eficients).

El trigger s'ha d'executar manualment al SQL Editor de Supabase un cop, ja que Prisma no suporta triggers nativament.

### Endpoints GIS — `backend/src/routes/geo.ts`

| Mètode | Ruta | Query Params | Descripció |
|---|---|---|---|
| GET | `/api/geo/geojson` | `state`, `category`, `days` | FeatureCollection GeoJSON |
| GET | `/api/geo/heatmap` | `weightBy`, `state`, `category`, `days` | Punts amb pes per al heatmap |

Ambdós endpoints estan protegits amb `authenticate + authorize('ADMIN')`.

#### Format GeoJSON

L'endpoint `/geojson` retorna una `FeatureCollection` estàndard compatible directament amb Leaflet i qualsevol client GIS:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [2.1060, 41.5025] },
      "properties": {
        "id": "uuid",
        "title": "Farola apagada",
        "state": "OPEN",
        "priority": "HIGH",
        "category": "LIGHTING",
        "createdBy": "Admin",
        "createdAt": "2026-04-06T..."
      }
    }
  ]
}
```

Nota: GeoJSON utilitza l'ordre `[longitude, latitude]`, no `[latitude, longitude]`.

#### Format Heatmap

L'endpoint `/heatmap` retorna un array de punts amb pes calculat segons el criteri seleccionat:

| `weightBy` | Càlcul |
|---|---|
| `priority` | LOW=1, MEDIUM=2, HIGH=3, CRITICAL=4 |
| `density` | Totes les incidències pesen 1 (concentració pura) |
| `age` | Setmanes d'antiguitat, limitat a 1-10 |

### Visualització Frontend — `MapPage.tsx`

#### Component base

Mapa Leaflet centrat al campus UAB (`41.5025, 2.1060`) amb zoom 16 i capa base OpenStreetMap. El mapa ocupa 600px d'alçada dins d'un contenidor arrodonit.

#### Vista Markers (`MarkerClusterGroup.tsx`)

Utilitza el plugin `leaflet.markercluster` per agrupar automàticament els markers per proximitat. Cada marker té:
- **Color segons estat**: blau (Oberta), groc (Assignada), taronja (En procés), verd (Validada), gris (Tancada)
- **Popup**: títol, estat, prioritat, categoria (traduïda al català) i data
- **Navegació**: clic al marker obre el detall de la incidència (`/reports/:id`)

El clustering es calcula al client (no al servidor) ja que el volum de dades d'un campus universitari (centenars d'incidències) no justifica la complexitat de clustering SQL (`ST_ClusterDBSCAN`).

#### Vista Heatmap (`HeatmapLayer.tsx`)

Utilitza el plugin `leaflet.heat` amb un gradient de 5 colors (blau → cian → verd → groc → vermell). L'admin pot seleccionar el criteri de pes entre tres opcions per obtenir perspectives analítiques diferents.

#### Filtres

Tres selectors que filtren ambdues vistes simultàniament:
- **Estat**: tots / Obertes / Assignades / En procés / Validades / Tancades
- **Categoria**: totes / els 9 valors de l'enum Category
- **Rang temporal**: qualsevol data / últims 7 / 30 / 90 dies

Els filtres es passen com a query params als endpoints del backend, que filtra a nivell de consulta Prisma.

#### Toggle de vista

Un botó segmentat permet alternar entre "Markers" i "Mapa de calor". Quan s'activa el heatmap, apareix un selector addicional per al criteri de pes.

### Llegenda

A sota del mapa es mostra:
- En vista markers: llegenda de colors per estat
- En vista heatmap: text descriptiu del criteri de pes seleccionat

### Dependències afegides

| Paquet | Versió | Propòsit |
|---|---|---|
| `leaflet` | 1.9 | Llibreria de mapes interactius |
| `react-leaflet` | 5.0 | Integració React per Leaflet |
| `leaflet.markercluster` | 1.5 | Plugin de clustering visual |
| `leaflet.heat` | 0.2 | Plugin de mapa de calor |
| `@types/leaflet` | — | Tipus TypeScript |
| `@types/leaflet.markercluster` | — | Tipus TypeScript |
| `@types/leaflet.heat` | — | Tipus TypeScript |

### Fitxers creats o modificats

| Fitxer | Acció | Descripció |
|---|---|---|
| `backend/prisma/schema.prisma` | Modificat | `category` canviat de `String?` a `Category?` enum |
| `backend/prisma/sql/001_postgis_trigger.sql` | Creat | Trigger PostGIS per sincronitzar columna `location` |
| `backend/src/services/geo.ts` | Creat | Queries GeoJSON i heatmap amb filtres |
| `backend/src/controllers/geo.ts` | Creat | Controlador amb validació de query params |
| `backend/src/routes/geo.ts` | Creat | Rutes protegides GET /api/geo/* |
| `backend/src/index.ts` | Modificat | Registrada ruta `/api/geo` |
| `frontend/src/api/geo.ts` | Creat | Client API per GeoJSON i heatmap |
| `frontend/src/components/map/MarkerClusterGroup.tsx` | Creat | Clustering visual amb popups |
| `frontend/src/components/map/HeatmapLayer.tsx` | Creat | Capa de calor configurable |
| `frontend/src/pages/MapPage.tsx` | Creat | Pàgina completa amb mapa + filtres + toggle |
| `frontend/src/App.tsx` | Modificat | Afegida ruta `/map` |
| `frontend/src/components/Layout.tsx` | Modificat | Afegit enllaç "Mapa" al sidebar |
| `frontend/src/types/index.ts` | Modificat | Afegits `Category`, `CATEGORY_LABELS` |

---

## Mòdul d'Analítica i Visualització de Dades — Dashboard

### Resum

S'ha redissenyat completament el `DashboardPage.tsx`, transformant-lo d'una pàgina estàtica amb comptadors simples a un dashboard analític professional amb 9 visualitzacions interactives. L'objectiu és satisfer el requisit funcional **RF-07** (Panell de control d'administració) i l'objectiu estratègic del projecte d'**anàlisi de dades per a la gestió estratègica del Campus**, proporcionant als administradors una eina de presa de decisions basada en dades reals.

### Justificació de la llibreria escollida — Recharts

S'ha escollit **Recharts** com a llibreria de visualització de dades pels següents motius:

1. **Integració nativa amb React**: Recharts és una llibreria construïda específicament sobre components React i D3.js. Cada gràfic és un component declaratiu (`<PieChart>`, `<BarChart>`, `<AreaChart>`), cosa que s'integra naturalment amb l'arquitectura de components del frontend existent. A diferència de Chart.js (imperatiu, basat en Canvas) o D3.js pur (excessivament complex per a aquest cas d'ús), Recharts respecta el cicle de vida de React i el seu model de dades reactiu.

2. **Suport complet dels tipus de gràfic necessaris**: El dashboard requereix 6 tipus de gràfic diferents (donut, àrees apilades, barres agrupades, barres horitzontals apilades, dispersió i barres amb colors per cel·la). Recharts els suporta tots de forma nativa, sense necessitat de plugins addicionals ni configuracions complexes.

3. **Responsivitat integrada**: El component `<ResponsiveContainer>` adapta automàticament cada gràfic al contenidor pare, garantint que el dashboard es visualitzi correctament en qualsevol resolució de pantalla sense codi CSS addicional.

4. **Lleugeresa**: Recharts afegeix ~45 KB (gzipped) al bundle, significativament menys que alternatives com Highcharts (~80 KB) o ECharts (~100 KB). En un projecte acadèmic on el rendiment de càrrega és rellevant, aquesta diferència és significativa.

5. **Personalització**: Permet configurar colors, tooltips, llegendes i etiquetes per component, cosa que ha permès mantenir la coherència visual amb la paleta de colors ja establerta al projecte (estat → color, categoria → color, prioritat → color).

**Alternatives descartades:**
- **Chart.js / react-chartjs-2**: Model imperatiu que no s'integra tan bé amb l'estat de React. Requereix refs i useEffect per actualitzar gràfics, trencant la filosofia declarativa.
- **D3.js**: Massa baix nivell per a aquest cas d'ús. Recharts ja utilitza D3 internament per als càlculs matemàtics, però abstrau la complexitat de manipulació del DOM.
- **Nivo**: Bona alternativa, però menys documentada i amb una comunitat més petita.

### Arquitectura de dades — Blocs analítics

El dashboard s'organitza en 4 blocs temàtics, cadascun dissenyat per respondre preguntes específiques de gestió:

#### Bloc 1: Operatiu — Estat en temps real

**Pregunta que respon**: Quin és l'estat actual del sistema? Hi ha bloqueig?

| Component | Tipus | Dades |
|---|---|---|
| Targetes d'estat (×5) | KPI cards clicables | Comptatge per `state` (`groupBy`) |
| % Crítiques + Altes | KPI card vermell | Ràtio `priority IN (HIGH, CRITICAL)` / total |
| Distribució per estat | Donut Chart (PieChart amb innerRadius) | Mateixa agregació, visualitzada com a proporcions |

**Justificació del Donut Chart**: El gràfic de rosca és l'estàndard per mostrar distribucions proporcionals d'un conjunt tancat de categories (els 5 estats). La perforació central permet col·locar el total al centre, maximitzant la densitat informativa. S'ha preferit davant d'un gràfic de barres perquè l'objectiu no és comparar quantitats absolutes sinó percebre les proporcions relatives d'un cop d'ull.

#### Bloc 2: Temporal — Anàlisi de tendències

**Pregunta que respon**: El sistema millora o empitjora amb el temps? Quines categories creixen?

| Component | Tipus | Dades |
|---|---|---|
| Històric per categoria | Stacked Area Chart | `createdAt` truncat per interval + `category` |
| Creades vs Tancades | Grouped Bar Chart | `createdAt` vs `resolvedAt` per setmana |

**Justificació del Stacked Area Chart**: Les àrees apilades mostren simultàniament la tendència global (l'alçada total de l'àrea) i la composició per categoria (cada franja de color). Això permet detectar estacionalitat (per exemple, pics de `TECHNOLOGY` durant el període d'exàmens quan les aules d'informàtica tenen més ús) i preveure necessitats de material. El toggle de granularitat (dia/setmana/mes) permet a l'administrador ajustar el nivell de detall segons el context de l'anàlisi.

**Justificació del Grouped Bar Chart**: La comparativa visual de barres adjacents (blau = creades, verd = tancades) és la forma més intuïtiva de mesurar la **capacitat d'absorció del sistema**. Si les barres blaves superen consistentment les verdes, el sistema està col·lapsant i cal assignar més recursos. Aquesta visualització requereix el camp `resolvedAt` (afegit al model Report), ja que `updatedAt` no distingeix entre una actualització d'estat i el tancament definitiu.

#### Bloc 3: Rendiment — Eficiència dels recursos

**Pregunta que respon**: Els tècnics estan equilibrats? Les incidències crítiques es resolen ràpid?

| Component | Tipus | Dades |
|---|---|---|
| Workload per tècnic | Stacked Horizontal Bar Chart | `assignedToId` + `state` (`groupBy`) |
| Temps resolució vs Prioritat | Scatter Plot | `resolvedAt - createdAt` vs `priority` |
| Distribució per categoria | Bar Chart vertical amb colors | `category` (`groupBy`) |

**Justificació del Horizontal Bar Chart apilat**: Les barres horitzontals permeten incloure noms llargs de tècnics a l'eix Y sense problemes de rotació de text. L'apilament per estat (Assignades → En procés → Validades → Tancades) permet veure no només el volum total sinó l'estat del treball de cada tècnic. Un tècnic amb moltes barres taronges (En procés) i poques grises (Tancades) pot indicar un coll d'ampolla.

**Justificació del Scatter Plot**: El gràfic de dispersió és el tipus de gràfic canònic per analitzar la relació entre dues variables contínues. En aquest cas, l'eix X (hores de resolució) i l'eix Y (nivell de prioritat) permeten **auditar la qualitat del servei**: les incidències Crítiques haurien d'aparèixer agrupades a l'esquerra (poques hores). Si apareixen punts Crítics a la dreta del gràfic, indica una fallada en la priorització. Aquesta visualització requereix el camp `resolvedAt` per calcular el temps real de resolució.

**Justificació del Bar Chart per categoria (substitueix Treemap per edificis)**: El pla original preveia un Treemap per edificis/facultats, però el model de dades actual no disposa d'un camp `building` als reports (es preveu afegir-lo al Sprint 4 amb l'app mòbil). Com a alternativa equivalent en valor analític, s'ha implementat un gràfic de barres per categoria que identifica quins tipus d'infraestructura consumeixen més recursos de manteniment. Cada barra utilitza el color assignat a la seva categoria per mantenir la coherència visual amb el mapa i la resta del dashboard.

#### Bloc 4: Social — Participació

**Pregunta que respon**: Quins usuaris contribueixen més al sistema?

| Component | Tipus | Dades |
|---|---|---|
| Top 10 Reporters | Taula rànquing | `createdById` (`groupBy`) + `users.points` |

**Justificació de la taula (substitueix Leaderboard de punts)**: El sistema de gamificació complet està planificat pel Sprint 7. Mentrestant, s'ha implementat un rànquing basat en el nombre d'incidències reportades per cada usuari, que ja és calculable amb les dades actuals. La taula inclou columna de punts (actualment 0 per a tots els usuaris) preparada per reflectir el sistema de recompenses quan s'implementi. S'ha optat per una taula HTML en lloc d'un gràfic perquè els rànquings amb noms d'usuari i múltiples mètriques es llegeixen millor en format tabular que en barres.

### Canvi al model de dades — `resolvedAt`

S'ha afegit el camp `resolvedAt DateTime?` al model `Report` a Prisma. Aquest camp:
- Es marca automàticament amb `new Date()` quan una incidència transiciona a l'estat `CLOSED` (dins del servei `transitionReport()`)
- És `null` per a incidències no tancades
- Permet calcular el temps real de resolució (`resolvedAt - createdAt`) sense dependre de `updatedAt`, que canvia amb qualsevol modificació

**Per què no reutilitzar `updatedAt`?** El camp `@updatedAt` de Prisma s'actualitza amb qualsevol operació d'escriptura sobre el registre (canvi d'estat, reassignació, edició de camps). Això contamina la dada temporal i impossibilita el càlcul precís del temps de resolució. Un camp dedicat `resolvedAt` garanteix que la marca temporal correspon exclusivament al moment de tancament definitiu.

### Endpoint d'analítica — `GET /api/analytics/dashboard`

S'ha creat un únic endpoint que retorna totes les dades del dashboard en una sola petició HTTP, minimitzant la latència i simplificant la gestió d'estat al frontend.

**Ruta**: `GET /api/analytics/dashboard?granularity=week&days=90`
**Protecció**: `authenticate` + `authorize('ADMIN')`
**Paràmetres opcionals**:
- `granularity`: `day` | `week` | `month` (per defecte `week`) — controla la truncatura temporal dels gràfics d'àrees i barres
- `days`: nombre de dies enrere a consultar (per defecte `90`)

**Justificació d'un sol endpoint**: En lloc de crear 8 endpoints separats (un per cada visualització), s'ha optat per un endpoint únic que executa totes les queries en paral·lel amb `Promise.all()`. Aquesta decisió es basa en:
1. **Reducció de roundtrips**: Una sola petició HTTP en lloc de 8, eliminant la latència acumulada de múltiples connexions TCP
2. **Consistència temporal**: Totes les dades es consulten al mateix instant, evitant discrepàncies entre gràfics si les dades canvien entre peticions
3. **Simplicitat al frontend**: Un sol `useEffect` i un sol estat (`DashboardData`) en lloc de 8 hooks independents amb 8 estats de càrrega

**Queries executades en paral·lel**:

| Query | Mètode Prisma | Descripció |
|---|---|---|
| `getStateCounts()` | `groupBy(['state'])` | Comptatge per estat |
| `getCriticalHighPercentage()` | `count()` × 2 | Ràtio prioritat alta/crítica |
| `getHistoryByCategory()` | `$queryRawUnsafe` amb `date_trunc` | Sèrie temporal per categoria |
| `getCreatedVsResolved()` | `$queryRawUnsafe` × 2 | Creades vs tancades per setmana |
| `getTechnicianWorkload()` | `groupBy(['assignedToId', 'state'])` | Càrrega per tècnic |
| `getResolutionTimeVsPriority()` | `findMany` amb `resolvedAt` | Dispersió temps vs prioritat |
| `getCategoryDistribution()` | `groupBy(['category'])` | Distribució per categoria |
| `getTopReporters()` | `groupBy(['createdById'])` | Top 10 reporters |

**Nota sobre `$queryRawUnsafe`**: Dues queries utilitzen SQL cru en lloc de l'ORM de Prisma perquè requereixen la funció `date_trunc()` de PostgreSQL per truncar dates a intervals (dia/setmana/mes). Prisma no suporta aquesta funció nativament a la seva API de consultes. Els paràmetres s'injecten de forma segura mitjançant placeholders posicionals (`$1`) per prevenir SQL injection.

### Fitxers creats o modificats

| Fitxer | Acció | Descripció |
|---|---|---|
| `backend/prisma/schema.prisma` | Modificat | Afegit `resolvedAt DateTime?` al model Report |
| `backend/src/services/analytics.ts` | Creat | 8 funcions d'agregació per al dashboard |
| `backend/src/controllers/analytics.ts` | Creat | Controlador amb `Promise.all()` de totes les queries |
| `backend/src/routes/analytics.ts` | Creat | Ruta protegida `GET /api/analytics/dashboard` |
| `backend/src/index.ts` | Modificat | Registrada ruta `/api/analytics` |
| `backend/src/services/report.ts` | Modificat | Marca `resolvedAt` automàticament en transició a CLOSED |
| `frontend/src/api/analytics.ts` | Creat | Client API amb interfície `DashboardData` tipada |
| `frontend/src/pages/DashboardPage.tsx` | Reescrit | 9 visualitzacions Recharts amb controls globals |

### Dependències afegides

**Frontend (`frontend/package.json`)**:

| Paquet | Versió | Funció |
|---|---|---|
| `recharts` | ^2.x | Llibreria de gràfics React basada en D3.js |

### Evolució del dashboard — Gràfic "Incidències per categoria" amb filtre de calendari

El gràfic temporal **"Històric per categoria"** (Stacked Area Chart del Bloc 2) s'ha substituït per un gràfic **"Incidències per categoria"** amb una lògica diferent, més directa per a la consulta operativa:

- **Eixos**: l'eix **X** mostra les categories i l'eix **Y** el nombre d'incidències de cadascuna (una barra per categoria), en lloc de la sèrie temporal apilada.
- **Filtre manual per calendari**: dos selectors de data (`<input type="date">`, "Del … al …") permeten escollir un rang arbitrari. Per consultar **un sol dia** s'estableix la mateixa data a tots dos camps. Per defecte mostra els últims 30 dies fins avui.
- **Independència del filtre global**: a diferència de la resta de gràfics (lligats als controls globals `granularity`/`days`), aquest té el seu propi estat de dates i consulta un **endpoint dedicat**, de manera que pot anar més enllà de la finestra global i amb precisió de dia.

**Justificació del canvi**: l'àrea apilada respon a "com evoluciona cada categoria en el temps", però per a la gestió diària és més útil respondre "quantes incidències de cada tipus hi ha hagut en un període concret". El filtre de calendari dona control total sobre el període auditat (un dia puntual, una setmana, un mes…) sense dependre de granularitats predefinides.

#### Nou endpoint — `GET /api/analytics/category-counts`

**Ruta**: `GET /api/analytics/category-counts?from=YYYY-MM-DD&to=YYYY-MM-DD`
**Protecció**: `authenticate` + `authorize('ADMIN')`
**Paràmetres obligatoris**: `from` i `to` (dates inclusives). El backend interpreta el rang com a dies complets (`from` a les 00:00:00 i `to` a les 23:59:59.999) i retorna `{ category, count }[]` ordenat descendentment.

La funció de servei `getCategoryCountsInRange(from, to)` fa un `groupBy(['category'])` amb el filtre `createdAt: { gte: from, lte: to }`. És un endpoint separat del dashboard perquè el seu cicle de vida (es recarrega en canviar les dates) és independent de la resta de visualitzacions.

#### Colors i format de les barres per categoria

- **Dos blaus alternats**: tant "Incidències per categoria" com "Distribució per categoria" pinten les barres amb dos tons de blau que s'alternen per índex (`barBlues[i % 2]`), en lloc d'un color diferent per categoria. Com que cada barra ja s'identifica pel nom a l'eix X, alternar dos blaus dona un resultat net i coherent amb la marca, i evita una paleta excessivament cridanera. Els tons s'adapten al tema: blaus foscos sobre fons clar, blaus clars en mode fosc.
- **Amplada màxima de columna (`maxBarSize={64}`)**: limita l'amplada de cada barra perquè, quan hi ha poques categories (o només una), les columnes no s'eixamplin desproporcionadament. Així el format es manté constant independentment del nombre de categories del període.

#### Adaptació al mode fosc

Tot el dashboard és sensible al tema (clar/fosc) mitjançant el `ThemeContext` del frontend:
- Els colors d'estat amb blaus marins poc visibles (`ASSIGNED`) es reemplacen per blaus clars en mode fosc.
- Els elements propis de Recharts (eixos, graella, llegenda, tooltips) s'estilitzen via CSS dirigit a les seves classes (`.recharts-text`, `.recharts-cartesian-grid line`, etc.) dins de `.dark`, ja que es dibuixen com a SVG/HTML i no com a utilitats Tailwind.

#### Fitxers afegits o modificats en aquesta evolució

| Fitxer | Acció | Descripció |
|---|---|---|
| `backend/src/services/analytics.ts` | Modificat | Afegida `getCategoryCountsInRange(from, to)` |
| `backend/src/controllers/analytics.ts` | Modificat | Afegit controlador `getCategoryCounts` (valida `from`/`to`) |
| `backend/src/routes/analytics.ts` | Modificat | Afegida ruta `GET /api/analytics/category-counts` |
| `frontend/src/api/analytics.ts` | Modificat | Afegida `getCategoryCounts(from, to)` + tipus `CategoryCount` |
| `frontend/src/pages/DashboardPage.tsx` | Modificat | Nou gràfic per categoria amb calendari, blaus alternats, `maxBarSize` i suport de mode fosc |

---

# Sprint 4: Aplicació Mòbil — Fase 1 (Autenticació i Estructura)

## Resum

Fase inicial de l'app mòbil de CityFix: inicialització del projecte Expo, arquitectura de navegació, sistema d'autenticació amb emmagatzematge segur del JWT, i pantalles de login i registre funcionals contra el backend. Queda pendent el disseny en Figma de les pantalles específiques per rol (Estudiant / Tècnic) i la navegació per pestanyes.

## Tecnologies escollides

| Tecnologia | Per què |
|---|---|
| **React Native + Expo (Managed)** | Reaprofita coneixement de React del frontend web. Compila per Android i iOS amb una sola base de codi. Expo Go permet provar al dispositiu físic via QR sense configurar Android Studio/Xcode. |
| **Expo Router** | File-based routing inspirat en Next.js. Permet separar *Auth Stack* i *App Stack* mitjançant Route Groups (`(auth)` i `(app)`) amb layouts independents. |
| **NativeWind** | Tailwind CSS per a React Native. Manté coherència visual amb el frontend web (mateixes classes). |
| **expo-secure-store** | Emmagatzematge encriptat del JWT via iOS Keychain / Android Keystore. Descartat `AsyncStorage` perquè guarda en text pla. |
| **React Hook Form + Zod** | Formularis performants amb validació declarativa i inferència de tipus automàtica. |
| **Axios** | Mateix patró d'interceptors que el frontend web per injectar el JWT i gestionar 401. |

## Arquitectura del projecte

```
app/
├── app.json, package.json, tailwind.config.js, babel.config.js, metro.config.js, global.css
├── app/                              ← Carpeta màgica d'Expo Router
│   ├── _layout.tsx                   ← AuthProvider + guard de redirecció
│   ├── index.tsx                     ← Redirect inicial a /login
│   ├── (auth)/                       ← Route Group: pantalles públiques
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   └── register.tsx
│   └── (app)/                        ← Route Group: pantalles protegides
│       ├── _layout.tsx
│       └── home.tsx
└── src/
    ├── types/index.ts                ← User, Role, LoginResponse, RegisterPayload
    ├── config/env.ts                 ← Resolució dinàmica d'API_URL segons plataforma
    ├── api/
    │   ├── client.ts                 ← Axios + interceptors JWT + SecureStore
    │   └── auth.ts                   ← login, register, getProfile
    └── context/AuthContext.tsx       ← Estat global + auto-login + login/logout/register
```

**Route Groups `(auth)` i `(app)`**: els parèntesis són una convenció d'Expo Router. Les carpetes agrupen rutes lògicament **sense afectar la URL** (`(auth)/login.tsx` és accessible com a `/login`), i permeten layouts independents per a pantalles públiques vs. autenticades.

## Lògica clau

### Guard de rutes (`app/_layout.tsx`)

El layout root utilitza `useSegments()` per detectar en quin Route Group es troba l'usuari i redirigir amb `router.replace()`:
- Si `user == null` i NO està a `(auth)` → redirigeix a `/login`
- Si `user != null` i ESTÀ a `(auth)` → redirigeix a `/home`

### Auto-login (`AuthContext.tsx`)

En muntar el provider, un `useEffect` llegeix el JWT del SecureStore i fa `GET /users/profile` per validar-lo. Si té èxit, l'usuari queda autenticat sense introduir credencials. Si falla, s'esborra el token.

### Interceptors d'Axios (`api/client.ts`)

- **Request**: injecta `Authorization: Bearer <token>` llegint el JWT del SecureStore abans de cada petició.
- **Response**: si el backend retorna 401, esborra el token del SecureStore automàticament.

### API_URL dinàmica (`config/env.ts`)

Resol la URL del backend segons l'entorn: `10.0.2.2:3000` per Android Emulator, `localhost:3000` per iOS Simulator, i la IP del host des d'`Constants.expoConfig.hostUri` per a dispositiu físic via Expo Go (sense configuració manual).

### Registre amb flux dual (`app/(auth)/register.tsx`)

Formulari amb dues pestanyes: **"Estudiant UAB"** (registre públic, força `role: STUDENT`) i **"Amb codi d'invitació"** (afegeix camp `token` que el backend valida contra la taula `invites`). L'esquema Zod es construeix dinàmicament segons el mode per aplicar validació condicional al camp `token`. La validació del domini UAB (`uab.cat`, `autonoma.cat`) es fa tant al client (UX) com al backend (seguretat).

## Canvis al Backend

- **`backend/src/services/auth.ts`**: afegida validació `isUabEmail()` al `registerUser()`. Només s'accepten correus `@uab.cat` i `@autonoma.cat`. La validació és server-side obligatòria (el frontend només l'usa per UX).

## Fitxers creats o modificats

| Fitxer | Acció | Descripció |
|---|---|---|
| `app/` | Creat | Projecte Expo amb TypeScript |
| `app/app.json` | Creat | Nom "CityFix", slug "cityfix-mobile", scheme "cityfix" per deep linking |
| `app/tailwind.config.js`, `babel.config.js`, `metro.config.js`, `global.css`, `nativewind-env.d.ts` | Creat | Configuració de NativeWind |
| `app/app/_layout.tsx` | Creat | RootLayout amb AuthProvider + guard de redirecció |
| `app/app/index.tsx` | Creat | Redirect inicial a `/login` |
| `app/app/(auth)/_layout.tsx`, `(app)/_layout.tsx` | Creat | Stacks per grups de rutes |
| `app/app/(auth)/login.tsx` | Creat | Formulari de login amb Zod |
| `app/app/(auth)/register.tsx` | Creat | Formulari dual (estudiant/invitació) amb validació condicional |
| `app/app/(app)/home.tsx` | Creat | Placeholder amb perfil i logout |
| `app/src/types/index.ts` | Creat | Tipus compartits mirall del backend |
| `app/src/config/env.ts` | Creat | Resolució dinàmica d'API_URL |
| `app/src/api/client.ts` | Creat | Instància Axios + interceptors |
| `app/src/api/auth.ts` | Creat | Wrappers tipats dels endpoints d'auth |
| `app/src/context/AuthContext.tsx` | Creat | Estat global + auto-login |
| `backend/src/services/auth.ts` | Modificat | Validació de domini UAB al registre |

## Dependències afegides

**Mòbil (`app/package.json`)**:

| Paquet | Funció |
|---|---|
| `expo`, `expo-router`, `expo-constants`, `expo-linking`, `expo-status-bar` | Framework + routing |
| `expo-secure-store` | Emmagatzematge encriptat del JWT |
| `react-native-safe-area-context`, `react-native-screens`, `react-native-gesture-handler`, `react-native-reanimated` | Requisits natius d'Expo Router |
| `axios` | Client HTTP |
| `react-hook-form`, `zod`, `@hookform/resolvers` | Formularis + validació |
| `nativewind`, `tailwindcss` | Estilització |

## Pendents per a la Fase 2

Disseny Figma de les pantalles per rol, navegació per pestanyes (`<Tabs>`) al grup `(app)` condicionada per `user.role`, integració de `expo-camera`, `expo-location` i `react-native-maps`, i pantalla de gamificació amb rànquing de punts.

---

# Sprint 4 — Fase 2: Pantallas, mapa real y sincronización con el backend

## Resumen

Segunda fase del cliente móvil de CityFix. Se ha completado el diseño y la implementación de todas las pantallas de la aplicación (home, mapa, listado, creación, perfil y detalle de incidencia), se ha sustituido el sistema de mocks por consultas reales al backend (`/api/reports`), se ha integrado un mapa OpenStreetMap real con marcadores y mapa de calor — siguiendo la misma estética que el panel de administración web — y se ha sustituido toda la iconografía basada en emojis por iconos vectoriales `Ionicons` para reforzar la identidad seria y profesional de la aplicación.

## Tecnologías añadidas

| Tecnología | Por qué |
|---|---|
| **`@expo/vector-icons` (Ionicons)** | Iconos vectoriales nativos incluidos con Expo. Sustituye los emojis del prototipo inicial por símbolos coherentes con la estética de aplicaciones modernas (variantes `outline` por defecto y `filled` en estado activo). |
| **`react-native-webview`** | WebView nativo. Se usa como contenedor del mapa Leaflet (mismo *stack* que el dashboard web), evitando depender de `react-native-maps` que en SDK 54 + new architecture mostraba el mapa en blanco sobre Apple Maps. |
| **Leaflet + `leaflet.markercluster` + `leaflet.heat`** *(vía CDN dentro del WebView)* | Misma librería que la web admin. Permite *clustering* de marcadores y mapa de calor con un único peso por punto. Cargado desde `cdn.jsdelivr.net` para que iOS WKWebView (con `baseUrl` definido) permita los `<script>` externos. |

## Arquitectura del proyecto

Estructura final del directorio `app/` tras la Fase 2:

```
app/
├── app/                                  ← Carpeta de Expo Router
│   ├── _layout.tsx                       ← AuthProvider + guard de rutas
│   ├── index.tsx
│   ├── (auth)/                           ← Pantallas públicas (login, register)
│   └── (app)/                            ← Pantallas autenticadas
│       ├── _layout.tsx                   ← Stack que envuelve (tabs) + incident/[id]
│       ├── (tabs)/
│       │   ├── _layout.tsx               ← Tab bar flotante estilo iOS + Ionicons
│       │   ├── home.tsx                  ← Inicio (variantes Estudiante / Técnico / Admin)
│       │   ├── map.tsx                   ← Mapa Leaflet (markers + heatmap)
│       │   ├── reports.tsx               ← Listado filtrable por estado
│       │   ├── create.tsx                ← Formulario de nueva incidencia
│       │   └── profile.tsx               ← Perfil del usuario
│       └── incident/
│           └── [id].tsx                  ← Detalle de incidencia + transiciones
└── src/
    ├── types/index.ts                    ← Report alineado con el backend (createdBy/assignedTo anidados)
    ├── api/
    │   ├── client.ts                     ← Axios + JWT desde SecureStore
    │   ├── auth.ts
    │   └── reports.ts                    ← getAllReports / getReportById / createReport / transitionReport
    ├── hooks/
    │   └── useReports.ts                 ← useReports() y useReport(id) con loading/error/refresh
    ├── components/ReportCard.tsx
    ├── mocks/reports.ts                  ← Constantes y helpers (sin datos mock)
    └── context/AuthContext.tsx
```

**Patrón Stack-sobre-Tabs**: el grupo `(app)` se compone de un `<Stack>` raíz que contiene a su vez el grupo `(tabs)` y la pantalla `incident/[id].tsx`. Esto permite que el detalle de una incidencia se presente como una nueva pantalla por encima de la barra de pestañas (con su propio botón de retroceso) sin perder el estado de las tabs.

## Pantallas implementadas

| Pantalla | Variantes por rol | Funcionalidades clave |
|---|---|---|
| **Home (`home.tsx`)** | Estudiante / Técnico / Admin | Estudiante ve sus puntos, accesos rápidos a "Reportar" y "Mapa", y sus últimas incidencias. Técnico ve resumen de carga (pendientes / en curso / resueltas) y la lista ordenada por prioridad. Admin ve estadísticas globales. Pull-to-refresh. |
| **Mapa (`map.tsx`)** | Común | Mapa OSM real, alternancia *Markers ↔ Mapa de calor*, filtros por estado, marcadores agrupados con `markercluster`, leyenda de estados, botón de recentrado, hoja inferior con preview de la incidencia seleccionada. |
| **Listado (`reports.tsx`)** | Común | Filtros por estado (Todas / Abiertas / Asignadas / En curso / Validadas / Cerradas) en chips horizontales. Pull-to-refresh. Adapta el título según rol ("Mis incidencias" / "Asignadas" / "Todas"). |
| **Crear (`create.tsx`)** | Estudiante (solo) | Formulario con foto (placeholder), título, descripción, categoría (chips con `Ionicons`) y ubicación. POST a `/api/reports`. Botón de enviar deshabilitado mientras se valida o se envía. |
| **Perfil (`profile.tsx`)** | Común | Avatar con iniciales, badge de rol con icono, estadísticas según rol (puntos / incidencias / resueltas), datos de cuenta, ajustes y logout con confirmación. |
| **Detalle (`incident/[id].tsx`)** | Común con acciones para Técnico | Carga la incidencia desde `GET /api/reports/:id`. Muestra galería, badges (categoría, prioridad, estado), descripción, ubicación, metadatos y comentarios. Si el usuario es **Técnico** y está asignado a la incidencia, ofrece botones de transición (`START`, `RESOLVE`, `CLOSE`) que llaman a `PATCH /api/reports/:id/transition` con actualización optimista. |

## Tab bar flotante estilo iOS

El layout `(tabs)/_layout.tsx` configura una barra de pestañas con apariencia de píldora flotante:

- `position: absolute` con `bottom: 28` (iOS) / `18` (Android), márgenes laterales generosos (`left: 32, right: 32`) y `borderRadius: 32`.
- Fondo translúcido blanco (`rgba(255,255,255,0.96)`), borde sutil y sombra elevada.
- Iconos `Ionicons` con variante `outline` en estado inactivo y `filled` cuando la pestaña está activa, todo coloreado con `tabBarActiveTintColor` / `tabBarInactiveTintColor`.
- La pestaña **"Reportar"** se oculta para los roles `TECHNICAL` y `ADMIN` mediante `href: isStudent ? '/create' : null`.

## Mapa OpenStreetMap dentro de un WebView

### Por qué WebView en lugar de `react-native-maps`

Durante la implementación se intentó primero usar `react-native-maps` con `UrlTile` apuntando a OpenStreetMap. En iOS Expo Go (SDK 54, new architecture) el mapa se mostraba completamente gris sin renderizar tiles ni el mapa base de Apple Maps, sin emitir errores. La solución definitiva fue replicar exactamente el *stack* del dashboard web (Leaflet + OSM) dentro de un `WebView` con HTML inline. Ventajas:

- Funciona idénticamente en iOS y Android sin claves de Google Maps.
- Permite reutilizar `leaflet.markercluster` y `leaflet.heat` del frontend admin.
- Independiente del SDK de mapas nativo: actualizar la librería no requiere recompilar.

### Detalles técnicos no obvios

Tres ajustes resultaron críticos para que el mapa se renderice correctamente:

1. **`baseUrl: 'https://cdn.jsdelivr.net/'`** en `source={{ html, baseUrl }}`. Sin un `baseUrl` real, WKWebView de iOS sirve el HTML desde el origen `about:blank`, lo que bloquea silenciosamente los `<script>` externos. Con un `baseUrl` HTTPS, Leaflet y los plugins se cargan correctamente desde el CDN.
2. **`map.invalidateSize()` con varios `setTimeout`** después de inicializar el mapa. Leaflet mide el contenedor al arrancar; en un WebView ese contenedor todavía no tiene su tamaño definitivo, por lo que sin estos `invalidateSize` los tiles se renderizan en un canvas de 0×0 aunque el resto funcione.
3. **WebView con `position: absolute, top:0, left:0, right:0, bottom:0`** dentro de un contenedor `<View style={{ flex: 1 }}>`. El `flex: 1` puro sobre el WebView en algunas combinaciones colapsaba a altura 0 — el posicionamiento absoluto explícito fuerza al WebView a ocupar el contenedor padre.

### Comunicación nativo ↔ WebView

- **Nativo → WebView**: cuando cambian los reports visibles o el modo de vista, se llama `webviewRef.current.injectJavaScript('window.__renderMarkers(...)')` (o `__renderHeatmap`) con el payload serializado. La capa Leaflet borra los marcadores anteriores y dibuja los nuevos.
- **WebView → Nativo**: `window.ReactNativeWebView.postMessage(JSON.stringify({...}))` envía un evento `ready` al inicializar, y un `select` con el `id` de la incidencia cuando se hace clic en un marcador. El handler `onMessage` del componente actualiza el estado de React Native.

### Markers vs. Heatmap

| Modo | Estilo |
|---|---|
| **Markers** | Punto de 14 px coloreado según el **estado** de la incidencia (mismo mapeo que el panel admin: azul=Abierta, amarillo=Asignada, naranja=En curso, verde=Validada, gris=Cerrada). Se agrupan automáticamente con `markercluster`. Sin emojis, en línea con el rediseño solicitado. |
| **Mapa de calor** | `leaflet.heat` con peso por incidencia derivado de la prioridad (`PRIORITY_WEIGHTS`: LOW=0.25, MEDIUM=0.5, HIGH=0.75, CRITICAL=1.0). Gradiente azul → amarillo → rojo. |

El mapa móvil reutiliza el endpoint común `/api/reports` (accesible para todos los roles autenticados) en lugar de `/api/geo/geojson` y `/api/geo/heatmap` (que el backend restringe a `ADMIN`). Los marcadores y el heatmap se calculan en cliente sobre el mismo conjunto de datos, lo que evita tener que abrir esos endpoints geo a estudiantes y técnicos.

## Sincronización con el backend

### Cliente API (`src/api/reports.ts`)

Wrappers tipados sobre el cliente Axios, todos con JWT inyectado automáticamente por el interceptor:

| Función | Endpoint | Uso |
|---|---|---|
| `getAllReports({ state? })` | `GET /api/reports` | Lista de incidencias visibles para el usuario autenticado. |
| `getReportById(id)` | `GET /api/reports/:id` | Detalle con `images` y `comments` incluidos. |
| `createReport({ title, description, latitude, longitude, category })` | `POST /api/reports` | Crear nueva incidencia (estudiantes). |
| `transitionReport(id, event, assignedToId?)` | `PATCH /api/reports/:id/transition` | Disparar transición de XState. Eventos: `ASSIGN`, `START`, `REASSIGN`, `RESOLVE`, `CLOSE`, `REJECT`. |

### Hooks (`src/hooks/useReports.ts`)

Dos hooks que abstraen la carga de datos:

- **`useReports()`** — devuelve `{ reports, loading, error, refresh }`. Usado por home, listado, mapa y perfil. Compatible con `RefreshControl` para pull-to-refresh.
- **`useReport(id)`** — devuelve `{ report, loading, error, refresh, setReport }`. Usado por la pantalla de detalle. `setReport` permite actualización optimista cuando se ejecuta una transición.

### Alineación de tipos con el backend

El tipo `Report` se ha rediseñado para reflejar exactamente la forma que devuelve Prisma desde `services/report.ts`:

```ts
export interface Report {
  report_id: string;
  title: string;
  description: string;
  state: ReportState;
  priority: ReportPriority;
  category: ReportCategory | null;     // El backend permite null
  latitude: number;
  longitude: number;
  createdBy: ReportAuthor;             // Antes: createdByName/createdByNickname planos
  assignedTo: ReportAuthor | null;     // Antes: assignedToName/assignedToNickname opcionales
  images?: ReportImage[];              // Solo presentes en GET /:id
  comments?: ReportComment[];          // Solo presentes en GET /:id
  createdAt: string;
  resolvedAt?: string;
}
```

El helper `getReportsByRole(reports, role, nickname)` se ha actualizado para leer `r.createdBy?.nickname` y `r.assignedTo?.nickname` en lugar de los campos planos del prototipo.

### Modelo de asignación (decisión)

Se ha optado por el modelo simple: **solo los administradores pueden asignar incidencias a técnicos** (vía dashboard web con el evento `ASSIGN`). Los técnicos solo pueden ejecutar transiciones sobre incidencias ya asignadas a ellos: `START` (iniciar trabajo), `RESOLVE` (marcar como validada) y `CLOSE` (cerrar definitivamente). Esta restricción es server-side: la máquina de estados XState del backend valida tanto la transición como el rol del usuario, por lo que la UI móvil simplemente expone los botones permitidos según el estado actual.

## Migración emoji → Ionicons

Toda la iconografía emoji se ha reemplazado por iconos vectoriales `Ionicons` (variante `outline` por defecto, `filled` en estados activos). Se ha creado un mapa explícito de categorías:

```ts
export const CATEGORY_IONICONS: Record<ReportCategory, IoniconName> = {
  LIGHTING: 'bulb-outline',
  URBAN_FURNITURE: 'cube-outline',
  PAVEMENT: 'construct-outline',
  CLEANING: 'sparkles-outline',
  GREEN_AREAS: 'leaf-outline',
  SIGNAGE: 'flag-outline',
  ACCESSIBILITY: 'accessibility-outline',
  TECHNOLOGY: 'desktop-outline',
  OTHER: 'pricetag-outline',
};
```

Otros reemplazos relevantes: trofeo de puntos (`trophy-outline`), rol estudiante (`school-outline`), rol técnico (`construct-outline`), rol admin (`shield-checkmark-outline`), botones de cámara/galería (`camera-outline`/`image-outline`), botón de recentrado del mapa (`locate-outline`), botones de transición (`play-outline`, `checkmark-done-outline`, `lock-closed-outline`), errores (`alert-circle-outline`), ajustes (`notifications-outline`, `language-outline`, `information-circle-outline`), logout (`log-out-outline`).

## Lecciones aprendidas (para el TFG)

- **NativeWind y SafeAreaView**: en algunas combinaciones de pantalla con WebView dentro, `className="flex-1"` sobre `SafeAreaView` (el deprecado, importado desde `react-native`) no propaga el `flex` a los hijos. La solución es usar `style={{ flex: 1 }}` inline sobre el `SafeAreaView` y sobre el contenedor del WebView; mantener `className` solo para color de fondo.
- **NativeWind y `printUpgradeWarning`**: cambiar dinámicamente clases con sombras o pseudo-clases (`active:bg-...`, `shadow-sm`) entre renders dispara un *upgrade warning* del runtime de `react-native-css-interop` que en algunos casos rompe la navegación. La regla práctica adoptada: para estados (selected/active), usar `style={{ ... }}` inline en lugar de cambios de `className`.
- **Expo Go vs. Metro tras instalar un módulo nativo**: tras añadir `react-native-webview` o `@expo/vector-icons`, no basta con un *fast refresh*: hay que parar Metro, reiniciar con `npx expo start --clear` y matar Expo Go por completo en el dispositivo (no recargar). De lo contrario, el bundle JavaScript anterior sigue activo y el módulo nativo no está enlazado.

## Ficheros creados o modificados

| Fichero | Acción | Descripción |
|---|---|---|
| `app/app/(app)/_layout.tsx` | Modificado | `Stack` que envuelve `(tabs)` + `incident/[id]`. |
| `app/app/(app)/(tabs)/_layout.tsx` | Creado | Tab bar flotante estilo iOS con Ionicons; tab "Reportar" oculta para no-estudiantes. |
| `app/app/(app)/(tabs)/home.tsx` | Creado | Inicio con tres variantes según rol; usa `useReports` y `RefreshControl`. |
| `app/app/(app)/(tabs)/map.tsx` | Creado | Mapa Leaflet en WebView con markers + heatmap basado en datos reales. |
| `app/app/(app)/(tabs)/reports.tsx` | Creado | Listado filtrable por estado (chips). Pull-to-refresh. |
| `app/app/(app)/(tabs)/create.tsx` | Creado | Formulario que envía `POST /api/reports`. |
| `app/app/(app)/(tabs)/profile.tsx` | Creado | Perfil con stats por rol y logout. |
| `app/app/(app)/incident/[id].tsx` | Creado | Detalle con `useReport(id)` y botones de transición XState para técnicos. |
| `app/src/api/reports.ts` | Creado | Wrappers tipados sobre `/api/reports`. |
| `app/src/hooks/useReports.ts` | Creado | Hooks `useReports` y `useReport`. |
| `app/src/components/ReportCard.tsx` | Modificado | Se adapta al nuevo tipo `Report` con `createdBy` anidado y usa `Ionicons` para la categoría. |
| `app/src/types/index.ts` | Modificado | `Report` reescrito con `createdBy`/`assignedTo` anidados, `category` nullable, `images`/`comments` opcionales. |
| `app/src/mocks/reports.ts` | Modificado | Eliminado `MOCK_REPORTS`. Sustituido `CATEGORY_ICONS` (emojis) por `CATEGORY_IONICONS`. Añadido `STATE_COLORS.dot` y `PRIORITY_WEIGHTS`. `getReportsByRole` ahora lee la forma anidada. |

## Dependencias añadidas

| Paquete | Función |
|---|---|
| `@expo/vector-icons` | Iconos `Ionicons` para tab bar, botones, badges y categorías. |
| `react-native-webview` | Contenedor del mapa Leaflet/OSM. |
| `react-native-worklets` | Dependencia introducida con Reanimated v4 (separó el plugin de worklets). |

## Estado al final del Sprint 4

La aplicación móvil ya consume datos reales del backend para los roles **STUDENT** y **TECHNICAL**: ambos pueden iniciar sesión, ver el mapa y el listado de incidencias, y los técnicos pueden cambiar el estado de sus incidencias asignadas. La interfaz mantiene la misma estética que el panel web pero adaptada a patrones móviles (tab bar flotante, pull-to-refresh, hoja inferior).

---

## Integració hardware: ubicació, càmera i pujada d'imatges (Fase 3)

Tercera fase de l'app mòbil i ampliació del backend. Ara els estudiants poden capturar la **ubicació real del dispositiu** i adjuntar **fotos amb la càmera o la galeria** a les seves incidències, i els tècnics poden tancar el cicle de resolució amb una **foto del resultat** i un **comentari justificatiu** que queda lligat de manera explícita a la transició `RESOLVE`. Les imatges es guarden a **Supabase Storage** (no al sistema de fitxers del backend), de manera que el client només rep una URL pública per renderitzar-les.

### Per què aquestes decisions

| Decisió | Alternativa descartada | Per què |
|---|---|---|
| **Pujades sempre a través del backend** | Pujada directa des del mòbil amb la `anon` key de Supabase | El backend és l'únic punt on s'apliquen les regles de negoci (qui pot pujar quin tipus d'imatge a quina incidència). Així evitem haver de replicar aquesta lògica amb policies RLS al bucket. |
| **Bucket públic + URL pública** | Bucket privat + signed URLs | Les fotos d'incidències al campus no són sensibles. Les signed URLs caduquen i requereixen renovació al client; per a un TFG no aporten valor i sí complexitat. |
| **`Comment.transitionEvent` opcional** | Crear un model `TransitionLog` separat | Una sola taula serveix per a comentaris de discussió i comentaris de transició. La UI els separa amb un `filter()` (mateix patró que els *event comments* de GitHub). |
| **`Image.uploadedById` opcional** | Inferir-ho a partir del `type` (INITIAL → createdBy, RESOLUTION → assignedTo) | Fàcil d'afegir ara, impossible de recuperar després si demà cal auditar exactament qui va pujar una foto excepcional. Cost real: una columna nul·lable. |
| **`prisma db push` enlloc de `migrate dev`** | `prisma migrate dev --name X` | El camp `Report.location: geography(Point, 4326)` necessita PostGIS; el *shadow database* que crea Prisma per validar migracions no té PostGIS instal·lat i la migració inicial falla. `db push` sincronitza directament contra el DB real saltant-se el shadow DB. La contrapartida: no queda registre del canvi a `prisma/migrations/`, però per a un TFG és acceptable. |

### Canvis al schema Prisma

Tres modificacions al fitxer `backend/prisma/schema.prisma`:

```prisma
// 1. Nou enum unificat (abans existia només com a tipus TypeScript)
enum IncidentEvent {
  ASSIGN
  START
  REASSIGN
  RESOLVE
  CLOSE
  REJECT
}

// 2. Comment guanya un camp opcional per lligar-se a una transició
model Comment {
  // ...
  transitionEvent IncidentEvent?
}

// 3. Image guanya l'autor de la pujada (FK opcional a User)
model Image {
  // ...
  uploadedById String?
  uploadedBy   User?   @relation("UploadedImages", fields: [uploadedById], references: [user_id])
}

model User {
  // ...
  imagesUploaded Image[] @relation("UploadedImages")
}
```

Aplicació del canvi:

```bash
cd backend
npx prisma db push   # sincronitza contra Supabase Postgres
npx prisma generate  # regenera el client TypeScript
```

### Configuració de Supabase Storage

Es crea un bucket **`report-images`** marcat com a **Public** (les fotos són accessibles sense autenticació via URL pública). Les pujades sempre es fan des del backend amb el `service_role key`, que té permís total i salta les *Row Level Security policies*; per tant no cal definir cap policy al bucket.

Al fitxer `backend/.env` cal afegir:

```
SUPABASE_URL=https://<projecte>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role secret>
SUPABASE_STORAGE_BUCKET=report-images
```

> ⚠️ **Important**: el `service_role key` permet bypass total del RLS. No s'ha de filtrar mai (no committejar el `.env`, no enviar-lo al client). El backend l'usa exclusivament des del servei `services/storage.ts`.

### Backend: nou endpoint i ampliació de l'existent

#### `POST /api/reports/:id/images` — pujar imatge

Endpoint nou per adjuntar imatges a una incidència. Body **multipart/form-data** amb:
- `image` (camp file) → la imatge a pujar.
- `type` (camp text) → `INITIAL` | `RESOLUTION` | `PROGRESS`.

**Pipeline d'execució:**

```
[Mòbil]                     [Backend]                              [Supabase]
   │                           │                                       │
   ├── multipart upload ──────>│                                       │
   │   (image + type)          │                                       │
   │                           ├── multer (memoryStorage, max 8 MB)    │
   │                           │                                       │
   │                           ├── controller validates:               │
   │                           │   - file present                      │
   │                           │   - mimetype in whitelist             │
   │                           │   - type valid                        │
   │                           │                                       │
   │                           ├── service.addReportImage:             │
   │                           │   - report exists?                    │
   │                           │   - role check segons type:           │
   │                           │     · INITIAL → només createdBy       │
   │                           │     · RESOLUTION/PROGRESS → assignedTo│
   │                           │     · ADMIN sempre permès             │
   │                           │                                       │
   │                           ├── storage.uploadReportImage ─────────>├─ bucket: report-images
   │                           │                                       │  path: <reportId>/<uuid>.<ext>
   │                           │                                       │
   │                           │<──────────── publicUrl ───────────────┤
   │                           │                                       │
   │                           ├── prisma.image.create                 │
   │                           │   { url, type, reportId, uploadedById }│
   │                           │                                       │
   │<───── 201 Created ────────┤                                       │
   │     { image: {...} }      │                                       │
```

**Validacions de tipus i mida**:
- Mimetypes acceptats: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`.
- Mida màxima: 8 MB (configurat al `multer({ limits: { fileSize: 8 * 1024 * 1024 } })`).
- **Defensa en profunditat**: el bucket de Supabase pot opcionalment activar els toggles "Restrict file size" i "Restrict MIME types" amb els mateixos valors. No són necessaris (el backend ja les aplica) però protegeixen davant de descuits futurs.

**Codis d'error**:
| HTTP | Quan |
|---|---|
| 400 | Falta `image` o `type` invàlid |
| 403 | L'usuari autenticat no té permís per pujar aquell `type` a aquesta incidència |
| 404 | La incidència no existeix |
| 415 | Mimetype no suportat |
| 500 | Error pujant a Supabase Storage o creant la fila Image |

#### `PATCH /api/reports/:id/transition` — accepta `comment` opcional

S'amplia l'endpoint existent. La signatura del body passa de `{ event, assignedToId? }` a `{ event, assignedToId?, comment? }`. Si arriba `comment`, el servei `transitionReport()` el crea com a fila `Comment` **dins la mateixa transacció Prisma** que actualitza l'estat de la incidència, amb el camp `transitionEvent` igual a l'`event` disparat:

```ts
// services/report.ts, dins transitionReport()
if (trimmedComment) {
  const [, , updated] = await prisma.$transaction([
    prisma.comment.create({
      data: {
        content: trimmedComment,
        transitionEvent: event,    // ← marca el comentari com a esdeveniment
        reportId,
        authorId: userId,
      },
    }),
    prisma.report.update({ where: { report_id: reportId }, data: {} }), // touch
    updateReport,
  ]);
  return updated;
}
```

L'**atomicitat** és crítica: o es transiciona i es crea el comentari, o no es fa cap de les dues coses. Així evitem situacions inconsistents on l'estat canvia però el comentari justificatiu es perd per un error.

### Backend: nous fitxers i serveis

| Fitxer | Acció | Funció |
|---|---|---|
| `backend/src/services/storage.ts` | Creat | Wraps `@supabase/supabase-js`. Inicialització *lazy* del client (només es crea quan es fa la primera pujada, així el backend arrenca encara que les vars de Supabase no estiguin definides). Funció `uploadReportImage(reportId, buffer, mimetype)` que puja al bucket i retorna la URL pública. Path generat: `<reportId>/<uuid>.<ext>` per evitar col·lisions de noms. |
| `backend/src/services/report.ts` | Modificat | `transitionReport()` accepta `options: { assignedToId?, comment? }` (canvi de signatura). Nou `addReportImage()` amb les autoritzacions per `type` descrites més amunt. |
| `backend/src/controllers/report.ts` | Modificat | Nou controlador `uploadImage` amb validació de mimetype + tipus i mapatge d'errors a 403/404/415. `transition` ara llegeix també `comment` del body. |
| `backend/src/routes/reports.ts` | Modificat | Afegit `multer` amb `memoryStorage` (sense fitxers temporals al disc) i nova ruta `POST /:id/images`. |
| `backend/src/config/env.ts` | Modificat | Lectura de `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` (amb default `report-images`). Avís per `console.warn` si no estan definides, però no atura el procés. |
| `backend/src/types/index.ts` | Modificat | Re-exportació de `IncidentEvent` directament des de l'enum de Prisma per tenir una sola font de veritat. |

**Dependències backend afegides:**
- `@supabase/supabase-js` — client oficial; només s'usa la part de Storage.
- `multer` + `@types/multer` — parsing de bodies multipart al middleware Express.

### Mòbil: integració amb el hardware

#### Permisos i plugins (`app.json`)

S'afegeixen els plugins d'Expo amb missatges de permís en català (es mostren a l'usuari quan es demana l'accés per primera vegada):

```json
"plugins": [
  ["expo-location", {
    "locationAlwaysAndWhenInUsePermission": "CityFix necessita la teva ubicació..."
  }],
  ["expo-image-picker", {
    "photosPermission": "CityFix necessita accés a la galeria...",
    "cameraPermission": "CityFix necessita la càmera..."
  }]
]
```

A més, claus `infoPlist` per iOS (`NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`) i permissions `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA`, `READ_MEDIA_IMAGES` per Android. Sense aquestes entrades l'app peta a iOS i obre un diàleg buit a Android.

#### Captura de la ubicació al crear una incidència

A `app/(app)/(tabs)/create.tsx`, en muntar la pantalla:

1. `Location.requestForegroundPermissionsAsync()` → demana permís d'ubicació *while-in-use*. Si l'usuari el denega, la pantalla mostra clarament "Sense permís de ubicació" i utilitzarà el centre del campus com a *fallback* (no bloqueja la creació).
2. `Location.getCurrentPositionAsync({ accuracy: Balanced })` → obté la posició una sola vegada (no escolta canvis). `Balanced` és un compromís entre precisió i bateria adequat per a aquest cas d'ús (no necessitem 1 m de precisió).
3. Es mostra l'estat real al panel d'ubicació: `loading` (spinner), `granted` (lat/lng amb 5 decimals), `denied` (avís + fallback).

Quan l'usuari prem "Enviar incidència":
1. `createReport({ ..., latitude, longitude })` — primer es crea la incidència sense imatge.
2. Si hi ha foto seleccionada, es fa `uploadReportImage(report.report_id, photoUri, 'INITIAL')`. Aquesta segona crida és independent: si falla, l'usuari rep un missatge clar però **la incidència ja està creada** (no es pot reintentar tota l'operació, només la pujada de la foto).

Aquesta separació en dos passos és deliberada: simplifica el contracte de l'API (`POST /reports` no necessita ser multipart) i fa que la creació sigui resilient — perdre la foto és recuperable, perdre el report és frustrant.

#### Captura de fotos amb cámera o galeria

`expo-image-picker` exposa dues API simètriques:
- `launchCameraAsync({ quality: 0.7 })` — obre la càmera. Demana automàticament `requestCameraPermissionsAsync()` si no s'ha demanat abans.
- `launchImageLibraryAsync({ quality: 0.7 })` — obre el selector de la galeria amb `requestMediaLibraryPermissionsAsync()`.

`quality: 0.7` redueix la mida del fitxer (l'aplicació dels propis dispositius sol generar JPEG ~0.92, i passar a 0.7 redueix la mida a un 30-50% sense pèrdua visual). Així pugem menys MB al bucket i la pujada és més ràpida en xarxes mòbils.

L'usuari pot eliminar la foto seleccionada (botó `×` al damunt del *preview*) abans d'enviar.

#### Pujada multipart des de React Native

A `app/src/api/reports.ts`, la funció `uploadReportImage()` construeix un `FormData` amb la convenció especial de RN per a fitxers locals:

```ts
form.append('image', {
  uri: imageUri,        // file:///... que torna ImagePicker
  name: filename,
  type: mimetype,
} as any);
form.append('type', type);
```

I la crida Axios necessita dues opcions especials per evitar que el client serialitzi el `FormData` com a JSON:

```ts
client.post(url, form, {
  headers: { 'Content-Type': 'multipart/form-data' },
  transformRequest: (d) => d,    // ← deixa passar el FormData tal qual
  timeout: 30000,                // pujades poden ser lentes en 4G
});
```

Sense `transformRequest: (d) => d`, Axios crida `JSON.stringify(form)` i el backend rep un body buit; aquest és un *gotcha* clàssic de RN+Axios.

#### Flux de resolució del tècnic

A `app/(app)/incident/[id].tsx`, quan un tècnic té una incidència en `IN_PROGRESS` assignada a ell:

1. El botó **"Marcar resolta"** ja no dispara directament la transició: ara obre un **modal** (`<Modal animationType="slide">` que llisca des de baix, estil iOS).
2. El modal **exigeix una foto** de resolució (botó *Confirmar* deshabilitat fins que s'adjunti). Permet **comentari opcional** explicant com s'ha resolt.
3. En confirmar, l'app fa **dues crides en sèrie**:
   - `uploadReportImage(reportId, uri, 'RESOLUTION')` — la incidència encara està en `IN_PROGRESS`, així que l'usuari encara figura com a `assignedTo` i el backend l'autoritza per pujar `RESOLUTION`.
   - `transitionReport(reportId, { event: 'RESOLVE', comment })` — aquí XState canvia l'estat a `VALIDATED` i, dins la mateixa transacció, crea el `Comment` lligat a la transició.

L'ordre importa: si fes la transició primer, l'usuari deixaria de ser `assignedTo` (el RESOLVE no canvia l'assignat però el VALIDATED ja és estat final per al tècnic) i en alguns escenaris futurs (canvi de regla de negoci) el segon pas podria fallar.

#### Timeline d'activitat al detall de la incidència

Al detall, els comentaris ara es separen en dues seccions:

- **Activitat** — comentaris amb `transitionEvent != null`. Es renderitzen com a *timeline entries* amb una icona i color que reflecteix l'esdeveniment (verd `checkmark-done` per `RESOLVE`, blau `play` per `START`, groc `person-add` per `ASSIGN`, etc.). Inclouen *@autor* i temps relatiu.
- **Comentaris** — comentaris amb `transitionEvent = null`. Estètica neutra com fins ara.

Aquesta separació és purament client-side: el detall de la incidència fa una sola consulta `GET /api/reports/:id` (amb `include: { comments: true }`) i el client agrupa amb un `filter()`.

#### Etiqueta de tipus a la galeria de fotos

Cada imatge mostra un *badge* a la part superior dreta amb el seu `type` (`INICIAL`, `RESOLUCIÓ` o `PROGRÉS`), de manera que l'usuari pot distingir d'un cop d'ull si està veient la foto del problema o la del resultat.

### Mòbil: nous fitxers i modificats

| Fitxer | Acció | Descripció |
|---|---|---|
| `app/app.json` | Modificat | Plugins `expo-location` i `expo-image-picker`, claus `infoPlist` iOS, `permissions` Android. |
| `app/src/api/reports.ts` | Modificat | `transitionReport(id, { event, assignedToId?, comment? })` (canvi de signatura). Nou `uploadReportImage(reportId, uri, type)` amb la configuració multipart correcta per RN. |
| `app/src/types/index.ts` | Modificat | `IncidentEvent`, `ReportComment.transitionEvent`, `ReportImage.uploadedById`. |
| `app/app/(app)/(tabs)/create.tsx` | Modificat | Captura GPS amb `expo-location`, càmera i galeria amb `expo-image-picker`, *preview* eliminable, pujada `INITIAL` després de crear el report. |
| `app/app/(app)/incident/[id].tsx` | Modificat | Modal de resolució que exigeix foto + permet comentari, ordre upload→transition, *timeline* d'activitat amb icones per esdeveniment, *badge* de tipus a cada imatge. |
| `.gitignore` | Modificat | Patró `.env` (sense barra inicial) per ignorar fitxers `.env` a qualsevol nivell, no només a l'arrel. Es desfà el *tracking* de `backend/.env`. |

**Dependències mòbils afegides:**
- `expo-location` — accés al GPS amb gestió integrada de permisos.
- `expo-image-picker` — accés a càmera i galeria amb gestió integrada de permisos.

### Ajust del check de domini institucional al registre

Durant la preparació del *test plan* (crear un compte de tècnic per provar el flux complet) ens adonem que el check de domini UAB del registre no encaixa amb el cas d'ús real dels tècnics. El servei `registerUser` aplicava `isUabEmail()` **a tots els registres**, però:

- Els **TECHNICAL** són sovint **contractistes externs** (Eulen, Ferrovial, jardineria, electricistes…) sense correu `@uab.cat`. Forçar-los a tenir un correu institucional bloqueja el cas d'ús real.
- El que aporta confiança al rol TECHNICAL **no és el domini, sinó la invitació mateixa**: un admin l'ha hagut d'emetre explícitament des de `POST /api/invites` i la persona ha de coincidir amb l'email de la invitació pendent.

Decisió: la regla del domini UAB s'aplica només quan és l'única defensa disponible.

| Cas | Domini UAB obligatori? | Per què |
|---|---|---|
| Registre públic (rol forçat a `STUDENT`) | **Sí** | No hi ha invitació; sense aquest filtre qualsevol persona externa podria registrar-se. |
| Invitació amb `role = 'ADMIN'` | **Sí** | Els admins són personal intern de la UAB; han de tenir correu institucional. |
| Invitació amb `role = 'TECHNICAL'` | **No** | La invitació ja avala l'usuari; el correu pot ser de l'empresa contractista. |

**Canvis aplicats:**

- `backend/src/services/auth.ts` → s'elimina el `isUabEmail()` global al principi de `registerUser`. Es mou cap a dues posicions: dins la branca privilegiada **només si `invite.role === 'ADMIN'`**, i a la branca pública (estudiant) com a primera línia abans de crear l'usuari.
- `app/app/(auth)/register.tsx` → l'esquema Zod construeix el camp `email` de forma diferent segons el mode: en mode `'student'` aplica `.refine(isUabEmail)`, en mode `'invited'` només valida format de correu. La label del camp passa de "Correu UAB" a "Correu electrònic" quan estàs en mode invitació, i el placeholder canvia de `niu@uab.cat` a `el.teu@correu.com`. Així el client no rebutja correus que el backend acceptaria, i els missatges UI són coherents amb el cas d'ús.

Aquesta separació il·lustra el principi de **defensa apropiada**: aplica controls allà on són necessaris (registre obert, accés privilegiat real) i no on només afegeixen fricció (un tècnic extern amb una invitació personalitzada).

### Caducitat i revocació d'invitacions

Originalment una invitació `PENDING` vivia indefinidament a la taula `invites`: si l'admin enviava un token al destinatari equivocat, o si l'usuari mai es registrava, el token quedava actiu per sempre. Això suposa un **risc de seguretat petit però evitable**: si un token es filtra (Slack mal configurat, captura de pantalla, email reenviat…), qualsevol persona el pot fer servir mesos després.

S'introdueixen dos mecanismes complementaris:

**1. Caducitat automàtica (7 dies)**

S'afegeix un camp `expiresAt: DateTime` al model `Invite` amb default `now() + 7 days` a nivell de base de dades:

```prisma
model Invite {
  // ...
  expiresAt DateTime @default(dbgenerated("(now() + interval '7 days')"))
}
```

El servei `createInvite` també l'estableix explícitament a 7 dies des del moment de creació (constant `INVITE_TTL_DAYS = 7` a `services/invite.ts`), de manera que el comportament queda visible al codi. El default a la DB és la xarxa de seguretat per si en un futur es creen invitacions per via no estàndard.

A `services/auth.ts`, just després de validar que la invitació existeix i està `PENDING`, afegim un check explícit:

```ts
if (invite.expiresAt < new Date()) {
  throw new Error('Aquesta invitació ha caducat. Demana\'n una de nova a l\'administrador.');
}
```

> **Nota**: no s'introdueix un nou estat `EXPIRED` a l'enum `InviteStatus`. La regla és: *vàlida = `status === 'PENDING' && expiresAt > now()`*. La UI pot derivar el badge "caducada" client-side. Així evitem haver d'executar un cron per re-etiquetar invitacions vençudes; són dades sense efecte si ningú les fa servir.

**2. Revocació manual**

Nou endpoint `PATCH /api/invites/:id/revoke` (només `ADMIN`) que canvia l'estat de `PENDING` a `REVOKED`. Si la invitació ja està `USED` o `REVOKED` retorna **409 Conflict**; si no existeix, **404 Not Found**. Permet a l'admin "tornar enrere" si:

- S'ha creat una invitació amb un email equivocat.
- Es vol cancel·lar abans dels 7 dies (p. ex. l'usuari ja no és contractista).

L'endpoint queda muntat al router juntament amb els existents `GET /api/invites` i `POST /api/invites`, i utilitza el servei `revokeInvite()` que valida l'estat actual abans de modificar.

**Per què aquesta combinació**

| Mecanisme | Cobertura |
|---|---|
| **Caducitat automàtica** | Casos passius (l'usuari no es registra mai, l'admin oblida una invitació) |
| **Revocació manual** | Casos actius (s'ha creat per error, l'usuari ja no fa falta) |

Junts cobreixen els dos vectors d'invitació "zombi" sense necessitat d'un cron job ni infraestructura addicional. Per a un futur productiu es podria afegir un cron setmanal que esborri invitacions amb estat final (`USED`, `REVOKED` o caducades > 30 dies) per mantenir la taula neta, però per a un TFG és innecessari.

**Fitxers modificats:**

- `backend/prisma/schema.prisma` → camp `expiresAt` al model `Invite`.
- `backend/src/services/invite.ts` → `createInvite` ara estableix `expiresAt`; nou `revokeInvite(id)` que valida que l'estat sigui `PENDING`. Constant `INVITE_TTL_DAYS = 7` exposa el TTL al codi.
- `backend/src/services/auth.ts` → check d'expiració dins `registerUser` per a registres privilegiats.
- `backend/src/controllers/invite.ts` → controlador `revoke` amb mapatge a 404/409.
- `backend/src/routes/invites.ts` → nova ruta `PATCH /:id/revoke`.

### Comentaris de progrés i fotos de progrés del tècnic

Després de provar el flux complet d'una incidència, detectem que el cicle de vida és massa rígid: el tècnic només pot deixar constància de la seva feina al moment final (`RESOLVE`) i únicament a través del comentari de transició. Els casos reals freqüents que no estaven coberts:

- "He passat avui però necessito demanar peces, vindré demà." — el tècnic no pot anotar res perquè no canvia d'estat.
- "Veig que el problema és més gros del que semblava, deixo una foto." — no hi ha forma de pujar una foto intermèdia.

S'afegeixen dos mecanismes complementaris:

**1. Comentari de discussió (`POST /api/reports/:id/comments`)**

Endpoint nou que crea un `Comment` **sense `transitionEvent`** (el camp existia al model però només l'omplíem en transicions). Cas d'ús: anotar progrés o aclariments en qualsevol moment, sense canviar l'estat.

```ts
// services/report.ts
export const addComment = async (params: {
  reportId; content; userId; role
}) => {
  // Validacions: content no buit, < 2000 chars
  // Autorització: només creador, assignat o admin (evitar soroll d'estudiants no relacionats)
  return prisma.comment.create({
    data: { content, reportId, authorId: userId },  // transitionEvent queda null
    include: { author: { select: { user_id, name, nickname } } },
  });
};
```

L'autorització és intencionadament estricta: estudiants que no han creat la incidència ni n'estan assignats no poden comentar. Si demà es vol obrir a comentaris públics només cal afegir un altre rol al check.

Diferència respecte al comentari de transició:

| | Comentari de **transició** | Comentari de **discussió** (nou) |
|---|---|---|
| Endpoint | `PATCH /reports/:id/transition` (camp `comment` opcional) | `POST /reports/:id/comments` |
| Quan | Només al canviar d'estat | Sempre |
| `transitionEvent` | L'esdeveniment (`RESOLVE`, `START`...) | `null` |
| UI | Secció **"Activitat"** (timeline amb icones) | Secció **"Comentaris"** |

**2. Foto de progrés (`type: 'PROGRESS'`)**

L'enum `TypeImage` ja tenia el valor `PROGRESS` i l'endpoint `POST /api/reports/:id/images` ja l'acceptava amb les autoritzacions correctes (només l'assignat o un admin). El que faltava era exposar-ho a la UI mòbil:

- Nou botó **"Foto de progrés"** a la card d'accions del tècnic, només visible quan `state === 'IN_PROGRESS'` (té sentit només mentre s'està treballant en la incidència).
- Reutilitza l'`Alert.alert()` natiu com a *action sheet* per oferir Càmera o Galeria.
- Crida `uploadReportImage(reportId, uri, 'PROGRESS')` i refresca el report.

La galeria del detall ja mostrava `images.map(...)`, i cada imatge té el seu badge de tipus (INICIAL / RESOLUCIÓ / PROGRÉS), així que les noves fotos s'integren automàticament a la mateixa galeria amb la seva etiqueta corresponent.

**Fitxers modificats:**

- `backend/src/services/report.ts` → nou `addComment()` amb validacions i autorització.
- `backend/src/controllers/report.ts` → controlador `addComment` amb mapatge a 400/403/404.
- `backend/src/routes/reports.ts` → nova ruta `POST /:id/comments`.
- `app/src/api/reports.ts` → helper `addComment(reportId, content)`.
- `app/app/(app)/incident/[id].tsx` → input multiline + botó "Enviar" sota la secció Comentaris (visible si `canComment`); botó "Foto de progrés" a la card d'accions del tècnic en estat `IN_PROGRESS`; `offerProgressPhoto()` que utilitza l'`Alert` natiu com a action sheet.

Amb aquests dos canvis, el tècnic té tota la llibertat per documentar el procés sense estar lligat al moment de transicionar, mantenint l'auditabilitat (cada comentari porta `authorId` i `createdAt`) i la separació visual entre activitat (esdeveniments d'estat) i discussió (notes lliures).

### Tancament de la incidència: model d'aprovació

Quan implementem el flux complet sorgeix una pregunta: **qui valida que una incidència estigui realment resolta** abans de tancar-la? Considerem tres opcions:

| Opció | Qui valida | Veredicte |
|---|---|---|
| **A.** L'estudiant que va reportar la incidència aprova/rebutja la resolució | Estudiant | Descartada — l'estudiant **no és el propietari** del bé públic. Pot ser parcial (vol punts → aprova de pressa) o massa exigent. No s'ajusta al model UAB on la institució és el "client final" del manteniment. |
| **B.** Només l'admin valida i tanca, sense intervenció de l'estudiant | Admin | Massa rígid — perd el coneixement local de qui va reportar el problema. |
| **C.** Híbrid: l'estudiant pot comentar després del RESOLVE, l'admin decideix amb tota la informació | Admin (informat per l'estudiant) | **Escollida.** Coherent amb que l'admin sigui qui dictamina, però aprofita el feedback del reporter ("el fanal funciona però hi ha un cable solt"). Reutilitza els comentaris de discussió que ja teníem implementats; no requereix nous camps al schema ni nous endpoints. |

**Resum de l'opció C:**

```
Estudiant reporta            → state OPEN
Admin assigna a tècnic       → state ASSIGNED
Tècnic comença               → state IN_PROGRESS
Tècnic resol amb foto+comentari → state VALIDATED
                                        ↓
       ┌────────────────────────────────┴────────────────────────────┐
       │ Estudiant veu banner i pot afegir comentari (opcional)      │
       │ Tècnic veu "Pendent de tancament per part de l'administrador" │
       │ Admin llegeix tots els comentaris i decideix:               │
       │   • Tancar (CLOSE) → state CLOSED                            │
       │   • Refusar (REJECT) → torna a IN_PROGRESS, tècnic refà     │
       └─────────────────────────────────────────────────────────────┘
```

**Per què cap canvi al schema ni a la màquina d'estats:**

- La màquina d'estats XState ja tenia el guard correcte: `CLOSE` i `REJECT` només per `isAdmin`. El bug latent era que la **UI mòbil del tècnic mostrava un botó "Tancar"** que en realitat hauria fallat amb 400 si algú l'hagués clicat (cap usuari l'havia disparat encara).
- L'estudiant no necessita aprovar via cap mecanisme nou: pot deixar comentaris de discussió amb l'endpoint `POST /api/reports/:id/comments` que ja existeix.
- L'admin tanca amb el `PATCH /reports/:id/transition` existent (event `CLOSE`).

**Canvis aplicats a la UI mòbil:**

- [app/app/(app)/incident/[id].tsx](../app/app/(app)/incident/%5Bid%5D.tsx):
  - **Treta** la `ActionButton` "Tancar" del tècnic. Substituïda per un missatge informatiu *"Pendent de tancament per part de l'administrador"* quan el tècnic veu una incidència seva en `VALIDATED`.
  - **Afegit** un *banner* verd quan el reporter (creator) obre una incidència seva en `VALIDATED`: *"El tècnic ha marcat la incidència com a resolta. L'administrador la tancarà aviat. Si veus que el problema no està resolt o vols afegir informació, deixa un comentari aquí sota."* Visualment guia l'estudiant cap a l'input de comentaris si té alguna observació.
- [app/app/(app)/(tabs)/home.tsx](../app/app/(app)/(tabs)/home.tsx):
  - Nova secció **"Per revisar (N)"** al `StudentHome` que apareix només si l'estudiant té incidències seves en `VALIDATED`. Mostra fins a 3 ReportCards i un text-call-to-action per recordar-li que pot comentar abans del tancament definitiu. Si no en té cap, la secció s'amaga.

**Auto-tancament als 7 dies (descartat):**

A l'opció A original es proposava auto-aprovar passats 7 dies sense resposta de l'estudiant, perquè la decisió depenia d'ell. A l'opció C la decisió **sempre** és de l'admin, així que un auto-tancament temporal no té sentit conceptual: no estem esperant una resposta de l'estudiant per progressar.

Si en el futur es vol afegir un mecanisme similar per evitar que les incidències quedin enquistades en `VALIDATED` per oblit de l'admin, la implementació natural és: **dashboard alerta visual** ("Aquesta incidència porta 14 dies en VALIDATED, recorda tancar-la"). És més una *to-do list* per a l'admin que una regla automàtica de transició.

### Millores del panel d'administració web

Després de tenir el flux complet operatiu, el dashboard web es queda curt: el llistat d'incidències només permet filtrar per estat, no hi ha cap cercador, l'admin no té una vista dedicada per assignar/tancar incidències pendents, les fotos no s'expandeixen i no hi ha cap manera de recomanar tècnics adequats per a cada incidència. Implementem una sèrie de millores que el converteixen en una eina real de gestió.

**1. Camps nous a `User` per al perfil de tècnic**

```prisma
model User {
  // ... camps existents
  position     String?   // p. ex. "Electricista", "Jardiner" — text descriptiu
  workCategory Category? // àmbit principal — utilitzat per al matching
  company      String?   // empresa contractista (Eulen, Ferrovial...)
}
```

Decisió de disseny: **`workCategory` com a `Category` (única) i no com a `Category[]`**. Per al TFG és suficient i la UI és més senzilla. Si un tècnic és polivalent, l'admin pot ignorar la recomanació i assignar-lo manualment. Els tres camps són `nullable` perquè a STUDENT i ADMIN no tenen sentit, i a tècnics existents no els forcem (es poden poblar gradualment via Supabase Studio o a través de la UI).

**2. Filtres + cercador al llistat d'incidències**

Endpoint `GET /api/reports` ampliat amb 5 nous query params:

| Param | Tipus | Descripció |
|---|---|---|
| `q` | string | Cerca en `title` + `description` (case-insensitive). |
| `createdById` | uuid | Filtra per autor del report. |
| `assignedToId` | uuid | Filtra per tècnic assignat. |
| `dateFrom` | YYYY-MM-DD | Reports creats a partir d'aquest dia (inclusiu). |
| `dateTo` | YYYY-MM-DD | Reports creats fins aquest dia (inclusiu — s'amplia automàticament al final del dia, 23:59:59). |

A `frontend/src/pages/ReportsListPage.tsx`:
- **Cercador** amb icona de lupa, debouncat a 300 ms perquè cada caràcter no dispari una crida.
- **Selectors** poblats dinàmicament: estudiants (per al filtre de creador) i tècnics (per al filtre d'assignat). Endpoint nou `GET /api/users/students` per a la primera llista.
- **Date pickers** HTML5 nadius per "Des de" i "Fins" — sense dependències addicionals.
- **Filtres persistents a la URL** via `useSearchParams`, així es poden compartir o rellegir sense perdre l'estat.
- **Botó "Netejar filtres"** que reset-eja tot, només visible si hi ha filtres actius.
- **Comptador** de resultats al header.

**3. Lightbox d'imatges al detall**

Component nou `frontend/src/components/ImageLightbox.tsx`. Quan l'admin fa clic a una imatge del detall:

- **Modal de pantalla completa** amb fons fosc translúcid + blur.
- **Navegació** entre imatges amb fletxes laterals i tecles `←` / `→`.
- **Tancament** amb la `X`, clic al fons o tecla `Esc`.
- **Comptador** "1 / 3" centrat a la part superior.
- **Bloqueig de l'scroll del body** mentre el modal és obert (`document.body.style.overflow = 'hidden'`) per evitar que la pàgina es mogui darrere.

A la galeria, cada imatge mostra **un badge de tipus** ("INICIAL" / "RESOLUCIÓ" / "PROGRÉS") a la cantonada superior i una icona de "expand" centrada quan el cursor passa per sobre, perquè l'usuari sàpiga que és clicable.

**4. Pàgina nova: `/assignments` — assignacions pendents amb tècnics recomanats**

Aquesta és la pàgina més rica funcionalment. Mostra **totes les incidències en estat `OPEN`** (no assignades) i, per a cada una, un panel desplegable amb els tècnics actius dividits en dues seccions:

- **Recomanats** — Aquells tècnics amb `workCategory === report.category`. Marcats amb una estrella verda i un anell `ring-emerald-200`.
- **Altres tècnics disponibles** — La resta.

L'**algoritme de rànquing** dins de cada secció:

```ts
function rankTechnicians(technicians, category) {
  return technicians
    .map((t) => ({
      ...t,
      matchesCategory: t.workCategory === category,
      workload: t._count?.reportsAssigned ?? 0,
    }))
    .sort((a, b) => {
      if (a.matchesCategory !== b.matchesCategory) return a.matchesCategory ? -1 : 1;
      if (a.workload !== b.workload) return a.workload - b.workload;
      return (b.points ?? 0) - (a.points ?? 0);
    });
}
```

És a dir, per ordre de prioritat:

1. **Match de categoria** primer (recomanats).
2. **Càrrega actual ascendent** (menys feina = més disponible). Per calcular-ho, ampliem `getAllTechnicians` perquè faci un `_count: { reportsAssigned: { where: { state: { in: ['ASSIGNED', 'IN_PROGRESS'] } } } }` — així el frontend rep el nombre de tasques actives sense haver de fer una segona crida.
3. **Punts descendent** com a desempat (gamificació premia els més actius).

Cada fila de tècnic mostra: nom + nickname + posició + workCategory amb badge + companyia en cursiva + càrrega actual + punts. Un sol clic al botó "Assignar" dispara `transitionReport(reportId, 'ASSIGN', techId)` i refresca la llista.

**5. Pàgina nova: `/validations` — validacions pendents de tancament**

Mostra **totes les incidències en estat `VALIDATED`** (resoltes pel tècnic, esperant decisió de l'admin). Per cada una:

- Badge automàtic **"Fa N dies"** taronja si la incidència porta més de 7 dies sense tancar-se (com a recordatori visual, no com a auto-tancament — l'admin segueix sent qui decideix).
- Botons d'acció ràpida:
  - **"Tancar definitivament"** (verd) → dispara `CLOSE` → `CLOSED`.
  - **"Rebutjar resolució"** (vermell) → dispara `REJECT` → torna a `IN_PROGRESS` perquè el tècnic refaci la feina.
  - **"Veure detall"** per anar al detall complet i llegir comentaris/imatges abans de decidir.

Confirmació amb `confirm()` natiu abans de qualsevol acció destructiva.

**6. Sidebar i rutes**

Dues entrades noves al menú lateral, entre "Incidències" i "Mapa":

- 🧰 **Assignacions** → `/assignments`
- ✅ **Validacions** → `/validations`

Aquestes pàgines es converteixen en el **dia a dia de l'admin**: en lloc d'haver d'anar al llistat genèric i filtrar a mà, té dos *worklists* dedicats que mostren exactament la feina que requereix la seva atenció.

**Fitxers creats o modificats:**

| Fitxer | Acció | Descripció |
|---|---|---|
| `backend/prisma/schema.prisma` | Modificat | `position`, `workCategory`, `company` opcionals al `User`. |
| `backend/src/controllers/user.ts` | Modificat | `getAllTechnicians` retorna nous camps + `_count.reportsAssigned`. Nou `getAllStudents`. |
| `backend/src/routes/users.ts` | Modificat | Nova ruta `GET /api/users/students`. |
| `backend/src/controllers/report.ts` | Modificat | `getAll` accepta 5 nous query params i els passa al servei. |
| `backend/src/services/report.ts` | Modificat | `getAllReports` amb `where` dinàmic per `q`/`createdById`/`assignedToId`/`dateFrom`/`dateTo` (Prisma `mode: 'insensitive'` per al `q`). |
| `frontend/src/types/index.ts` | Modificat | `User` amb camps de tècnic + interfaces `Technician` i `StudentSummary`. |
| `frontend/src/api/users.ts` | Modificat | `getStudents` afegit. `getTechnicians` retorna `Technician[]`. |
| `frontend/src/api/reports.ts` | Modificat | `getReports(filters)` amb objecte de filtres complet. |
| `frontend/src/components/ImageLightbox.tsx` | Creat | Modal d'expansió d'imatges amb navegació + tecles. |
| `frontend/src/pages/ReportDetailPage.tsx` | Modificat | Imatges clicables que obren el lightbox + badges de tipus. |
| `frontend/src/pages/ReportsListPage.tsx` | Modificat | Cercador + 5 filtres + persistència URL + reset. |
| `frontend/src/pages/AssignmentsPage.tsx` | Creat | Worklist d'OPEN amb tècnics recomanats. |
| `frontend/src/pages/ValidationsPage.tsx` | Creat | Worklist de VALIDATED amb accions ràpides CLOSE/REJECT. |
| `frontend/src/components/Layout.tsx` | Modificat | Dues entrades noves a la sidebar. |
| `frontend/src/App.tsx` | Modificat | Rutes `/assignments` i `/validations` registrades. |

**Per què no afegim un endpoint específic `GET /api/reports/:id/recommended-technicians`:**

Vam considerar fer la recomanació al backend, però per a l'escala d'un TFG (poques desenes de tècnics per organització) és més senzill enviar tots els tècnics actius una sola vegada quan obrim la pàgina d'assignacions i fer el rànquing client-side amb `useMemo`. Així evitem un endpoint nou, una segona crida per cada incidència, i l'admin pot veure les llistes "recomanats" / "altres" alhora sense esperes. Si en un futur el sistema escalés a centenars de tècnics, llavors sí caldria moure la lògica al backend amb paginació.

**Configuració inicial dels nous camps:**

Els camps `position`, `workCategory` i `company` són `null` per defecte als tècnics existents. Per a poder provar la recomanació amb dades reals, l'admin pot:

1. **Via Supabase Studio**: editar la fila a la taula `users` (camp per camp).
2. **Via UI** *(pendent)*: una pantalla d'edició al panel d'admin per gestionar el perfil dels tècnics. No s'inclou aquesta iteració per limitar l'abast; per al TFG és acceptable poblar-ho via Supabase Studio.

### Refinaments posteriors: UX, reutilització i visibilitat per rol

Després de l'iteració d'admin, durant les proves d'integració apareixen tres tipus de polidesa que val la pena documentar perquè afecten transversalment al producte:

**1. Component `TechnicianAssignmentList` reutilitzat al detall**

A `/assignments` ja teníem el llistat de tècnics recomanats (match de `workCategory`) + altres disponibles, cada un amb el seu botó "Assignar". A la pàgina **detall d'una incidència en estat `OPEN`**, en canvi, tan sols apareixia un `<select>` amb tots els tècnics i un botó "Assignar" genèric — UX més pobra i sense la lògica de recomanació.

Solució: extreure el llistat a un component reutilitzable.

- Nou fitxer `frontend/src/components/TechnicianAssignmentList.tsx` que encapsula:
  - La funció `rankTechnicians()` (exportada per si en algun altre lloc cal el rànquing sense la UI).
  - El render amb dues seccions ("Recomanats" / "Altres tècnics disponibles") i les fileres per tècnic amb el botó "Assignar" en el seu color (verd / blau).
  - Props: `technicians`, `category`, `onAssign(techId)`, `assigningTechId` (per loading state per fila).
- `AssignmentsPage.tsx`: refactoritzada per fer servir `<TechnicianAssignmentList>` dins de cada targeta. Menys línies, mateix comportament.
- `ReportDetailPage.tsx`: substituït el `<select>` + botó genèric per `<TechnicianAssignmentList>` quan `report.state === 'OPEN'`. La resta d'estats (`ASSIGNED`, `IN_PROGRESS`, `VALIDATED`) mantenen els botons d'acció (Iniciar, Resoldre, Tancar, etc.). Per a la transició `ASSIGN` el handler ja no fa servir cap `selectedTechId`: hi ha un `handleAssignTechnician(techId)` dedicat que el component crida amb el techId de la fila.

Resultat: l'admin veu **la mateixa UX d'assignació** tant si entra per `/assignments` com si va directament al detall via `/reports/:id`. Sense codi duplicat ni divergències futures.

**2. Sidebar amb icones Lucide enlloc d'emojis**

Per consistència amb el mòbil (que ja fa servir `Ionicons` outline), s'instal·la `lucide-react` (biblioteca SVG outline lleugera, *tree-shakeable*) i es substitueixen els emojis del menú lateral del dashboard:

| Antic | Nou (`lucide-react`) |
|---|---|
| 📊 Dashboard | `LayoutDashboard` |
| 📋 Incidències | `ClipboardList` |
| 🧰 Assignacions | `Wrench` |
| ✅ Validacions | `CheckCircle2` |
| 🗺️ Mapa | `Map` |
| 🔑 Invitacions | `KeyRound` |
| (cap) Tancar sessió | `LogOut` |

Cada icona es renderitza a 18 px (16 px al logout) amb `strokeWidth={2}`, hereta el color del `NavLink` pare i passa automàticament a `text-indigo-700` quan la ruta és activa. Visualment alineat amb el pes de la tipografia Tailwind i els *outline* del mòbil.

**3. Mapa de selecció manual d'ubicació al mòbil**

L'estudiant pot reportar una incidència que no s'està veient *en aquest moment* (per exemple, un fanal trencat que ha vist en passar i en torna a casa). El GPS actual no serveix; cal un selector manual.

- Nou component `app/src/components/LocationPicker.tsx`: WebView amb Leaflet interactiu (la mateixa stack que la resta de mapes). Marcador `draggable` + tap al mapa per recol·locar-lo. Cada moviment emet un `postMessage` cap a React Native amb les noves coordenades. Pista visual a dalt: *"Toca el mapa per col·locar el marcador"*.
- `create.tsx`: nou estat `locMode: 'gps' | 'map'` amb un *toggle* a la secció Ubicació:
  - **"Ubicació actual"** (per defecte) — flux GPS existent.
  - **"Triar al mapa"** — apareix el `LocationPicker` (240 px d'alçada). Si l'usuari encara no ha picat al mapa, el botó "Enviar" queda **desactivat** (per evitar enviar amb la posició per defecte sense voler-ho).
- L'`effectiveCoords` final triat per al `POST /api/reports` es deriva del mode actiu, així no calen branques diferents al `handleSubmit`.

**4. Reset del formulari de creació en sortir del tab**

Es detecta que si l'estudiant escriu mig formulari i navega a un altre tab, en tornar a Reportar es trobava la informació anterior. Comportament que té sentit en alguns contextos (esborranys), però aquí va contra l'expectativa: cada nova incidència s'ha de poder començar de zero.

- A `create.tsx` s'afegeix un `useFocusEffect` (de `expo-router`) amb una funció de **cleanup**. La funció es dispara quan el tab perd el focus, i neteja `title`, `description`, `category`, `photoUri`, `locMode`, `pickedCoords` i `submitting`. Es preserva `coords` i `locStatus` perquè la posició GPS ja és vàlida i mantenir-la evita un *flicker* en obrir el tab de nou.
- Hot reload o canvi d'orientació no provoquen un blur del tab → l'edició no es perd dins d'una mateixa sessió de redacció.

**5. Visibilitat per rol forçada al backend**

Bug latent de seguretat: `GET /api/reports` retornava **totes** les incidències a qualsevol usuari autenticat. La UI mòbil ja filtrava client-side (`getReportsByRole`), però un estudiant que cridés l'API directament amb el seu JWT podia veure incidències d'altres estudiants — un *information disclosure*.

Solució a `services/report.ts`:

```ts
const viewerScope =
  filters?.viewer?.role === 'STUDENT'
    ? { createdById: filters.viewer.userId }
    : filters?.viewer?.role === 'TECHNICAL'
    ? { assignedToId: filters.viewer.userId }
    : {};

return prisma.report.findMany({
  where: {
    ...viewerScope,
    ...(filters?.state && { state: filters.state }),
    // ... resta de filtres explícits
  },
  // ...
});
```

El controlador injecta sempre `viewer` a partir de `req.user`:

```ts
viewer: { role: req.user!.role, userId: req.user!.userId }
```

Comportament resultant:

| Rol | Què veu via `GET /api/reports` |
|---|---|
| `STUDENT` | Només les incidències que ell ha creat (`createdById = userId`) |
| `TECHNICAL` | Només les que té assignades (`assignedToId = userId`) |
| `ADMIN` | Totes (cap restricció implícita) |

Els filtres explícits de query string (`createdById`, `assignedToId`, `state`, `q`, `dateFrom/To`) s'apliquen **per damunt** del scope. Per a un admin això vol dir poder filtrar per creador concret; per a un estudiant els seus filtres explícits són sempre subset del seu propi scope (no pot ampliar visibilitat).

Conseqüències a la UI:
- **Mapa mòbil**: l'estudiant ara només veu els seus pins; el tècnic, els que té assignats.
- **Reports tab mòbil**: el filtre client-side `getReportsByRole` esdevé redundant però es manté com a defensa en profunditat.
- **Dashboard web**: cap canvi (l'admin segueix veient tot).

**Nota sobre el detall (`GET /api/reports/:id`)**: aquesta ruta NO s'ha restringit en aquesta iteració. En la pràctica el risc és baix perquè els UUIDs són essencialment inenumerable i ningú no comparteix IDs entre usuaris, però per a un projecte productiu real caldria afegir-hi una verificació anàloga (un `STUDENT` només pot llegir els seus, un `TECHNICAL` només els assignats). Es deixa com a *to-do* per a un sprint futur.

**Sobre la menció de "filtrar amb PostGIS"**: la primera proposta de l'usuari era filtrar al DB amb PostGIS. Important aclarir-ho: PostGIS s'usa exclusivament per a consultes geoespacials (radi, polígons, distàncies). El que cal aquí és un *where* per FK (`createdById` / `assignedToId`), que es resol amb SQL/Prisma estàndard. PostGIS no hi entra; el camp `Report.location` (PostGIS `geography(Point, 4326)`) s'utilitzarà només quan implementem consultes del tipus "incidències a menys de 100 m del meu pin", que ja seria una funcionalitat futura.

**Fitxers afegits o modificats en aquesta iteració:**

| Fitxer | Acció | Descripció |
|---|---|---|
| `frontend/src/components/TechnicianAssignmentList.tsx` | Creat | Llista reutilitzable de tècnics recomanats / altres amb botó "Assignar" per fila. Exporta `rankTechnicians()`. |
| `frontend/src/pages/AssignmentsPage.tsx` | Modificat | Substituït el codi inline per `<TechnicianAssignmentList>`. |
| `frontend/src/pages/ReportDetailPage.tsx` | Modificat | Substituït el `<select>` per `<TechnicianAssignmentList>` quan estat `OPEN`. Nou handler `handleAssignTechnician`. |
| `frontend/src/components/Layout.tsx` | Modificat | Icones Lucide en lloc d'emojis al menú lateral; icona `LogOut` al botó. Dependència nova: `lucide-react`. |
| `app/src/components/LocationPicker.tsx` | Creat | WebView+Leaflet interactiu per triar la ubicació al mapa. |
| `app/app/(app)/(tabs)/create.tsx` | Modificat | Toggle GPS/Mapa amb `LocationPicker`. `useFocusEffect` que neteja el formulari en sortir del tab. |
| `backend/src/services/report.ts` | Modificat | `getAllReports()` accepta `viewer: { role, userId }` i aplica scope implícit. |
| `backend/src/controllers/report.ts` | Modificat | El controller `getAll` passa sempre `viewer` extret de `req.user`. |

### Lliçons apreses

- **Prisma + PostGIS + Supabase pooler**: `prisma migrate dev` falla perquè el shadow DB que crea Prisma no té PostGIS i el camp `geography(Point, 4326)` no es pot recrear. La solució per a desenvolupament és `prisma db push`, que sincronitza directament. Per a producció caldria un shadow DB dedicat amb PostGIS pre-instal·lat.
- **Axios + React Native + multipart**: cal `transformRequest: (d) => d` perquè Axios respecti el `FormData` enlloc d'aplicar `JSON.stringify`. És un dels errors més comuns quan es passa de web a RN.
- **Ordre de les operacions a la resolució**: cal pujar la imatge **abans** de transicionar perquè el tècnic encara compleixi la condició d'autorització (`assignedToId === userId`).
- **Atomicitat de transicions amb comentari**: utilitzar `prisma.$transaction([...])` garanteix que estat i comentari avancen junts; sense això podríem deixar incidències amb estat canviat però sense la justificació corresponent.
- **`db push` enlloc de migracions versionades**: per a un TFG és el camí més senzill. En un projecte productiu caldria mantenir l'històric a `prisma/migrations/` i generar la migració manualment amb `prisma migrate diff` quan el shadow DB no és viable.

### Estat al final de la integració hardware

L'aplicació mòbil ja és funcionalment completa per al cicle de vida d'una incidència:

- **L'estudiant** captura ubicació real, fa una foto del problema, descriu i envia → la foto va a Supabase Storage com a `INITIAL`, la URL es guarda al DB, la incidència es llista al mapa amb el seu marcador.
- **L'admin** (al panel web) assigna la incidència a un tècnic i pot afegir un comentari de l'assignació (futur — actualment ho fa per UI web sense comentari).
- **El tècnic** veu la incidència assignada al mòbil, prem "Començar" (transició `START`), i quan ha resolt la incidència obre el modal de resolució, fa una foto del resultat, escriu un comentari justificatiu i confirma → la foto puja com a `RESOLUTION` i es crea un `Comment` amb `transitionEvent = RESOLVE`, tot dins la mateixa transacció.
- **Qualsevol usuari** que obri el detall de la incidència veu la galeria amb fotos etiquetades per tipus, una *timeline* d'activitat amb cada transició important, i la conversa de comentaris separada.

Queden com a treball futur: enviament de comentaris de discussió (no de transició) des del mòbil, suport per a comentaris en la transició `ASSIGN` des del panel web, captura GPS d'alta precisió quan el tècnic confirma que ha treballat sobre el lloc, i possible migració del bucket a privat amb signed URLs si en un futur les fotos contenen informació sensible.

### Perfil del tècnic, reassignació en marxa i comentari obligatori al rebuig

Aquesta iteració tanca tres mancances detectades a la fase anterior:

1. Els camps específics de tècnic (`position`, `workCategory`, `company`) ja existien al schema des del Sprint 3 — eren la base de l'algoritme de recomanació del panel admin — però **no hi havia cap manera de capturar-los**. Es creaven sempre `null` perquè el formulari de registre no els demanava i no existia cap pantalla d'edició de perfil. Un tècnic donat d'alta amb el flux d'invitació entrava al sistema "buit" i mai no apareixia com a recomanat.
2. La màquina d'estats no contemplava el cas que un tècnic comencés una incidència (`IN_PROGRESS`) i no la pogués acabar — baixa, canvi d'empresa, especialitat equivocada. L'única sortida era esperar a què la marqués com a resolta o que un admin manipulés el DB directament.
3. El rebuig d'una resolució (`VALIDATED → IN_PROGRESS` via `REJECT`) deixava el tècnic sense informació del motiu. La transició era silenciosa i els comentaris ja existien al model com a opcionals, però el panel web no els demanava.

#### Decisions de disseny

**Camps de tècnic com a opcionals al formulari, però visibles al perfil.** Al formulari de registre amb invitació es mostren `Posició`, `Empresa` i un selector de `Àmbit principal` amb chips. No els forcem perquè una invitació pot ser per a un `ADMIN` (que no té sentit que tingui aquests camps) i el client no sap el rol de la invitació fins que el backend la resol. La sanitització la fa el servei: només si `invite.role === 'TECHNICAL'` persisteix els camps; per a `ADMIN` els ignora silenciosament. Aquesta defensa al backend evita que un usuari maliciós omplís un `workCategory` per a un compte d'admin enviant el camp manualment.

**Edició posterior via `PATCH /api/users/profile`, no `PUT`.** El mètode `PATCH` permet enviar només els camps que canvien. El servei distingeix entre `undefined` (no toca el camp) i `null` (esborra el valor explícitament), cosa imprescindible per poder buidar la `position` o `workCategory` d'un tècnic que canvia d'especialitat. Aquesta semàntica només es pot expressar en JSON amb un PATCH.

**Camps de tècnic blocats per rol al backend, no al frontend.** El servei `updateOwnProfile` aplica `name` i `surname` a qualsevol rol, però els camps de tècnic només si `user.role === 'TECHNICAL'`. Si un estudiant intenta enviar `position`, el backend ho ignora sense error. El client mòbil ja amaga aquests inputs per als rols no-tècnic, però la validació al backend és la que dona la garantia real.

**`REASSIGN` des de `IN_PROGRESS` torna a `ASSIGNED`, no a `OPEN`.** La transició existent `ASSIGNED → REASSIGN → OPEN` és per al cas en què l'admin s'ha equivocat d'assignat i vol tornar a començar el procés de tria. La nova transició `IN_PROGRESS → REASSIGN → ASSIGNED` és diferent: la incidència ja s'ha començat i hi ha hagut feina, només cal canviar la persona que la continua. Anar a `OPEN` perdria la traçabilitat del fet que estava en marxa. Per això la transició preserva l'estat "assignat" i només canvia el `assignedToId`.

**Comentari obligatori al `REJECT`, opcional al `REASSIGN`.** El rebuig és un acte amb pes — l'admin diu al tècnic que la feina no està ben feta — i sense motiu escrit acabaria en confusió o desconfiança. El servei `transition` a backend retorna `400` si es rep `REJECT` sense `comment` no buit. La reassignació, en canvi, sovint és per causes administratives (baixa, canvi d'empresa) i imposar-ne un text seria fricció innecessària; es deixa opcional.

#### Implementació

**Backend** (`backend/src/`):

| Fitxer | Acció | Descripció |
|---|---|---|
| `types/index.ts` | Modificat | `RegisterDTO` afegeix `position?`, `company?`, `workCategory?`. Nou `UpdateProfileDTO` amb els mateixos camps a més de `name?` i `surname?`. |
| `services/auth.ts` | Modificat | A `registerUser`, només persisteix els camps de tècnic si `invite.role === 'TECHNICAL'`. Per a invitacions d'`ADMIN` els ignora encara que els enviï el client (defensiu). |
| `controllers/auth.ts` | Modificat | El controlador de registre passa els nous camps al servei. |
| `services/user.ts` | Modificat | Nou `updateOwnProfile(userId, data)` que aplica un patch parcial: `undefined` no toca el camp, `null` l'esborra. Els camps de tècnic només s'apliquen si `user.role === 'TECHNICAL'`. |
| `controllers/user.ts` | Modificat | Nou `updateProfile` exposat com a `PATCH /api/users/profile`. Retorna l'usuari actualitzat amb tots els camps que el `getProfile` també retorna ara (`position`, `workCategory`, `company`). |
| `routes/users.ts` | Modificat | Registra `PATCH /profile`. La ruta és per a qualsevol usuari autenticat (sense `authorize()`), perquè cada usuari edita el seu propi perfil. |
| `machines/stateMachine.ts` | Modificat | Afegida la transició `REASSIGN` a l'estat `IN_PROGRESS` amb `target: 'ASSIGNED'` i `guard: 'isAdmin'`. Coexisteix amb la `REASSIGN` original des de `ASSIGNED`. |
| `services/report.ts` | Modificat | A la transició, quan és `REASSIGN` i el nou estat és `ASSIGNED` actualitza `assignedToId` al nou tècnic; quan és `REASSIGN` i el nou estat és `OPEN`, posa `assignedToId = null`. Així cobreix els dos camins de la `REASSIGN`. |
| `controllers/report.ts` | Modificat | A `transition`, retorna 400 si l'esdeveniment és `REJECT` i el `comment` és absent o buit. La validació es fa al controller (no al servei) per separar el contracte HTTP de la lògica de domini. |

**Mòbil** (`app/`):

| Fitxer | Acció | Descripció |
|---|---|---|
| `src/types/index.ts` | Modificat | `User` afegeix `position`, `workCategory`, `company`. `RegisterPayload` també. Nou `UpdateProfilePayload`. |
| `src/api/auth.ts` | Modificat | Afegida la funció `updateProfile(payload)` que crida `PATCH /users/profile`. |
| `src/context/AuthContext.tsx` | Modificat | Exposa `setUser` perquè la pantalla de configuració pugui actualitzar l'usuari en memòria després d'un PATCH sense haver de tornar a llegir el perfil sencer. |
| `app/(auth)/register.tsx` | Modificat | En mode "amb invitació" mostra els camps `Posició` (text), `Empresa` (text) i `Àmbit principal` (selector amb chips de les 9 categories). Tots són opcionals. El `workCategory` s'envia només si l'usuari el selecciona. |
| `app/(app)/settings.tsx` | Creat | Pantalla de configuració del compte, accessible des del perfil. Per a tots els rols permet editar `name` i `surname`. Per a `TECHNICAL` afegeix la secció "Dades del tècnic" amb els tres camps. Camps buits s'envien com a `null` per esborrar el valor anterior. |
| `app/(app)/(tabs)/profile.tsx` | Modificat | Per a `TECHNICAL` mostra una secció "Dades professionals" amb `Posició`, `Empresa` i `Àmbit`. Substituïda l'opció "Configuració" per "Editar perfil" que navega a `/settings`. |
| `app/(app)/_layout.tsx` | Modificat | Registra la ruta `settings` al `Stack`. |

**Web** (`frontend/`):

| Fitxer | Acció | Descripció |
|---|---|---|
| `src/types/index.ts` | Modificat | `STATE_TRANSITIONS.IN_PROGRESS` passa de `['RESOLVE']` a `['RESOLVE', 'REASSIGN']`. |
| `src/api/reports.ts` | Modificat | `transitionReport` accepta un quart paràmetre `comment` opcional que envia al body. |
| `src/pages/ReportDetailPage.tsx` | Modificat | Afegit estat de modal i nou component intern `TransitionModal`. El handler `handleTransition` intercepta `REJECT` i `REASSIGN` des de `IN_PROGRESS` i obre el modal en lloc d'enviar la transició directament. La `REASSIGN` des de `ASSIGNED` continua igual (sense modal, com abans). |

#### Flux d'una reassignació en marxa

1. Una incidència està en `IN_PROGRESS` perquè un tècnic l'havia començat.
2. L'admin obre el detall i prem "Reassignar".
3. S'obre el modal amb un `<select>` que llista tots els tècnics actius excloent l'actualment assignat. Si la `category` de la incidència coincideix amb el `workCategory` d'algun tècnic, l'opció es marca amb el sufix "· recomanat". Comentari opcional.
4. En confirmar, el client crida `PATCH /reports/:id/transition` amb `{ event: 'REASSIGN', assignedToId: <nouTècnic>, comment? }`.
5. El controller valida l'event, el servei carrega l'estat i crea l'actor XState. La transició `IN_PROGRESS → REASSIGN` és guardada per `isAdmin` i resol a `ASSIGNED`. El servei actualitza `assignedToId` (nou tècnic) i, si hi ha comentari, crea un `Comment` amb `transitionEvent: 'REASSIGN'` dins la mateixa transacció.
6. La incidència queda en estat `ASSIGNED` apuntant al nou tècnic, que la veurà al seu llistat al mòbil i podrà prémer "Començar" (transició `START` ja existent) per tornar-la a posar en marxa.

#### Flux d'un rebuig amb motiu

1. El tècnic resol la incidència (`IN_PROGRESS → RESOLVE → VALIDATED`) i adjunta foto + comentari.
2. L'admin obre el detall, mira la foto i conclou que no està ben resolta.
3. Prem "Rebutjar" i s'obre el modal amb un `<textarea>` obligatori.
4. Si l'envia buit, el client mostra error inline; si el deixa intentar enviar igualment, el backend respon 400.
5. Quan el comentari hi és, la transició `VALIDATED → REJECT → IN_PROGRESS` s'aplica i el `Comment` amb `transitionEvent: 'REJECT'` queda al timeline. El tècnic veurà la incidència de nou en `IN_PROGRESS` amb el motiu visible al mòbil i podrà tornar a treballar-hi.

#### Lliçons apreses

- **Patch parcial amb semàntica triple-estat**: distingir `undefined` (no toca), `null` (esborra) i valor (assigna) en un endpoint PATCH és imprescindible quan l'usuari pot voler buidar un camp opcional. Una API que només distingís entre "envia el camp" i "no l'envies" no permetria buidar la `workCategory` d'un tècnic sense afegir-hi un endpoint específic.
- **Validació RBAC al servei, no al controller**: que `updateOwnProfile` ignori els camps de tècnic per a `STUDENT/ADMIN` en lloc de retornar 403 simplifica el client (no ha de filtrar segons rol abans d'enviar) i tanca un possible bypass si algun dia s'expandís el formulari sense actualitzar el filtre.
- **Una mateixa transició amb dos comportaments (REASSIGN)**: XState ho gestiona amb naturalitat — dues entrades `on.REASSIGN` a estats diferents — i el servei discrimina pel `newState`. No cal inventar dos events distints (`REASSIGN_FROM_OPEN` vs `REASSIGN_IN_PROGRESS`); el contracte de la API queda més simple i el frontend tampoc no ha de saber el detall.
- **Validació d'entrada al controller per a obligatorietat condicional**: el contracte "REJECT exigeix comment" és més una regla del transport HTTP que del domini. Posar-la al controller deixa el servei agnòstic d'aquesta exigència i fa més fàcil reusar-lo en altres camins (per exemple, un job intern que rebutgi automàticament passades 24h sense resposta).

### Edició de la prioritat per part de l'administrador

#### Motivació

El camp `priority` (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) existeix al schema des del Sprint 2 amb `@default(MEDIUM)`, però fins ara era pràcticament cosmètic: el formulari mòbil no el demana, el servei `createReport` no l'accepta i el panel web només el mostrava com a `<PriorityBadge>` sense forma d'editar-lo. Conseqüència: totes les incidències del sistema acabaven amb `MEDIUM` i les ponderacions del *heatmap* del mapa (que pesa pels valors `LOW=1, MEDIUM=2, HIGH=3, CRITICAL=4` a [services/geo.ts](backend/src/services/geo.ts)) eren funcionalment planes.

A més, el formulari de creació al mòbil prometia explícitament a l'usuari "La prioritat la determinarà l'administrador quan revisi la incidència" ([create.tsx:399-401](app/app/(app)/(tabs)/create.tsx#L399)), promesa que el panel web no complia.

#### Decisions de disseny

**Endpoint separat, no part de la màquina d'estats.** Canviar la prioritat **no és una transició** — no afecta el cicle de vida (`OPEN → ASSIGNED → IN_PROGRESS → …`) i, de fet, l'admin ha de poder ajustar-la en qualsevol moment, també amb la incidència `CLOSED` (per a analítica retrospectiva). Per això es crea `PATCH /api/reports/:id/priority` separat de `PATCH /api/reports/:id/transition`. Si haguéssim afegit un `event` tipus `SET_PRIORITY` a XState, hauríem hagut d'afegir auto-loops a tots els estats i barrejaríem dos conceptes diferents (cicle de vida vs metadata).

**Restricció a `ADMIN` al middleware, no al controller.** La ruta s'embolica amb `authorize('ADMIN')` directament a `routes/reports.ts`. Mantenir aquest filtre al middleware (i no dins del controller) fa que l'enforçament sigui declaratiu i visible des del fitxer de rutes — és l'únic lloc on cal mirar per saber qui pot accedir a què.

**El client web no permet desactivar el dropdown per la resta de rols** perquè el panel web només l'usen els `ADMIN`. La pantalla `ReportDetailPage` ja està dins de `<ProtectedRoute>` amb scope d'admin; no cal afegir defensa redundant a la UI.

**Selector a la sidebar, no a la capçalera.** La capçalera del detall conté badges de lectura ràpida (`ReportStatusBadge`, `PriorityBadge`, categoria). Convertir-ne un en dropdown trencaria la consistència visual de "tot són badges". En lloc d'això, s'afegeix una targeta nova "Prioritat" a la sidebar, mantenint el badge a la capçalera per a la lectura ràpida i posant el control d'edició al costat de la resta d'accions administratives ("Detalls", "Accions"). Ambdues vistes queden sincronitzades pel mateix estat `report` del component.

**Sense modal de confirmació.** El canvi és reversible (només és metadata, no afecta el flux ni notifica ningú) i el `<select>` ja és explícit. Imposar un modal seria fricció.

#### Implementació

**Backend** (`backend/src/`):

| Fitxer | Acció | Descripció |
|---|---|---|
| `services/report.ts` | Modificat | Nou `updateReportPriority(reportId, priority)` que comprova existència i fa un `prisma.report.update({ data: { priority } })`. No toca cap altre camp ni la `lastModified` explícitament (Prisma ja la manté). |
| `controllers/report.ts` | Modificat | Nou `updatePriority` amb validació de l'enum (`['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']`). Retorna 400 si la prioritat és invàlida, 404 si la incidència no existeix. |
| `routes/reports.ts` | Modificat | `PATCH /:id/priority` amb middleware `authorize('ADMIN')`. |

**Frontend** (`frontend/src/`):

| Fitxer | Acció | Descripció |
|---|---|---|
| `api/reports.ts` | Modificat | Afegida `updateReportPriority(id, priority)` que crida `PATCH /reports/:id/priority`. |
| `pages/ReportDetailPage.tsx` | Modificat | Nova targeta "Prioritat" a la sidebar amb la `PriorityBadge` actual al costat d'un `<select>` editable. Handler `handlePriorityChange` que ignora si l'usuari selecciona el mateix valor. Estat `priorityLoading` per deshabilitar el control durant la petició. |

#### Flux complet

1. Un alumne crea una incidència des del mòbil. El backend l'emmagatzema amb `priority = MEDIUM` (per defecte del schema).
2. La incidència apareix al panel d'assignacions de l'admin amb el badge `MEDIUM`.
3. L'admin obre el detall, llegeix la descripció i mira la foto.
4. A la targeta "Prioritat" de la sidebar tria el valor adequat al `<select>`. El client crida `PATCH /reports/:id/priority`. El backend valida i actualitza.
5. El component re-renderitza amb el `report` retornat: tant el badge de la capçalera com el del select queden sincronitzats.

#### Lliçons apreses

- **Distingir cicle de vida de metadata**: la regla "tot el que canvia un report passa per la màquina d'estats" és atractiva per simetria, però barreja conceptes. Una transició és un esdeveniment puntual amb pre/post-condicions; un canvi de prioritat és edició de metadata. Tractar-los igual hauria forçat afegir un event sintètic a XState i auto-loops a tots els estats.
- **El `@default` del schema no equival a "té un valor sensat"**: que tots els reports tinguin `MEDIUM` no significa que el sistema estigui prioritzant; significa que ningú no ha decidit. Documentar-ho com a deute tècnic abans (la frase del mòbil) ha permès tancar-ho ràpidament quan ha tocat.
- **Una promesa a la UI obliga a complir-la**: el text "la prioritat la determinarà l'administrador" del formulari mòbil era una promesa que el sistema no complia. Aquestes mentides petites s'acumulen i degraden la confiança del producte; pagar-les ràpid val la pena.

---

# Sprint 5: Sistema de Notificacions (Push + Temps Real)

## Resum

En aquest sprint s'ha construït el sistema de notificacions del producte, format per dues peces complementàries que comparteixen un únic punt d'orquestració al backend:

1. **Push notifications** a la app mòbil (Expo Push Service) per a estudiants i tècnics. Els estudiants reben un avís cada vegada que la seva incidència canvia d'estat; els tècnics quan se'ls assigna o reassigna una tasca; tots dos quan algú comenta a una incidència en què hi estan implicats.
2. **Server-Sent Events (SSE)** al panell web admin: el dashboard, la llista d'incidències i el mapa s'actualitzen en temps real quan passa qualsevol cosa rellevant al sistema, sense haver de refrescar la pàgina ni fer polling.

El resultat és que **un únic esdeveniment de domini** (per exemple, "un admin ha assignat l'incident X al tècnic Y") es propaga simultàniament cap a tres destinataris: una entrada persistent a la base de dades (historial in-app), un push al mòbil del tècnic, i un missatge SSE als admins connectats al dashboard. Tot orquestrat per una sola capa de servei (`NotificationService`), invocada des dels punts del codi on ja passen els canvis (transicions del report, comentaris, canvi de prioritat).

---

## Context tecnològic

### Push notifications i el paper d'Expo

Quan parlem de "notificacions push" a un mòbil, en realitat parlem de dos serveis propietaris: **APNs** (Apple Push Notification service) per a iOS i **FCM** (Firebase Cloud Messaging) per a Android. Cada un requereix la seva pròpia integració, credencials i certificats — feina considerable per a un projecte que ja viu dins l'ecosistema Expo.

**Expo Push Service** és un servei intermedi gratuït que actua de proxy entre la nostra API i APNs/FCM:

```
                  ┌───────────────────┐
                  │  Backend (Node)   │
                  └─────────┬─────────┘
                            │ POST /push/send
                            ▼
                  ┌───────────────────┐
                  │ Expo Push Service │
                  └────┬─────────┬────┘
                       │         │
                  ┌────▼───┐ ┌───▼────┐
                  │  APNs  │ │  FCM   │
                  │ (iOS)  │ │(Android)│
                  └────┬───┘ └───┬────┘
                       │         │
                       ▼         ▼
                    ┌────────────────┐
                    │  Dispositiu    │
                    └────────────────┘
```

A canvi, les nostres apps no envien ni reben tokens nadius (FCM/APNs); fan servir un **Expo Push Token** amb el format `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]` que identifica un dispositiu concret + la nostra app concreta. Aquest token és el que el mòbil envia al backend i el que el backend posa al camp `to` quan demana enviar una notificació.

L'avantatge d'aquesta arquitectura és que la part del backend és **un sol endpoint HTTP**: cap SDK, cap certificat, cap `google-services.json` ni `apns-key.p8`. L'inconvenient és que estem afegint un servei tercer al camí crític — però Expo el manté gratuïtament i és la pràctica recomanada al seu ecosistema.

### Server-Sent Events: streaming HTTP server→client

**SSE** és una tecnologia W3C estàndard per fer streaming **unidireccional** del servidor al client sobre HTTP. Funciona així:

- El client obre una connexió HTTP normal (GET) a un endpoint amb `Content-Type: text/event-stream`.
- El servidor manté la connexió oberta i escriu missatges amb un format simple (`event: nom\ndata: {...}\n\n`) cada vegada que té alguna cosa per dir.
- El navegador exposa l'API `EventSource` que parsega aquest format automàticament i dispara listeners.

Comparat amb WebSockets / Socket.io, SSE té tres virtuts importants per al nostre cas d'ús:

| | SSE | Socket.io |
|---|---|---|
| Direcció | Server→client només | Bidireccional |
| Protocol | HTTP estàndard | Protocol propi sobre WS |
| Reconnexió automàtica | **Sí, gratuïta** | Sí, configurable |
| Travessa proxies | Trivial (és HTTP) | Pot fallar |
| Llibreria al client | **Cap** (`EventSource` és nadiu) | `socket.io-client` |

Com que el dashboard admin **només rep esdeveniments** (no n'envia), no necessitem la bidireccionalitat de WebSockets. Triant SSE evitem una dependència i un protocol propietari, i obtenim reconnexió automàtica sense escriure-la nosaltres.

L'única limitació real d'`EventSource`: **no permet capçaleres personalitzades**, així que no podem enviar `Authorization: Bearer ...`. Aquí és on entra el sistema de tickets efímers (vegeu més avall).

---

## Visió general de l'arquitectura

L'esquema de la propagació d'un esdeveniment, de principi a fi, té aquest aspecte:

```
            [acció d'un usuari]
                    │
                    ▼
       ┌────────────────────────┐
       │  controller (REST)     │
       │  /reports/:id/transition │
       └─────────────┬──────────┘
                     │
                     ▼
       ┌────────────────────────┐
       │  reportService         │
       │  - valida XState       │
       │  - prisma.update       │
       └─────────────┬──────────┘
                     │   (després del commit)
                     ▼
       ┌────────────────────────┐
       │  NotificationService   │
       │  onReportTransitioned()│
       └──┬──────────┬─────────┬┘
          │          │         │
          ▼          ▼         ▼
     ┌────────┐  ┌──────┐  ┌─────────┐
     │ DB     │  │ Expo │  │ SSE hub │
     │ insert │  │ Push │  │ broad-  │
     │ notif. │  │ API  │  │ cast    │
     └────────┘  └───┬──┘  └────┬────┘
                     │          │
                     ▼          ▼
                 ┌──────┐   ┌────────┐
                 │ Móvil│   │ Admin  │
                 │ Push │   │ Web    │
                 └──────┘   └────────┘
```

Una sola crida (`onReportTransitioned`) acaba: persistint a la BD, enviant push al mòbil del destinatari i emetent un esdeveniment SSE als admins. Els tres canals comparteixen el mateix payload conceptual ("el report X ha canviat d'estat"), però cada un l'expressa al seu format natiu.

---

## Catàleg de mòduls i mètodes

Per facilitar la lectura, abans de la descripció en detall, aquí teniu un cop d'ull a TOT el que s'ha creat amb una frase per cada element:

### Backend

#### `services/expoPush.ts`
Capa fina sobre l'API HTTP de Expo Push Service.
- `sendPushBatch(messages)` — envia un lot de fins a 100 missatges a `/push/send` i retorna els tickets (acceptació d'encolat).
- `fetchReceipts(ids)` — consulta `/push/getReceipts` per saber el resultat real d'un enviament minuts després.
- `isValidExpoPushToken(token)` — regex que descarta tokens malformats abans de fer crides HTTP.

#### `services/sse.ts`
Hub en memòria de connexions SSE.
- `addClient(userId, role, res)` — registra un client nou, configura les capçaleres SSE, envia handshake i retorna una funció de cleanup.
- `broadcastToRole(role, event)` — escriu l'esdeveniment a tots els clients connectats amb el rol indicat.
- `getConnectedCount()` — utilitari opcional per a debug / mètriques.
- *(intern)* heartbeat cada 25 s perquè els proxies no tallin la connexió per inactivitat.

#### `services/streamTicket.ts`
Tickets efímers d'un sol ús per autenticar la connexió SSE sense exposar el JWT.
- `issueTicket(userId, role)` — genera 32 bytes aleatoris i els associa a un `{userId, role, expiresAt = ara+60s}`.
- `consumeTicket(ticket)` — valida i esborra el ticket; retorna les dades de l'usuari o `null` si invàlid/caducat.
- *(intern)* neteja periòdica dels tickets caducats no consumits.

#### `services/notification.ts` (NotificationService)
Punt únic d'orquestració de notificacions. **És el mòdul central de tot el sprint**.
- `onReportCreated(reportId)` — emet SSE als admins quan es crea una incidència.
- `onReportPriorityChanged(reportId, priority)` — emet SSE als admins quan un admin canvia la prioritat.
- `onReportTransitioned({...})` — la funció més complexa: persisteix notificació, envia push i emet SSE per a una transició d'estat. Decideix recipients en funció de l'event (`ASSIGN`, `REASSIGN`, `START`, `RESOLVE`, etc.).
- `onCommentAdded({...})` — persisteix notificació i envia push als implicats (autor del report + tècnic assignat), excloent l'autor del comentari. SSE als admins.
- `registerPushToken({userId, token, platform})` — upsert d'un Expo Push Token a la taula `push_tokens`.
- `unregisterPushToken(token)` — desactiva un token (al fer logout o quan Expo informa que està mort).
- `listNotifications(userId, options)` — historial in-app per al mòbil; ordena per data desc, opcional `unreadOnly`.
- `countUnreadNotifications(userId)` — comptador per a un badge de campana.
- `markNotificationRead(id, userId)` — marca una notificació com a llegida (filtrant per userId per evitar que un usuari marqui les d'un altre).
- `markAllNotificationsRead(userId)` — botó "marcar totes".
- *(intern)* `persistAndPush({...})` — primitiva de baix nivell: crea la fila a `notifications` i envia push als tokens actius del destinatari, desactivant tokens si Expo retorna `DeviceNotRegistered`.
- *(intern)* `notifyAdminsSse(event)` — wrapper amb captura d'errors sobre `broadcastToRole(ADMIN, ...)`.

#### `controllers/events.ts`
- `ticket(req, res)` — bescanvia el JWT validat pel middleware `authenticate` per un ticket efímer.
- `stream(req, res)` — accepta el ticket de la query, el consumeix i obre la connexió SSE.

#### `controllers/notification.ts`
- `registerToken(req, res)` — POST /tokens. Valida format del token i la plataforma.
- `unregisterToken(req, res)` — DELETE /tokens/:token.
- `list(req, res)` — GET /notifications, retorna l'historial i el comptador de no llegides.
- `markRead(req, res)` — PATCH /notifications/:id/read.
- `markAllRead(req, res)` — PATCH /notifications/read-all.

#### `routes/events.ts`
Munta `POST /api/events/ticket` (amb `authenticate`) i `GET /api/events/stream` (sense, perquè EventSource no envia headers).

#### `routes/notifications.ts`
Munta el grup `/api/notifications` amb `authenticate` per a totes les rutes.

#### Models nous a `prisma/schema.prisma`
- `enum NotificationType` — categories de notificació (`REPORT_ASSIGNED`, `REPORT_REASSIGNED`, `REPORT_UNASSIGNED`, `REPORT_STATE_CHANGED`).
- `model PushToken` — un token Expo per dispositiu, amb camp `active` per soft-delete.
- `model Notification` — historial persistent de notificacions enviades a un usuari.

### Frontend web (panel admin)

#### `api/events.ts`
- `requestStreamTicket()` — fa POST /api/events/ticket reutilitzant el JWT que axios injecta automàticament. Retorna l'string del ticket.

#### `hooks/useEventStream.ts`
- `useEventStream(enabled, onEvent)` — hook que demana ticket, obre `EventSource`, registra listeners per a cada tipus d'esdeveniment, i gestiona reconnexió manual quan la connexió cau (perquè el ticket ja ha estat consumit).
- `type DashboardEvent` — discriminated union amb tots els tipus d'esdeveniment que pot rebre el dashboard. Ha de coincidir amb el `SseEvent` del backend.

#### `hooks/liveEvents.ts`
- `emitLiveEvent(event)` — el `Layout` ho crida per redistribuir un esdeveniment SSE entre les pàgines.
- `useLiveEvent(type, handler)` — hook que les pàgines fan servir per subscriure's a un tipus concret d'esdeveniment.
- *(intern)* un `EventTarget` singleton que connecta emisor i subscriptors sense provocar re-renders globals.

#### Modificacions a pàgines existents
- `components/Layout.tsx` — afegit `useEventStream(...)` (la connexió s'obre un sol cop aquí).
- `pages/DashboardPage.tsx` — refactoritzat el fetch a una funció `refetch`, subscrita a `report.created` i `report.transitioned`.
- `pages/ReportsListPage.tsx` — `refetch` subscrit a `report.created`, `report.transitioned`, `report.priority_changed`.
- `pages/MapPage.tsx` — `refetch` subscrit a `report.created` i `report.transitioned` (markers / heatmap).
- `pages/ReportDetailPage.tsx` — refetch del report obert subscrit a `transitioned`, `priority_changed` i `comment_added`, **filtrant per `event.reportId === id`**.

### App mòbil

#### `api/notifications.ts`
- `registerPushToken(token, platform)` — POST /notifications/tokens. Cridat un cop l'usuari concedeix permís.
- `unregisterPushToken(token)` — DELETE /notifications/tokens/:token. Cridat al fer logout.
- `listNotifications(options)` — GET /notifications per a la pantalla d'inbox.
- `markNotificationRead(id)` / `markAllNotificationsRead()` — PATCH per als botons de la campana.

#### `hooks/usePushNotifications.ts`
- `usePushNotifications(userId)` — hook principal. Quan canvia l'`userId`, demana permisos, obté el token Expo i el registra al backend. Al primer muntatge registra també els dos listeners globals.
- `detachPushToken()` — funció (no hook) cridada des d'AuthContext en el logout per desactivar el token al backend abans d'esborrar el JWT.
- *(intern)* `Notifications.setNotificationHandler({...})` — configuració global perquè les notificacions es vegin també amb l'app oberta.
- *(intern)* `ensureAndroidChannel()` — crea el canal Android per defecte (Android 8+).
- *(intern)* `obtainPushToken()` — orquestra la petició de permisos i la crida a `getExpoPushTokenAsync`.

#### Modificacions a fitxers existents
- `app/_layout.tsx` — afegida la crida `usePushNotifications(user?.user_id ?? null)`.
- `src/context/AuthContext.tsx` — afegida la crida a `detachPushToken()` ABANS d'esborrar el JWT al logout.
- `app.json` — afegit el plugin `expo-notifications` amb icona i color de marca.
- `src/types/index.ts` — afegits `NotificationType` i `NotificationItem` per tipar respostes.

---

## Backend en detall

### 1. Models de dades — `prisma/schema.prisma`

S'han afegit dos models nous i un enum:

```prisma
enum NotificationType {
  REPORT_ASSIGNED
  REPORT_REASSIGNED
  REPORT_UNASSIGNED
  REPORT_STATE_CHANGED
}

model PushToken {
  id          String   @id @default(uuid())
  token       String   @unique
  platform    String   // 'ios' | 'android'
  active      Boolean  @default(true)
  userId      String
  user        User     @relation(...)
  createdAt   DateTime @default(now())
  lastSeenAt  DateTime @default(now())
}

model Notification {
  id          String           @id @default(uuid())
  type        NotificationType
  title       String
  body        String
  read        Boolean          @default(false)
  userId      String
  reportId    String?
  createdAt   DateTime         @default(now())
}
```

Decisions de disseny:

- **`PushToken` és una taula a part, no un camp del User**. Un usuari pot tenir múltiples dispositius (mòbil personal + tauleta) i cadascun té el seu token Expo. Modelar-ho com a 1-a-N permet enviar la notificació a tots els dispositius alhora i desactivar-los individualment quan Expo ens informi que algun ha caducat.
- **El camp `active` substitueix l'esborrat dur**. Quan Expo retorna `DeviceNotRegistered` (l'usuari ha desinstal·lat l'app), no esborrem la fila: la marquem `active=false`. Així conservem traça històrica per debugar i podem reactivar-la si l'usuari torna a instal·lar amb el mateix token.
- **`Notification` és el "historial" persistent del que ha passat**. El push és efímer: si el dispositiu està apagat es perd. Aquesta taula és el que mostraria una pantalla de "campana" / "novetats" dins l'app, i el que un client podria consultar amb `GET /api/notifications`. Té un índex `(userId, read, createdAt)` perquè la consulta típica ("dóna'm les meves notificacions, no llegides primer, ordenades per data") sigui eficient.
- **`reportId` és opcional**. Si en el futur afegim notificacions desvinculades d'una incidència (avisos del sistema, manteniment), ja queda obert.

#### Migració

S'ha aplicat la migració `20260509193823_add_notifications_and_push_tokens`. Per un detall que ja apareix en sprints anteriors (la columna `geography` PostGIS de `reports` no existeix a la shadow database de Prisma), la generació automàtica via `migrate dev` falla. La hem creat manualment amb el SQL equivalent i l'hem aplicat amb `prisma db execute`, registrant-la després al log de migracions amb `prisma migrate resolve --applied`. El resultat és exactament el mateix; només canvia el camí.

### 2. Client Expo Push API — `services/expoPush.ts`

Un mòdul mínim que parla amb dues URLs d'Expo. No fem servir l'SDK oficial `expo-server-sdk` perquè el nostre ús és senzill i evitem una dependència.

#### Tickets vs receipts: per què la diferència importa

Quan crides `/push/send`, Expo accepta el missatge i el posa a una cua interna; et retorna un ticket dient "rebut, t'ho processo". Que un ticket tingui `status: 'ok'` **no vol dir que la notificació hagi arribat al dispositiu** — només que Expo l'ha encolada i la intentarà entregar. Per saber el resultat real cal consultar el `getReceipts` amb l'`id` del ticket uns minuts més tard. És el receipt qui ens dirà "entregada", "el dispositiu està desregistrat", "Apple ha rebutjat el missatge", etc.

A la nostra implementació, el cas més important — `DeviceNotRegistered` — ja apareix immediatament al ticket en alguns errors, així que el detectem aviat. Per a una implementació industrial caldria un cron job que llegís els rebuts pendents i actualitzés tokens caducats; per al TFG, el mecanisme actual cobreix els casos visibles.

### 3. SSE Hub — `services/sse.ts`

És el "directori telefònic" dels admins connectats al dashboard. Manté un `Map<id, SseClient>` en memòria amb totes les connexions vives. Configura les capçaleres SSE estàndard (`text/event-stream`, `Connection: keep-alive`, `Cache-Control: no-cache`, `X-Accel-Buffering: no` perquè nginx no faci buffering).

#### Heartbeat

Cada 25 segons emetem una línia de comentari (`: heartbeat ...\n\n`) a tots els clients. És un truc senzill però necessari: si la connexió queda massa estona inactiva, alguns proxies (nginx, els load balancers cloud) la tallen. El comentari és invisible al client (`EventSource` l'ignora) però manté el túnel obert.

#### Per què en memòria i no en Redis

Aquesta solució funciona perfectament mentre tinguem **una sola instància del backend**. Si en algun moment escalem horitzontalment a N rèpliques, dues d'elles no compartirien el Map i un esdeveniment emès per la rèplica A no arribaria als admins connectats a la rèplica B. La solució estàndard és substituir el Map en memòria per un canal Redis pub/sub. Per al TFG, una sola instància cobreix l'escala demostrable; deixem la migració documentada com a treball futur.

### 4. Tickets efímers per al stream — `services/streamTicket.ts`

Aquest és el component més interessant des del punt de vista de seguretat.

**El problema**: l'API `EventSource` del navegador **no admet capçaleres HTTP personalitzades**. No podem enviar `Authorization: Bearer <jwt>` quan obrim la connexió SSE. Tres solucions possibles:
- (A) JWT directament al query param. Més simple, però **els query params apareixen als logs del servidor i es propaguen via `Referer`**. Si un proxy o un atac log-poisoning els captura, el JWT (vàlid hores o dies) està compromès.
- (B) Usar `fetch` amb `ReadableStream` en lloc d'`EventSource`. Permet headers, però perdem la reconnexió automàtica i hem d'escriure'ns el parser SSE.
- (C) Token efímer d'un sol ús a la query.

Hem triat **(C)**, que és el patró estàndard en sistemes professionals. El flux:

```
1. Client (admin autenticat amb JWT)
        │ POST /api/events/ticket  (header Authorization: Bearer <jwt>)
        ▼
2. Backend: valida JWT, genera token aleatori de 32 bytes,
   l'associa a {userId, role, expiresAt = ara+60s} dins un Map
        │ resposta: { ticket: "abc123...", expiresInSeconds: 60 }
        ▼
3. Client obre EventSource("/api/events/stream?ticket=abc123...")
        │
        ▼
4. Backend (endpoint GET /stream): consumeix el ticket
   (l'esborra del Map; un sol ús), comprova que no hagi caducat,
   accepta o tanca la connexió.
```

Garanties que ofereix:

- **El JWT mai viatja a la query string**, només al header `Authorization` del POST inicial.
- Si un proxy o un log captura el ticket, **és inservible**: ja s'ha consumit (un sol ús) o caduca al minut.
- Si l'atacant fa replay del POST per obtenir un ticket nou, ho veuríem perquè requereix el JWT — torna a ser el problema d'origen, no el problema del SSE.

Aquesta és la mateixa filosofia que utilitzen serveis com **AWS Cognito** per autoritzar connexions WebSocket: bescanviar credencials de llarga vida per credencials de curta vida just abans d'establir el túnel.

### 5. NotificationService — `services/notification.ts`

És el cor de tot el sistema. Tothom que vol enviar una notificació passa per aquí. La capa pública parla **el llenguatge del domini** (no diu "envia push a l'usuari X", diu "ha passat un esdeveniment Y"). El servei decideix qui ha de saber-ho i com.

Detalls concrets de cada esdeveniment:

- **`onReportCreated`**: per requisit de producte, l'autor del report no s'auto-notifica. Només SSE als admins.
- **`onReportTransitioned`**: la més complexa. Decideix recipients en funció de l'event XState i de qui era assignat abans:
    - L'**autor del report** rep notificació en **qualsevol** transició (ASSIGN, START, REASSIGN, RESOLVE, REJECT, CLOSE). Aquesta és una regla deliberada del producte: l'estudiant ha d'estar al corrent de tot el cicle de vida de la seva incidència.
    - Si l'event és `ASSIGN`, el nou tècnic rep "Nova tasca assignada".
    - Si l'event és `REASSIGN`, el tècnic anterior rep "Tasca retirada" i el nou (si n'hi ha) "Tasca reassignada a tu".
    - **Regla universal**: l'actor (qui ha fet la transició) mai es notifica a si mateix. Aquesta regla és el que evita que un tècnic rebi push de la seva pròpia acció `START`, per exemple.
- **`onCommentAdded`**: notifica el creador del report i el tècnic assignat — exclou l'autor del comentari. Si l'autor és el mateix estudiant, només notifica el tècnic; si és el tècnic, només l'estudiant; si és un admin, els dos.

#### Per què `Promise.allSettled` i no `await` directe

Tot el que sigui xarxa externa (Expo Push, SSE) pot fallar per causes externes a la nostra request: Expo està caigut, un client web ha tancat la pestanya entre l'`emit` i el `write`, etc. Si hi posem `await` directe sense gestió, una transició d'estat fallaria perquè una notificació secundària no s'ha pogut entregar — exactament el que **no** volem. Resoldre amb `Promise.allSettled` significa: "intenta-ho tot, però no aturis res si una branca falla".

A més, les crides al servei es fan amb `void notificationService.onReportTransitioned(...)` (no `await`) **després del commit de Prisma**: així la response HTTP del controlador es retorna a l'usuari sense esperar a que Expo respongui. Si Expo tarda 800 ms, el tècnic que ha clicat "iniciar" no se n'adona.

### 6. Endpoints REST

Tres rutes noves al backend:

#### `/api/events`

- `POST /api/events/ticket` (autenticat amb JWT, només ADMIN): emet un ticket efímer.
- `GET /api/events/stream?ticket=...`: consumeix el ticket i obre el stream SSE. Aquesta ruta no passa pel middleware `authenticate` perquè EventSource no pot enviar headers; l'auth es fa via ticket.

#### `/api/notifications` (totes autenticades)

- `POST /tokens` `{ token, platform }`: registra (o reactiva) un Expo Push Token.
- `DELETE /tokens/:token`: desactiva un token (al fer logout al mòbil).
- `GET /` `?unreadOnly=true&limit=50`: llista les notificacions de l'usuari, amb comptador de no llegides.
- `PATCH /:id/read`: marca una notificació concreta com a llegida.
- `PATCH /read-all`: marca totes les no llegides com a llegides.

### 7. Integració amb el flux existent

El `NotificationService` és invocat des de `services/report.ts` en quatre punts:

- `createReport()` → `onReportCreated(reportId)`
- `updateReportPriority()` → `onReportPriorityChanged(reportId, priority)`
- `transitionReport()` → `onReportTransitioned({...})`. Aquest és el cas més delicat: cal capturar l'estat i l'`assignedToId` ANTERIORS abans de fer l'update, perquè el `previousAssigneeId` és necessari per emetre notificacions correctes a una `REASSIGN` (sabem a qui se li ha "retirat" la tasca).
- `addComment()` → `onCommentAdded({...})`. També cal capturar el títol del report per al cos del missatge.

Cap d'aquestes crides té `await`: són tipus `void` i no bloquegen la response HTTP.

---

## Frontend web (panel admin) en detall

### 1. Hook `useEventStream` — `hooks/useEventStream.ts`

Encapsula tot el cicle de vida de la connexió SSE:

1. Demana un ticket via `requestStreamTicket()` (POST /api/events/ticket).
2. Obre `new EventSource('/api/events/stream?ticket=...')`. Com que Vite proxa `/api` al backend, no cal hardcoder host.
3. Registra listeners per a cada tipus d'esdeveniment (`report.created`, `report.transitioned`, etc.). Han de coincidir noms-per-noms amb el que emet el backend.
4. Si la connexió es trenca, l'auto-reconnexió nadiua d'`EventSource` no ens serveix perquè el ticket ja s'ha consumit. Ho gestionem manualment: en `onerror`, tanquem, esperem 3 s i tornem a fer tot el flux (ticket nou + connexió nova).

Subtilesa important: el handler que rep el component es passa per **ref**, no per dependència de l'`useEffect`. Si el passéssim com a dependència, cada re-render del component (canvi de filtre, etc.) tancaria i tornaria a obrir la connexió. Amb el ref, el handler es manté actualitzat sense provocar reconnexió.

### 2. Bus d'esdeveniments interns — `hooks/liveEvents.ts`

Una capa molt fina entre `useEventStream` (que s'invoca un sol cop al `Layout`) i les pàgines individuals (Dashboard, Reports, Map...) que volen reaccionar als esdeveniments. Internament és un `EventTarget` global més dos helpers.

Per què un `EventTarget` i no un `Context` de React: les pàgines que reaccionen (refrescant dades) no necessiten re-renderitzar quan arriba un esdeveniment — només cridar una funció. Un Context provocaria re-renders globals innecessaris.

### 3. Cablejat al `Layout`

Al `Layout`, una sola línia connecta tot:

```tsx
useEventStream(user?.role === 'ADMIN', (event) => emitLiveEvent(event));
```

A partir d'aquí, qualsevol pàgina pot subscriure's amb una línia:

```tsx
useLiveEvent('report.transitioned', refetch);
```

### 4. Pàgines cablejades

- **DashboardPage**: refresca les agregacions quan arriben `report.created` i `report.transitioned` (que afecten estat i timeline). No reacciona a comentaris ni canvis de prioritat (no afecten les mètriques mostrades).
- **ReportsListPage**: refresca la llista a `created`, `transitioned` i `priority_changed`.
- **MapPage**: refresca markers/heatmap a `created` i `transitioned`.
- **ReportDetailPage**: refresca el report **només si** l'esdeveniment és sobre el report obert (`event.reportId === id`). Reacciona a `transitioned`, `priority_changed` i `comment_added`. Aquesta és la pantalla on el temps real és més visible: si dos admins miren el mateix report i un l'assigna, l'altre veu el canvi sense recarregar.

---

## App mòbil en detall

### 1. Dependències i configuració

S'han instal·lat dues llibreries via `expo install`:
- `expo-notifications`: permisos, gestió de tokens i listeners.
- `expo-device`: detecta si l'aparell és físic. Push notifications només funcionen en dispositius reals (excepte algun cas amb Android i FCM al simulador).

A `app.json` s'hi ha afegit el plugin `expo-notifications` amb el color de marca i la icona. Cap més canvi de permisos: Android i iOS demanen permís dinàmicament a la primera invocació.

### 2. Hook `usePushNotifications` — `hooks/usePushNotifications.ts`

És el punt d'entrada únic per al cicle de vida de les push al mòbil. Té tres responsabilitats:

#### a) Configuració global

```ts
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
```

Per defecte, `expo-notifications` **no mostra** la notificació si arriba amb l'app oberta — assumeix que la pròpia UI ja reflecteix el canvi. Aquí forcem mostrar-la perquè per al nostre cas (canvi d'estat a una incidència que potser l'usuari no està mirant) sí que volem que aparegui el banner.

#### b) Canal Android

Android 8+ requereix que cada notificació estigui associada a un "canal" amb importància, vibració i color. Creem un canal `default` global. Si en el futur volem agrupar (per exemple, separar "tasques noves" de "comentaris"), n'afegim més.

#### c) Obtenció i registre del token

Quan canvia l'`userId` (login), executem aquest flux:

1. Comprovem `Device.isDevice` — si som a un emulador, sortim sense error.
2. Demanem permisos amb `getPermissionsAsync()` + `requestPermissionsAsync()`.
3. Cridem `Notifications.getExpoPushTokenAsync({ projectId })`. Internament:
    - El SDK demana un token a Expo Push Service.
    - Expo li dóna un `ExponentPushToken[xxx]` lligat al `projectId` de la nostra app + l'identificador del dispositiu.
4. Enviem el token al backend amb `POST /notifications/tokens` (axios ja injecta el JWT).

#### d) Listeners

Dos listeners globals:
- `addNotificationReceivedListener`: dispara quan arriba una notif amb l'app **en primer pla**. Per ara només loguegem; aquí podrem actualitzar un badge global o disparar un toast custom.
- `addNotificationResponseReceivedListener`: dispara quan l'usuari **tapeja** una notificació, indistintament de si l'app estava oberta, en background o tancada. Llegim `notification.request.content.data.reportId` i fem `router.push('/incident/[id]')` — això és el deep-link clàssic de qualsevol app mòbil.

### 3. Logout

Al `AuthContext.logout()` s'ha afegit una crida a `detachPushToken()` **abans** d'esborrar el JWT (perquè la crida `DELETE /notifications/tokens/:token` requereix autenticació). Si la crida falla (sense xarxa, etc.), no aturem el logout — desactivar el token és una operació best-effort.

Per què cal: si l'usuari A fa logout i l'usuari B fa login al mateix dispositiu, sense aquest pas el dispositiu rebria les notificacions destinades a A.

---

## Flux complet, exemple end-to-end

Imaginem el cas d'**un admin que assigna una incidència oberta a un tècnic**:

1. L'admin (al panell web) selecciona el tècnic i prem "Assignar".
2. El frontend fa `PATCH /api/reports/:id/transition` amb `{ event: 'ASSIGN', assignedToId: <userId> }`.
3. Al controlador del backend, `transitionReport()` valida l'event amb XState, fa l'`UPDATE` a la BD i, després del commit, crida `notificationService.onReportTransitioned({...})`.
4. `NotificationService`:
    - Emet `broadcastToRole('ADMIN', { type: 'report.transitioned', from: 'OPEN', to: 'ASSIGNED', ... })`. Tots els admins connectats al stream reben el missatge.
    - Crea una fila a `notifications` per al tècnic ("Nova tasca assignada").
    - Crea una fila a `notifications` per a l'estudiant autor ("S'ha assignat la teva incidència").
    - Cerca els tokens actius del tècnic i de l'estudiant; per cadascun, fa una crida `POST /push/send` a Expo amb el missatge corresponent.
5. **Tècnic**: el seu mòbil mostra el banner "Nova tasca assignada — T'han assignat: Fanal trencat al carrer Gran". Tapeja → l'app obre `/incident/:id`.
6. **Estudiant**: el seu mòbil mostra "S'ha assignat la teva incidència — Un tècnic s'encarregarà de: Fanal trencat al carrer Gran".
7. **Admin (un altre, no el que ha fet l'acció)**: el seu dashboard veu en temps real que l'incidència ha desaparegut de la columna "Obertes" i ha aparegut a "Assignades". Si tenia el detall del report obert, els camps `state` i `assignedTo` s'han actualitzat sols.

Tot això a partir d'**una sola request HTTP** de l'admin original, amb un únic punt d'orquestració (`NotificationService.onReportTransitioned`) que decideix recipients i canals.

---

## Decisions i compromisos

- **SSE en lloc de Socket.io**: triat perquè el dashboard només rep esdeveniments. SSE evita una dependència, és HTTP estàndard i ja porta reconnexió automàtica. Documentat com a punt fort de cara a la defensa: una decisió d'arquitectura justificada amb criteri (mínim privilegi tecnològic), no per costum.
- **Tickets efímers en lloc de JWT a la query**: el JWT és sensible i de llarga durada. El ticket és d'un sol ús i caduca al minut. La complexitat afegida (un endpoint més) val la pena per la garantia de seguretat.
- **Notificacions persistides + push**: el push és efímer. Si el dispositiu està apagat o sense xarxa, la notificació es perd. Tenir la taula `notifications` ens permet (a) construir una pantalla de campana / inbox a futur, (b) auditar què s'ha enviat, (c) marcar com a llegit independentment de si el push s'ha mostrat.
- **NotificationService com a únic punt d'orquestració**: els controladors no diuen "envia push al user X"; diuen "ha passat un esdeveniment de domini Y". Això vol dir que afegir un quart canal (correu electrònic, per exemple) o canviar el text d'un missatge no toca cap controlador. Tota la lògica de "qui ha de saber què" està concentrada en un sol fitxer.
- **Sense cua de missatges (Redis/BullMQ)**: per al volum del TFG, `Promise.allSettled` directament a la request és suficient. Una cua és la peça que afegiríem si Expo comencés a fer servir minuts en respondre o si volguéssim retry automàtic. Documentat com a millora futura.
- **Sense processador de receipts diferits**: actualment només reaccionem als errors immediats que retorna `sendPushBatch`. Per a una implementació industrial caldria un cron que cada 15 min llegís els rebuts pendents i actualitzés tokens caducats. És feina de polish per a un sprint posterior.
- **EventTarget en memòria al SSE hub**: simple i suficient mentre el backend sigui mono-instància. Si escalem horitzontalment cal substituir-ho per Redis pub/sub. Documentat.

---

## Lliçons apreses

- **EventSource és antic però brillant per a aquest cas**. La gent reflexa anar a WebSockets per "real-time" sense pensar si el cas és bidireccional. SSE té anys i resol aquest problema sense hipèrbole.
- **El JWT no hauria d'aparèixer mai a un query string**. Costa temps adonar-se'n perquè "funciona" igualment, però és una pràctica que es queda als logs i al `Referer` per sempre. El patró del ticket efímer és una solució neta a un problema petit.
- **Centralitzar la lògica de notificacions val la complexitat inicial**. La temptació era posar `prisma.notification.create` allà mateix on transiciona el report. Hauria deixat el codi escampat, amb regles diferents en cada lloc i sense un punt clar on afegir més canals al futur.
- **L'asincronia "fora del camí crític" és una tècnica subtil però decisiva**. La diferència entre `await notificationService.onX(...)` i `void notificationService.onX(...)` són 100 ms invisibles a l'usuari final si tot va bé, però si Expo s'ha penjat són 30 segons d'espera o un timeout. Decidir-ho conscientment és part de pensar en latency budgets.
- **Push notifications són una pell de plàtan amb tres capes**. APNs, FCM i Expo Push Service. Sense Expo, la integració hauria sigut un sprint sencer per ella sola. Aquí en una tarda hem tingut un sistema funcional. Aquest tipus de "outsource a un servei especialitzat" és una decisió que cal saber justificar.

---

# Sprint 6: Auto-classificació IA i Auto-assignació

## Resum

En aquest sprint s'han incorporat dues funcionalitats que tanquen el cicle complet de gestió d'incidències sense intervenció manual:

1. **Auto-classificació IA**: cada nova incidència passa per un graf orquestrat amb **LangGraph** que crida **Google Gemini 2.0 Flash** amb el text + la imatge inicial i decideix automàticament la `category` correcta, la `priority` apropiada i un resum d'una línia. El resultat sobreescriu la categoria triada per l'usuari (l'IA actua com a revisor) i activa per primera vegada el camp `priority`, que fins ara es quedava sempre al default `MEDIUM`.

2. **Auto-assignació en lot**: el panell admin pot seleccionar múltiples incidències OBERTES i prémer un sol botó perquè el sistema les reparteixi entre els tècnics seguint un algoritme de matching per `workCategory` + balanceig de càrrega.

Les dues peces queden naturalment connectades: l'IA omple la categoria → l'auto-assignació la fa servir per triar tècnic. Junts, el flux complet d'una incidència ("alumne reporta → categoritzada → assignada a tècnic adient") pot passar **sense que cap admin hagi tocat res**, en uns 5 segons des de la creació.

---

## Context tecnològic

### LangGraph i el patró d'orquestració

**LangGraph** és la llibreria d'orquestració d'agents de l'ecosistema LangChain. La diferència amb LangChain a seques és que LangGraph modela el sistema com un **graf d'estats** amb nodes (passos) i arestes (transicions, possiblement condicionals). Això el fa adequat per a:

- Fluxos amb branching condicional ("si la imatge no existeix, salta el node de visió").
- Loops d'iteració ("torna a generar fins que validi").
- Múltiples agents que comparteixen un estat global.
- Observabilitat: cada pas és un node anomenat, no una funció anònima dins d'una callback.

Per al nostre cas, hem dissenyat un graf molt senzill (2 nodes lineals) després de descartar deliberadament una arquitectura multi-agent més complexa. Justificació detallada a la secció "Decisions i compromisos".

### Gemini 2.0 Flash

És el model multimodal de Google amb generosos límits gratuïts a la seva API (Google AI Studio):

- **15 RPM** (requests per minut), **1500 RPD** (requests per dia) al nivell gratuït.
- Acepta **text + imatge** al mateix prompt — fa servir cross-attention multimodal nativament.
- Latència típica: 1-2 segons per crida amb imatge.
- **Sense targeta de crèdit** per al free tier — només compte de Google.
- Format de resposta: text lliure (li demanem JSON al system prompt).

És, ara mateix, l'únic model **gratuït + multimodal + via endpoint** que cobreix els tres requisits del sprint.

---

## Visió general de l'arquitectura

```
1. CREATE
        Alumne crea report
            │
            ▼
       prisma.create + setTimeout(3s)
            │
            ▼ ───────────────────────────────┐
                                              │
                                              ▼
                                  ┌─────────────────────────┐
                                  │   classifyReport()      │
                                  │                         │
                                  │  ┌───────────────────┐  │
                                  │  │ LangGraph         │  │
                                  │  │ ┌─────────────┐   │  │
                                  │  │ │ Node 1: LLM │   │  │
                                  │  │ │ Gemini 2.0  │   │  │
                                  │  │ │ Flash       │   │  │
                                  │  │ └──────┬──────┘   │  │
                                  │  │        ▼          │  │
                                  │  │ ┌─────────────┐   │  │
                                  │  │ │ Node 2:     │   │  │
                                  │  │ │ Rules       │   │  │
                                  │  │ │ (validate + │   │  │
                                  │  │ │ normalize)  │   │  │
                                  │  │ └──────┬──────┘   │  │
                                  │  └─────────┼─────────┘  │
                                  │            ▼            │
                                  │   prisma.update         │
                                  │   broadcast SSE         │
                                  └─────────────────────────┘
                                              │
                                              ▼
                                  Admin dashboard refresca
                                  (categoria + prioritat
                                   + aiSummary visibles)

2. AUTO-ASSIGN
        Admin selecciona [r1, r2, r3] + clic "Auto-assignar"
            │
            ▼
       autoAssignReports({ reportIds, actorId })
            │
            ▼
       Per cada report en ordre:
         filter techs amb workCategory == r.category
           │
           ├─ no candidats → skip + raó
           │
           └─ sort per (load asc, lastAssignedAt asc)
                  │
                  ▼
              transitionReport(ASSIGN)  ← XState valida
                  │
                  ▼
              load[chosen] += 1
              SSE notifica admins
              Push notif al tècnic
            │
            ▼
       { assigned: [...], skipped: [...] } al frontend
```

---

## Catàleg de mòduls i mètodes

### Backend — Classificació IA

#### `services/classification/llm.ts`
Crida directa a Gemini Flash via LangChain.
- `classifyWithGemini({title, description, userCategory, imageUrl})` — construeix el system prompt amb les categories i prioritats vàlides, envelopa la imatge en format multimodal (`{type: 'image_url', image_url: ...}`) i demana JSON estricte. Retorna el text cru perquè el node de regles el normalitzi.
- *(intern)* `buildSystemPrompt()` — genera el prompt amb totes les categories i pistes humanes.
- *(intern)* `CATEGORY_HINTS` i `PRIORITY_HINTS` — taules amb descripció breu de cada enum, donades al model perquè l'encerti millor.

#### `services/classification/rules.ts`
Capa determinista que normalitza la sortida del LLM.
- `parseAndValidate(raw)` — parseja el JSON, normalitza categoria/prioritat al whitelist d'enums, retalla el resum a 100 caràcters. Si el JSON no parseja, retorna defaults segurs (`OTHER` / `MEDIUM`).
- *(intern)* `stripMarkdown(raw)` — treu els blocs ```` ```json ... ``` ```` que Gemini afegeix de vegades.
- *(intern)* `normalizeCategory`, `normalizePriority`, `normalizeSummary` — sanitització camp per camp.

#### `services/classification/graph.ts`
Definició del graf LangGraph.
- `runClassificationGraph(input)` — API pública. Compila i executa el graf amb les dades del report; retorna l'objecte `ClassificationOutput` final.
- *(intern)* `ClassificationState` — annotation de l'estat compartit entre nodes (input + raw + result).
- *(intern)* `llmNode` — wrapper sobre `classifyWithGemini`.
- *(intern)* `rulesNode` — wrapper sobre `parseAndValidate`.
- *(intern)* la compilació del graf es fa una sola vegada al carregar el mòdul.

#### `services/classification/index.ts`
Punt d'entrada únic.
- `classifyReport(reportId)` — fire-and-forget: llegeix el report (incloent imatge `INITIAL`), executa el graf, escriu `category`, `priority`, `aiSummary`, `aiClassifiedAt` a la BD, emet SSE `report.classified`. Captura tots els errors internament — un fallada de Gemini mai propaga al flux principal.

### Backend — Auto-assignació

#### `services/autoAssign.ts`
- `autoAssignReports({reportIds, actorId})` — l'algoritme. Carrega tècnics elegibles (rol TECHNICAL, actius, amb `workCategory != null`), calcula càrrega actual i les coordenades de les incidències actives de cadascun, itera els reports en ordre i n'assigna un per un. Dins de cada categoria, ordena els candidats per **càrrega ascendent**, després per **proximitat** (distància a la incidència activa més propera del tècnic) i finalment per round-robin. Manté un Map en memòria de càrrega i ubicacions que actualitza incrementalment perquè el següent report del lot no torni a anar al mateix tècnic i tingui en compte la feina just assignada. Cridat `transitionReport(ASSIGN)` per a cada assignació exitosa, així mantenim la integritat de la màquina d'estats XState. Retorna `{assigned: [...], skipped: [...]}` amb raons concretes.
- `haversineMeters(a, b)` / `nearestDistanceMeters(target, techLocations)` *(interns)* — càlcul de distància (haversine, metres WGS84) i distància del report a la incidència activa més propera del tècnic, usats per al desempat per proximitat.
- `interface AutoAssignResult` — exportada perquè el frontend tipi la resposta.

#### `controllers/autoAssign.ts`
- `autoAssign(req, res)` — valida que `reportIds` sigui un array no buit de strings (límit defensiu de 50 per crida), crida el servei i retorna el resultat.

#### Modificacions a fitxers existents
- `services/sse.ts` — afegit `report.classified` al type union `SseEvent`.
- `services/report.ts` — `createReport` dispara `classifyReport` amb `setTimeout(3000)` (perquè el mòbil tingui temps de pujar la imatge inicial).
- `routes/reports.ts` — afegit `POST /reports/auto-assign` (ABANS de `/:id` perquè Express no l'interpreti com a id).
- `prisma/schema.prisma` — afegits camps `aiSummary` (String?) i `aiClassifiedAt` (DateTime?) al model `Report`.
- `config/env.ts` — afegida `GEMINI_API_KEY`. Si falta, només avís a la consola; la classificació es desactiva silenciosament i la resta de l'app funciona normalment.

### Frontend web

#### `api/reports.ts`
- `autoAssignReports(reportIds)` — POST `/reports/auto-assign`. Retorna `AutoAssignResult` amb `assigned[]` i `skipped[]`.

#### Modificacions a `pages/ReportsListPage.tsx`
- **Multi-selecció**: `selectedIds: Set<string>` amb checkboxes per fila. Només es poden seleccionar reports amb `state === 'OPEN'`; els altres es renderitzen amb el checkbox deshabilitat.
- **Header checkbox**: tri-state "select all visible OPEN".
- **Botó "Auto-assignar (N)"**: apareix només quan hi ha selecció. Mostra spinner durant la crida.
- **Sincronització auto**: quan canvia la llista (nous filtres, refresc SSE), neteja les seleccions que ja no són visibles.
- **Modal de resultats**: després d'auto-assignar, mostra `assigned` (verd) i `skipped` (taronja) amb les raons.
- **Visualització aiSummary**: subtítol indigo amb icona ✨ sota el títol del report a la taula.
- **Listener SSE**: subscrit a `report.classified` per refrescar la llista quan l'IA acaba.

#### Modificacions a `pages/ReportDetailPage.tsx`
- **Badge "Classificat per IA"**: quan `aiClassifiedAt != null`. Tooltip amb la data exacta.
- **Card "Resum IA"**: dins de la card de descripció, fons indigo, mostra `aiSummary`.
- **Listener SSE**: subscrit a `report.classified` filtrant per id.

#### Modificacions a `hooks/useEventStream.ts`
- Afegit `report.classified` al type union i al `addEventListener`.

#### Modificacions a `types/index.ts`
- Afegits `aiSummary?` i `aiClassifiedAt?` al `Report`.

### App mòbil

#### Modificacions a `src/types/index.ts`
- Afegits `aiSummary?` i `aiClassifiedAt?` al `Report` perquè quan el mòbil refresqui un detall (per exemple després d'una notificació), els tipus quadrin amb el que retorna el backend.

---

## Backend en detall

### 1. Modelat dels camps IA

S'han afegit dues columnes a la taula `reports`:

```prisma
aiSummary      String?
aiClassifiedAt DateTime?
```

Decisions:
- **Sobreescrivim `category` i `priority` directes** (no creem `aiCategory` / `aiPriority` separats). Un sol source of truth, més simple. La traçabilitat ve via `aiClassifiedAt`: si està posat, sabem que els valors van ser determinats per IA; si és null, els va triar l'usuari (o el sistema no l'ha pogut classificar).
- **`aiSummary` és opcional**: en un report sense imatge i amb descripció molt curta, l'IA pot retornar resum buit. Si és null o `''`, el frontend simplement no el mostra.
- **Sense camp `confidence`**: vam decidir auto-aplicar sempre, sense llindar de revisió humana. Afegir `confidence` sense que serveixi seria soroll.

### 2. Per què LangGraph quan només tenim 2 nodes lineals

Sincerament, un graf de 2 nodes lineals podria ser perfectament una funció:

```ts
const result = parseAndValidate(await classifyWithGemini(input));
```

Hem optat per LangGraph igualment per dues raons concretes:

- **Extensibilitat real**: si en el futur volem afegir un node "router" inicial que decideixi si val la pena cridar Gemini (descripcions ambigües molt curtes, per exemple), o un node de "fallback" amb un model més barat quan Gemini no respon, ja tenim la infraestructura. Reescriure quan toqui hauria portat més temps que tenir-ho llest des d'ara.
- **Observabilitat**: LangGraph s'integra natiu amb LangSmith (la plataforma de tracing de LangChain). Quan vulguem mesurar precisió a un dataset etiquetat o debugar una classificació concreta, els passos ja queden anomenats i traçables.

És sobre-enginyeria petita, sí, però controlada i amb justificació. Documentat com a tal.

### 3. El system prompt de Gemini

Decisions clau del prompt:

- **Llistem totes les categories AMB descripció humana**, no només els noms enum. Sense la pista "LIGHTING: enllumenat públic, fanals, làmpades" el model encerta menys.
- **Demanem JSON estricte** sense markdown ni text al voltant. De totes maneres, el node de regles té un `stripMarkdown` defensiu perquè Gemini de vegades incompleix.
- **Donem la categoria de l'usuari com a hint**, no com a ordre. Instruccions explícites: "si és coherent, mantén-la; si la imatge mostra una altra cosa, sobreescriu-la". Així respectem la intuïció humana però permetem la correcció.
- **Tone temperature 0.1**: volem classificacions consistents, no creatives. Si li passes el mateix report dues vegades, ha de decidir el mateix.

### 4. Per què `setTimeout(3000)` abans de classificar

Hi ha un problema temporal: el mòbil crea el report en una crida HTTP (`POST /reports`) i puja la imatge en una segona crida (`POST /reports/:id/images`). Si disparem la classificació immediatament al `createReport`, l'IA classifica només amb text — perd la informació visual.

Vam considerar tres alternatives:

| Opció | Inconvenient |
|---|---|
| Classificar només quan arribi la imatge | Reports sense imatge mai es classifiquen |
| Classificar a `createReport` AMB segona passada quan arribi imatge | 2 crides Gemini per report, doble cuota |
| Delay de 3s post-create | "Hacky", però funciona en el 99% dels casos |

Hem escollit la 3a com a compromís pragmàtic. Documentat com a deute tècnic; si en producció apareguessin casos on el mòbil tarda més de 3s a pujar imatge, refactor a opció 1 + fallback al cron job per a reports vells sense classificar.

### 5. Algoritme d'auto-assignació

Dins de cada categoria, els candidats s'ordenen per **tres criteris en cascada**:

```ts
ranked.sort((a, b) => {
  if (a.tech.load !== b.tech.load) return a.tech.load - b.tech.load;       // 1. càrrega
  if (a.distance !== b.distance) return a.distance - b.distance;           // 2. proximitat
  return a.tech.lastAssignedAt - b.tech.lastAssignedAt;                    // 3. round-robin
});
```

**Criteri 1 — càrrega ascendent (principal).** La part clau és l'**actualització incremental de càrrega**:

```ts
chosen.load += 1;             // ← clau: actualitzem en memòria després d'assignar
chosen.locations.push(target); // ← també la ubicació, per al desempat de proximitat dins del lot
```

Sense aquest `chosen.load += 1`, si seleccionessis 5 reports de la mateixa categoria, **els 5 anirien al tècnic amb menys càrrega inicial**. Amb la actualització incremental, cada report veu la càrrega ja modificada pels anteriors del mateix lot, i el repartiment és equitatiu.

**Criteri 2 — proximitat ascendent (desempat per ubicació).** Quan dos tècnics tenen la **mateixa càrrega**, s'assigna al que ja té una incidència activa **més a prop** de la nova. Un tècnic no té una ubicació fixa, així que la seva proximitat es deriva de les coordenades (`latitude`/`longitude`) de les incidències actives que ja té assignades: es calcula la distància (haversine, en metres) del report a la **incidència activa més propera** del tècnic (`nearestDistanceMeters`). Així s'agrupen els desplaçaments per zona — si un tècnic ja treballa en aquell racó del campus, té sentit que també s'encarregui de la nova incidència veïna.

Una propietat elegant d'aquest disseny: la proximitat **només** decideix entre tècnics amb la mateixa càrrega **> 0**, i tot tècnic amb càrrega > 0 té com a mínim una incidència per mesurar la distància. Els tècnics sense feina (càrrega 0, sense ubicació de referència) ja guanyen abans pel criteri principal de càrrega, de manera que no cal cap regla especial per al cas "tècnic sense incidències". A més, dins d'un mateix lot, la ubicació de cada incidència acabada d'assignar s'afegeix a la llista del tècnic (`chosen.locations.push(target)`), perquè les incidències següents del lot que caiguin a la mateixa zona també el considerin "proper".

**Criteri 3 — `lastAssignedAt` (round-robin final).** Si encara hi ha empat (mateixa càrrega i mateixa proximitat), dóna prioritat al tècnic que fa més temps que no rep res. És un round-robin suau que evita que el primer per ordre sempre rebi els empats.

> **Nota d'escala**: el desempat per proximitat es calcula en JavaScript sobre els camps `latitude`/`longitude`, no amb PostGIS. Per a l'escala d'un campus i lots de 5–20 incidències és perfectament eficient. Si el sistema escalés a milers d'incidències actives per tècnic, el natural seria moure el càlcul a una query PostGIS (`ST_Distance` sobre la columna `location`), coherent amb l'ús de PostGIS previst per a futures consultes espacials.

### 6. Per què crida `transitionReport` i no fa l'`UPDATE` directe

Tot i que des d'aquí podríem fer `prisma.report.update({ assignedToId, state: 'ASSIGNED' })` directament, fem servir `transitionReport(ASSIGN)`. Així:

- La màquina d'estats XState valida la transició (només es pot ASSIGN des d'OPEN).
- Es disparen les notificacions push del Sprint 5 (push al tècnic).
- L'event SSE `report.transitioned` arriba als admins (refrescant els altres dashboards oberts).
- Si aquesta lògica creix en el futur (per exemple, audit log per cada transició), només toca un fitxer.

Reutilitzar el mateix camí d'una transició manual és més robust que duplicar-la.

---

## Frontend en detall

### 1. UX de la multi-selecció

Els checkboxes apareixen a tota la taula però només són clickables per a reports `OPEN`. Reports en estats posteriors (ASSIGNED, IN_PROGRESS, etc.) tenen el checkbox **visible però deshabilitat amb tooltip** explicant per què. Això és més clar que amagar-los: l'admin veu que la columna existeix i que ARA NO PODEN seleccionar-se aquests, sense haver d'endevinar res.

### 2. Sincronització de selecció amb la llista

Cada vegada que la llista es refresca (canvi de filtres, esdeveniment SSE), filtrem les `selectedIds` per quedar-nos només amb els que segueixen visibles i en `OPEN`:

```ts
useEffect(() => {
  setSelectedIds(prev => {
    const next = new Set<string>();
    const visible = new Set(selectableIds);
    for (const id of prev) if (visible.has(id)) next.add(id);
    return next;
  });
}, [selectableIds]);
```

Sense això, l'admin podria seleccionar 5 reports, canviar el filtre a "Tancades", i el botó encara mostraria "(5)" — confús i amb risc d'enviar IDs que ara no s'haurien d'auto-assignar (perquè no estan OPEN).

### 3. El modal de resultats

Després de l'auto-assignació, l'admin no rep "OK" — rep una taula amb dues seccions:
- **Verd**: reports assignats correctament i el nom del tècnic triat.
- **Taronja**: reports no assignats amb la raó concreta (no era OPEN, sense categoria, cap tècnic disponible per a aquella categoria, etc.).

Així l'admin pot **decidir què fer amb els no assignats** sense haver de navegar pel sistema. Un "10 assignats correctament" és un missatge útil; un "8 assignats correctament, però aquests 2 cal que els assignis tu manualment perquè no hi ha tècnics de Lighting actius" ja és un missatge **accionable**.

### 4. Refresc en temps real

La pàgina no fa cap recàrrega manual després d'auto-assignar. El backend, al cridar `transitionReport(ASSIGN)` per cada report, ja emet SSE `report.transitioned` — el listener `useLiveEvent` de la pàgina dispara el `refetch` automàticament. Quan el modal de resultats s'obre, la llista de darrere ja s'ha actualitzat (els reports assignats han canviat d'estat).

És un exemple net d'un patró que ja teníem (SSE del Sprint 5) servint a una funcionalitat nova sense cap línia extra.

---

## App mòbil

L'únic canvi al mòbil és afegir els camps `aiSummary` i `aiClassifiedAt` al tipus `Report` perquè quadri amb el backend. No mostrem la informació enlloc del mòbil — l'aplicació mòbil està orientada a usuaris (alumnes/tècnics) que no necessiten saber que l'IA ha classificat el report; per a ells, la categoria i la prioritat són simplement el que apareix.

Si en una iteració futura volguéssim donar feedback (per exemple, un toast "Hem revisat la teva categoria"), aquí tindríem les dades.

---

## Configuració requerida

Per fer servir el sistema, l'usuari del backend ha d'obtenir una API key gratuïta a https://aistudio.google.com/app/apikey i afegir-la al `.env`:

```
GEMINI_API_KEY=el_codi_aqui
```

Sense ella, el sistema arrenca igualment, registra un avís per consola i la classificació queda silenciosament desactivada (els reports nous mantenen la categoria triada per l'usuari i `priority=MEDIUM` per defecte). La resta de l'app — auto-assignació inclosa — funciona; simplement no s'aplicarà el revisor IA.

---

## Flux complet, exemple end-to-end

Imaginem una alumna que reporta des del mòbil "Fanal trencat al carrer Major" amb una foto:

1. **Mòbil**: `POST /reports` amb títol, descripció, categoria triada per l'usuari (LIGHTING) i coordenades.
2. **Backend**: crea el report (categoria=LIGHTING, priority=MEDIUM per defecte). Emet SSE `report.created`. Programa `setTimeout(3000)` per a la classificació.
3. **Mòbil**: rep el `report_id` i puja la imatge en una segona crida `POST /reports/:id/images`.
4. **Admin (panell web)**: veu el report aparèixer al dashboard al moment via SSE.
5. **3s després**: el `setTimeout` dispara `classifyReport`. Llegeix la imatge `INITIAL` recent pujada.
6. **LangGraph**:
   - Node 1: Gemini Flash rep text + imatge. Confirma LIGHTING (l'usuari l'havia triat bé), determina priority=HIGH (la foto mostra un cable elèctric exposat). Retorna JSON amb `aiSummary`: "Fanal vandalitzat amb cables exposats al carrer Major".
   - Node 2: rules valida i retorna l'objecte normalitzat.
7. **Backend**: `prisma.update` amb `category=LIGHTING, priority=HIGH, aiSummary=..., aiClassifiedAt=now()`. Emet SSE `report.classified`.
8. **Admin**: el dashboard refresca el report. Ara mostra "HIGH" en lloc de "MEDIUM" i el resum IA sota el títol.
9. **Admin (5 minuts després)**: selecciona aquest report + 4 més de la mateixa zona, prem "Auto-assignar".
10. **Backend**: filtra tècnics amb `workCategory=LIGHTING`. Triba a "Joan Pérez" (1 incidència activa, fa 3 hores que no rep res). Crida `transitionReport(ASSIGN)`. Emet SSE `report.transitioned` i push notification.
11. **Tècnic**: rep al mòbil "Nova tasca assignada — T'han assignat: Fanal trencat al carrer Major".
12. **Alumna**: rep al mòbil "S'ha assignat la teva incidència — Un tècnic s'encarregarà de: Fanal trencat al carrer Major".

Tot el flux dura uns segons d'IA i un click d'admin. Cap intervenció manual per a categoritzar o prioritzar; cap conversa per decidir qui s'ho mira.

---

## Decisions i compromisos

- **Una sola crida LLM en lloc de múltiples agents**: vam descartar el patró multi-agent (text agent + vision agent + arbitrator). Per al cas concret de classificació amb visió, una sola crida multimodal és més precisa (cross-attention entre imatge i text), més ràpida i més barata. La defensa enginyera és més forta dient "vaig avaluar les dues arquitectures i vaig triar la més eficient" que dient "vaig fer multi-agent perquè queda bé".
- **LangGraph per a 2 nodes**: sobre-enginyeria petita però amb justificació (extensibilitat futura, observabilitat).
- **Auto-aplicar sempre, sense llindar de confiança**: simplificació conscient. El default `MEDIUM`/categoria de l'usuari ja era pitjor que la classificació de l'IA en mitjana, així que aplicar sempre és una millora neta. Si en el futur calgués revisió humana per a casos dubtosos, afegir un camp `confidence` i un panell de revisió és afegir, no refactoritzar.
- **`setTimeout(3000)` abans de classificar**: hack pragmàtic per esperar la imatge. Documentat com a deute tècnic.
- **Tècnics sense `workCategory` queden fora del pool d'auto-assignació**: decisió explícita. Per als reports que no troben candidats, l'admin haurà d'assignar manualment. Així mantenim la qualitat: només auto-assignem a tècnics amb expertesa declarada.
- **Càrrega = `ASSIGNED + IN_PROGRESS` sense ponderar per prioritat**: simple, suficient. Si en el futur els CRITICAL volgués comptar com a 3, només cal canviar la query.
- **Proximitat com a desempat, no com a criteri principal**: es va valorar fer la proximitat el factor dominant (el tècnic més proper guanya sempre), però això pot sobrecarregar el tècnic d'una zona molt activa. Mantenint la càrrega com a criteri principal i la proximitat només per desempatar tècnics amb la mateixa càrrega, es preserva l'equilibri de feina i alhora s'agrupen els desplaçaments per zona. La mètrica triada és la "incidència activa més propera" (no el centroide) perquè captura millor el cas "ja té feina just al costat".
- **Reuse de `transitionReport` a l'auto-assignació**: en lloc de fer `UPDATE` directe, passem per la màquina d'estats. Així reutilitzem totes les notificacions, SSE, validacions i auditoria que ja teníem del Sprint 2 i 5. **És el millor exemple de tot el TFG de "build it once, reuse it everywhere"**.
- **Sense cau de classificacions**: si el mateix report es re-classifiqués (no passa avui, però podria), tornaríem a cridar Gemini. Per al volum del TFG i 1500 RPD gratuïts, no és problema.

---

## Lliçons apreses

- **El multi-agent està de moda però sovint és sobre-enginyeria**. La discussió "1 crida vs 3 agents" va ser la decisió més important del sprint. La intuïció diu "més agents = més modular = millor"; la realitat és que perds el senyal multimodal i guanyes complexitat. Defensar la versió simple amb arguments tècnics és més valuós que defensar l'elaborada perquè queda impressionant.
- **El JWT no és l'única decisió de seguretat amb conseqüències**. Aquí Gemini retorna text lliure que escrius a la BD. La capa de regles deterministes (parser + whitelist de valors) és tan important com qualsevol middleware d'auth. Sense ella, una al·lucinació del model et podria escriure `priority="OMG"` a Postgres.
- **Auto-classificar ASSÍNCRONAMENT és el detall que canvia la UX**. Si féssim la crida LLM al `POST /reports` i esperéssim, l'usuari veuria 3-5s d'spinner. Fent-ho post-create, l'usuari obté resposta instantània i l'admin veu la classificació arribar uns segons després via SSE — millor experiència per a tots.
- **La integració entre sprints és el que dóna valor de veritat**. Aquest sprint usa l'XState del Sprint 2, l'API REST del Sprint 3, els tipus del frontend del Sprint 3, l'app del Sprint 4 i les SSE+push del Sprint 5. Cada un per separat era una funcionalitat; tots junts, és un producte. El Sprint 6 hauria sigut **impossible de defensar** sense els anteriors.
- **Els hacks pragmàtics han d'estar documentats**. El `setTimeout(3000)` és lleig, però millor que esperar 5 sprints per fer una cua de tasques "professional". Documentar-ho a la memòria amb les alternatives i el motiu de la decisió és més honest que amagar-ho.

---

# Sprint 7: Sistema de Gamificació de Punts

## Resum

S'ha implementat un sistema de gamificació que premia els estudiants amb punts cada vegada que una incidència que han reportat es tanca definitivament (estat `CLOSED`). La quantitat de punts es modula per la criticalitat de la incidència — un report `CRITICAL` val 8 vegades més que un `LOW` —, de manera que el sistema valora l'aportació en proporció a l'impacte real al campus.

L'arquitectura reaprofita tots els carrils d'infraestructura ja construïts als sprints anteriors: el premi es dispara des de la mateixa transició XState que ja governa el cicle de vida (`Sprint 2`), s'orquestra des del `NotificationService` central per emetre push al mòbil i SSE al dashboard admin (`Sprint 5`), i s'exposa a les tres interfícies (mòbil estudiant/tècnic, web admin) sense duplicar lògica.

El resultat és que quan l'admin clica "Tancar" en una incidència, succeeixen quatre coses en cadena dins d'una sola request: la transició a CLOSED es valida i s'emmagatzema, l'estudiant veu el seu comptador de punts incrementat al perfil, rep un push immediat ("Has guanyat 20 punts!"), i el rànquing del dashboard admin es refresca en temps real via SSE.

---

## Context tecnològic i decisions de disseny

### Per què només es premia al CLOSED, no al RESOLVE

El cicle de vida té dos estats "resolts" diferents: `VALIDATED` (el tècnic l'ha marcat com a resolta) i `CLOSED` (l'admin l'ha validat definitivament). Es va considerar premiar als dos punts (parcial al RESOLVE, complet al CLOSE), però es va descartar perquè:

- Si l'admin acaba fent `REJECT` (la resolució no era bona), caldria *restar* punts ja entregats — una operació socialment fragil ("M'has tret punts!") i tècnicament confusa.
- L'únic moment objectivament fiable de "incidència resolta de veritat" és el CLOSED, perquè hi ha l'admin validant. Premiar abans és premiar per crèdit.
- És més senzill, més just i més fàcil d'explicar als usuaris: "guanyes punts quan es tanca".

### Per què una taula `PointsTransaction` separada en lloc de només incrementar `User.points`

L'alternativa mínima seria fer un sol `UPDATE users SET points = points + N`. Funcionaria, però perdríem tres garanties que la taula sí dóna:

1. **Idempotència via constraint**. El camp `PointsTransaction.reportId` és `UNIQUE`. Si per un bug futur la transició CLOSE arribés dues vegades (per exemple, un retry de xarxa, una migració incorrecta, un test), la segona inserció rebot amb `P2002` i el premi *no es duplica*. Sense aquesta taula, l'únic check possible seria "ja s'ha incrementat aquest comptador per aquest report?" que no es pot expressar amb un `UPDATE` atòmic.

2. **Auditoria històrica**. Quan un estudiant té 240 punts, *d'on vénen?* La taula respon: 12 reports, distribuïts en X categories i Y nivells de criticalitat, en un rang de dates concret. Sense ella, sabem el total però no la història.

3. **Snapshot de prioritat al moment del premi**. Si l'admin canvia la `priority` d'una incidència mesos després (per a analítica retrospectiva), volem que el premi reflecteixi el valor *real aplicat*, no el valor *actual*. La taula emmagatzema la prioritat junt amb l'amount.

### Per què només els estudiants reben punts

Decisió de domini: els punts representen el reconeixement a l'aportació ciutadana. Admins i tècnics ja tenen rol institucional i no necessiten incentius extrínsecs. Si en algun moment un admin o tècnic crea un report (per testing o per cas especial), el servei `awardPointsForClosedReport` ho detecta i retorna `not_student` sense premiar — el filtre és al backend, no al frontend, per garantir-ho.

### Per què el premi és fire-and-forget

A `transitionReport`, la crida `awardPointsForClosedReport(reportId)` es dispara amb `void ... .then(...).catch(...)` sense `await`. Així:

- Si el sistema de gamificació falla (per exemple, BD lenta puntualment), la transició CLOSE no es bloqueja ni retorna error a l'admin.
- L'admin obté resposta HTTP en mil·lisegons; el push de "Has guanyat punts!" arriba al mòbil quan toqui (centenars de mil·lisegons després).

És el mateix patró que ja s'usava per als push del Sprint 5 — extensió coherent del principi "lo no crític, fora del camí crític".

### Escala 5/10/20/40

L'escala segueix una progressió geomètrica (cada nivell dobla l'anterior). Això:

- Té significat clar: una incidència CRÍTICA equival a *vuit* de baixes — diferència suficient per motivar reports d'alta prioritat.
- Manté els nombres petits i llegibles al podi i a les notificacions.
- És fàcilment ajustable: els valors estan en una sola constant (`POINTS_BY_PRIORITY` a `services/gamification.ts`).

Mirall al frontend i mòbil amb la mateixa constant per poder mostrar previsualitzacions ("guanyaràs +X punts quan es tanqui") sense una crida API.

---

## Visió general de l'arquitectura

```
[Admin clica "Tancar" al panel web]
            │
            ▼
   PATCH /reports/:id/transition { event: 'CLOSE' }
            │
            ▼
┌───────────────────────────────────┐
│  transitionReport()               │
│   - XState valida (isAdmin)       │
│   - prisma.update(state=CLOSED,   │
│                   resolvedAt=now) │
└─────────────┬─────────────────────┘
              │ (després del commit)
              ▼
   ┌──────────────────────────────┐
   │  Fire-and-forget en paral·lel │
   └─┬──────────┬─────────────────┘
     │          │
     ▼          ▼
notificationService.   awardPointsForClosedReport()
onReportTransitioned()      │
     │                      │  $transaction([
     ▼                      │    pointsTransaction.create,
   Push +                   │    user.update(points += N)
   SSE                      │  ])
                            │
                            ▼
              if (awarded) → onPointsEarned()
                                │
                                ├─ persistAndPush  → push mòbil "Has guanyat N punts!"
                                └─ SSE 'points.awarded' → dashboard admin refresca rànquing
```

Una sola transició HTTP, tres canals propagats, zero acoblament entre ells (cada canal pot fallar sense afectar els altres).

---

## Catàleg de mòduls i mètodes

### Backend

#### `services/gamification.ts` (nou)

Motor del sistema. Tota la lògica de càlcul i persistència viu aquí.

- `POINTS_BY_PRIORITY` — constant exportada `{ LOW: 5, MEDIUM: 10, HIGH: 20, CRITICAL: 40 }`. Single source of truth.
- `awardPointsForClosedReport(reportId)` — l'operació crítica. Llegeix el report (incloent priority + creador), valida que el creador sigui STUDENT, i fa la `$transaction([create PointsTransaction, update User.points])`. Retorna `{ awarded, amount, newTotal, reason? }`. Captura `P2002` (unique constraint) i el retorna com a `already_awarded` no-op.
- `getLeaderboard(limit)` — top N estudiants actius ordenats per punts descendents, desempat per nom. Límit màxim 50.
- `getUserPointsHistory(userId, limit)` — transaccions d'un usuari amb el report incrustat (title, priority, category). Pensat per al perfil mòbil.
- `getAllPointsTransactions({ userId?, limit? })` — historial complet d'auditoria amb user + report incrustats. Filtrable per usuari concret. Pensat per al panel admin.
- `getUserRank(userId)` — posició al rànquing comptant quants estudiants tenen `points > userPoints`. Retorna `{ rank, total, points }` o `null` si l'usuari no és estudiant.

#### `services/notification.ts` (modificat)

- Nova funció `onPointsEarned({ userId, reportId, reportTitle, amount, newTotal })` — emet SSE `points.awarded` als admins i fa `persistAndPush` per al destinatari amb el tipus `POINTS_EARNED` ("Has guanyat N punts!").

#### `services/sse.ts` (modificat)

- Afegit `{ type: 'points.awarded'; userId: string; reportId: string; amount: number }` al `SseEvent` union.

#### `services/report.ts` (modificat)

- A `transitionReport()`, al final, si `newState === 'CLOSED'`, dispara `awardPointsForClosedReport(reportId)` fire-and-forget. Si el premi és nou (`result.awarded === true`), invoca `notificationService.onPointsEarned(...)`. Errors capturats i només es loguen — no propaguen.

#### `controllers/gamification.ts` (nou)

- `getLeaderboard(req, res)` — wrap del servei. Llegeix `?limit=N` opcional.
- `getMyPoints(req, res)` — retorna `{ history, rank }` de l'usuari autenticat (a partir del `req.user.userId` del JWT).
- `getAllTransactions(req, res)` — admin only. Llegeix `?userId=<uuid>&limit=N` opcionals.

#### `routes/gamification.ts` (nou)

Mount del router sota `/api/gamification`. Totes les rutes passen per `authenticate`; `/transactions` afegeix `authorize('ADMIN')`.

#### Models nous a `prisma/schema.prisma`

- Enum `NotificationType` ampliat amb `POINTS_EARNED`.
- Nou model `PointsTransaction`:
  ```prisma
  model PointsTransaction {
    id        String   @id @default(uuid())
    userId    String
    user      User     @relation(fields: [userId], references: [user_id], onDelete: Cascade)
    reportId  String   @unique
    report    Report   @relation(fields: [reportId], references: [report_id], onDelete: Cascade)
    amount    Int
    priority  Priority
    createdAt DateTime @default(now())
    @@index([userId, createdAt])
    @@map("points_transactions")
  }
  ```
- Relacions inverses afegides al `User` (`pointsTransactions`) i al `Report` (`pointsTransaction` — singular, perquè la UNIQUE de `reportId` fa que sigui 0 o 1).
- Aplicat amb `npx prisma db push` (la mateixa raó del Sprint anterior: el shadow DB no té PostGIS, així evitem `migrate dev`).

#### Endpoints REST nous

| Mètode | Ruta | Protecció | Descripció |
|---|---|---|---|
| GET | `/api/gamification/leaderboard` | `authenticate` | Top N estudiants per punts. Query: `?limit=N` (def. 10, màx. 50). |
| GET | `/api/gamification/me` | `authenticate` | Historial de punts + posició + total de l'usuari autenticat. |
| GET | `/api/gamification/transactions` | `authenticate` + `authorize('ADMIN')` | Historial complet d'auditoria, filtrable per usuari. |

### Frontend web (panel admin)

#### `api/gamification.ts` (nou)

- `getLeaderboard(limit)` — `GET /gamification/leaderboard`.
- `getAllPointsTransactions({ userId?, limit? })` — `GET /gamification/transactions`.

#### `types/index.ts` (modificat)

- Nous tipus `LeaderboardEntry`, `PointsTransaction`.
- Constant `POINTS_BY_PRIORITY` mirall del backend per renderitzar l'escala.

#### `hooks/useEventStream.ts` (modificat)

- Afegit `points.awarded` al union `DashboardEvent`.
- Registrat `source.addEventListener('points.awarded', dispatch)`.

#### `pages/PointsPage.tsx` (nou)

Pàgina completa amb tres blocs:

1. **KPIs superiors**: total atorgat, transaccions, estudiants premiats.
2. **Escala de punts**: targeta explicativa amb els valors per criticalitat (`POINTS_BY_PRIORITY`).
3. **Rànquing + historial**: dues columnes. A l'esquerra, top 20 amb medalles de podi (or/plata/bronze). A la dreta, taula d'historial amb filtre per usuari (select poblat amb el leaderboard) i enllaços als reports.

Subscrita a `useLiveEvent('points.awarded', fetchData)` per refrescar en temps real cada vegada que un admin tanca una incidència.

#### `components/Layout.tsx` (modificat)

- Nova entrada "Punts" al sidebar amb icona `Trophy` de `lucide-react`, entre "Mapa" i "Invitacions".

#### `App.tsx` (modificat)

- Registrada la ruta `/points` dins del bloc `ProtectedRoute` + `Layout`.

### App mòbil

#### `src/types/index.ts` (modificat)

- Afegit `POINTS_EARNED` al tipus `NotificationType`.
- Nous tipus `LeaderboardEntry`, `PointsTransactionItem`, `UserRank`.
- Constant `POINTS_BY_PRIORITY` mirall del backend.

#### `src/api/gamification.ts` (nou)

- `getLeaderboard(limit)` — `GET /gamification/leaderboard`.
- `getMyPoints()` — `GET /gamification/me` (retorna `{ history, rank }`).

#### `app/(app)/(tabs)/leaderboard.tsx` (nou)

Pestanya "Punts" disponible per a tots els rols (la informació no és sensible). Per a estudiants mostra també una targeta amb la seva posició personal (`#3 de 27 estudiants · 145 punts totals`). Inclou:

- Card de posició personal (només STUDENT).
- Escala de punts amb chips de color per prioritat.
- Top 20 amb medalles, ressaltat de l'usuari actual (`bg-brand-50` + sufix "· tu").
- Pull-to-refresh.

#### `app/(app)/(tabs)/_layout.tsx` (modificat)

- Nova `Tabs.Screen name="leaderboard"` amb icona `trophy-outline` / `trophy`.

#### `app/(app)/(tabs)/profile.tsx` (modificat)

Secció nova "Darrers punts guanyats" al perfil de l'estudiant (només es renderitza si `role === STUDENT`):

- Estat buit amb call-to-action si encara no té cap punt.
- Llista dels últims 5 premis amb data, categoria i amount.
- Botó "Veure classificació" que navega a `/leaderboard`.
- Header amb la seva posició al rànquing.

L'historial es carrega via `getMyPoints()` amb `useEffect` dependent de `user?.points` — així es refresca automàticament quan rep el push de "Has guanyat punts!" i el `AuthContext` actualitza l'usuari.

---

## Backend en detall

### 1. Atomicitat de l'award

L'operació crítica és garantir que *o* es crea la fila a `points_transactions` *i* s'incrementa `User.points`, *o* no passa res. La implementació:

```ts
const [, updatedUser] = await prisma.$transaction([
  prisma.pointsTransaction.create({
    data: {
      userId: report.createdById,
      reportId: report.report_id,
      amount,
      priority: report.priority,
    },
  }),
  prisma.user.update({
    where: { user_id: report.createdById },
    data: { points: { increment: amount } },
    select: { points: true },
  }),
]);
```

Si la `create` falla per UNIQUE constraint (`P2002`), la `update` *no* s'aplica. Sense la `$transaction`, podríem deixar `User.points` incrementat sense fila a `points_transactions` — exactament el tipus d'inconsistència que la taula d'auditoria havia de prevenir.

### 2. Idempotència via UNIQUE + try/catch

```ts
try {
  const [, updatedUser] = await prisma.$transaction([...]);
  return { awarded: true, amount, newTotal: updatedUser.points };
} catch (err: any) {
  if (err?.code === 'P2002') {
    return { awarded: false, amount: 0, newTotal: report.createdBy.points, reason: 'already_awarded' };
  }
  throw err;
}
```

Aquest patró converteix una violació de constraint en una resposta semàntica del domini ("ja premiat") sense propagar l'error. El caller (`transitionReport`) només mira `result.awarded` per decidir si emet la notificació de "punts guanyats". Si es tornés a disparar la transició per qualsevol motiu, el sistema no enviarà un segon push fantasma.

### 3. Snapshot de priority al moment del premi

El camp `PointsTransaction.priority` no és una simple FK al report — és un valor cru *copiat* en el moment de la creació. La raó: si l'admin edita la priority del report mesos després (per a analítica retrospectiva o correcció), el premi original ha de mantenir el seu valor. La taula `points_transactions` és l'auditoria del que va passar, no del que és cert ara.

### 4. Per què el rank és un `COUNT(*) WHERE points > X` i no una window function

```ts
const higher = await prisma.user.count({
  where: { role: 'STUDENT', active: true, points: { gt: user.points } },
});
return { rank: higher + 1, ... };
```

Una `RANK() OVER (ORDER BY points DESC)` en SQL seria més idiomàtica però requereix `$queryRaw` (Prisma no l'exposa directament). Per al volum del TFG (centenars d'estudiants), un `COUNT(*)` indexat és O(log n) i suficient. Si en el futur el sistema escalés a milers, refactor a window function és un sol fitxer.

### 5. Per què `points.awarded` és un esdeveniment SSE propi i no es deriva de `report.transitioned`

El dashboard admin *podria* recalcular el rànquing cada vegada que arriba un `report.transitioned` amb `to: 'CLOSED'`. Però:

- No tots els CLOSEs generen punts (admins/tècnics que tanquen incidències pròpies, casos de `not_student`).
- L'esdeveniment `report.transitioned` parla del cicle de vida, no de gamificació. Barrejar-ho seria acoblar dos dominis.
- Tenir un `points.awarded` separat permet que la pàgina `/points` només es refresqui quan realment passa cosa rellevant per ella — la `/reports` no necessita reaccionar a aquest tipus i així evitem refetches innecessaris.

### 6. Hook al `transitionReport`

```ts
if (newState === 'CLOSED') {
  void awardPointsForClosedReport(reportId)
    .then((result) => {
      if (result.awarded) {
        notificationService.onPointsEarned({
          userId: updated.createdById,
          reportId,
          reportTitle: updated.title,
          amount: result.amount,
          newTotal: result.newTotal,
        });
      }
    })
    .catch((err) => {
      console.error('[gamification] Error premiant punts:', err);
    });
}
```

`void` + `.then().catch()` enlloc d'`await`: el premi és asíncron i no bloqueja la response HTTP de la transició. L'admin no nota cap latència extra; el push del mòbil arriba "uns segons després" (igual que la resta de notificacions del Sprint 5).

---

## Frontend i mòbil en detall

### Refresc en temps real al panel admin

La pàgina `/points` registra un `useLiveEvent('points.awarded', fetchData)`. Cada vegada que un admin (potencialment un *altre* admin) tanca una incidència, el rànquing i l'historial es refresquen sense que ningú hagi de recarregar la pàgina. És la mateixa pauta del Sprint 5 aplicada a un nou tipus d'esdeveniment.

### Refresc del perfil mòbil sense polling

Al `profile.tsx`, l'`useEffect` que carrega `getMyPoints()` depèn de `user?.points`. Quan arriba un push de "Has guanyat punts", el `usePushNotifications` (Sprint 5) processa la notificació i l'`AuthContext` acaba refrescant l'usuari (els punts pugen). Això dispara automàticament una recàrrega de l'historial. Sense polling, sense WebSocket, sense complexitat addicional — només encadenat de cause-effects existents.

### Mostrar la posició personal només a estudiants

Tots els rols veuen la pestanya "Punts" (no és informació sensible), però la targeta "La teva posició" només es renderitza si `user.role === 'STUDENT' && myRank != null`. Tècnics i admins veuen únicament el podi i l'escala. Es podria amagar la pestanya per a no-estudiants, però la visibilitat aporta context (tots saben com funciona el sistema, tots veuen qui són els reporters més actius).

---

## Flux complet, exemple end-to-end

Una estudiant ha reportat la setmana passada una incidència de prioritat HIGH ("Cable elèctric exposat al pàrquing"). Un tècnic l'ha resolta i l'admin la revisa avui:

1. **Admin (panel web)** entra a `/validations`, llegeix els comentaris, mira la foto de resolució i clica "Tancar definitivament".
2. **Backend**: `PATCH /reports/:id/transition { event: 'CLOSE' }`. XState valida `VALIDATED → CLOSE → CLOSED` amb guard `isAdmin`. Es fa `prisma.update({ state: 'CLOSED', resolvedAt: now() })`.
3. **Backend (notificacions Sprint 5)**: `notificationService.onReportTransitioned(...)` envia push a la estudiant "Incidència tancada" i SSE `report.transitioned` als admins. La transició retorna 200 al frontend admin → la incidència desapareix de la llista de pendents (refrescada per SSE).
4. **Backend (gamificació)**: en paral·lel, `awardPointsForClosedReport(reportId)` s'executa. Detecta que la creadora és STUDENT, calcula `POINTS_BY_PRIORITY.HIGH = 20`, executa la `$transaction([create PointsTransaction, increment user.points])`. Retorna `{ awarded: true, amount: 20, newTotal: 145 }`.
5. **Backend**: com que `awarded === true`, dispara `notificationService.onPointsEarned(...)`. Persistéix una fila a `notifications` (type `POINTS_EARNED`), envia push a la estudiant ("Has guanyat 20 punts! S'ha tancat la teva incidència 'Cable elèctric exposat al pàrquing'. Total: 145 punts."), i emet SSE `points.awarded` als admins.
6. **Estudiant (mòbil)**: el dispositiu mostra el banner del push. Si toca la notificació, l'app obre el detall de la incidència. Si va al perfil, la secció "Darrers punts guanyats" mostra el nou registre. Si va a la pestanya "Punts", la seva posició s'ha actualitzat.
7. **Admin (panel web)**: si tenia oberta la pàgina `/points` en una altra finestra, l'historial refresca automàticament amb la nova transacció a dalt. El total atorgat puja, el podi es recalcula.

Tot a partir d'una sola request HTTP i un sol clic — XState valida, gamificació premia, notificacions emet, SSE refresca.

---

## Decisions i compromisos

- **Premiar només al CLOSED** en lloc de fer premi parcial al RESOLVE: més simple, més just, sense necessitat de restar punts si l'admin fa REJECT després.
- **Taula `PointsTransaction` separada** en lloc de només `User.points`: la UNIQUE de `reportId` proporciona idempotència via constraint (el mecanisme més robust possible), permet auditoria històrica i snapshot de priority. Cost real: una taula, un índex; benefici: tres garanties dures.
- **`POINTS_EARNED` com a NotificationType nou** en lloc de reutilitzar `REPORT_STATE_CHANGED`: permet al mòbil tractar visualment els push de punts de forma diferenciada (futur: icona de trofeu en lloc d'incidència) sense canviar res al servei.
- **Escala 5/10/20/40** com a progressió geomètrica: cada nivell doblar l'anterior dóna significat clar ("un crític val vuit baixes") i manté els nombres petits.
- **Fire-and-forget al CLOSE**: el premi mai bloqueja la transició. Coherent amb el patró de notificacions del Sprint 5 — lo no crític, fora del camí crític.
- **Pestanya "Punts" visible per a tots els rols**: tots saben com funciona el sistema; només l'estudiant veu la card personal.
- **Endpoint únic `GET /gamification/me`** que retorna `{ history, rank }`: una sola crida HTTP per a tota la informació personal del mòbil, en lloc de dues (historial + posició).
- **Sense badges ni nivells**: el sistema són només punts. Afegir nivells/insígnies/desbloquejos és una decisió de producte separada que pot venir més tard sense canviar el backend (només cal derivar del `points` total a la UI).

---

## Lliçons apreses

- **La UNIQUE constraint és la millor xarxa de seguretat**. Es podria comprovar a l'aplicació amb un `findFirst` previ, però sempre tindria una *race condition* (dos `findFirst` simultanis veuen "no existeix" i tots dos creen). La constraint, en canvi, és atòmica per definició — Postgres garanteix l'exclusivitat. El patró `try { create } catch (P2002) { ... }` és el modisme correcte per a operacions idempotents.
- **Snapshot vs join**: és tentador modelar el premi només amb una FK al report i derivar la priority cada vegada (`points_transactions JOIN reports`). Però si el report es modifica, l'auditoria s'ha vist contaminada. La regla és: les taules d'historial copien valors que defineixen l'esdeveniment.
- **L'asincronia bona és invisible**. L'usuari admin no nota res quan tanca una incidència — la resposta HTTP arriba en mil·lisegons. El push de "Has guanyat punts!" arriba a la estudiant uns segons més tard. Sense `void ... .then()` (és a dir, amb `await` directe), tots dos haurien d'esperar a tots dos. Aquesta separació costa zero línies de codi i salva 50-200 ms de latència en el cas feliç i 30 segons en el cas dolent (timeout d'Expo).
- **Reutilitzar canals existents val més que dissenyar nous**. La temptació era afegir una taula "rewards" i un canal nou de "rewards events". La realitat: les notifications, els push, els SSE i el patró fire-and-forget ja existien. Una sola funció nova (`onPointsEarned`) reaprofita tot. El cost d'integració és proporcional a com de bé separes responsabilitats; aquí, el NotificationService del Sprint 5 era el lloc natural.
- **La constant `POINTS_BY_PRIORITY` viu en 3 llocs (backend, web, mòbil)** i això és correcte. Una sola font de veritat seria un endpoint `GET /gamification/scale` que les tres capes consumeixen, però per a una constant que canvia un cop l'any (i mai sense desplegament coordinat), el cost de mantenir 3 còpies sincronitzades és menor que el cost d'una crida HTTP extra al boot de l'app.

---

## Ampliació: Fotos de Perfil i Gestió d'Usuaris

A més de la gamificació, en aquest sprint s'han afegit dues funcionalitats transversals que toquen les tres interfícies:

1. **Fotos de perfil (avatars)** per a estudiants i tècnics. La imatge es puja des del mòbil (càmera o galeria), es desa a Supabase Storage i es mostra al perfil, als rànquings (mòbil i web) i als resultats de cerca.
2. **Cerca i gestió d'usuaris**. Qualsevol usuari pot cercar estudiants i tècnics per nom/cognoms/nick (mòbil i web), amb una fitxa d'informació bàsica i el comptador d'incidències resoltes. A més, des del panell web l'admin pot **bloquejar, reactivar i eliminar** qualsevol compte, amb **logout automàtic** dels comptes afectats que estiguin en ús i la impossibilitat de tornar a iniciar sessió.

La implementació reaprofita la infraestructura ja existent: el patró de pujada multipart → Supabase Storage del Sprint 4 (Fase 3), els interceptors 401 que ja feien neteja de token a web i mòbil, i les regles de protecció d'usuaris privilegiats (root + últim admin) introduïdes a la revocació per invitació.

### Context i decisions de disseny (avatars i gestió)

#### Eliminar un compte = anonimitzar in-place, no esborrat dur

Els `reports`, `comments` i `images` tenen una FK **obligatòria** cap al seu creador/autor. Un `DELETE` dur de la fila d'usuari trencaria l'històric d'incidències (o obligaria a esborrar-lo en cascada, perdent dades valuoses). La decisió va ser **anonimitzar la fila in-place**:

- S'esborra tota la PII (nom, cognoms, email, nickname, avatar, dades de tècnic).
- Les credencials s'invaliden (password = hash d'un UUID aleatori) i `active = false`.
- S'eliminen les dades efímeres del compte (`pushTokens`, `notifications`).
- La invitació associada (si en tenia) es marca `REVOKED`.

Resultat: el "compte real" desapareix (PII fora, login impossible), però els reports queden atribuïts a una fila anònima ("Usuari eliminat") i les estadístiques i l'històric es mantenen íntegres. És l'enfocament GDPR-friendly: dret a l'oblit sense corrompre dades de tercers.

#### Auto-logout: comprovació d'`active` a cada petició autenticada

Fins ara el JWT (vàlid 24 h) era condició suficient: un cop emès, l'usuari tenia accés fins a l'expiració encara que l'admin el bloquegés. Per aconseguir un **logout immediat**, el middleware `authenticate` ara fa una consulta lleugera (`select: { active: true }`) a la BD després de verificar la signatura: si el compte no existeix o està inactiu, retorna **401**. Com que els interceptors 401 de web i mòbil ja netegen el token i redirigeixen a login, el bloqueig/eliminació es propaga sol a la propera petició.

El compromís és **una query extra per request autenticada**. Per a l'escala d'un TFG (centenars d'usuaris) és negligible; si el volum ho exigís, es podria cachejar l'estat `active` amb un TTL curt (p. ex. 30 s).

#### Abast de la cerca

Els **resultats** de cerca són sempre estudiants i tècnics (els admins són gestió, no apareixen com a fitxes). Qui pot **cercar** difereix per interfície: al mòbil ho fan estudiants i tècnics; al web, l'admin. L'endpoint és compartit i només requereix autenticació. Un únic matís de gestió: l'admin pot passar `?includeInactive=true` per veure i reactivar comptes bloquejats — el backend només honora aquest flag si el sol·licitant és ADMIN, de manera que el mòbil mai veu comptes inactius.

#### Reutilitzar el bucket d'imatges per als avatars

En lloc de crear un bucket nou, els avatars es desen al mateix bucket de Supabase Storage que les imatges d'incidència, sota el prefix `avatars/<userId>/`. Reaprofita la configuració, les credencials i la funció `extensionFromMimetype` ja existents; la separació per path és suficient.

### Arquitectura del bloqueig → auto-logout

```
[Admin clica "Bloquejar" o "Eliminar" al panel web]
            │
            ▼
   PATCH /users/:id/active { active:false }   |  DELETE /users/:id
            │                                        │
            ▼                                        ▼
   setUserActive(false)                       deleteUser() (anonimitza + active:false)
   (proteccions: root, últim admin)           (mateixes proteccions)
            │
            ▼
   user.active = false a la BD
            │
            ▼ (propera petició de l'usuari afectat, encara amb JWT vàlid)
   authenticate → select active → false → 401
            │
            ├─ Web:  interceptor 401 → localStorage.removeItem + redirect /login
            └─ Mòbil: interceptor 401 → SecureStore delete + onUnauthorized() → setUser(null)
                                                             → guard de navegació → /login
```

### Catàleg de mòduls i mètodes (avatars i gestió)

#### Backend

##### `prisma/schema.prisma` (modificat)

- Nou camp `avatarUrl String?` al model `User` (URL pública de la foto a Supabase Storage).
- Aplicat amb `npx prisma db push` (com als sprints previs: el shadow DB no té PostGIS, així evitem `migrate dev`).

##### `services/storage.ts` (modificat)

- `uploadAvatarImage(userId, buffer, mimetype)` — puja l'avatar al bucket sota `avatars/<userId>/<uuid>.<ext>` i retorna la URL pública. Reaprofita `getClient()` i `extensionFromMimetype()`.

##### `services/user.ts` (modificat)

- `PUBLIC_USER_SELECT` — objecte `select` compartit amb els camps públics (inclou `avatarUrl`), per no duplicar-lo a cada query.
- `setUserActive(userId, active)` — bloqueja o reactiva qualsevol rol. En desactivar aplica les proteccions (root intocable, últim admin actiu) i, si l'usuari té invitació, la marca `REVOKED` dins una transacció.
- `revokeUser(userId)` — ara és un cas particular de `setUserActive(userId, false)`, conservant el guard "ja està desactivat" (compatibilitat amb l'endpoint `/revoke`).
- `deleteUser(userId)` — anonimització in-place (vegeu detall més avall). Mateixes proteccions.
- `updateAvatar(userId, buffer, mimetype)` — puja la imatge i desa la URL a `User.avatarUrl`.
- `searchUsers(q, includeInactive?)` — cerca STUDENT/TECHNICAL per `name`/`surname`/`nickname` (`contains`, insensitive) i calcula `solvedCount` per rol via `_count`.

##### `controllers/user.ts` (modificat)

- `uploadAvatar` — valida el fitxer multipart (`ACCEPTED_AVATAR_MIMETYPES`) i crida `updateAvatar`.
- `search` — llegeix `?q=` i només permet `includeInactive` si `req.user.role === 'ADMIN'`.
- `setActive` — valida el booleà `active` del body i crida `setUserActive`.
- `remove` — crida `deleteUser`. Tradueix proteccions a 403 i "no trobat" a 404.
- `avatarUrl` afegit als `select` de `getProfile`, `getTechnicianById`, `getAllTechnicians`, `getAllStudents`.

##### `routes/users.ts` (modificat)

- `multer` en memòria (com a `routes/reports.ts`) i noves rutes:

| Mètode | Ruta | Protecció | Descripció |
|---|---|---|---|
| POST | `/api/users/avatar` | `authenticate` | Puja/actualitza la foto de perfil pròpia (multipart, camp `image`). |
| GET | `/api/users/search` | `authenticate` | Cerca STUDENT/TECHNICAL. Query: `?q=`, `?includeInactive=true` (només admin). |
| PATCH | `/api/users/:id/active` | `authenticate` + `authorize('ADMIN')` | Bloqueja/reactiva un compte (`{ active }`). |
| DELETE | `/api/users/:id` | `authenticate` + `authorize('ADMIN')` | Elimina (anonimitza) un compte. |

##### `middlewares/auth.ts` (modificat)

- `authenticate` passa a ser `async`: després de `jwt.verify`, comprova a la BD que el compte segueix `active`; si no, **401**. És la peça clau de l'auto-logout.

##### `services/gamification.ts` (modificat)

- `getLeaderboard` afegeix `avatarUrl` al `select` per mostrar la foto al podi.

#### Frontend web (panel admin)

##### `types/index.ts` (modificat)

- `avatarUrl?` afegit a `User`, `TechnicianDetails`, `LeaderboardEntry` (i per herència a `Technician`).
- Nou tipus `UserSearchResult` (info bàsica + `solvedCount`).

##### `api/users.ts` (modificat)

- `searchUsers(q, includeInactive?)`, `setUserActive(id, active)`, `deleteUser(id)`.

##### `components/Avatar.tsx` (nou)

- Component reutilitzable: mostra `<img>` si hi ha `url`, o un cercle amb inicials com a fallback. Mida configurable.

##### `pages/PointsPage.tsx` (modificat)

- Avatar a cada fila del rànquing.

##### `pages/InvitesPage.tsx` (modificat — "Gestió d'Accessos")

- Nova secció **Cerca d'usuaris**: input amb debounce + taula de resultats (avatar, nom/nick, email, rol, punts, dades de tècnic, incidències resoltes, estat).
- Accions de gestió **Bloquejar/Reactivar** i **Eliminar** (component `UserActions`) tant als resultats de cerca com a la taula d'admins/tècnics, amb confirmació i columna d'avatar. La cerca usa `includeInactive=true` per poder reactivar comptes bloquejats.

#### App mòbil

##### `src/types/index.ts` (modificat)

- `avatarUrl?` afegit a `User` i `LeaderboardEntry`; nou tipus `UserSearchResult`.

##### `src/api/auth.ts` (modificat)

- `uploadAvatar(uri)` — pujada multipart al `POST /users/avatar` (mateix patró que `uploadReportImage`).

##### `src/api/users.ts` (nou)

- `searchUsers(q)` — `GET /users/search`.

##### `src/api/client.ts` (modificat)

- `setUnauthorizedHandler(cb)` — permet registrar un callback que l'interceptor 401 invoca després d'esborrar el token.

##### `src/context/AuthContext.tsx` (modificat)

- Registra el handler perquè un 401 faci `setUser(null)` → el guard de `app/_layout.tsx` redirigeix a login (auto-logout real mentre s'usa l'app).

##### `src/components/Avatar.tsx` (nou)

- Equivalent mòbil: `<Image>` si hi ha `uri`, o cercle amb inicials.

##### `app/(app)/(tabs)/profile.tsx` i `app/(app)/settings.tsx` (modificats)

- Substitueixen el cercle d'inicials per `<Avatar>` amb una insígnia de càmera; en tocar-la, `Alert` amb opcions càmera/galeria → `expo-image-picker` → `uploadAvatar` → `setUser`.

##### `app/(app)/(tabs)/leaderboard.tsx` (modificat)

- Avatar a cada fila del podi i botó "Cerca usuaris" que navega a `/users`.

##### `app/(app)/users.tsx` (nou) + `app/(app)/_layout.tsx` (modificat)

- Pantalla de cerca (presentació `card`, registrada al layout): input amb debounce i targetes de resultat amb avatar, dades bàsiques, dades de tècnic i incidències resoltes.

### Backend en detall (avatars i gestió)

#### 1. Anonimització atòmica a `deleteUser`

```ts
const scrambledPassword = await bcrypt.hash(randomUUID(), 10);
const anonId = userId.slice(0, 8);

await prisma.$transaction([
  prisma.pushToken.deleteMany({ where: { userId } }),
  prisma.notification.deleteMany({ where: { userId } }),
  prisma.user.update({
    where: { user_id: userId },
    data: {
      name: 'Usuari', surname: 'eliminat',
      nickname: `deleted_${anonId}_${Date.now()}`,
      email: `deleted_${anonId}_${Date.now()}@deleted.local`,
      password: scrambledPassword, active: false,
      avatarUrl: null, position: null, company: null, workCategory: null,
    },
  }),
  ...(user.inviteId
    ? [prisma.invite.update({ where: { id: user.inviteId }, data: { status: 'REVOKED' } })]
    : []),
]);
```

El `nickname` i l'`email` són `@unique`: per evitar col·lisions amb futurs esborrats, s'hi afegeix `userId` + timestamp. Tot dins una `$transaction`: o l'usuari queda completament anonimitzat o no canvia res.

#### 2. La comprovació d'`active` al middleware

`authenticate` separa ara dos errors: signatura invàlida (token corromput/caducat) i compte inactiu. Tots dos retornen 401 — el client no necessita distingir-los, només ha de tancar sessió. La query és un `findUnique` per PK amb `select` d'un sol camp: el cost mínim possible.

#### 3. `solvedCount` calculat amb `_count` filtrat

```ts
_count: {
  select: {
    reportsCreated:  { where: { state: { in: ['VALIDATED','CLOSED'] } } },
    reportsAssigned: { where: { state: { in: ['VALIDATED','CLOSED'] } } },
  },
}
```

Prisma permet filtrar dins de `_count`, de manera que el comptador es resol en la mateixa query del `findMany` (sense N+1). El mapeig final tria `reportsAssigned` per a tècnics ("incidències solucionades") i `reportsCreated` per a estudiants ("incidències resoltes").

#### 4. Reutilització de les proteccions

Les regles "root intocable" i "últim admin actiu" ja existien a la revocació per invitació. `setUserActive` i `deleteUser` les comparteixen, de manera que cap operació de gestió (bloqueig, eliminació o revocació) pot deixar el sistema sense administrador ni tocar l'admin root.

### Frontend i mòbil en detall (avatars i gestió)

#### Auto-logout: web vs mòbil

A la web n'hi havia prou: l'interceptor 401 ja feia `localStorage.removeItem('token')` + `window.location.href = '/login'`. Al mòbil, en canvi, l'interceptor només esborrava el token de `SecureStore`, però l'estat de React (`AuthContext.user`) seguia ple, així que la navegació no reaccionava. La solució mínima va ser un **callback registrable** (`setUnauthorizedHandler`) que l'`AuthContext` connecta a `setUser(null)`; el guard de `_layout.tsx` (que ja redirigia quan `user` és null) fa la resta. Zero acoblament del client amb el context de navegació.

#### `includeInactive` només per a l'admin

El mateix endpoint de cerca serveix mòbil i web. Per evitar que un estudiant pogués enumerar comptes bloquejats, el flag `includeInactive` només s'honora al backend si el sol·licitant és ADMIN. El mòbil ni tan sols l'envia.

#### Component `Avatar` amb fallback

Tant a web com a mòbil, l'avatar és un component únic que mostra la foto si existeix o un cercle amb inicials si no. Cap pantalla duplica la lògica del fallback, i el dia que un usuari no tingui foto la UI segueix sent coherent.

### Flux end-to-end: bloqueig en calent

Un estudiant té comportament abusiu i l'admin decideix bloquejar-lo mentre l'app de l'estudiant està oberta:

1. **Admin (web)** entra a "Gestió d'Accessos", cerca l'estudiant pel nom, i clica "Bloquejar". `PATCH /users/:id/active { active:false }`. El backend valida proteccions i posa `active=false`.
2. **Estudiant (mòbil)** fa qualsevol acció que dispari una petició. El JWT encara és vàlid, però `authenticate` consulta la BD, veu `active=false` i retorna **401**.
3. **Mòbil**: l'interceptor 401 esborra el token de `SecureStore` i invoca el handler → `setUser(null)` → el guard redirigeix a `/(auth)/login`.
4. **Estudiant** intenta tornar a iniciar sessió: `loginUser` rebutja amb "Compte desactivat. Contacta amb un administrador."
5. Més endavant, si l'admin clica "Reactivar" (`active:true`), l'estudiant ja pot tornar a entrar amb les seves credencials de sempre.

Si en comptes de bloquejar l'admin hagués clicat "Eliminar", el pas 4 fallaria igualment (credencials invalidades i email anonimitzat), però de forma permanent — i els reports de l'estudiant seguirien existint atribuïts a "Usuari eliminat".

### Decisions i compromisos (avatars i gestió)

- **Anonimitzar en lloc d'esborrar dur**: preserva l'històric d'incidències (FK obligatòries) i compleix el dret a l'oblit.
- **Comprovar `active` a cada request**: garanteix logout immediat a canvi d'una query per petició. Acceptable a escala TFG; cachejable amb TTL si calgués.
- **Endpoint de cerca compartit amb gate per rol** (`includeInactive`): una sola API per a mòbil i web, sense filtrar dades sensibles a usuaris no privilegiats.
- **Reutilitzar el bucket i el patró multipart existents** per als avatars: zero infraestructura nova.
- **Component `Avatar` únic per interfície** amb fallback d'inicials: coherència visual i sense duplicació.
- **`setUnauthorizedHandler` al mòbil** en lloc d'acoblar el client API amb expo-router: el client no sap res de navegació, només notifica; el context decideix.

### Lliçons apreses (avatars i gestió)

- **Una FK obligatòria condiciona l'estratègia d'esborrat**. "Eliminar un usuari" sembla trivial fins que descobreixes que mitja base de dades hi apunta. Anonimitzar és sovint la resposta correcta en sistemes amb històric — el patró GDPR estàndard.
- **El JWT stateless té un cost amagat: la revocació**. Un token signat és vàlid fins que expira, per definició. Si necessites poder "fer fora" algú a l'instant, has de reintroduir estat (consultar la BD) en algun punt. És el compromís clàssic stateless ↔ revocabilitat; aquí hem triat revocabilitat amb una query barata.
- **Els interceptors 401 ja existien, però fer-los útils al mòbil demanava un pont cap a l'estat de React**. La diferència entre "esborrar el token" i "tancar sessió de veritat" era un callback.
- **Filtrar dins de `_count` evita N+1**. Prisma permet expressar el comptador d'incidències resoltes declarativament dins del mateix `findMany`, mantenint la cerca en una sola anada a la BD.
