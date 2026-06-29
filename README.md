# CampusFix

> Plataforma multiplataforma de control i gestió d'incidències del campus universitari.

**Treball de Final de Grau** · Enginyeria Informàtica (Menció en Enginyeria del Software)
Escola d'Enginyeria · Universitat Autònoma de Barcelona (UAB) · Curs 2025/26

- **Autor:** Albert Vacas Martínez
- **Tutor:** Sergio Bachiller Rubia (Àrea de Ciències de la Computació i Intel·ligència Artificial)

---

## 📋 Descripció

CampusFix és un programari que connecta **alumnes**, **tècnics** i **administradors** per gestionar el manteniment de les infraestructures del campus. Cobreix el cicle complet d'una incidència: report mòbil amb geolocalització i foto, classificació automàtica amb IA, assignació al tècnic, validació fotogràfica i tancament amb premi de gamificació.

La traçabilitat del manteniment es garanteix amb una **màquina d'estats finits** que governa cinc estats: *Oberta → Assignada → En procés → Validada → Tancada*.

## 👥 Rols i interfícies

| Rol | Descripció | Interfície |
|---|---|---|
| **Alumne** (`STUDENT`) | Reporta incidències amb foto i GPS, en fa el seguiment i guanya punts | App mòbil |
| **Tècnic** (`TECHNICAL`) | Resol les incidències que té assignades i en documenta la resolució | App mòbil |
| **Administrador** (`ADMIN`) | Gestiona la plataforma, assigna tasques i analitza les dades | Panell web |

## ✨ Funcionalitats principals

- **Cicle de vida amb màquina d'estats** (XState) amb permisos per rol.
- **Geolocalització i SIG**: mapa d'incidències amb clustering i mapa de calor (Leaflet + PostGIS).
- **Classificació automàtica per IA** del text i la imatge (LangGraph + Google Gemini).
- **Auto-assignació de tasques** (algoritme determinista per categoria, càrrega i proximitat).
- **Notificacions en temps real**: push al mòbil (Expo) i actualització del panell admin via Server-Sent Events.
- **Gamificació**: sistema de punts i rànquings per fomentar la participació.
- **Seguretat**: autenticació JWT, RBAC, registre per invitació i compliment del RGPD.
- **Multiidioma** (català, castellà i anglès) a totes les interfícies (i18next).

## 🛠️ Stack tecnològic

**Backend** · Node.js · Express 5 · TypeScript · Prisma 7 · PostgreSQL + PostGIS (Supabase) · XState 5 · JWT · bcrypt · LangGraph · Google Gemini

**Panell web (admin)** · React · Vite · TypeScript · Tailwind CSS · Leaflet · Recharts · Server-Sent Events

**App mòbil** · React Native · Expo · Expo Router · NativeWind · Axios · React Hook Form + Zod · expo-secure-store

**Eines** · Git · Render (desplegament) · Vitest · jest-expo · LaTeX

## 📁 Estructura del repositori

```
TFG-CityFix/
├── backend/     # API REST: Express + Prisma + XState + IA (font de veritat)
├── frontend/    # Panell web d'administració (React + Vite)
├── app/         # Aplicació mòbil per a alumnes i tècnics (React Native + Expo)
└── files/       # Documentació, informes i resum web del projecte (files/index/)
```

## 🚀 Posada en marxa

> Requisits: Node.js 20+, una base de dades PostgreSQL amb PostGIS (p. ex. Supabase) i un compte de Google AI Studio per a la IA.

Clona el repositori i instal·la les dependències de cada mòdul (`npm install` dins de `backend/`, `frontend/` i `app/`). Cada mòdul necessita el seu propi fitxer `.env` amb les variables corresponents (com a mínim `DATABASE_URL` i `JWT_SECRET` al backend).

### Backend

```bash
cd backend
npm install
npm run build      # prisma generate
npm run dev        # servidor en mode desenvolupament (tsx watch)
```

### Panell web

```bash
cd frontend
npm install
npm run dev        # Vite dev server
```

### App mòbil

```bash
cd app
npm install
npm start          # Expo (escaneja el QR amb Expo Go)
```

## 🧪 Tests

El projecte disposa d'una bateria de proves automàtiques com a porta de qualitat:

```bash
cd backend  && npm test    # proves unitàries (Vitest) + smoke test (npm run smoke)
cd frontend && npm test    # proves de renderitzat (Vitest + Testing Library)
cd app      && npm test    # fluxos per rol (jest-expo + Testing Library)
```

---

<sub>Projecte acadèmic desenvolupat com a Treball de Final de Grau a la UAB (2025/26).</sub>
