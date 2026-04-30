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

