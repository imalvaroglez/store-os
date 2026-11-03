# Runbook — Purge del historial contaminado (2026-11-03)

Herramienta: [`scripts/history-purge-2026-11-03.sh`](../scripts/history-purge-2026-11-03.sh).
Contexto y decisiones: [`docs/superpowers/plans/2026-11-03-cero-pinzas.md`](superpowers/plans/2026-11-03-cero-pinzas.md).

**Qué elimina (y nada más):** toda traza histórica de `.local/` (28 archivos con
datos reales de clientas) y de los 11 duplicados de sincronización macOS
(`" N.ext"`). La punta del árbol de `main` NO cambia ni un byte: los archivos ya
salieron del árbol en `34f4fd2` (PR #178); solo se limpia el historial.

**Quién lo ejecuta:** exclusivamente el PO, desde su terminal, con ningún agente
corriendo. El modo `verify` es seguro (clona a un directorio temporal y no empuja
nada); el modo `push` REESCRIBE `origin/main` con force y es decisión humana.

## Prerequisitos

1. `brew install git-filter-repo` (verificado con 2.47.0).
2. Ningún agente empujando ramas mientras se ejecuta.
3. **Precondición de portadores (hallazgo 2026-11-03, corregido tras auditoría):**
   el script aborta si alguna rama remota distinta de `main` desciende del merge
   contaminado `ab4f51d`. Hoy hay exactamente **dos** portadores y ambos deben
   resolverse antes del `push`:
   - `docs/cero-pinzas-plan` (la de este mismo cambio): fusionar su PR y borrar
     la rama en GitHub.
   - `chore/eradicate-local-mode` (PR #111): se volvió portadora al integrar
     `main` en ella. Hay que **fusionar el PR #111** (o cerrarlo y borrar la
     rama — con el costo de re-aplicar el trabajo). El orden natural es:
     PR de purge-tools → PR #111 → purge.
   El guard es intencional: mientras una rama viva apunte al historial viejo,
   los objetos contaminados siguen alcanzables en GitHub.
4. Verificar que no hay forks (si hubiera, avisar a los forks antes de reescribir):
   `gh api repos/imalvaroglez/store-os --jq .forks_count` → debe ser `0`.

## Pasos

### 1. Verify (seguro, no empuja nada)

Correrlo SIEMPRE desde fuera del repo y de `/private/tmp/store-os-*` (el script
lo exige y aborta):

```bash
cd "$HOME"
bash /Users/imalvaroglez/Documents/GitHub/store-os/scripts/history-purge-2026-11-03.sh verify
```

Salida esperada (evidencia de la ejecución del 2026-11-03, réplica con la
precondición 3 satisfecha; nota de auditoría: este bloque es una
reconstrucción legible, no salida literal — las cifras sí son exactas, y con
los portadores activos el script imprime `ABORT` en vez de continuar):

```
== tip actual de main: 09f50c5f932002050450ca401d498f8f24ca65a5 (523 commits)
== portadores de la contaminación (debe ser SOLO origin/main):
refs/remotes/origin/main
== STRAYS: (vacío, OK)
== .local eliminado del historial: OK
== 11 duplicados eliminados del historial: OK
== purge OK: tip 09f50c5f... -> 404517ad...; árbol idéntico: de767a17...
== commits: 523 -> 523
== MODO VERIFY: nada se empujó.
```

Si aparece `ABORT: otra rama remota porta la contaminación`: revisar la lista
que imprime, fusionar/borrar esas ramas en GitHub y repetir. No editar el
script para saltarse el guard.

### 2. Push (reescribe `origin/main`; decisión humana)

```bash
cd "$HOME"
bash /Users/imalvaroglez/Documents/GitHub/store-os/scripts/history-purge-2026-11-03.sh push
```

El empuje usa `--force-with-lease` anclado al SHA previo: si alguien movió
`main` entre el verify y el push, el push se rehúsa. Solo toca `refs/heads/main`.

### 3. Vigilar CI

El force-push dispara CI (`.github/workflows/ci.yml`), que valida y publica
**solo al Preview de dev**. Producción NO se despliega sola: es
`workflow_dispatch` con input `release_production` (decisión aparte).

```bash
gh run watch   # elegir el run de la rama main
```

### 4. Resincronizar el repo local

Tras la reescritura, el `main` local viejo ya no sirve:

```bash
cd /Users/imalvaroglez/Documents/GitHub/store-os
git fetch origin --prune
git switch main
git reset --hard origin/main
```

Cualquier worktree con ramas antiguas al historial contaminado debe re-basarse
o descartarse; los PRs abiertos cuyo base quedó reescrito se revisan con:

```bash
gh pr list --json number,mergeable
```

(Los PRs abiertos cuyos commits son previos a la contaminación conservan sus
SHA. El plan lo verificó originalmente como "ninguna rama de PR abierto
desciende de `ab4f51d`", pero la auditoría corrigió ese dato: **el PR #111 sí
desciende** (por la integración de `main` del 2026-11-03) — por eso es
precondición del purge. Los demás 16 PRs abiertos no descienden y no requieren
rebase.)

### 5. Purga de vistas cacheadas en GitHub (OBLIGATORIO)

La reescritura deja los objetos contaminados inalcanzables, pero GitHub puede
seguir sirviendo vistas cacheadas de los commits colgantes (por SHA o desde
PRs antiguos). Al tratarse de **datos reales de clientas**, hay que pedir a
GitHub Support que purge esas vistas y ejecute `gc` sobre el repositorio:

- https://support.github.com/contact → solicitar remoción de contenido /
  cached views de commits inalcanzables, citando los SHA reescritos
  (`ab4f51d...` y los posteriores a él en el historial viejo).

### 6. Cierre

- Confirmar `gh api repos/imalvaroglez/store-os --jq .forks_count` → `0`.
- Registrar la liberación del purge como evidencia en la issue de seguimiento
  del plan cero-pinzas.

## Nota de desviación respecto al plan (2026-11-03)

El script del plan (paso 2.1 de `2026-11-03-cero-pinzas.md`) omitía
`--invert-paths` en el `git filter-repo`. Verificado en clon de prueba: sin esa
bandera, `--paths-from-file` se interpreta como *conservar solo esos paths* y el
árbol de `main` quedaba **vacío** (con `.local` aún presente en el historial);
el propio check de "árbol idéntico" jamás habría pasado. La corrección es una
bandera en una línea, marcada con comentario en el script, y la mecánica
completa se re-verificó en modo réplica (evidencia arriba). El PO puede vetar la
desviación al revisar este PR: en tal caso, el script debe corregirse antes de
cualquier `push`.
