#!/usr/bin/env bash
# Run the Firebase emulator suite with its explicitly configured test-only
# Storage rules. The production rules file is never modified by tests.
set -euo pipefail

firebase emulators:exec --config firebase.emulator.json --only auth,firestore,storage \
  'playwright test --config=playwright.firebase.config.ts'
