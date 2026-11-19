#!/usr/bin/env bash
set -euo pipefail
# Run each rules/emulator suite in its OWN emulator process. All suites share a
# projectId and one emulator process keeps state across files, while vitest
# orders files by SIZE (not CLI order) — so cross-file state made results
# depend on incidental file-size changes (2026-11-03 incident on PR #166:
# editing orderPayments.emulator.test.ts flipped the execution order and broke
# orderTransactions). One emulator per file is hermetic and order-proof.
FIRESTORE_FILES=(
  src/app/firebase/firestore.rules.test.ts
  src/app/firebase/securityMatrix.emulator.test.ts
  src/app/firebase/orderTransactions.emulator.test.ts
  src/app/firebase/orderPayments.emulator.test.ts
  src/app/firebase/creditEditInvariants.emulator.test.ts
  src/app/firebase/creditCustomerChange.emulator.test.ts
  src/app/firebase/deliveredBalanceSeal.emulator.test.ts
  src/app/firebase/incidents.emulator.test.ts
  src/app/firebase/expenses.emulator.test.ts
  src/app/firebase/installments.emulator.test.ts
  src/app/firebase/customerPricing.emulator.test.ts
  src/app/firebase/variantConversion.emulator.test.ts
  src/app/firebase/protoCreditRules.emulator.test.ts
  src/app/firebase/republishStockSignals.emulator.test.ts
  src/app/firebase/financialRules.emulator.test.ts
  src/app/firebase/closeAdjustments.emulator.test.ts
  src/app/firebase/staleWrites.emulator.test.ts
  src/app/firebase/rankingConfirmations.emulator.test.ts
  src/app/firebase/supplierLinks.emulator.test.ts
  src/app/firebase/storefrontSave.emulator.test.ts
  src/app/firebase/priceEvents.emulator.test.ts
  src/app/firebase/profitDistribution.emulator.test.ts
  src/app/firebase/installmentsMarkerRules.emulator.test.ts
)
# #380: the saldo-a-favor suites drive the TRUSTED applyCredit/releaseCredit
# callables (rules deny every client write to the credit fields), so they need
# the FUNCTIONS emulator plus AUTH — the callables authenticate a real
# emulator user before moving a clienta's credit.
CALLABLE_FILES=(
  src/app/firebase/customerCredit.emulator.test.ts
  src/app/firebase/deleteCredit.emulator.test.ts
  src/app/firebase/deleteStoreRetention.emulator.test.ts
)
# Storage suites (#176): the emulator loads each file's rules explicitly, so
# they do NOT use firebase.emulator.json's storage.rules.emulator swap.
STORAGE_FILES=(
  src/app/firebase/storage.rules.test.ts
  src/app/firebase/storage.rules.matrix.test.ts
)
for f in "${FIRESTORE_FILES[@]}"; do
  [ -f "$f" ] || continue
  firebase emulators:exec --project store-os-dev --config firebase.emulator.json --only firestore \
    "npx vitest run --no-file-parallelism $f"
done
# The functions emulator loads functions/src/*.mjs, which needs its deps
# (installed once; local runs usually already have them).
[ -d functions/node_modules ] || npm --prefix functions ci --silent
for f in "${CALLABLE_FILES[@]}"; do
  [ -f "$f" ] || continue
  firebase emulators:exec --project store-os-dev --config firebase.emulator.json --only auth,firestore,functions \
    "npx vitest run --no-file-parallelism $f"
done
for f in "${STORAGE_FILES[@]}"; do
  [ -f "$f" ] || continue
  firebase emulators:exec --project store-os-dev --config firebase.emulator.json --only storage \
    "npx vitest run --no-file-parallelism $f"
done
