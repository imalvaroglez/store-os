# Runbook — purge del historial contaminado (2026-11-03)

Herramienta: [`scripts/history-purge-2026-11-03.sh`](../scripts/history-purge-2026-11-03.sh). Snapshots del preflight actual: [`refs.tsv`](../scripts/history-purge-2026-11-03.refs.tsv) (refs públicas), [`pull-refs.tsv`](../scripts/history-purge-2026-11-03.pull-refs.tsv) (refs internas de PR) y [`main-tree.txt`](../scripts/history-purge-2026-11-03.main-tree.txt).

## Objetivo y alcance

Eliminar del historial alcanzable únicamente `.local/` y los 11 archivos duplicados de sincronización macOS listados por la herramienta. El árbol de `main` debe conservar exactamente el tree `bbcf44a4114c31062c7917c956c1cdcd7c8ce42f`.

El snapshot verificado el 2026-11-18 encontró 36 ramas, 11 tags y 333 refs internas `refs/pull/*`. Aunque solo 20 ramas y 11 tags contienen directamente el merge `ab4f51d4b914815abfb1b02df69b7f38c64fe91c`, el filtrado real reescribe los 380 refs del espejo: las 36 ramas, los 11 tags y las 333 refs de PR. Las 16 ramas restantes también tienen ancestros afectados. Por tanto, el trabajo preserva/rebasa todas las ramas públicas, incluidos los 18 heads de PR abiertos, las dos ramas portadoras sin PR (`codex/420-catalogo-estimado-iconic`, `fix/pricing-apply-ux-289`) y las otras 16 ramas. Los tags conservan sus nombres y apuntan a commits reescritos. Las 333 refs `refs/pull/*` son administradas por GitHub y no se empujan directamente; se requiere verificación con GitHub Support.

`forks_count=0`. Los manifiestos contienen SHAs exactos observados. Si se mueve cualquier SHA o cambia la lista de refs, la herramienta aborta. Después de integrar la herramienta, generar y revisar snapshots nuevos: el PR de esta herramienta también altera el inventario.

## Preservación local previa

Antes de la ejecución, inventariar cada clone y worktree afectado; guardar todos los cambios tracked y untracked, ramas locales y tags fuera de los repositorios afectados. En particular, preservar los cuatro planes sin seguimiento en `.zcode/plans/` y el WIP de los 17 worktrees identificados en el preflight. No resetear, limpiar, podar ni retirar ningún worktree hasta verificar sus respaldos y documentar su destino. No copiar datos productivos ni crear respaldo de los archivos sensibles fuera de un medio local protegido.

## Requisitos y guardas

- Ejecutar desde un checkout temporal independiente, no desde el repo principal ni un worktree. El mirror se crea con permisos `0700`, se elimina al salir y nunca imprime contenido de archivos sensibles.
- Requiere `git-filter-repo` con `--sensitive-data-removal` y `gh` autenticado. Confirma `forks_count=0`.
- El snapshot adjunto suma 380 refs exactas: 47 públicas (36 ramas y 11 tags) y 333 internas de PR. Si una sola cambia, la herramienta aborta. Repetir preflight, investigar y revisar un snapshot nuevo.
- `--invert-paths` es obligatorio; omitirlo interpretaría la lista como rutas que se conservan.
- El push actualiza solo las 47 refs públicas con refspecs explícitos, `--atomic` y `--force-with-lease` por cada SHA observado. Nunca empujar `refs/pull/*`; GitHub Support atiende esas refs y sus vistas cacheadas.
- `verify` conserva únicamente metadatos de SHA (commit-map, changed-refs y first-changed-commits) en una carpeta temporal privada que imprime al final. Ese directorio no contiene el mirror ni los archivos borrados; conservar los metadatos hasta terminar la revisión y el trámite con Support, y después eliminarlos.
- Para el preflight final, copiar el script/lib a una carpeta temporal privada e independiente. Ejecutar `bash history-purge-2026-11-03.sh snapshot /ruta/nueva/snapshot-aprobado`; inspeccionar los 46 + 333 SHA y el tree de main. Copiar esos tres manifiestos junto al script y correr `verify`. El modo `snapshot` elimina su mirror al salir y conserva solo los SHA.
- Push exige el argumento explícito `push --po-approved`. El PO autorizó el plan anterior; este alcance ampliado (36 ramas públicas, 11 tags y 333 refs internas de PR) requiere autorización explícita antes de escribir refs.

## Ejecución

1. Desde una copia aislada de la herramienta, generar el snapshot final con el modo `snapshot` descrito arriba; revisar cualquier movimiento de SHA/ref. Copiar los manifiestos a la carpeta de la herramienta y correr `bash scripts/history-purge-2026-11-03.sh verify`.
2. Inspeccionar metadatos: `changed-refs` debe coincidir con los 379 refs del snapshot; `first-changed-commits` y `commit-map` documentan el impacto. Verificar tree de `main`, ausencia de rutas sensibles y que cada head conserva su trabajo útil. Revisar especialmente los 17 PRs abiertos, las dos ramas portadoras sin PR y las 15 ramas restantes.
3. Respaldar y documentar todo el WIP local. Congelar escrituras y volver a generar el snapshot de ramas, tags, refs de PR y forks justo antes del push.
4. Solo con autorización explícita para el alcance ampliado y revisión independiente aprobada, ejecutar `bash scripts/history-purge-2026-11-03.sh push --po-approved`. El script vuelve a comprobar las 380 refs antes del push y verifica las 47 puntas públicas después.
5. Consultar CI para `main` y los 18 PRs abiertos; verificar las refs internas de PR con GitHub Support. No liberar producción como parte del purge: el tree de `main` no cambia y el push de limpieza no es una release de aplicación.
6. Contactar [GitHub Support](https://support.github.com/contact) para purgar vistas cacheadas y objetos inalcanzables, citando el commit contaminado y los SHA de `first-changed-commits`.
7. Repetir preflight de refs/forks y comprobar que ya no quedan rutas en el historial accesible. Sincronizar cada clone/worktree solo después de verificar el respaldo y reaplicar/rebasar su WIP. Retirar worktrees únicamente cuando sus commits y archivos estén a salvo.

## Verificación técnica del filtro

La prueba sintética de `scripts/history-purge-2026-11-03.test.sh` verifica conservación de árboles, eliminación de rutas, reescritura de ramas/tags, rechazo de snapshots remotos obsoletos y push atómico en un remoto temporal. Nunca usa datos reales.
