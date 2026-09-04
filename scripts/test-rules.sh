#!/usr/bin/env bash
# Firestore rules integration against the real store-os-dev project.
set -euo pipefail
node scripts/test-rules-dev.cjs
