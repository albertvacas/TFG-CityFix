# Problemes trobats durant el desenvolupament

Registre de bugs i incidències detectats durant el desenvolupament del TFG, amb la causa real i la correcció aplicada. Útil per al capítol de "Lliçons apreses" i per evitar repetir el mateix error més endavant.

---

## #1 — Pantalla en blanc al panel admin després d'assignar una incidència

**Sprint / fase**: Sprint 4 — Integració hardware

**Símptoma**
En entrar al detall d'una incidència `OPEN` al dashboard web, seleccionar un tècnic i prémer "Assignar", la pantalla quedava completament en blanc. Fer F5 carregava la pàgina correctament i mostrava l'estat ja com a `ASSIGNED` amb les opcions per iniciar o reassignar. La transició al backend, doncs, s'executava bé; el problema era purament de renderitzat al client.

**Causa real**
Inconsistència en la forma del `Report` que retornaven els diferents endpoints del backend.

- `GET /api/reports/:id` (`getReportById`) → retornava un `Report` complet amb `images: []` i `comments: []`.
- `PATCH /api/reports/:id/transition` (`transitionReport`) → només feia `include: { createdBy, assignedTo }`. Els camps `images` i `comments` **no eren a la resposta** (a Prisma, una relació no inclosa simplement no surt a l'objecte; no és un `[]` buit, és `undefined`).

A `frontend/src/pages/ReportDetailPage.tsx` el codi llegia:

```tsx
{report.images.length > 0 && ( ... )}
{report.comments.length > 0 && ( ... )}
```

Després d'una transició, `setReport(updated)` substituïa el report complet anterior per un d'incomplet. Al re-renderitzar:

```
report.images.length  →  TypeError: Cannot read properties of undefined (reading 'length')
```

Aquest error durant el render no es captura per cap *error boundary*, i React desmunta tot l'arbre. Resultat visual: pantalla en blanc. F5 dispara `getReportById`, que sí torna les arrays, i la pàgina torna a renderitzar bé.

**Bug latent extra**
A `getReportById`, el `comments: true` no incloïa l'autor del comentari. La pàgina llegia `c.author.name`, així que el primer cop que es creés un comentari de transició (per exemple, en disparar `RESOLVE` amb comentari justificatiu des del mòbil) i un admin obrís el detall, hauria petat amb el mateix patró: `Cannot read properties of undefined (reading 'name')`.

**Correcció aplicada**

- **Backend** [backend/src/services/report.ts](../backend/src/services/report.ts):
  - Nova constant `REPORT_INCLUDE` amb la forma completa: `createdBy`, `assignedTo`, `images`, `comments` (amb el seu `author` i ordenats per `createdAt asc`).
  - Nova constant `REPORT_LIST_INCLUDE` per a `getAllReports`, més lleugera (sense `images` ni `comments`) per estalviar ample de banda al llistar moltes incidències.
  - `createReport`, `getReportById` i `transitionReport` passen a fer `include: REPORT_INCLUDE`. **Una sola font de veritat** per a la forma del `Report`.

- **Frontend** [frontend/src/pages/ReportDetailPage.tsx](../frontend/src/pages/ReportDetailPage.tsx):
  - Optional chaining defensiu a totes les lectures: `(report.images?.length ?? 0) > 0`, `report.images?.map(...)`, `c.author?.name ?? 'Usuari'`. Així, si en un futur algun endpoint torna a retallar la forma, el component **degrada amagant la secció** en lloc de petar tot l'arbre.

**Lliçó apresa**

- **Contracte d'API uniforme**: tots els endpoints que retornin la mateixa entitat han de retornar-la amb la mateixa forma. Si un retorna un `Report` "lleuger" (sense relacions), ha de ser un *tipus diferent* explícitament (p. ex. `ReportSummary`).
- **Defensa en profunditat al client**: assumir que cada propietat opcional pot ser `undefined` i protegir amb `?.` o `?? []` les operacions sobre arrays. El cost és mínim i evita *crashes* totals davant respostes inesperades.
- **`Error boundaries`**: actualment el frontend no en té. Afegir-ne un al voltant de cada *page* permetria mostrar un missatge d'error amigable enlloc d'una pantalla blanca quan un component fa un *throw* durant el render.
- **Patró ja aplicat al mòbil**: a [app/app/(app)/incident/[id].tsx](../app/app/(app)/incident/%5Bid%5D.tsx) ja feia `const images = report.images ?? []`. Quan es va escriure el frontend admin, abans, encara no hi havia aquest patró establert; per això el bug només va aparèixer al web.

