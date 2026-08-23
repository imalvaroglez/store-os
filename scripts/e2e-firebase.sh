#!/usr/bin/env bash
# Run the Firebase emulator suite with its explicitly configured test-only
# Storage rules. The production rules file is never modified by tests.
set -euo pipefail

# Functions deps (tesseract/mupdf load lazily, after the auth guards) — same
# flow for CI and local runs.
npm --prefix functions ci --silent
firebase emulators:exec --project store-os-demo --config firebase.emulator.json --only auth,firestore,storage,functions \
  'playwright test --config=playwright.firebase.config.ts'
