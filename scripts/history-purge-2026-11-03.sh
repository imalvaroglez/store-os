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
# DESVIACIÓN DOCUMENTADA del texto del plan: --invert-paths es indispensable.
# Sin él, filter-repo trata la lista como "conservar SOLO estos paths" (semántica
# de inclusión) y vacía el árbol de main en vez de excluir la contaminación
# (verificado 2026-11-03 en clon de prueba: árbol de main quedaba vacío y .local
# seguía en el historial; el check "árbol idéntico" nunca podría pasar).
git filter-repo --invert-paths --paths-from-file "$SCRATCH/paths.txt" --replace-refs delete-no-add

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
