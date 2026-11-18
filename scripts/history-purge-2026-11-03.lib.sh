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

purge_assert_commit_map_changes_limited_to_paths() {
  local commit_map="$1"
  local original_repo="$2"
  local rewritten_repo="$3"
  local paths_file="$4"
  local old_sha new_sha old_commit parent_commit new_commit changed_paths changed_path allowed_path allowed

  git -C "$original_repo" fetch --quiet --no-tags "$rewritten_repo" '+refs/*:refs/purge-rewritten/*' || {
    echo "FALLO: no se pudieron cargar los commits reescritos para comparar el trabajo." >&2
    return 1
  }

  while read -r old_sha new_sha; do
    [ -n "$old_sha" ] || continue
    case "$old_sha" in old) continue ;; esac
    old_commit="$(git -C "$original_repo" rev-parse --verify "$old_sha^{commit}" 2>/dev/null)" || {
      printf 'FALLO: no se pudo resolver el commit original %s\n' "$old_sha" >&2
      return 1
    }
    if [[ "$new_sha" =~ ^0+$ ]]; then
      if parent_commit="$(git -C "$original_repo" rev-parse --verify "$old_commit^1" 2>/dev/null)"; then
        changed_paths="$(git -C "$original_repo" diff --name-only "$parent_commit" "$old_commit")" || {
          printf 'FALLO: no se pudo comparar el commit eliminado %s\n' "$old_sha" >&2
          return 1
        }
      else
        changed_paths="$(git -C "$original_repo" diff-tree --root --no-commit-id --name-only -r "$old_commit")" || {
          printf 'FALLO: no se pudo comparar el commit raíz eliminado %s\n' "$old_sha" >&2
          return 1
        }
      fi
    else
      new_commit="$(git -C "$rewritten_repo" rev-parse --verify "$new_sha^{commit}" 2>/dev/null)" || {
        printf 'FALLO: no se pudo resolver el commit reescrito %s\n' "$new_sha" >&2
        return 1
      }
      changed_paths="$(git -C "$original_repo" diff --name-only "$old_commit^{tree}" "$new_commit^{tree}")" || {
        printf 'FALLO: no se pudo comparar el commit %s con su reescritura\n' "$old_sha" >&2
        return 1
      }
    fi
    while IFS= read -r changed_path; do
      [ -n "$changed_path" ] || continue
      allowed=0
      while IFS= read -r allowed_path; do
        [ -n "$allowed_path" ] || continue
        if [ "$changed_path" = "$allowed_path" ] || [[ "$changed_path" == "$allowed_path/"* ]]; then
          allowed=1
          break
        fi
      done < "$paths_file"
      if [ "$allowed" -ne 1 ]; then
        printf 'FALLO: el commit %s cambió fuera de las rutas aprobadas: %s\n' "$old_sha" "$changed_path" >&2
        return 1
      fi
    done <<< "$changed_paths"
  done < "$commit_map"
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

purge_assert_same_ref_snapshot() {
  local expected_snapshot="$1"
  local actual_snapshot="$2"
  local label="$3"

  if ! cmp -s "$expected_snapshot" "$actual_snapshot"; then
    printf 'FALLO: cambió el snapshot exacto de %s.\n' "$label" >&2
    diff -u "$expected_snapshot" "$actual_snapshot" >&2 || true
    return 1
  fi
}

purge_push_rewritten_refs() {
  local remote_url="$1"
  local refs_snapshot="$2"
  local repo="$3"
  local audit_dir="${4:-}"
  local push_tmpdir
  local current_snapshot
  local expected_after_snapshot
  local old_sha ref new_sha
  local -a leases=()
  local -a refspecs=()

  push_tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/store-os-purge-push-check.XXXXXX")"
  current_snapshot="$push_tmpdir/current-refs.tsv"
  expected_after_snapshot="$push_tmpdir/expected-after-refs.tsv"
  trap 'rm -rf "$push_tmpdir"' RETURN

  git ls-remote --refs "$remote_url" 'refs/heads/*' 'refs/tags/*' | sort > "$current_snapshot"
  if ! cmp -s "$refs_snapshot" "$current_snapshot"; then
    echo "ABORT: cambiaron refs remotas desde la verificación; no se actualizó ninguna ref." >&2
    diff -u "$refs_snapshot" "$current_snapshot" >&2 || true
    return 1
  fi
  if [ -n "$audit_dir" ]; then
    cp "$current_snapshot" "$audit_dir/public-before-push.tsv"
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

  : > "$expected_after_snapshot"
  while IFS=$'\t' read -r old_sha ref; do
    [ -n "$ref" ] || continue
    new_sha="$(git -C "$repo" rev-parse --verify "$ref" 2>/dev/null)" || {
      echo "ABORT: desapareció la ref tras el push: $ref" >&2
      return 1
    }
    printf '%s\t%s\n' "$new_sha" "$ref" >> "$expected_after_snapshot"
  done < "$refs_snapshot"
  sort -o "$expected_after_snapshot" "$expected_after_snapshot"
  git ls-remote --refs "$remote_url" 'refs/heads/*' 'refs/tags/*' | sort > "$current_snapshot"
  if [ -n "$audit_dir" ]; then
    cp "$current_snapshot" "$audit_dir/public-after-push.tsv"
  fi
  if ! cmp -s "$expected_after_snapshot" "$current_snapshot"; then
    echo "ABORT: aparecieron o cambiaron refs públicas durante el push; revisar antes de continuar." >&2
    diff -u "$expected_after_snapshot" "$current_snapshot" >&2 || true
    return 1
  fi
}
