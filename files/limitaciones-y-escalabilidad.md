# Limitaciones y escalabilidad

Este documento recoge los límites conocidos de la plataforma CityFix en su estado
actual y las mejoras propuestas para escalar más allá del volumen previsto para el
TFG. Para cada punto se describe: el comportamiento actual, por qué no escala, el
impacto real y la mejora propuesta con su prioridad.

> **Contexto de volumen.** El sistema está dimensionado y probado para un escenario
> de TFG (un campus, decenas de incidencias activas, pocos técnicos y admins
> concurrentes). Varias decisiones de diseño asumen explícitamente ese volumen y
> están acotadas a propósito. Las limitaciones siguientes **no son defectos** a ese
> nivel, sino el límite hasta donde el diseño actual es razonable.

---

## 1. Autoasignación de incidencias (panel web)

### Comportamiento actual

El endpoint `POST /api/reports/auto-assign` recibe una lista de `reportIds` y, para
cada uno, elige el técnico de la misma `workCategory` con menor carga de trabajo
(desempate por proximidad PostGIS y, en segundo desempate, round-robin temporal).
El procesamiento es **secuencial**: cada incidencia se confirma en la base de datos
antes de pasar a la siguiente, de modo que la carga del técnico y las distancias del
siguiente report ya reflejan la asignación anterior (coherencia dentro del lote).

Ficheros: `backend/src/controllers/autoAssign.ts`, `backend/src/services/autoAssign.ts`,
`backend/src/services/geo.ts`, `backend/src/services/report.ts` (`transitionReport`).

### ¿Se puede colapsar?

**Para el volumen previsto (lotes de 5–20, máximo 50), no.** Existen protecciones
que lo evitan:

- **Tope duro de 50 reports por llamada** (`autoAssign.ts` controller): el endpoint
  rechaza lotes mayores, acotando el coste máximo de una petición.
- **Notificaciones fire-and-forget**: el envío de push (Expo) y SSE no bloquea la
  respuesta; una caída temporal de Expo no cuelga la operación.
- **Cada transición se confirma de forma independiente**: un fallo puntual en un
  report no aborta el lote; se reporta en `skipped[]` y se continúa.

### Por qué no escala

1. **Procesamiento secuencial con consulta espacial N+1.** El bucle hace `await` por
   cada report. Por cada incidencia se ejecuta una consulta PostGIS `ST_Distance`
   independiente (`getNearestActiveDistances`) más, dentro de `transitionReport`,
   varias idas y vuelta a BD (`findUnique` del report, validación del asignado,
   `update`). Son ~3–5 round-trips de BD **en serie** por report → para 50, del orden
   de 150–250 idas y vueltas secuenciales dentro de **una única petición HTTP
   síncrona** que el admin mantiene abierta. Con latencia de red alta, la petición se
   alarga notablemente.

2. **Condición de carrera entre llamadas concurrentes.** El mapa de carga
   (`techState`) se calcula al inicio desde una instantánea y solo se actualiza
   **en memoria** dentro de esa llamada. Si dos admins (o el mismo admin dos veces)
   lanzan la autoasignación simultáneamente, cada petición tiene su propia copia de
   la carga y ambas pueden elegir al mismo "técnico menos cargado", produciendo un
   reparto desigual. No es una caída, es un fallo lógico de balanceo: no hay bloqueo
   ni recálculo transaccional de la carga entre peticiones.

3. **Efecto dominó de refresco en el frontend (ver también §2).** Cada asignación
   emite un evento SSE `report.transitioned`. Un lote de 50 genera 50 eventos, y la
   pantalla de asignaciones vuelve a cargar datos (`fetchData`) en cada uno, sin
   *debounce*. El coste del lote se multiplica en el cliente de cada admin conectado.

### Mejoras propuestas

| # | Mejora | Prioridad |
|---|--------|-----------|
| 1.1 | **Batchear la consulta espacial.** Sustituir las N llamadas a `getNearestActiveDistances` por una única consulta que calcule las distancias de todos los reports del lote a todos los candidatos de golpe (o precalcularlas antes del bucle). Elimina el N+1. | Alta |
| 1.2 | **Control de concurrencia / carga transaccional.** Recalcular la carga del técnico dentro de una transacción con bloqueo a nivel de fila, o serializar las autoasignaciones con un lock por categoría, para impedir la doble asignación entre peticiones concurrentes. | Alta |
| 1.3 | **Procesamiento asíncrono por cola.** Para lotes grandes, mover el trabajo a una cola (p. ej. BullMQ) y devolver un identificador de job, informando el progreso por SSE en lugar de mantener la petición HTTP abierta. Permitiría además subir o eliminar el tope de 50. | Media |
| 1.4 | **Debounce del refresco en el cliente** (detallado en §2). | Media |

---

<!-- Secciones adicionales pendientes de validar con el equipo (ver conversación). -->
