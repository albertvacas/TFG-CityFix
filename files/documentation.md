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
