#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/history-purge-2026-11-03.lib.sh"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/history-purge-test.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

REMOTE="$TMP_ROOT/origin.git"
REMOTE_RACE="$TMP_ROOT/race.git"
SOURCE="$TMP_ROOT/source"
git init --quiet --bare --initial-branch=main "$REMOTE"
git clone --quiet "$REMOTE" "$SOURCE" 2>/dev/null
git -C "$SOURCE" config user.name "History Purge Test"
git -C "$SOURCE" config user.email "history-purge-test@example.invalid"
git -C "$SOURCE" switch --quiet -c main
printf 'public tree\n' > "$SOURCE/README.md"
git -C "$SOURCE" add README.md
git -C "$SOURCE" commit --quiet -m "initial tree"
git -C "$SOURCE" push --quiet -u origin main

mkdir -p "$SOURCE/.local" "$SOURCE/docs/superpowers/specs"
printf 'synthetic sensitive marker\n' > "$SOURCE/.local/client.txt"
printf 'synthetic duplicate marker\n' > "$SOURCE/docs/superpowers/specs/fer-04-precios-clienta 2.md"
git -C "$SOURCE" add .local docs/superpowers/specs
git -C "$SOURCE" commit --quiet -m "synthetic contaminated commit"
BAD_COMMIT="$(git -C "$SOURCE" rev-parse HEAD)"

git -C "$SOURCE" rm --quiet -r .local docs/superpowers/specs
git -C "$SOURCE" commit --quiet -m "remove synthetic contaminated files"
printf 'feature work\n' > "$SOURCE/feature.txt"
git -C "$SOURCE" add feature.txt
git -C "$SOURCE" commit --quiet -m "feature work"
git -C "$SOURCE" switch --quiet -c feature
git -C "$SOURCE" tag release/test main
git -C "$SOURCE" push --quiet origin main feature --tags
cp -R "$REMOTE" "$REMOTE_RACE"

OLD_MAIN="$(git -C "$SOURCE" rev-parse main)"
OLD_MAIN_TREE="$(git -C "$SOURCE" rev-parse 'main^{tree}')"
OLD_FEATURE="$(git -C "$SOURCE" rev-parse feature)"
OLD_FEATURE_TREE="$(git -C "$SOURCE" rev-parse 'feature^{tree}')"
OLD_TAG="$(git -C "$SOURCE" rev-parse 'release/test^{commit}')"
git ls-remote --refs "$REMOTE" 'refs/heads/*' 'refs/tags/*' | sort > "$TMP_ROOT/refs.before"

rewrite_for_test() {
  local remote="$1"
  local target="$2"
  git clone --quiet --mirror "$remote" "$target"
  printf '.local\ndocs/superpowers/specs/fer-04-precios-clienta 2.md\n' > "$TMP_ROOT/paths.txt"
  git -C "$target" filter-repo --sensitive-data-removal --invert-paths --paths-from-file "$TMP_ROOT/paths.txt" >/dev/null
}

assert_rewrite_clean() {
  local repo="$1"
  test "$(git -C "$repo" rev-parse 'refs/heads/main^{tree}')" = "$OLD_MAIN_TREE"
  test "$(git -C "$repo" rev-parse 'refs/heads/feature^{tree}')" = "$OLD_FEATURE_TREE"
  test "$(git -C "$repo" rev-parse refs/heads/main)" != "$OLD_MAIN"
  test "$(git -C "$repo" rev-parse refs/heads/feature)" != "$OLD_FEATURE"
  test "$(git -C "$repo" rev-parse 'refs/tags/release/test^{commit}')" != "$OLD_TAG"
  test -z "$(git -C "$repo" log --all --format= --name-only -- .local)"
  test -z "$(git -C "$repo" log --all --format= --name-only -- 'docs/superpowers/specs/fer-04-precios-clienta 2.md')"
  if git -C "$repo" cat-file -e "$BAD_COMMIT^{commit}" 2>/dev/null; then
    test -z "$(git -C "$repo" for-each-ref --contains "$BAD_COMMIT" --format='%(refname)')"
  fi
  grep -Fxq refs/heads/main "$repo/filter-repo/changed-refs"
  grep -Fxq refs/heads/feature "$repo/filter-repo/changed-refs"
  grep -Fxq refs/tags/release/test "$repo/filter-repo/changed-refs"
}

REWRITE_RACE="$TMP_ROOT/rewrite-race.git"
rewrite_for_test "$REMOTE_RACE" "$REWRITE_RACE"
assert_rewrite_clean "$REWRITE_RACE"

# A remote change after the rewrite snapshot must stop the whole operation.
RACER="$TMP_ROOT/racer"
git clone --quiet "$REMOTE_RACE" "$RACER"
git -C "$RACER" config user.name "Concurrent Writer"
git -C "$RACER" config user.email "concurrent-writer@example.invalid"
git -C "$RACER" switch --quiet main
printf 'concurrent\n' > "$RACER/concurrent.txt"
git -C "$RACER" add concurrent.txt
git -C "$RACER" commit --quiet -m "concurrent update"
git -C "$RACER" push --quiet origin main
if (purge_push_rewritten_refs "$REMOTE_RACE" "$TMP_ROOT/refs.before" "$REWRITE_RACE") >"$TMP_ROOT/race.log" 2>&1; then
  echo "expected stale snapshot rejection" >&2
  exit 1
fi
grep -Fq "ABORT: cambiaron refs remotas" "$TMP_ROOT/race.log"
test "$(git --git-dir="$REMOTE_RACE" rev-parse refs/heads/main)" != "$(git -C "$REWRITE_RACE" rev-parse refs/heads/main)"
test "$(git --git-dir="$REMOTE_RACE" rev-parse refs/heads/feature)" = "$OLD_FEATURE"
test "$(git --git-dir="$REMOTE_RACE" rev-parse refs/tags/release/test)" = "$OLD_TAG"

# A fresh rewrite with an unchanged remote updates every branch and tag atomically.
REWRITE_OK="$TMP_ROOT/rewrite-ok.git"
rewrite_for_test "$REMOTE" "$REWRITE_OK"
assert_rewrite_clean "$REWRITE_OK"
purge_push_rewritten_refs "$REMOTE" "$TMP_ROOT/refs.before" "$REWRITE_OK"
test "$(git --git-dir="$REMOTE" rev-parse 'refs/heads/main^{tree}')" = "$OLD_MAIN_TREE"
test -z "$(git --git-dir="$REMOTE" log --all --format= --name-only -- .local)"
test -z "$(git --git-dir="$REMOTE" for-each-ref --contains "$BAD_COMMIT" --format='%(refname)')"

# Changed refs must match every reviewed public and GitHub-managed ref name.
printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/release/test\ncccccccccccccccccccccccccccccccccccccccc\trefs/pull/42/head\n' > "$TMP_ROOT/all-refs.tsv"
printf 'refs/heads/main\nrefs/tags/release/test\nrefs/pull/42/head\n' > "$TMP_ROOT/changed-refs"
purge_assert_changed_refs "$TMP_ROOT/all-refs.tsv" "$TMP_ROOT/changed-refs"
printf 'refs/heads/main\nrefs/tags/release/test\nrefs/pull/42/head\nrefs/pull/43/head\n' > "$TMP_ROOT/changed-refs-extra"
if purge_assert_changed_refs "$TMP_ROOT/all-refs.tsv" "$TMP_ROOT/changed-refs-extra" >/dev/null 2>&1; then
  echo "expected unexpected changed ref rejection" >&2
  exit 1
fi
printf 'history purge ref rewrite tests passed\n'
