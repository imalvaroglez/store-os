#!/usr/bin/env bash
# Run the Firebase emulator suite with its explicitly configured test-only
# Storage rules. The production rules file is never modified by tests.
set -euo pipefail

# Functions deps (tesseract/mupdf load lazily, after the auth guards) — same
# flow for CI and local runs.
npm --prefix functions ci --silent
# Session 1: the app suite WITHOUT the Functions emulator.
firebase emulators:exec --project store-os-demo --config firebase.emulator.json --only auth,firestore,storage \
  'playwright test --config=playwright.firebase.config.ts --grep-invert @functions'
# Session 2: the callable suite with the Functions emulator. Global setup wipes
# Auth+Firestore between sessions, so this suite seeds its own state.
firebase emulators:exec --project store-os-demo --config firebase.emulator.json --only auth,firestore,storage,functions \
  'playwright test --config=playwright.firebase.config.ts --project=foundation e2e/functions.spec.ts e2e/public-order.spec.ts'
