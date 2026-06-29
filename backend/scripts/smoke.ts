#!/usr/bin/env tsx
/**
 * Smoke-test del backend de CityFix/CampusFix.
 *
 * Comprova "des de fora" (HTTP real) les regles que el client mai intenta
 * trencar i que, per tant, no es poden validar des de l'app o el panell:
 * autenticació (401), control d'accés per rols (403), transicions d'estat
 * il·legals (400), visibilitat forçada al servidor, validació de fitxers (415)...
 *
 * Requereix el backend EN MARXA (npm run dev) contra una BD real.
 * En acabar, NETEJA les dades que ha creat (usuaris i incidència de prova)
 * fent servir el client Prisma del propi backend, per no deixar residus.
 *
 * Ús:
 *   npm run smoke
 *   API_URL=http://localhost:3000/api npm run smoke
 *   ADMIN_EMAIL=admin@uab.cat ADMIN_PASSWORD=secret npm run smoke
 *
 * Les comprovacions d'ADMIN només s'executen si proporciones ADMIN_EMAIL i
 * ADMIN_PASSWORD (un compte admin ja existent). La resta funcionen sempre.
 */

import { prisma } from '../src/config/db';

const API_URL = process.env.API_URL ?? 'http://localhost:3000/api';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Sufix únic per no xocar amb dades existents en re-execucions.
const SUFFIX = Date.now().toString(36);
const studentA = {
  email: `smoke.a.${SUFFIX}@uab.cat`,
  name: 'Smoke',
  surname: 'AlumneA',
  password: 'Password123!',
  nickname: `smoke_a_${SUFFIX}`,
};
const studentB = {
  email: `smoke.b.${SUFFIX}@uab.cat`,
  name: 'Smoke',
  surname: 'AlumneB',
  password: 'Password123!',
  nickname: `smoke_b_${SUFFIX}`,
};
// Emails creats per aquesta execució — els fem servir per a la neteja final.
const CREATED_EMAILS = [studentA.email, studentB.email];

// ---------------------------------------------------------------------------
// Utilitats
// ---------------------------------------------------------------------------
const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

let passed = 0;
let failed = 0;
let skipped = 0;
let connectionFailed = false;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ${c.green('✓')} ${name}`);
  } else {
    failed++;
    console.log(`  ${c.red('✗')} ${name}${detail ? c.gray(`  — ${detail}`) : ''}`);
  }
}
function skip(name: string, why: string) {
  skipped++;
  console.log(`  ${c.yellow('•')} ${c.gray(`${name} (omès: ${why})`)}`);
}
function section(title: string) {
  console.log(`\n${c.bold(title)}`);
}

type ApiOpts = { token?: string; body?: unknown; form?: FormData };
async function api(method: string, path: string, { token, body, form }: ApiOpts = {}) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (form) {
    payload = form; // FormData: fetch posa el Content-Type amb boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: payload });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* respostes sense cos */
  }
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// Comprovacions
// ---------------------------------------------------------------------------
async function runChecks() {
  console.log(c.bold(`\n🔎 Smoke-test del backend — ${API_URL}\n`));

  // 0) El servidor està viu?
  section('0. Disponibilitat');
  let health;
  try {
    health = await api('GET', '/health');
  } catch (e: any) {
    connectionFailed = true;
    console.log(c.red(`\n✗ No s'ha pogut connectar a ${API_URL}. Està el backend en marxa? (npm run dev)`));
    console.log(c.gray(`  ${e.message}`));
    return;
  }
  check('GET /health retorna 200 { status: "ok" }', health.status === 200 && health.json?.status === 'ok', `status ${health.status}`);

  // 1) Autenticació
  section('1. Autenticació i tokens');
  const noToken = await api('GET', '/reports');
  check('Sense token → 401', noToken.status === 401, `status ${noToken.status}`);

  const badToken = await api('GET', '/reports', { token: 'token-manipulat.aaa.bbb' });
  check('Token invàlid/manipulat → 401', badToken.status === 401, `status ${badToken.status}`);

  const badDomain = await api('POST', '/auth/register', {
    body: { ...studentA, email: `smoke.${SUFFIX}@gmail.com`, nickname: `smoke_x_${SUFFIX}` },
  });
  check('Registre amb domini no-UAB → rebutjat (4xx)', badDomain.status >= 400 && badDomain.status < 500, `status ${badDomain.status}`);

  // 2) Registre i login de dos estudiants
  section('2. Registre públic (STUDENT)');
  const regA = await api('POST', '/auth/register', { body: studentA });
  check('Registre alumne A amb email UAB → 201', regA.status === 201, `status ${regA.status} ${JSON.stringify(regA.json)}`);
  const regB = await api('POST', '/auth/register', { body: studentB });
  check('Registre alumne B amb email UAB → 201', regB.status === 201, `status ${regB.status}`);

  const dup = await api('POST', '/auth/register', { body: studentA });
  check('Registre amb email/nickname duplicat → 409', dup.status === 409, `status ${dup.status}`);

  const loginA = await api('POST', '/auth/login', { body: { email: studentA.email, password: studentA.password } });
  const tokenA = loginA.json?.token;
  check('Login alumne A → 200 + token', loginA.status === 200 && !!tokenA, `status ${loginA.status}`);

  const loginB = await api('POST', '/auth/login', { body: { email: studentB.email, password: studentB.password } });
  const tokenB = loginB.json?.token;
  check('Login alumne B → 200 + token', loginB.status === 200 && !!tokenB, `status ${loginB.status}`);

  const wrongPass = await api('POST', '/auth/login', { body: { email: studentA.email, password: 'incorrecta' } });
  check('Login amb contrasenya incorrecta → 401', wrongPass.status === 401, `status ${wrongPass.status}`);

  if (!tokenA || !tokenB) {
    console.log(c.red('\n✗ Sense tokens d\'estudiant no es poden fer la resta de comprovacions.'));
    return;
  }

  // 3) Crear incidència + visibilitat forçada
  section('3. Incidències i visibilitat per rol');
  const createA = await api('POST', '/reports', {
    token: tokenA,
    body: { title: `Smoke incidència ${SUFFIX}`, description: 'Generada pel smoke-test', latitude: 41.5025, longitude: 2.106, category: 'LIGHTING' },
  });
  const reportId = createA.json?.report?.report_id;
  check('Alumne A crea incidència → 201, estat OPEN', createA.status === 201 && createA.json?.report?.state === 'OPEN', `status ${createA.status}`);

  const listA = await api('GET', '/reports', { token: tokenA });
  const aSeesOwn = Array.isArray(listA.json?.reports) && listA.json.reports.some((r: any) => r.report_id === reportId);
  check('Alumne A veu la SEVA incidència al llistat', aSeesOwn);

  const listB = await api('GET', '/reports', { token: tokenB });
  const bSeesAs = Array.isArray(listB.json?.reports) && listB.json.reports.some((r: any) => r.report_id === reportId);
  check('Alumne B NO veu la incidència d\'A (visibilitat forçada al servidor)', !bSeesAs);

  // 4) Màquina d'estats: transicions il·legals
  section('4. Màquina d\'estats (RBAC dins XState)');
  if (reportId) {
    const studentClose = await api('PATCH', `/reports/${reportId}/transition`, { token: tokenA, body: { event: 'CLOSE' } });
    check('STUDENT intenta CLOSE des d\'OPEN → 400', studentClose.status === 400, `status ${studentClose.status}`);

    const badEvent = await api('PATCH', `/reports/${reportId}/transition`, { token: tokenA, body: { event: 'INVENTAT' } });
    check('Esdeveniment inexistent → 400', badEvent.status === 400, `status ${badEvent.status}`);

    const assignNoTarget = await api('PATCH', `/reports/${reportId}/transition`, { token: tokenA, body: { event: 'ASSIGN' } });
    check('ASSIGN sense assignedToId → 400', assignNoTarget.status === 400, `status ${assignNoTarget.status}`);
  } else {
    skip('Transicions d\'estat', 'no s\'ha pogut crear la incidència');
  }

  // 5) RBAC a endpoints d'admin
  section('5. Control d\'accés (RBAC)');
  const techAsStudent = await api('GET', '/users/technicians', { token: tokenA });
  check('STUDENT crida endpoint d\'ADMIN (/users/technicians) → 403', techAsStudent.status === 403, `status ${techAsStudent.status}`);

  // 6) Validació de fitxers
  section('6. Pujada d\'imatges');
  if (reportId) {
    const form = new FormData();
    form.append('image', new Blob(['no soc una imatge'], { type: 'text/plain' }), 'fake.txt');
    form.append('type', 'INITIAL');
    const badImage = await api('POST', `/reports/${reportId}/images`, { token: tokenA, form });
    check('Pujar fitxer no-imatge (text/plain) → 415', badImage.status === 415, `status ${badImage.status}`);
  } else {
    skip('Validació d\'imatge', 'no hi ha incidència');
  }

  // 7) Comprovacions com a ADMIN (opcionals)
  section('7. ADMIN (opcional)');
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const loginAdmin = await api('POST', '/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    const tokenAdmin = loginAdmin.json?.token;
    check('Login ADMIN → 200 + token', loginAdmin.status === 200 && !!tokenAdmin, `status ${loginAdmin.status}`);
    if (tokenAdmin) {
      const techs = await api('GET', '/users/technicians', { token: tokenAdmin });
      check('ADMIN pot llistar tècnics → 200', techs.status === 200, `status ${techs.status}`);

      const adminList = await api('GET', '/reports', { token: tokenAdmin });
      const adminSeesAll = Array.isArray(adminList.json?.reports) && adminList.json.reports.some((r: any) => r.report_id === reportId);
      check('ADMIN veu TOTES les incidències (inclosa la d\'A)', adminSeesAll);
    }
  } else {
    skip('Comprovacions d\'ADMIN', 'defineix ADMIN_EMAIL i ADMIN_PASSWORD per activar-les');
  }
}

// ---------------------------------------------------------------------------
// Neteja: elimina les dades creades per aquesta execució.
// Ordre: primer les incidències (FK Restrict cap a l'autor), després els usuaris.
// ---------------------------------------------------------------------------
async function cleanup() {
  try {
    const users = await prisma.user.findMany({
      where: { email: { in: CREATED_EMAILS } },
      select: { user_id: true },
    });
    if (users.length === 0) return;

    const ids = users.map((u) => u.user_id);
    const delReports = await prisma.report.deleteMany({ where: { createdById: { in: ids } } });
    const delUsers = await prisma.user.deleteMany({ where: { user_id: { in: ids } } });

    section('🧹 Neteja');
    console.log(c.gray(`  ${delUsers.count} usuari(s) i ${delReports.count} incidència(es) de prova eliminats.`));
  } catch (e: any) {
    section('🧹 Neteja');
    console.log(c.yellow(`  ⚠ No s'ha pogut netejar del tot: ${e.message}`));
    console.log(c.gray(`     Revisa i elimina manualment els registres amb prefix 'smoke_' si cal.`));
  }
}

function summary() {
  console.log(`\n${c.bold('Resum')}: ${c.green(`${passed} OK`)}, ${failed ? c.red(`${failed} FALLEN`) : '0 fallen'}, ${c.yellow(`${skipped} omesos`)}\n`);
}

// ---------------------------------------------------------------------------
(async () => {
  try {
    await runChecks();
  } catch (e: any) {
    failed++;
    console.error(c.red(`\nError inesperat al smoke-test: ${e.message}`));
  } finally {
    // Si el servidor estava caigut no s'ha creat res, però intentem netejar
    // igualment per cobrir execucions parcials anteriors d'aquest mateix sufix.
    if (!connectionFailed) await cleanup();
    await prisma.$disconnect().catch(() => {});
  }
  summary();
  process.exit(connectionFailed ? 2 : failed > 0 ? 1 : 0);
})();
