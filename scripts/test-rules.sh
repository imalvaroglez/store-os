#!/usr/bin/env bash
set -euo pipefail
# Run the Firestore rules test suite against the emulator, then tear down.
firebase emulators:exec --project store-os-demo --config firebase.emulator.json --only firestore \
  'npx vitest run --no-file-parallelism src/app/firebase/firestore.rules.test.ts src/app/firebase/customerPricing.emulator.test.ts'
