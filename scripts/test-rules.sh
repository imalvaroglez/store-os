#!/usr/bin/env bash
set -euo pipefail
# Run the Firestore rules test suite against the emulator, then tear down.
firebase emulators:exec --project store-os-dev --config firebase.emulator.json --only firestore \
  'npx vitest run --no-file-parallelism src/app/firebase/firestore.rules.test.ts src/app/firebase/orderTransactions.emulator.test.ts'
