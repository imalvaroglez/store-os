# Cero pinzas — Plan de limpieza (worktrees, historial contaminado, modo local)

> Decreto del PO: **cero pinzas** — nada de soportes temporales en la app ni en
> el repositorio. Este plan ataca las 3 pinzas identificadas el 2026-11-03:
> historial de git contaminado, ~22 worktrees de agentes sin triage, y el PR
> #111 (erradicación del modo local) estancado respecto a main.
>
> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans o
> subagent-driven-development, tarea por tarea. Los pasos usan checkboxes
> (`- [ ]`). Cada tarea declara qué NO hacer; las restricciones duras de abajo
> prevalecen sobre cualquier atajo.

**Goal:** dejar el repositorio sin pinzas: (1) triage y limpieza de worktrees
con evidencia, (2) script verificado + runbook para que el PO purge la
contaminación del historial, (3) PR #111 integrado con main y verde para
revisión del PO, (4) tablero y documentación al día.

**Verdad de base (investigación 2026-11-03, HEAD `09f50c5`):**

- La contaminación son **exactamente 39 paths** (verificado con
  `git log --all --pretty=format: --name-only | sort -u` sobre todo el
  historial): 28 bajo `.local/` y 11 duplicados macOS `" N.ext"`. No hay más
  ocultos en otros commits.
- Entraron por el merge del PR #97 (`ab4f51d`, segunda paternal vía `2ebe794`
  de la rama ya borrada `codex/migrate-adminstores`) y salieron del árbol en
  `34f4fd2` (PR #178). **Siguen en el historial.**
- `git for-each-ref --contains ab4f51d` sobre todas las ramas locales y
  remotas reales: **solo `main`** porta la contaminación. Las dos ramas que la
  portaban (`codex/migrate-adminstores`, `fix/retirar-datos-locales`) ya no
  existen en GitHub; quedan como refs de seguimiento obsoletas locales (se
  limpian con `git fetch --prune`). → El force-push posterior al purge toca
  **únicamente `main`**.
- **Ninguna rama local ni de PR abierto desciende de `ab4f51d`** (verificado
  rama por rama con `git merge-base --is-ancestor`). Reescribir main NO
  invalida los PRs abiertos: sus commits ancestros previos a la contaminación
  conservan sus SHA.
- 0 tags en el repo; 523 commits en `origin/main`.
- CI (`.github/workflows/ci.yml`): `push: branches: ['**']` valida y publica
  **solo al Preview de dev**; producción se publica únicamente con
  `workflow_dispatch` + input `release_production`. Un force-push a main NO
  despliega producción, pero SÍ dispara CI.
- PR #111 (`chore/eradicate-local-mode`, punta `9079ddd`): CI verde en su
  último push, pero contra main actual está **CONFLICTING / DIRTY** (main
  avanzó hoy con #96, #164, #178). Conflictos exactos:
  `src/app/AppShell.test.tsx` y `src/features/catalog/CatalogScreen.test.tsx`
  (verificado con `git merge-tree`); `AGENTS.md` y `CLAUDE.md` auto-mergear.

## Restricciones duras (no negociables, aplican a todas las tareas)

- **Jamás:** push a `main`, merge de PRs, force-push (solo el PO ejecuta el del
  paso de historial), operaciones contra `store-os-f7cf8` (producción), borrar
  o mover nada de `.local/` en disco (datos intocables del PO), emuladores
  Firebase locales (vetados).
- **Staging siempre con rutas explícitas.** NUNCA `git add -A` ni `git add .`
  (causa original del incidente).
- **`git-filter-repo` jamás corre en el repo principal** (los ~22 worktrees
  comparten su `.git`); solo en un clon temporal, empujando desde ahí.
- Verificación antes de declarar: comando + salida real como evidencia.
- El purge de historial se entrega como **script verificado + runbook**; el
  agente implementador solo lo ejecuta en modo `verify` (sin push).

---

## Mapa de triage de worktrees (verificado 2026-11-03)

`git worktree list` arroja 23 entradas: el repo principal + 22 en
`/private/tmp`. Estado sin commit: solo `node_modules` sin trackear en 4 de
ellas (regenerable, no es trabajo); WIP real solo en `production-gate` y
conflictos vivos en `reliability` (protegido).

### A. REMOVER (rama fusionada en main + rama remota ya borrada) — 3

| Worktree | Rama | Evidencia |
|---|---|---|
| `/private/tmp/store-os-firebase-release` | `codex/firebase-dev-project-fix-guarded` | Ancestro de main (entró con la cadena del PR #109); sin PR propio, sin rama remota; worktree limpio |
| `/private/tmp/store-os-issue-121-b870` | `codex/issue-121-defaults-b870` | PR #164 MERGED hoy 19:23 UTC; rama remota borrada; sucio solo `?? node_modules` |
| `/private/tmp/store-os-reliable-saves` | `codex/persist-entity-error-handling` | PR #96 MERGED hoy 19:22 UTC; rama remota borrada; sucio solo `?? node_modules`. **Matiz:** la issue #117 lo registra como worktree exclusivo del frente de fiabilidad → remover solo tras confirmar en #117 (ver T1 paso 1.3) |

### B. CONSERVAR (PR abierto o frente activo) — 17

| Worktree | Rama | Motivo |
|---|---|---|
| `/private/tmp/store-os-erase-local-mode` | `chore/eradicate-local-mode` | **PR #111 abierto** (objeto de T3) + issue #118 |
| `/private/tmp/store-os-fer-payment-display-integrity` | `codex/fer-payment-display-integrity` | PR #177 abierto (base #175) |
| `/private/tmp/store-os-fer-payment-ledger-integrity` | `codex/fer-payment-ledger-integrity` | PR #175 abierto (base #174) |
| `/private/tmp/store-os-fer-reservation-integrity` | `codex/fer-reservation-integrity` | PR #174 abierto (base #168) |
| `/private/tmp/store-os-issue-120-2324` | `codex/issue-120-photo-2324` | PR #163 abierto |
| `/private/tmp/store-os-issue-123-payments` | `codex/issue-123-payments` | PR #166 abierto |
| `/private/tmp/store-os-issue-126-allocation` | `codex/issue-126-allocation` | PR #167 abierto |
| `/private/tmp/store-os-issue-127-profit` | `codex/issue-127-profit` | PR #170 abierto (base #167) |
| `/private/tmp/store-os-issue-130-iconic` | `codex/issue-130-iconic` | PR #172 abierto |
| `/private/tmp/store-os-issue-131-alerts` | `codex/issue-131-alerts` | PR #169 abierto |
| `/private/tmp/store-os-issue-165-installments` | `codex/issue-165-installments` | PR #168 abierto |
| `/private/tmp/store-os-october-rebase` | `codex/october-assisted-close` | PR #115 abierto |
| `/private/tmp/store-os-purchase-trip` | `codex/purchase-feedback-backlog` | PR #114 abierto |
| `/private/tmp/store-os-issue-120-stack-check` | *(detached @ `28ac18d`)* | `28ac18d` = punta de `feat/order-capture-stack` = head del **PR #112 abierto**; sin rama propia. Conservar mientras viva #112/#163 |
| `/private/tmp/store-os-integration-t1` | `integration/tanda-1` | **Frente activo de la issue #171** (tanda 1 de integración); sin PR todavía |
| `/private/tmp/store-os-reliability` | `codex/reliability-review` | **PROTEGIDO (issue #117):** conflictos de merge sin resolver (`UU src/app/App.test.tsx`, `UU src/app/StoreProvider.tsx`). No usarlo, no borrarlo, no resetearlo |
| `/private/tmp/store-os-reliability-audit-117-118` | `codex/reliability-audit-117-118` | Misma punta (`93aebed`) que el frente protegido; auditoría #117/#118 en curso. No tocar sin decisión del PO |

### C. DECISIÓN DEL PO (no tocar en T1, solo reportar) — 2

| Worktree | Rama | Por qué decide el PO |
|---|---|---|
| `/private/tmp/store-os-production-gate` | `codex/production-release-gate` | La rama es una punta antigua de main (ancestro, sin PR), PERO el worktree tiene **WIP real sin commit**: `M .github/workflows/ci.yml`, `M docs/DEPLOYMENT.md`. Podría ser trabajo del PO sobre el flujo de liberación. No descartar sin revisar |
| `/private/tmp/store-os-excel-trial-safe` | `codex/e0-excel-trial-safe-unzip` | Nunca tuvo PR (verificado `gh pr list --state all --head`). Relacionada con E0 (#89, ya merged vía `feat/e0-excel-trial`); posiblemente el descompresor seguro del ciclo de cierre mensual. ¿Retomar o archivar? |

### D. Higiene de ramas locales (sin worktree) — reporte para T1

- **Borrables con `git branch -d`** (ancestros de main, rama remota ya
  inexistente): `codex/fer-04-precios-clienta`, `codex/fer-06-captura-rapida`,
  `codex/fer-07-revision-categorias`, `codex/fer-08-ticket-texto`,
  `codex/fer-interview-backlog`, `feat/e0-excel-trial`, `feat/e1-stock-integrity`,
  `codex/fer-11-acabado-catalogo` (PR #103 merged).
- **Existentes en remoto, fusionadas** (el PO las borra desde la UI de GitHub;
  un agente no hace `push --delete`): las 8 `perf/storefront-*` (PRs #77–#84).
- **Reportadas al PO, sin tocar:** `codex/backlog-audit-resolved` (PR #98
  CLOSED sin merge), `codex/restore-local-demo-mode` (PR #108 CLOSED y
  **excluido de integración** por regla permanente de arquitectura; existe
  también en remoto), `integration/preview-e1-e3` y su respaldo remoto
  `codex/backup-integration-preview-e1-e3-20261030` (integración antigua),
  `codex/fer-01-gastos-surtido` (solo remota; PR #95 CLOSED superseded por
  #110).

---

### Task 1: Triage y limpieza de worktrees

**Files:** ninguno (estado local de git + tablero; sin diff de repo, sin PR).

- [ ] **Step 1.1: Re-verificar el estado** (puede haber derivado desde el
  2026-11-03). Evidencia inicial: `git worktree list` y por worktree
  `git -C <path> status --porcelain`.

  ```bash
  cd /Users/imalvaroglez/Documents/GitHub/store-os
  git worktree list
  for wt in $(git worktree list --porcelain | grep '^worktree ' | sed 's|^worktree ||'); do
    echo "== $wt"; git -C "$wt" status --porcelain
  done
  ```

  Expected: misma foto que el mapa de arriba. Si algo cambió (worktree de más,
  rama fusionada nueva), re-triplicar con los mismos criterios antes de tocar.

- [ ] **Step 1.2: Remover los 2 worktrees sin matiz** (`firebase-release`,
  `issue-121-b870`). Por cada uno: verificar limpieza, remover, borrar rama
  local (`-d` = solo si está fusionada; es el cerrojo de seguridad).

  ```bash
  git -C /private/tmp/store-os-firebase-release status --porcelain   # Expected: vacío
  git worktree remove /private/tmp/store-os-firebase-release
  git branch -d codex/firebase-dev-project-fix-guarded

  git -C /private/tmp/store-os-issue-121-b870 status --porcelain     # Expected: solo "?? node_modules"
  git worktree remove --force /private/tmp/store-os-issue-121-b870   # --force SOLO por node_modules
  git branch -d codex/issue-121-defaults-b870
  ```

  `--force` se justifica únicamente cuando lo sin commit es `?? node_modules`
  (regenerable con `npm install`). Ante cualquier otra línea: PARAR y reportar.

- [ ] **Step 1.3: Remover `reliable-saves` tras confirmación.** La issue #117
  lo registra como worktree exclusivo del frente de fiabilidad
  (#96/#111/#117/#118). #96 ya está fusionado y #111 trabaja desde
  `store-os-erase-local-mode`, así que la estación quedó libre — pero se
  confirma antes:

  ```bash
  gh issue view 117 --json state,body --jq '.state'   # y releer el cuerpo por reasignaciones
  ```

  Si el frente/PO no lo reclama (o responde que ya no lo usa):

  ```bash
  git -C /private/tmp/store-os-reliable-saves status --porcelain     # Expected: solo "?? node_modules"
  git worktree remove --force /private/tmp/store-os-reliable-saves
  git branch -d codex/persist-entity-error-handling
  gh issue comment 117 --body "Worktree /private/tmp/store-os-reliable-saves liberado y removido: #96 fusionado y la rama ya no existe en remoto."
  ```

  Si el frente sigue vivo: dejar el worktree, anotarlo en la issue de T4 y
  continuar. **No forzar.**

- [ ] **Step 1.4: Higiene de refs.** Prune de refs de seguimiento obsoletas
  (incluye las 2 que aún portan contaminación localmente:
  `codex/migrate-adminstores` y `fix/retirar-datos-locales`) y borrado de las
  8 ramas locales fusionadas sin worktree de la sección D:

  ```bash
  git fetch origin --prune
  # Expected: desaparecen origin/codex/migrate-adminstores, origin/fix/retirar-datos-locales,
  # origin/codex/issue-121-defaults-b870, origin/codex/persist-entity-error-handling,
  # origin/codex/fer-09-restock-filter, origin/codex/feedback-continuity,
  # origin/codex/platform-users-view, origin/codex/projects-board
  for b in codex/fer-04-precios-clienta codex/fer-06-captura-rapida codex/fer-07-revision-categorias \
           codex/fer-08-ticket-texto codex/fer-interview-backlog feat/e0-excel-trial \
           feat/e1-stock-integrity codex/fer-11-acabado-catalogo; do git branch -d "$b"; done
  ```

  Expected: cada `-d` dice `deleted ... (was ...)`. Un `-d` que rehúsa = rama
  NO fusionada → no insistir con `-D`; reportarla en la sección C/D de la
  issue de T4.

- [ ] **Step 1.5: Verificación final.**

  ```bash
  git worktree list
  git branch -vv --merged origin/main
  ```

  Expected: quedan exactamente el repo principal + los 17 de la sección B (+
  los 2 de la sección C si el PO no decidió aún). Ningún worktree de la
  sección A/B del triage original fue removido por error. Pegar ambas salidas
  como evidencia en la issue de T4.

**Qué NO hacer en T1:** no tocar `/private/tmp/store-os-reliability` ni
`/private/tmp/store-os-reliability-audit-117-118`; no tocar los 2 worktrees de
la sección C; no borrar ramas de PRs abiertos ni de las reportadas al PO; no
`git worktree remove --force` fuera del caso `?? node_modules`; ningún push ni
staging (T1 no commitea nada).

### Task 2: Script de purge de historial + runbook para el PO

**Files:**
- Create: `scripts/history-purge-2026-11-03.sh` (ejecutable, `chmod +x`)
- Create: `docs/history-purge-2026-11-03.md` (runbook del PO)
- Rama propia desde main (p. ej. `ops/cero-pinzas-purge-tools`) + draft PR.

- [ ] **Step 2.1: Escribir el script** con EXACTO este contenido (los guards
  son parte del entregable; no "simplificar"):

```bash
#!/usr/bin/env bash
# history-purge-2026-11-03.sh — purge de la contaminación del 2026-11-03 del historial de git.
#
# QUÉ ELIMINA (y nada más): toda traza histórica de
#   - el directorio .local/ (28 archivos: capturas del corte de octubre con
#     datos reales de clientas — DATO SENSIBLE)
#   - 11 duplicados de sincronización macOS ("nombre 2.ext")
# Contexto: docs/superpowers/plans/2026-11-03-cero-pinzas.md (Tarea 2)
# Runbook: docs/history-purge-2026-11-03.md
#
# QUIÉN LO CORRE: el PO, deliberadamente. El modo verify (default) es seguro:
# clona el remoto en un directorio temporal y NO empuja nada. El modo push
# REESCRIBE origin/main (force) y es decisión humana; ningún agente lo ejecuta.
#
# REGLAS DURAS QUE AQUÍ SE HACEN VALER:
#   - nunca corre dentro del repo principal ni sus worktrees (comparten .git)
#   - falla cerrado si algún ref distinto de origin/main porta la contaminación
#   - falla cerrado si aparece un duplicado " N.ext" fuera de los 11 conocidos
#   - falla cerrado si el árbol (tree) de main cambia en un solo byte
#   - empuja únicamente refs/heads/main, con --force-with-lease anclado al SHA
#     previo a la reescritura
set -euo pipefail

REMOTE_URL="https://github.com/imalvaroglez/store-os.git"
FORBIDDEN_PREFIXES=("/Users/imalvaroglez/Documents/GitHub/store-os" "/private/tmp/store-os-")
BAD_MERGE="ab4f51d4b914815abfb1b02df69b7f38c64fe91c"  # merge del PR #97 que introdujo los archivos
MODE="${1:-verify}"

[ "$MODE" = "verify" ] || [ "$MODE" = "push" ] || { echo "uso: $0 [verify|push]" >&2; exit 2; }
command -v git-filter-repo >/dev/null || { echo "FALTA git-filter-repo: brew install git-filter-repo" >&2; exit 2; }
for p in "${FORBIDDEN_PREFIXES[@]}"; do
  case "$PWD" in "$p"*) echo "NO correr desde el repo principal ni sus worktrees: $PWD" >&2; exit 2 ;; esac
done

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/store-os-history-purge.XXXXXX")"
echo "== scratch: $SCRATCH"
git clone --quiet "$REMOTE_URL" "$SCRATCH/clone"
cd "$SCRATCH/clone"

OLD_TIP="$(git rev-parse origin/main)"
OLD_TREE="$(git rev-parse 'origin/main^{tree}')"
OLD_COUNT="$(git rev-list --count origin/main)"
echo "== tip actual de main: $OLD_TIP ($OLD_COUNT commits)"

echo "== portadores de la contaminación (debe ser SOLO origin/main):"
CARRIERS="$(git for-each-ref --contains "$BAD_MERGE" --format='%(refname)' refs/remotes/ | grep -v 'refs/remotes/origin/HEAD' || true)"
echo "$CARRIERS"
[ "$CARRIERS" = "refs/remotes/origin/main" ] || { echo "ABORT: otra rama remota porta la contaminación; revisar antes de purgar." >&2; exit 1; }

KNOWN_DUPES="docs/superpowers/specs/fer-04-precios-clienta 2.md
docs/superpowers/specs/fer-04-precios-clienta 3.md
docs/superpowers/specs/fer-06-captura-rapida 2.md
docs/superpowers/specs/fer-07-revision-categorias 2.md
docs/superpowers/specs/fer-08-ticket-texto 2.md
docs/superpowers/specs/fer-08-ticket-texto 3.md
docs/superpowers/specs/fer-11-acabado-catalogo 2.md
src/app/firebase/projectIds 2.ts
src/features/orders/OrderCard.test 2.tsx
src/features/orders/orderGrouping 2.ts
src/lib/orderMoney.test 2.ts"

STRAYS="$(git log --all --pretty=format: --name-only | sort -u \
  | grep -E ' [0-9]+\.[A-Za-z0-9]+$' | grep -vxF -f <(printf '%s\n' "$KNOWN_DUPES") || true)"
[ -z "$STRAYS" ] || { printf 'ABORT: duplicados " N.ext" desconocidos en el historial:\n%s\n' "$STRAYS" >&2; exit 1; }

{ echo '.local'; printf '%s\n' "$KNOWN_DUPES"; } > "$SCRATCH/paths.txt"
git filter-repo --paths-from-file "$SCRATCH/paths.txt" --replace-refs delete-no-add

# Verificación: falla cerrado ante cualquier resto.
[ -z "$(git log --all --oneline -- .local)" ] || { echo "FALLO: .local sigue en el historial" >&2; exit 1; }
while IFS= read -r p; do
  [ -z "$(git log --all --oneline -- "$p")" ] || { echo "FALLO: sigue en el historial: $p" >&2; exit 1; }
done <<< "$KNOWN_DUPES"
NEW_TREE="$(git rev-parse 'main^{tree}')"
[ "$NEW_TREE" = "$OLD_TREE" ] || { echo "FALLO: el árbol de main cambió ($OLD_TREE -> $NEW_TREE)" >&2; exit 1; }
echo "== purge OK: tip $OLD_TIP -> $(git rev-parse main); árbol idéntico: $NEW_TREE"
echo "== commits: $OLD_COUNT -> $(git rev-list --count main) (los commits que quedaron vacíos se descartan)"

if [ "$MODE" = "push" ]; then
  git remote add origin "$REMOTE_URL"
  git push --force-with-lease=main:"$OLD_TIP" origin refs/heads/main:refs/heads/main
  echo "== origin/main reescrito. CI correrá (solo Preview dev; producción es workflow_dispatch)."
  echo "== seguir el runbook: docs/history-purge-2026-11-03.md"
else
  echo "== MODO VERIFY: nada se empujó. Clon disponible para inspección en: $SCRATCH"
fi
```

- [ ] **Step 2.2: Verificar el script en modo verify** (esto es lo que el
  agente SÍ puede correr; nunca `push`). Desde `$HOME` o cualquier ruta fuera
  del repo y de `/private/tmp/store-os-*`:

  ```bash
  brew list git-filter-repo >/dev/null 2>&1 || brew install git-filter-repo
  bash scripts/history-purge-2026-11-03.sh verify
  ```

  Expected (evidencia a pegar en la issue de T4):
  - `portadores ... SOLO origin/main` con la línea `refs/remotes/origin/main`
  - `purge OK: tip 09f50c5... -> <sha nuevo>; árbol idéntico: <tree>`
  - `MODO VERIFY: nada se empujó`
  - `git ls-remote origin main` desde el repo principal sigue mostrando el
    SHA original (prueba de que el remoto no cambió).
  Después de capturar la evidencia: `rm -rf "$SCRATCH"`.

- [ ] **Step 2.3: Escribir el runbook** `docs/history-purge-2026-11-03.md`
  con: prerequisitos (`brew install git-filter-repo`; ningún agente empujando),
  pasos (verify → revisar salida → push → `gh run watch` en main → resincronizar
  el repo local: `git fetch origin --prune && git switch main && git reset --hard origin/main`
  → verificar PRs abiertos con `gh pr list --json number,mergeable`), el paso
  de **GitHub Support** para purgar vistas cacheadas de los commits colgantes
  (los objetos quedan inalcanzables pero visibles vía SHA/prs — obligatorio por
  tratarse de datos reales de clientas), verificación de que el repo no tiene
  forks (`gh api repos/imalvaroglez/store-os --jq .forks_count` → 0), y la nota
  de que producción NO se despliega solita (workflow_dispatch).

- [ ] **Step 2.4: Rama + draft PR.**

  ```bash
  git switch -c ops/cero-pinzas-purge-tools origin/main
  # escribir los dos archivos; staging EXPLÍCITO:
  git add scripts/history-purge-2026-11-03.sh docs/history-purge-2026-11-03.md
  git commit -m "chore: script verificado y runbook para purge de historial contaminado" -m "Co-Authored-By: Codex <noreply@anthropic.com>"
  git push -u origin ops/cero-pinzas-purge-tools
  gh pr create --draft --base main --title "chore: purge de historial contaminado (script + runbook para el PO)" --body "..."
  ```

  Expected: CI verde (`gh pr checks`); PR queda en draft esperando al PO. El
  script no se ejecuta en CI más allá de `bash -n` si se añade (opcional).

**Qué NO hacer en T2:** nunca ejecutar el script en modo `push`; nunca correr
`git filter-repo` en el repo principal ni en worktree alguno; nunca empujar
otro ref que no sea `main` desde el clon; no modificar la lista de paths (si el
paso de STRAYS aborta, el hallazgo se reporta, no se improvisa).

### Task 3: Preparar el PR #111 para revisión del PO

**Files:** conflicto en `src/app/AppShell.test.tsx` y
`src/features/catalog/CatalogScreen.test.tsx`; commits sobre la rama existente
`chore/eradicate-local-mode` (PR #111). Sin PR nuevo.

**Estado verificado 2026-11-03:** CI verde en el último push; `mergeable:
CONFLICTING`, `mergeStateStatus: DIRTY` contra main. Diff total: 42 archivos,
+884/−529. El worktree `/private/tmp/store-os-erase-local-mode` está limpio en
`9079ddd` = `origin/chore/eradicate-local-mode`.

- [ ] **Step 3.1: Integrar main (merge, no rebase** — la rama es compartida y
  el historial del repo ya usa merges de integración):

  ```bash
  cd /private/tmp/store-os-erase-local-mode
  git status --porcelain                      # Expected: vacío
  git fetch origin --prune
  git merge origin/main
  ```

  Expected: conflictos SOLO en los 2 archivos de arriba (AGENTS.md y CLAUDE.md
  auto-mergear). Si aparece cualquier otro conflicto, resolverlo también, pero
  reportarlo en el PR: era imprevisible desde el merge-tree.

- [ ] **Step 3.2: Resolver los 2 conflictos con criterio explícito.** #111
  reescribe ambos tests para mockear `AuthProvider`/`useAuth` con `vi.hoisted`
  y eliminar `saveState`/`storage` (parte de la erradicación). Main, por su
  lado, añadió comportamientos vía #164 (defaults de producto: Material en vez
  de Color/acabado), #102 (filtro "por surtir" + limpieza al cambiar tienda) y
  la vista de usuarios de plataforma. La resolución: **conservar la arquitectura
  de mocks de #111** (sin `saveState`, `useAuth` mockeado, `waitFor`) y
  **re-aplicar encima las expectativas de comportamiento llegadas de main**.
  Los tests no deben referenciar persistencia local eliminada.

- [ ] **Step 3.3: Verificación local completa** (sin emuladores — vetados):

  ```bash
  npm run typecheck && npm run test && npm run build
  ```

  Expected: verde todo. Si el gate del design system o cualquier test de
  migración/seguridad falla, la causa raíz se atiende aquí — no se salta ni se
  marca flaky sin diagnóstico.

- [ ] **Step 3.4: Commit + push de la rama del PR** (permitido: es la rama del
  PR, no main):

  ```bash
  git add src/app/AppShell.test.tsx src/features/catalog/CatalogScreen.test.tsx
  # (más cualquier archivo del merge ya resuelto, siempre con ruta explícita)
  git commit -m "merge: integrar main post-#96/#164/#178 en la erradicación del modo local" -m "Co-Authored-By: Codex <noreply@anthropic.com>"
  git push origin chore/eradicate-local-mode
  ```

- [ ] **Step 3.5: Cerrar con evidencia y dejarlo en manos del PO.**

  ```bash
  gh pr checks 111 --watch
  gh pr view 111 --json mergeable,mergeStateStatus
  gh pr comment 111 --body "Integrado main (post-#96/#164/#178). Conflictos resueltos en AppShell.test.tsx y CatalogScreen.test.tsx conservando los mocks sin persistencia local. CI verde. Listo para revisión del PO."
  ```

  Expected: checks en verde y `MERGEABLE`/`CLEAN`. El PR PERMANECE draft y
  abierto: **el merge requiere autorización explícita del PO y no es parte de
  este plan.**

**Qué NO hacer en T3:** no hacer merge del PR ni marcarlo "ready"; no hacer
rebase ni `--force` sobre la rama; no correr emuladores Firebase; no "resolver"
conflictos revirtiendo la erradicación (el modo local no regresa); no editar
ramas ajenas.

### Task 4: Documentación y tablero

**Files:** ninguna en el repo (la documentación viva ya viajó: este plan en su
PR; el runbook en T2). Solo GitHub Issues + Projects.

- [ ] **Step 4.1: Crear la issue de seguimiento de la limpieza** con criterios
  de aceptación (T1 ejecutado con evidencia; script+runbook en PR; #111
  mergeable; decisiones del PO sobre secciones C/D listadas) y agregarla al
  tablero. Mutaciones de `gh project` con **pacing ≥ 4 s** entre sí (límites de
  rate de la API de Projects) e idempotencia (verificar antes de escribir):

  ```bash
  gh issue create --title "[cero-pinzas] Limpieza de worktrees, purge de historial y cierre del modo local" \
    --body "<criterios de aceptación + lista de decisiones del PO (secciones C y D del plan)>"
  sleep 4
  gh project item-add 1 --owner imalvaroglez --url "<URL de la issue>"
  sleep 4
  gh project item-list 1 --owner imalvaroglez --limit 100   # localizar el item-id
  sleep 4
  gh project item-edit --id "<ITEM_ID>" --field "Status" --value "En curso"
  sleep 4
  gh project item-edit --id "<ITEM_ID>" --field "Tipo" --value "ops"
  sleep 4
  gh project item-edit --id "<ITEM_ID>" --field "Prioridad" --value "P1"
  ```

- [ ] **Step 4.2: Acomodar el tablero:** #118 (erradicación del modo local) en
  **En PR** mientras #111 siga abierto (verificar su estado actual con
  `gh project item-list` antes de escribir); comentar en #117 el destino del
  worktree `reliable-saves` (liberado o conservado, según T1); pegar en la
  issue nueva las evidencias de T1 (`git worktree list` final) y T2 (salida
  del modo verify).

- [ ] **Step 4.3: Cierre.** Las decisiones pendientes del PO (worktrees C,
  ramas D, ejecución del purge, merge de #111) quedan enlistadas en la issue;
  este plan se marca ejecutado y la issue pasa al estado que el PO decida.

**Qué NO hacer en T4:** no abrir PRs para documentación/feedback (regla del
tablero); no mutar el tablero en ráfaga (≥ 4 s); no cerrar issues ajenas ni
mover historias de producto sin su evidencia; no registrar estados de
liberación que no ocurrieron.

---

## Orden y dependencias

- T1 y T2 son independientes entre sí y de T3. T3 puede ir en paralelo.
- T4 va al final (registra resultados).
- La ejecución del purge por el PO puede ocurrir en cualquier momento después
  de que T2 se fusione; no invalida PRs abiertos (verificado) pero reescribe
  los SHA de main posteriores a `ab4f51d` — quien tenga main local viejo debe
  `git fetch --prune && git reset --hard origin/main` (el runbook lo dice).

## Resumen de decisiones que quedan para el PO (fuera de este plan)

1. Ejecutar el purge (`scripts/history-purge-2026-11-03.sh push`) — fuerza el
   historial; solo el PO.
2. Fate del worktree `production-gate` y su WIP sin commit (ci.yml,
   DEPLOYMENT.md).
3. Fate del worktree/rama `excel-trial-safe` (sin PR; ¿E4 del cierre mensual?).
4. Ramas reportadas: `backlog-audit-resolved` (#98 cerrado sin merge),
   `restore-local-demo-mode` (#108 excluido — no integrar jamás),
   `integration/preview-e1-e3` + respaldo, `perf/*` remotas fusionadas,
   `codex/fer-01-gastos-surtido` remota.
5. Merge del PR #111 (requiere autorización explícita; T3 solo lo deja listo).
