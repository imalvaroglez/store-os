#!/usr/bin/env bash
set -euo pipefail
# Run the Firestore rules test suite against the emulator, then tear down.
firebase emulators:exec --config firebase.emulator.json --only firestore \
  'npx vitest run src/app/firebase/firestore.rules.test.ts'
