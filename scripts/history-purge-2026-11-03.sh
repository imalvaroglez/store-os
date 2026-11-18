#!/usr/bin/env bash
# Rewrites only approved Git refs to remove the 2026-11-03 sensitive history.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REMOTE_URL="https://github.com/imalvaroglez/store-os.git"
MODE="${1:-verify}"
APPROVAL="${2:-}"

case "$MODE" in snapshot|verify|push) ;; *) echo "uso: $0 [snapshot /ruta/nueva | verify | push --po-approved]" >&2; exit 2 ;; esac
if [[ "$MODE" = snapshot && ( -z "$APPROVAL" || -e "$APPROVAL" ) ]]; then
  echo "snapshot requiere una ruta nueva para guardar manifiestos SHA-only." >&2
  exit 2
fi
if [[ "$MODE" = push && "$APPROVAL" != --po-approved ]]; then
  echo "ABORT: push requiere el argumento explícito --po-approved después del preflight final." >&2
  exit 2
fi
command -v git-filter-repo >/dev/null || { echo "FALTA git-filter-repo" >&2; exit 2; }
command -v gh >/dev/null || { echo "FALTA gh para comprobar forks" >&2; exit 2; }
case "$REPO_ROOT/" in
  /Users/imalvaroglez/Documents/GitHub/store-os/*|/private/tmp/store-os-*/*|*/.codex/worktrees/*/store-os/*)
    echo "ABORT: ejecuta desde una copia temporal independiente, no desde un repo/worktree de Store OS." >&2; exit 2 ;;
esac

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/store-os-history-purge.XXXXXX")"
chmod 700 "$SCRATCH"
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT HUP INT TERM
umask 077

EXPECTED_REFS="$SCRIPT_DIR/history-purge-2026-11-03.refs.tsv"
EXPECTED_PULL_REFS="$SCRIPT_DIR/history-purge-2026-11-03.pull-refs.tsv"
EXPECTED_TREE_FILE="$SCRIPT_DIR/history-purge-2026-11-03.main-tree.txt"
PATHS_FILE="$SCRATCH/paths.txt"
REMOTE_REFS="$SCRATCH/remote-refs.tsv"
ALL_REFS="$SCRATCH/all-refs.tsv"
CLONED_REFS="$SCRATCH/cloned-refs.tsv"
MIRROR="$SCRATCH/store-os.git"
BASELINE_MIRROR="$SCRATCH/store-os-before.git"

gh api repos/imalvaroglez/store-os --jq .forks_count > "$SCRATCH/forks-count"
FORKS="$(cat "$SCRATCH/forks-count")"
[ "$FORKS" = 0 ] || { echo "ABORT: forks_count=$FORKS; revisar y coordinar antes de reescribir." >&2; exit 1; }

if [[ "$MODE" = snapshot ]]; then
  SNAPSHOT_DIR="$APPROVAL"
  mkdir -m 700 "$SNAPSHOT_DIR"
  git clone --quiet --mirror "$REMOTE_URL" "$MIRROR"
  git -C "$MIRROR" for-each-ref --format='%(objectname)%09%(refname)' refs/heads refs/tags | sort > "$SNAPSHOT_DIR/history-purge-2026-11-03.refs.tsv"
  git -C "$MIRROR" for-each-ref --format='%(objectname)%09%(refname)' refs/pull | sort > "$SNAPSHOT_DIR/history-purge-2026-11-03.pull-refs.tsv"
  git -C "$MIRROR" rev-parse 'refs/heads/main^{tree}' > "$SNAPSHOT_DIR/history-purge-2026-11-03.main-tree.txt"
  [ "$(wc -l < "$SNAPSHOT_DIR/history-purge-2026-11-03.refs.tsv" | tr -d ' ')" -gt 0 ] || { echo "ABORT: snapshot público vacío." >&2; exit 1; }
  echo "== snapshot creado: $SNAPSHOT_DIR"
  echo "== refs públicas: $(wc -l < "$SNAPSHOT_DIR/history-purge-2026-11-03.refs.tsv" | tr -d ' '); refs/pull: $(wc -l < "$SNAPSHOT_DIR/history-purge-2026-11-03.pull-refs.tsv" | tr -d ' ')"
  echo "== main tree: $(cat "$SNAPSHOT_DIR/history-purge-2026-11-03.main-tree.txt")"
  exit 0
fi

EXPECTED_MAIN_TREE="$(cat "$EXPECTED_TREE_FILE")"

git ls-remote --refs "$REMOTE_URL" 'refs/heads/*' 'refs/tags/*' | sort > "$REMOTE_REFS"
git ls-remote --refs "$REMOTE_URL" 'refs/pull/*' | sort > "$SCRATCH/remote-pull-refs.tsv"
cat "$REMOTE_REFS" "$SCRATCH/remote-pull-refs.tsv" | sort > "$ALL_REFS"
cat "$EXPECTED_REFS" "$EXPECTED_PULL_REFS" | sort > "$SCRATCH/expected-all-refs.tsv"
if ! cmp -s "$EXPECTED_REFS" "$REMOTE_REFS" || ! cmp -s "$EXPECTED_PULL_REFS" "$SCRATCH/remote-pull-refs.tsv"; then
  echo "ABORT: cambió el snapshot de refs desde su revisión; no se reescribió ni empujó nada." >&2
  diff -u "$SCRATCH/expected-all-refs.tsv" "$ALL_REFS" >&2 || true
  exit 1
fi

git clone --quiet --mirror "$REMOTE_URL" "$MIRROR"
git -C "$MIRROR" for-each-ref --format='%(objectname)%09%(refname)' refs/heads refs/tags refs/pull | sort > "$CLONED_REFS"
cmp -s "$ALL_REFS" "$CLONED_REFS" || { echo "ABORT: el clon espejo no coincide con el snapshot completo remoto." >&2; exit 1; }

OLD_MAIN="$(git -C "$MIRROR" rev-parse refs/heads/main)"
OLD_TREE="$(git -C "$MIRROR" rev-parse 'refs/heads/main^{tree}')"
[ "$OLD_TREE" = "$EXPECTED_MAIN_TREE" ] || { echo "ABORT: cambió el árbol de main: $OLD_TREE" >&2; exit 1; }
BRANCH_COUNT="$(awk -F '\t' '$2 ~ /^refs\/heads\// {n++} END {print n+0}' "$REMOTE_REFS")"
TAG_COUNT="$(awk -F '\t' '$2 ~ /^refs\/tags\// {n++} END {print n+0}' "$REMOTE_REFS")"
PULL_COUNT="$(wc -l < "$SCRATCH/remote-pull-refs.tsv" | tr -d ' ')"

cat > "$PATHS_FILE" <<'PATHS'
.local
docs/superpowers/specs/fer-04-precios-clienta 2.md
docs/superpowers/specs/fer-04-precios-clienta 3.md
docs/superpowers/specs/fer-06-captura-rapida 2.md
docs/superpowers/specs/fer-07-revision-categorias 2.md
docs/superpowers/specs/fer-08-ticket-texto 2.md
docs/superpowers/specs/fer-08-ticket-texto 3.md
docs/superpowers/specs/fer-11-acabado-catalogo 2.md
src/app/firebase/projectIds 2.ts
src/features/orders/OrderCard.test 2.tsx
src/features/orders/orderGrouping 2.ts
src/lib/orderMoney.test 2.ts
PATHS
KNOWN_DUPES="$SCRATCH/known-duplicates.txt"
tail -n +2 "$PATHS_FILE" > "$KNOWN_DUPES"
STRAYS="$(git -C "$MIRROR" log --all --pretty=format: --name-only | sort -u | grep -E ' [0-9]+\.[A-Za-z0-9]+$' | grep -vxF -f "$KNOWN_DUPES" || true)"
[ -z "$STRAYS" ] || { printf 'ABORT: duplicados " N.ext" no aprobados:\n%s\n' "$STRAYS" >&2; exit 1; }

printf '%s\n' "== snapshot: $BRANCH_COUNT ramas + $TAG_COUNT tags + $PULL_COUNT refs internas de PR"
printf '%s\n' "== main: $OLD_MAIN | árbol: $OLD_TREE"

git clone --quiet --mirror "$MIRROR" "$BASELINE_MIRROR"
git -C "$MIRROR" filter-repo --sensitive-data-removal --invert-paths --paths-from-file "$PATHS_FILE"
source "$SCRIPT_DIR/history-purge-2026-11-03.lib.sh"
(cd "$MIRROR" && purge_assert_paths_absent "$PATHS_FILE")
(cd "$MIRROR" && purge_assert_same_tree refs/heads/main "$OLD_TREE")
purge_assert_commit_map_changes_limited_to_paths "$MIRROR/filter-repo/commit-map" "$BASELINE_MIRROR" "$MIRROR" "$PATHS_FILE"

purge_assert_changed_refs "$ALL_REFS" "$MIRROR/filter-repo/changed-refs"

printf '%s\n' "== purge verificado: árbol main idéntico; paths sensibles ausentes; $(wc -l < "$ALL_REFS" | tr -d ' ') refs del snapshot reescritas ($BRANCH_COUNT ramas, $TAG_COUNT tags, $PULL_COUNT refs PR)"
printf '%s\n' "== primeros commits afectados:"
cat "$MIRROR/filter-repo/first-changed-commits"
METADATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/store-os-purge-metadata.XXXXXX")"
chmod 700 "$METADATA_DIR"
cp "$MIRROR/filter-repo/commit-map" "$MIRROR/filter-repo/changed-refs" "$MIRROR/filter-repo/first-changed-commits" "$METADATA_DIR/"
cp "$REMOTE_REFS" "$SCRATCH/remote-pull-refs.tsv" "$ALL_REFS" "$METADATA_DIR/"
exec > >(tee "$METADATA_DIR/run.log") 2>&1
printf '%s\n' "== mapa de SHA (sin contenido sensible): $METADATA_DIR; revisar los $BRANCH_COUNT heads y $PULL_COUNT refs/pull con GitHub Support"
if [[ "$MODE" = push ]]; then
  gh api repos/imalvaroglez/store-os --jq .allow_forking > "$SCRATCH/allow-forking-before-push"
  ALLOW_FORKING="$(cat "$SCRATCH/allow-forking-before-push")"
  [ "$ALLOW_FORKING" = false ] || { echo "ABORT: deshabilita temporalmente la creación de forks antes del purge." >&2; exit 1; }
  gh api repos/imalvaroglez/store-os --jq .forks_count > "$SCRATCH/forks-count-before-push"
  FORKS="$(cat "$SCRATCH/forks-count-before-push")"
  [ "$FORKS" = 0 ] || { echo "ABORT: aparecieron forks antes del push (forks_count=$FORKS); coordinar antes de seguir." >&2; exit 1; }
  git ls-remote --refs "$REMOTE_URL" 'refs/heads/*' 'refs/tags/*' 'refs/pull/*' | sort > "$SCRATCH/before-push-all.tsv"
  cmp -s "$SCRATCH/expected-all-refs.tsv" "$SCRATCH/before-push-all.tsv" || { echo "ABORT: cambió alguna ref pública o refs/pull antes del push." >&2; exit 1; }
  cp "$SCRATCH/before-push-all.tsv" "$METADATA_DIR/all-refs-before-push.tsv"
  PUSH_STATUS=0
  purge_push_rewritten_refs "$REMOTE_URL" "$REMOTE_REFS" "$MIRROR" "$METADATA_DIR" || PUSH_STATUS=$?
  git ls-remote --refs "$REMOTE_URL" 'refs/pull/*' | sort > "$METADATA_DIR/pull-refs-after-attempt.tsv"
  if [ "$PUSH_STATUS" -ne 0 ]; then
    echo "FALLO: el push o su verificación posterior falló (código $PUSH_STATUS); conservar este directorio privado y no restaurar SHAs anteriores."
    exit "$PUSH_STATUS"
  fi
  purge_assert_same_ref_snapshot "$SCRATCH/remote-pull-refs.tsv" "$METADATA_DIR/pull-refs-after-attempt.tsv" "refs/pull (nombres y SHA)"
  gh api repos/imalvaroglez/store-os --jq .allow_forking > "$SCRATCH/allow-forking-after-push"
  ALLOW_FORKING="$(cat "$SCRATCH/allow-forking-after-push")"
  [ "$ALLOW_FORKING" = false ] || { echo "FALLO: se habilitó la creación de forks durante el push; investigar antes de continuar." >&2; exit 1; }
  gh api repos/imalvaroglez/store-os --jq .forks_count > "$SCRATCH/forks-count-after-push"
  FORKS="$(cat "$SCRATCH/forks-count-after-push")"
  [ "$FORKS" = 0 ] || { echo "FALLO: forks_count=$FORKS tras el push; coordinar limpieza con cada fork antes de continuar." >&2; exit 1; }
  git ls-remote --refs "$REMOTE_URL" 'refs/heads/*' 'refs/tags/*' | sort > "$SCRATCH/after-push.tsv"
  while IFS=$'\t' read -r _ ref; do
    expected="$(git -C "$MIRROR" rev-parse "$ref")"
    actual="$(awk -v r="$ref" '$2 == r {print $1}' "$SCRATCH/after-push.tsv")"
    [ "$actual" = "$expected" ] || { echo "FALLO: ref remota no coincide tras push: $ref" >&2; exit 1; }
  done < "$REMOTE_REFS"
  echo "== $BRANCH_COUNT ramas y $TAG_COUNT tags verificadas tras push. refs/pull son de GitHub; verificar y solicitar purge a Support."
else
  echo "== VERIFY: sin cambios remotos. Scratch eliminado al terminar."
fi
