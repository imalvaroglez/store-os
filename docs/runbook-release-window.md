# Runbook — Ventana diaria de liberación (#317)

Mecanismo: `.github/workflows/release-window.yml`. Orquestador programado que
**despacha el botón que ya existía** (`ci.yml` con `release_production=true`
sobre un SHA congelado de `main`). No abre gates nuevos; no relaja ninguno.

## Horario

- **Cron `25 11 * * *` UTC = 05:25 `America/Mexico_City`** (UTC-6 fijo; México
  no tiene DST). GitHub Actions puede encolar el arranque (típico 0–15 min).
- Duración medida del release dispatch: **18–25 min** (suites + deploy-rules +
  deploy + verificación). Objetivo: verificado ≤ 07:00, antes de que Fer
  arranque (~08:00).
- El scheduler SOLO INICIA a esa hora; si la cola retrasa, la ventana corre
  tarde pero completa — nunca se salta pruebas por el reloj.

## Qué hace la ventana, en orden

1. **Congela el candidato**: SHA de `origin/main` al arranque. Todo lo demás
   opera sobre ese SHA; si `main` avanza después, ese avance espera a mañana
   (el corte manda).
2. **Guard de contenido**: diff contra el tag `release/last`. Solo cambios
   documentales (`docs/`, `*.md`) o nada → **NO-OP** (nunca versión vacía).
3. **Guard de versión/notas (el existente)**: `scripts/check-release.cjs` con
   probe a producción. "Ya sirve esa versión" → NO-OP. Versión/notas
   inválidas → **fail-closed**.
4. **Despacho congelado**: `gh workflow run ci.yml --ref <SHA> -f
   release_production=true` — el run construye EXACTO ese commit (suites
   completas, deploy-rules con paridad, release guard, deploy Vercel prod).
5. **Espera el run** (`gh run watch --exit-status`, timeout 75 min). Gate en
   rojo → la ventana FALLA; **sin auto-reintento**.
6. **Verificación posdeploy**: sondea el `<meta name="store-os-version">` de
   `https://store-os-alpha.vercel.app` hasta coincidir con la versión del
   candidato; sin coincidencia → fail-closed.
7. **Trazabilidad**: tags `release/<versión>` y `release/last` sobre el SHA.

Anti-carreras: `concurrency: release-window` (una ventana a la vez; una
ventana tardía jamás cancela la anterior). Anti-duplicado: guard de versión
contra lo servido + tag `release/last`.

## Fallas y recuperación

| Síntoma | Acción |
|---|---|
| Gate del run en rojo (suite/deploy) | La ventana se detiene sola (fail-closed). Revisar el run; si es un flake conocido (ver #291), `gh run rerun <id> --failed` y luego **despacho manual** (abajo). Si es real: corregir en rama+PR; la historia queda Por liberar para la siguiente ventana. |
| El scheduler no arrancó / corrido tarde | **Despacho manual de respaldo**: Actions → `release-window` → Run workflow (sin dry_run). Idéntico camino y gates. Alternativa última: el despacho directo de siempre (`ci.yml` → `release_production=true`). |
| Ventana anterior aún corriendo | `concurrency` encola la nueva; no hay acción. |
| Producción no sirve la versión tras el deploy | La ventana falla en verificación. NO reintentar a ciegas: revisar el deploy en Vercel y el log del run; recuperar por despacho manual tras entender la causa. |

Ninguna recuperación salta pruebas: siempre reusa el camino completo del
dispatch (la única excepción Sev-1 con `sev1_reuse_ci` sigue siendo exclusiva
del runbook Sev-1).

## Qué NO hace la ventana

- No toca issues ni el tablero: el cierre `Por liberar → Hecho` lo reconcilia
  la sesión ejecutora tras leer el resultado y el tag, con evidencia.
- No construye desde ramas arbitrarias (solo SHAs de `main`).
- No escribe datos/seeds productivos; no crea versiones vacías.

## Notas para Fer

- **Dentro de la app:** la nota de cada versión viaja en
  `src/releases/releases.json` (se escribe en el PR de cada historia) y Fer la
  ve en el pie de la app al desplegar — disponible desde las ~07:00 aunque la
  sesión ejecutora esté caída.
- **Mensaje WhatsApp copiable (`docs/releases/notas-para-fer.md`):** lo
  redacta la sesión ejecutora al reconciliar el tablero tras la ventana (usa
  la sección "En esta versión" del job summary como fuente). Si la sesión
  está caída a la hora de la ventana, ese mensaje queda pendiente hasta su
  siguiente ciclo — el bloqueo se ve en el tablero (historias aún en Por
  liberar) y no pierde información.

## Primera vez / adopción

1. Mergear este workflow con sus dos revisiones.
2. **Dry-run**: Actions → `release-window` → Run workflow → `dry_run=true`.
   Debe imprimir candidato+versión y "NO se despachó nada".
3. **Ventana manual real** (bautismo): Run workflow sin dry_run con un
   candidato válido — valida congelamiento, dispatch, verificación y tags.
4. Desde entonces el cron gobierna; el tag `release/last` queda sembrado.
