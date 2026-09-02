#!/usr/bin/env bash
# Refresh-hard-reload suite: global setup builds A/B/cloud, then the spec serves
# each build with vite preview on :4320, swapping them mid-test to simulate
# consecutive deploys. Wrapped in emulators:exec because the cloud sub-case
# signs in and reads data through the Auth + Firestore emulators.
set -euo pipefail

# --project is load-bearing: without it the Auth emulator resolves .firebaserc's
# default (store-os-f7cf8) while the helpers read the store-os-demo bucket —
# oobCodes came back empty and signUp failed ("no verification code").
firebase emulators:exec --project store-os-demo --config firebase.emulator.json --only auth,firestore \
  'playwright test --config=playwright.refresh.config.ts'
