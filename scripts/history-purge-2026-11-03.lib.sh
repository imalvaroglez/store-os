#!/usr/bin/env bash

purge_filter_history() {
  local paths_file="$1"
  git-filter-repo --sensitive-data-removal --invert-paths --paths-from-file "$paths_file"
}

purge_assert_paths_absent() {
  local paths_file="$1"
  local path

  while IFS= read -r path; do
    [ -z "$path" ] && continue
    if [ -n "$(git log --all --format= --name-only -- "$path")" ]; then
      printf 'FALLO: sigue en el historial: %s\n' "$path" >&2
      return 1
    fi
  done < "$paths_file"
}

purge_assert_same_tree() {
  local ref="$1"
  local expected_tree="$2"
  local actual_tree

  actual_tree="$(git rev-parse "$ref^{tree}")"
  [ "$actual_tree" = "$expected_tree" ] || {
    printf 'FALLO: el árbol de %s cambió (%s -> %s)\n' "$ref" "$expected_tree" "$actual_tree" >&2
    return 1
  }
}

purge_assert_changed_refs() {
  local refs_snapshot="$1"
  local changed_refs_file="$2"
  local tempdir
  local expected_names
  local actual_names

  tempdir="$(mktemp -d "${TMPDIR:-/tmp}/store-os-purge-ref-names.XXXXXX")"
  expected_names="$tempdir/expected"
  actual_names="$tempdir/actual"
  cut -f2 "$refs_snapshot" | sort > "$expected_names"
  sort "$changed_refs_file" > "$actual_names"
  if ! cmp -s "$expected_names" "$actual_names"; then
    echo "ABORT: el conjunto de refs cambiado no coincide con el snapshot aprobado." >&2
    diff -u "$expected_names" "$actual_names" >&2 || true
    rm -f "$expected_names" "$actual_names"
    rmdir "$tempdir" 2>/dev/null || true
    return 1
  fi
  rm -f "$expected_names" "$actual_names"
  rmdir "$tempdir"
}

purge_push_rewritten_refs() {
  local remote_url="$1"
  local refs_snapshot="$2"
  local repo="$3"
  local push_tmpdir
  local current_snapshot
  local old_sha ref new_sha
  local -a leases=()
  local -a refspecs=()

  push_tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/store-os-purge-push-check.XXXXXX")"
  current_snapshot="$push_tmpdir/current-refs.tsv"
  trap 'rm -rf "$push_tmpdir"' RETURN

  git ls-remote --refs "$remote_url" 'refs/heads/*' 'refs/tags/*' | sort > "$current_snapshot"
  if ! cmp -s "$refs_snapshot" "$current_snapshot"; then
    echo "ABORT: cambiaron refs remotas desde la verificación; no se actualizó ninguna ref." >&2
    diff -u "$refs_snapshot" "$current_snapshot" >&2 || true
    return 1
  fi

  git -C "$repo" remote remove origin >/dev/null 2>&1 || true
  git -C "$repo" remote add origin "$remote_url"
  while IFS=$'\t' read -r old_sha ref; do
    [ -n "$ref" ] || continue
    case "$ref" in
      refs/heads/*|refs/tags/*) ;;
      *) echo "ABORT: ref fuera del alcance aprobado: $ref" >&2; return 1 ;;
    esac
    new_sha="$(git -C "$repo" rev-parse --verify "$ref" 2>/dev/null)" || {
      echo "ABORT: desapareció la ref en el clon filtrado: $ref" >&2
      return 1
    }
    if [ "$old_sha" != "$new_sha" ]; then
      leases+=("--force-with-lease=$ref:$old_sha")
      refspecs+=("$new_sha:$ref")
    fi
  done < "$refs_snapshot"

  [ "${#refspecs[@]}" -gt 0 ] || { echo "ABORT: el filtro no cambió ninguna ref aprobada." >&2; return 1; }
  git -C "$repo" push --atomic "${leases[@]}" origin "${refspecs[@]}"
}
