# Migración de la gestión a GitHub Projects (tablero kanban)

Fecha: 2026-11-01. Estado: diseño conversado y aprobado por el PO; spec pendiente
de revisión. Se consolida la reorganización del PR #116 (backlog conciliado de
41 entradas y plan de acción de Fer).

## Problema

El estado del trabajo vive en `docs/backlog.json`: un archivo que solo cambia
por commit, sin vista de cola, con dependencias escritas a mano que se
desactualizan. La fila de PRs apilados solo se ve inspeccionando GitHub a mano.
Y toda entrega exige spec de archivo aunque muchos cambios solo necesitan
criterios de aceptación.

Dolores confirmados por el PO: **seguimiento de estado, exceso de specs y
visibilidad de la fila**. La ceremonia de PRs (rama + draft + CI + revisión
humana) se conserva tal cual.

## Decisiones

1. **El tablero es la única fuente de estado.** Un Projects (V2) "Store OS"
   con campo `Estado`: Backlog / Especificado / En curso / En PR / Hecho.
   Campos mínimos: `Prioridad` (P0–P3), `Tipo` (feature / deuda / ops) y
   `Ciclo` (fases del plan de acción de Fer). Vistas: **Tablero** (agrupado
   por Estado, solo issues), **Cola** (tabla por Ciclo + Prioridad) y
   **PRs abiertos** (items tipo pull). Nada más; lo que falte se agrega después.
2. **La issue es la unidad de trabajo.** Cuerpo: Problema / Criterios de
   aceptación / Dependencias / Notas. Por defecto eso es toda la "spec".
   La spec de archivo pasa de obligatoria a **excepcional**: solo cuando hay
   decisiones de arquitectura o reglas de negocio; viaja dentro del PR
   (regla actual intacta) y se enlaza desde la issue.
3. **El repo guarda decisiones duraderas**: specs, ADRs, el plan de acción de
   Fer, el contexto de descubrimiento (entrevista, diagnóstico, análisis del
   Excel) y las convenciones (`CLAUDE.md`, `AGENTS.md`, `LOOPS.md`). Ningún
   documento del repo vuelve a registrar estados vivos.
4. **Agentes**: consultan y actualizan el tablero con `gh project` / `gh issue`
   al iniciar sesión y al cambiar de fase. Si `gh` falla, preguntan; no adivinan.
5. **No cambia**: verde antes de PR (`typecheck && test && build`), CI completo,
   revisión y merge humanos, cero costos (Projects es gratis; no toca Firebase).

## Migración (fuente: PR #116)

Ejecutar después de que el PO mergee #116, para partir del backlog conciliado.

- Script `scripts/migrate-backlog-to-projects.cjs` (idempotente, con
  `--dry-run`): lee `docs/backlog.json` de `main` post-#116 y crea una issue
  por entrada, con los criterios del JSON en el cuerpo, la agrega al proyecto
  y fija Estado / Prioridad / Tipo / Ciclo.
- Mapeo de estado JSON → columna: `idea`/`refining` → Backlog;
  `specced`/`awaiting-approval` → Especificado; `in-progress` → En curso
  (o En PR si tiene PR abierto); `done` → Hecho con issue cerrada;
  `blocked` → columna de su fase + label `bloqueado` + motivo en el cuerpo.
- El "Orden" del plan de acción (0, paralelo, 1A/1B, 2–8) → campo `Ciclo`.
- `Tipo` se asigna desde el plan de acción (FER-xx → feature; deuda y
  herramientas operativas → deuda/ops); lo dudoso queda feature y se corrige
  en el tablero.
- El proyecto vive a nivel de usuario (`imalvaroglez`), nombre "Store OS".
- Los PR abiertos del inventario del plan (#95–#115 vigentes) se agregan como
  items tipo pull (vista "PRs abiertos"); la issue correspondiente enlaza la
  implementación en su cuerpo. No se duplican entregas en el Tablero.
- Automatizaciones del proyecto (UI o GraphQL): PR abierto → En PR;
  merge → Hecho + cierre de la issue enlazada.
- En el mismo PR del repo, tras verificar el tablero: se elimina
  `docs/backlog.json`, `docs/BACKLOG.md` queda solo como contexto de
  descubrimiento + puntero al tablero, y se actualizan `LOOPS.md`, `CLAUDE.md`
  y `AGENTS.md` (paridad obligatoria).

## Secuencia

1. PO mergea #116 (docs-only, validado, sin conflictos).
2. Rama `codex/projects-board` se rebasa sobre ese `main`.
3. Script: dry-run → revisión → ejecución real → verificación del tablero.
4. Commit de docs (borrado del JSON, adelgazamiento, reglas para agentes).
5. Draft PR con spec + script + docs; CI verde; el PO valida el tablero en
   GitHub y hace merge.

## Fuera de alcance

- Mergear #116 y disponer de #95 (reemplazado por #110) y #98 (se solapa con
  la reconciliación): decisión del responsable; los agentes no cierran PRs ajenos.
- Implementar features del plan de acción (FER-18/19, cobros, variantes…):
  quedan como issues listas para spec/plan cuando les toque el Ciclo.
- Mantener `docs/backlog.json` como espejo: fuente única, sin doble registro.

## Validación

- Dry-run contra el JSON de #116: 41 issues proyectadas, sin IDs perdidos ni
  duplicados (mismo criterio de la validación del propio plan).
- Tras ejecutar: conteo de items del proyecto == entradas migradas + PRs
  abiertos; columnas y campos correctos (`gh project item-list`).
- CI del PR en verde (typecheck, test, build). Sin E2E nuevo: es un cambio
  documental y de herramienta, no toca la aplicación.
