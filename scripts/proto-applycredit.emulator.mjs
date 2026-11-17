// #380 prototype demo — run under the FULL emulator set (auth+firestore+functions):
//   firebase emulators:exec --project store-os-dev --config firebase.emulator.json \
//     --only auth,firestore,functions "node scripts/proto-applycredit.emulator.mjs"
// Exercises the trusted callables against REAL rules + functions emulators and
// prints PASS/FAIL per proof. Exit code non-zero on any failure.
//
// Proofs (PO request):
//   P1  applyCredit of $300 over $100 available → rejected, state intact.
//   P2  two CONCURRENT applyCredit ops respect the available balance
//       (exactly the surplus commits; the rest rejects).
//   P3  partial refund via releaseCredit(capCents) lands exactly; its RETRY
//       conserves the result (no double release).
//   P4  applyCredit retry with the same intentId → no duplicate movement.
//   P5  client-SDK direct write to credit fields → PERMISSION_DENIED
//       (the final protection: only the callable moves saldo a favor).
//   P6  a later order EDIT that would invalidate the backing balance is
//       rejected by saveOrderWithStockTx (verified in the vitest suite;
//       here we assert the guarded invariant directly on the document).
import { initializeApp } from "firebase/app";
import { initializeApp as adminInit, getApps, getApp } from "firebase-admin/app";
import { getFirestore as adminFs } from "firebase-admin/firestore";
import { getAuth as adminAuth } from "firebase-admin/auth";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, connectAuthEmulator } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, initializeFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";

const PROJECT = "store-os-dev";
const HOSTS = {
  auth: "127.0.0.1:9099",
  firestore: "127.0.0.1:8080",
  functions: "127.0.0.1:5001",
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const app = initializeApp(
  { projectId: PROJECT, apiKey: "demo-api-key", authDomain: `${PROJECT}.firebaseapp.com` },
  "proto-client"
);
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${HOSTS.auth}`, { disableWarnings: true });
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
connectFirestoreEmulator(db, ...HOSTS.firestore.split(":"));
const fns = getFunctions(app, "us-east1");
connectFunctionsEmulator(fns, ...HOSTS.functions.split(":"));

// ── Seed via the Admin SDK (bypasses rules — the callable path is what the
// rules govern) + a real Auth-emulator user the client signs in as.
const adminApp = getApps().length ? getApp() : adminInit({ projectId: PROJECT });
const adb = adminFs(adminApp);
const aauth = adminAuth(adminApp);
const EMAIL = `proto${Date.now()}@example.test`;
const PASSWORD = "password123";
const user = await aauth.createUser({ email: EMAIL, password: PASSWORD, emailVerified: true });
const uid = user.uid;
await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);

const STORE = `proto-${Date.now()}`;
const TS = new Date().toISOString();
await adb.doc(`users/${uid}`).set({ uid, email: EMAIL, role: "member", createdAt: TS, updatedAt: TS });
await adb.doc(`adminStores/${STORE}`).set({ storeId: STORE, ownerUid: uid, memberUids: [uid], pendingInvites: [] });
await adb.doc(`stores/${STORE}`).set({ id: STORE, storeId: STORE, name: "Proto", slug: `proto-${Date.now()}`, type: "inventory_tiered", ownerUid: uid, memberUids: [uid], pendingInvites: [], priceTiers: [{ id: "t", label: "Regular", order: 0 }], defaultTierId: "t", createdAt: TS, updatedAt: TS });

const orderDoc = (id, extra = {}) => ({
  storeId: STORE, customerId: "cli-1",
  items: [{ lineId: `${id}_L0`, productName: "Pieza", quantity: 1, unitPrice: 300, subtotal: 300 }],
  deposit: 0, orderStatus: "confirmed", revision: 0,
  createdAt: TS, updatedAt: TS, ...extra,
});

async function readOrder(id) {
  return (await adb.doc(`orders/${id}`).get()).data();
}

// Origin: $100 received of a $100 sale? No — surplus must come from OVERPAY:
// total $100, received $200 → $100 available.
const ORIGIN = "proto-o1";
const DEST = "proto-d1";
await adb.doc(`orders/${ORIGIN}`).set(orderDoc(ORIGIN, {
  items: [{ lineId: "o_L0", productName: "Collar", quantity: 1, unitPrice: 100, subtotal: 100 }],
  paymentsReceivedCents: 20000, inheritedDepositMaterialized: true, orderStatus: "delivered",
}));
await adb.doc(`orders/${DEST}`).set(orderDoc(DEST, {
  items: [{ lineId: "d_L0", productName: "Pulsera", quantity: 1, unitPrice: 300, subtotal: 300 }],
}));

const apply = httpsCallable(fns, "applyCredit");
const release = httpsCallable(fns, "releaseCredit");

// ── P1: $300 over $100 available ──────────────────────────────────────────
try {
  await apply({ storeId: STORE, fromOrderId: ORIGIN, toOrderId: DEST, amountCents: 30000, intentId: "p1" });
  check("P1 rechaza $300 sobre $100", false, "la llamada pasó");
} catch (e) {
  const ok = /disponible es de 100/.test(e.message) || /failed-precondition/.test(e.message);
  const origin = await readOrder(ORIGIN);
  const intact = (origin.creditConsumedCents ?? 0) === 0 && !(origin.creditLedger ?? []).length;
  check("P1 rechaza $300 sobre $100 (estado intacto)", ok && intact, e.message.slice(0, 90));
}

// ── P2: concurrency respects the balance ─────────────────────────────────
{
  const ORIGIN2 = "proto-o2";
  const D2A = "proto-d2a";
  const D2B = "proto-d2b";
  await adb.doc(`orders/${ORIGIN2}`).set(orderDoc(ORIGIN2, {
    items: [{ lineId: "o2_L0", productName: "Collar 2", quantity: 1, unitPrice: 100, subtotal: 100 }],
    paymentsReceivedCents: 20000, inheritedDepositMaterialized: true, orderStatus: "delivered",
  }));
  for (const d of [D2A, D2B]) {
    await adb.doc(`orders/${d}`).set(orderDoc(d, {
      items: [{ lineId: `${d}_L0`, productName: "Pieza", quantity: 1, unitPrice: 300, subtotal: 300 }],
    }));
  }
  const settled = await Promise.allSettled([
    apply({ storeId: STORE, fromOrderId: ORIGIN2, toOrderId: D2A, amountCents: 10000, intentId: "p2a" }),
    apply({ storeId: STORE, fromOrderId: ORIGIN2, toOrderId: D2B, amountCents: 10000, intentId: "p2b" }),
  ]);
  const fulfilled = settled.filter((r) => r.status === "fulfilled").length;
  const origin = await readOrder(ORIGIN2);
  const consumed = origin.creditConsumedCents ?? 0;
  check(
    "P2 concurrencia: exactamente el disponible comprometido",
    fulfilled === 1 && consumed === 10000,
    `fulfilled=${fulfilled} consumed=${consumed}`
  );
}

// ── P3: partial refund + retry ───────────────────────────────────────────
{
  // DEST still owes $200 of the $300 sale after nothing applied... apply $200 first.
  await apply({ storeId: STORE, fromOrderId: ORIGIN, toOrderId: DEST, amountCents: 10000, intentId: "p3-apply" });
  let origin = await readOrder(ORIGIN);
  let dest = await readOrder(DEST);
  const appliedOk = dest.creditAppliedCents === 10000 && origin.creditConsumedCents === 10000;
  check("P3a apply de $100 aterrizó (par existente)", appliedOk, `applied=${dest.creditAppliedCents} consumed=${origin.creditConsumedCents}`);

  // Partial release of $50 tagged to an incident event, then RETRY it.
  const r1 = await release({ storeId: STORE, orderId: DEST, intentId: "evt9", capCents: 5000, idPrefix: "rel_evt9_" });
  origin = await readOrder(ORIGIN);
  dest = await readOrder(DEST);
  const rel1 = r1.data.released === 5000 && dest.creditAppliedCents === 5000 && origin.creditConsumedCents === 5000;
  check("P3b devolución parcial de $50 exacta", rel1, `released=${r1.data.released} applied=${dest.creditAppliedCents} consumed=${origin.creditConsumedCents}`);

  const r2 = await release({ storeId: STORE, orderId: DEST, intentId: "evt9", capCents: 5000, idPrefix: "rel_evt9_" });
  origin = await readOrder(ORIGIN);
  dest = await readOrder(DEST);
  const rel2 = r2.data.released === 0 && dest.creditAppliedCents === 5000 && origin.creditConsumedCents === 5000;
  check("P3c reintento de la devolución conserva el resultado", rel2, `released=${r2.data.released} applied=${dest.creditAppliedCents}`);
}

// ── P4: apply retry with the same intentId ───────────────────────────────
{
  const before = await readOrder(ORIGIN);
  const r = await apply({ storeId: STORE, fromOrderId: ORIGIN, toOrderId: DEST, amountCents: 10000, intentId: "p3-apply" });
  const after = await readOrder(ORIGIN);
  const dest = await readOrder(DEST);
  const noDup =
    r.data.applied === false &&
    after.creditConsumedCents === before.creditConsumedCents &&
    (after.creditLedger ?? []).filter((e) => e.id === "con_app_p3-apply").length === 1 &&
    (dest.creditLedger ?? []).filter((e) => e.id === "app_p3-apply").length === 1;
  check("P4 reintento con mismo intentId no duplica", noDup, `applied=${r.data.applied} consumed=${after.creditConsumedCents}`);
}

// ── P5: client SDK direct credit write → DENIED ──────────────────────────
try {
  await updateDoc(doc(db, "orders", DEST), { creditAppliedCents: 0 });
  check("P5 escritura directa de crédito denegada", false, "la escritura pasó");
} catch (e) {
  check("P5 escritura directa de crédito denegada", /PERMISSION/i.test(e.message), e.code ?? e.message.slice(0, 60));
}

// ── P6: the backing invariant holds on the origin (edit guard is exercised
// in the vitest suite protoCreditRules; here we assert the document state
// that the guard protects: consumed ≤ real surplus) ───────────────────────
{
  const origin = await readOrder(ORIGIN);
  const surplus = 20000 - 10000; // received − total (no incidents seeded)
  const consumed = origin.creditConsumedCents ?? 0;
  check("P6 el saldo consumido sigue respaldado (consumed ≤ surplus)", consumed <= surplus, `consumed=${consumed} surplus=${surplus}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pruebas PASAN`);
if (failed.length) process.exit(1);
