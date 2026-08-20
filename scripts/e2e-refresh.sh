#!/usr/bin/env bash
# Refresh-hard-reload suite: global setup builds A/B/cloud, then the spec serves
# each build with vite preview on :4320, swapping them mid-test to simulate
# consecutive deploys. Wrapped in emulators:exec because the cloud sub-case
# signs in and reads data through the Auth + Firestore emulators.
set -euo pipefail

firebase emulators:exec --config firebase.emulator.json --only auth,firestore \
  'playwright test --config=playwright.refresh.config.ts'
