#!/usr/bin/env bash
# Refresh-hard-reload suite: global setup builds A/B/cloud, then the spec serves
# each build with vite preview on :4320, swapping them mid-test to simulate
# consecutive deploys. Wrapped in emulators:exec because the cloud sub-case
# signs in and reads data through the Auth + Firestore emulators.
set -euo pipefail

# Keep the local Auth and Firestore emulators under the same dev project ID used
# by the shared test helpers. All emulator traffic stays on localhost.
firebase emulators:exec --project store-os-dev --config firebase.emulator.json --only auth,firestore \
  'playwright test --config=playwright.refresh.config.ts'
