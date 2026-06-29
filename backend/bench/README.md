# Benchmarks i avaluació (suport per a la memòria del TFG)

Scripts per generar **mesures reals** que sustenten les afirmacions de la
secció *Resultats / Discussió* de l'informe:

| Script          | Què mesura / fa                               | Requisit del TFG |
| --------------- | --------------------------------------------- | ---------------- |
| `seed.ts`       | Pobla la BD amb incidències de prova (reversible) | suport RNF-03 |
| `unseed.ts`     | Reverteix el seed (esborra dades de prova)    | —                |
| `perf-geo.ts`   | Latència de les consultes geoespacials/dashboard | RNF-03 (< 500 ms) |
| `perf-sse.ts`   | Latència d'entrega d'esdeveniments SSE        | RNF-07 (< 200 ms) |
| `eval-ai.ts`    | Precisió de la classificació automàtica       | RF-14 / RF-15    |

## Requisits previs

- `.env` configurat amb `DATABASE_URL` (i `GEMINI_API_KEY` per a `eval-ai.ts`).
- Per a `perf-geo.ts`: la BD ha d'estar **poblada amb un volum realista** de
  dades (idealment centenars d'incidències) perquè la mesura sigui significativa.

## Execució

Des de la carpeta `backend/`:

```bash
# (Opcional però recomanat) Poblar la BD per a una mesura representativa de RNF-03
npx tsx bench/seed.ts                    # ~800 incidències de prova marcades
COUNT=1500 npx tsx bench/seed.ts         # volum a mida
npx tsx bench/unseed.ts                  # revertir-ho tot quan acabis

# RNF-03 — consultes geo/analytics (read-only, no muta res)
npx tsx bench/perf-geo.ts
ITER=200 npx tsx bench/perf-geo.ts      # més iteracions => p95/p99 més estables

# RNF-07 — latència SSE (servidor local efímer)
npx tsx bench/perf-sse.ts

# RF-14 — precisió de la classificació IA (fa crides reals a Gemini)
npx tsx bench/eval-ai.ts
DELAY_MS=7000 npx tsx bench/eval-ai.ts  # respecta el free tier (10 RPM)
```

> Cada script imprimeix un resum amb taules. **Copia la sortida sencera** i
> passa-la per integrar els números a l'informe.

## Notes de metodologia (honestes, per a la defensa)

- `perf-geo.ts` mesura a **nivell de servei** (consulta + round-trip a Supabase),
  no l'extrem-a-extrem HTTP. El clustering i el heatmap es calculen al **client**
  (Leaflet); el backend només serveix els punts amb un `findMany` filtrat.
- `perf-sse.ts` mesura sobre **loopback** (127.0.0.1): el cost real de xarxa
  (RTT navegador↔servidor) s'hi ha de sumar a part.
- `eval-ai.ts` és **text-only** i amb un conjunt reduït (~18 casos) curat a mà;
  no és un benchmark estadísticament robust, sinó una avaluació indicativa amb
  golden labels i discussió qualitativa. La prioritat es reporta com a encert
  exacte i com a encert ± 1 nivell (és intrínsecament subjectiva).


cd backend

# 1. Poblar la BD con ~800 incidencias de prueba (reversible, marcadas [SEED])
npx tsx bench/seed.ts

# 2. RNF-03 — latencia consultas geo/dashboard (solo lectura)
npx tsx bench/perf-geo.ts

# 3. RNF-07 — latencia SSE
npx tsx bench/perf-sse.ts

# 4. RF-14 — precisión clasificación IA (~2 min por el rate limit de Gemini)
npx tsx bench/eval-ai.ts

# 5. Cuando termines, limpiar la BD
npx tsx bench/unseed.ts
