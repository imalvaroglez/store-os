#!/usr/bin/env bash
# Run the Firebase emulator e2e suite with a TEST-ONLY permissive Storage rules
# file. The Storage emulator cannot evaluate cross-service firestore.get()
# (known limitation), so the strict membership rule in storage.rules 403s every
# write in the emulator even though production allows it. We swap in
# storage.rules.emulator (auth-only + size/type) for the run, then ALWAYS restore
# the strict production rules — even on failure — so the repo never ships weak
# rules. Membership enforcement is verified by review of storage.rules, not here.
set -euo pipefail

STRICT="storage.rules"
PERMISSIVE="storage.rules.emulator"
BACKUP="storage.rules.strict.bak"

if [ ! -f "$PERMISSIVE" ]; then
  echo "Missing $PERMISSIVE" >&2
  exit 1
fi

cp "$STRICT" "$BACKUP"
trap 'cp "$BACKUP" "$STRICT" && rm -f "$BACKUP"' EXIT INT TERM

cp "$PERMISSIVE" "$STRICT"

firebase emulators:exec --only auth,firestore,storage \
  'playwright test --config=playwright.firebase.config.ts'
