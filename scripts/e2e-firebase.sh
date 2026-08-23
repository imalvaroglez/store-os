#!/usr/bin/env bash
# Run the Firebase emulator suite with its explicitly configured test-only
# Storage rules. The production rules file is never modified by tests.
set -euo pipefail

# Functions deps (tesseract/mupdf load lazily, after the auth guards) — same
# flow for CI and local runs.
npm --prefix functions ci --silent
STATE_DIR="$(mktemp -d)"
# Session 1: the app suite WITHOUT the Functions emulator — co-running it on CI
# runners starved the Storage emulator and made the photo test fail silently.
# Auth+Firestore state is exported so session 2 sees the same admin/members.
firebase emulators:exec --project store-os-demo --config firebase.emulator.json --only auth,firestore,storage \
  --export-on-exit "$STATE_DIR" \
  'playwright test --config=playwright.firebase.config.ts --grep-invert @functions'
# Session 2: the callable suite with the Functions emulator, importing that state.
firebase emulators:exec --project store-os-demo --config firebase.emulator.json --only auth,firestore,storage,functions \
  --import "$STATE_DIR" \
  'playwright test --config=playwright.firebase.config.ts --project=foundation e2e/functions.spec.ts'
