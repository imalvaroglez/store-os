// #380 prototype: TRUSTED credit operations. The Firestore rules (prototype
// variant) deny every client write to the credit fields — the Admin SDK
// bypasses rules, so THESE callables become the only way to move a clienta's
// saldo a favor. Every callable:
//   1. authenticates the caller (req.auth),
//   2. resolves membership from the canonical adminStores control doc
//      (G-P02: members only; the platform allowlist mirrors the rules),
//   3. reads BOTH orders fresh inside ONE transaction (real balance, never
//      client-supplied figures),
//   4. writes the FULL pair — origin mirror + destination entry + revision
//      bumps — atomically. Admin transactions have no rules budget and no
//      phases, so there is no interrupted state to recover: it commits or
//      it throws, and the retry is idempotent by ledger id.
// Zero-cost guardrails (mirrors importPurchasePdf): callable only, retry
// disabled, no min instances, small memory, tight timeout.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  creditAvailableCents,
  pendingCents,
  netByOrigin,
} from "./creditMath.mjs";

// Mirrors firestore.rules isAllowlistedSuperAdmin (single source: the rules
// file owns the list; the function reads its own copy and the equivalence
// test in the app suite keeps them in lockstep — see the spec).
const PLATFORM_ADMIN_EMAILS = new Set([
  "admin@store.os",
  "imalvaroglez@gmail.com",
]);

const MAX_AMOUNT_CENTS = 9000000000000; // same safe-precision bound as the rules

async function requireOperator(db, storeId, auth) {
  const uid = auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
  const email = String(auth?.token?.email ?? "").toLowerCase();
  if (PLATFORM_ADMIN_EMAILS.has(email)) return;
  const snap = await db.collection("adminStores").doc(storeId).get();
  const members = snap.get("memberUids") ?? [];
  const owner = snap.get("ownerUid");
  if (!members.includes(uid) && owner !== uid) {
    throw new HttpsError("permission-denied", "No tienes acceso a esta tienda.");
  }
}

function readOrderOrThrow(tx, db, orderId, storeId, what) {
  return tx.get(db.collection("orders").doc(orderId)).then((snap) => {
    if (!snap.exists) throw new HttpsError("not-found", `No se encontró ${what}.`);
    const data = snap.data();
    if ((data.storeId ?? "") !== storeId) {
      throw new HttpsError("permission-denied", `${what} pertenece a otra tienda.`);
    }
    return { ref: snap.ref, data };
  });
}

function ledgerOf(order) {
  return Array.isArray(order.creditLedger) ? order.creditLedger : [];
}

function isoNow() {
  return new Date().toISOString();
}

/**
 * Apply a clienta's credit from one order onto another — the trusted
 * replacement for the client-side compensation write.
 * data: { storeId, fromOrderId, toOrderId, amountCents, intentId }
 * Idempotent per intentId: a retry after success returns { applied: false }
 * and writes nothing.
 */
export const applyCredit = onCall(
  {
    region: "us-east1",
    maxInstances: 3,
    retry: false,
    memory: "256MiB",
    timeoutSeconds: 30,
    minInstances: 0,
  },
  async (req) => {
    const { storeId, fromOrderId, toOrderId, intentId } = req.data ?? {};
    const amountCents = req.data?.amountCents;
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("invalid-argument", "Falta la tienda.");
    if (typeof fromOrderId !== "string" || !fromOrderId) throw new HttpsError("invalid-argument", "Falta el pedido origen.");
    if (typeof toOrderId !== "string" || !toOrderId) throw new HttpsError("invalid-argument", "Falta el pedido destino.");
    if (typeof intentId !== "string" || !intentId) throw new HttpsError("invalid-argument", "Falta el identificador de intento.");
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
      throw new HttpsError("invalid-argument", "El importe no es válido.");
    }

    const db = getFirestore();
    await requireOperator(db, storeId, req.auth);

    const entryId = `app_${intentId}`;
    const mirrorId = `con_${entryId}`;

    return db.runTransaction(async (tx) => {
      const origin = await readOrderOrThrow(tx, db, fromOrderId, storeId, "el pedido con el saldo a favor");
      const dest = await readOrderOrThrow(tx, db, toOrderId, storeId, "el pedido a compensar");

      // Same clienta, same store, nobody cancelled.
      const customerId = dest.data.customerId;
      if (!customerId || (origin.data.customerId ?? "") !== customerId) {
        throw new HttpsError("failed-precondition", "El saldo a favor solo compensa pedidos de la misma clienta.");
      }
      if (dest.data.orderStatus === "cancelled" || origin.data.orderStatus === "cancelled") {
        throw new HttpsError("failed-precondition", "Un pedido cancelado no participa en la compensación.");
      }

      // Idempotency first: this exact intent already landed → nothing to do.
      if (ledgerOf(dest.data).some((saved) => saved.id === entryId)) {
        return { applied: false, alreadyApplied: true };
      }

      // THE check the rules cannot express: the REAL fresh surplus must
      // cover the whole movement, and the destination must still owe it.
      const available = creditAvailableCents(origin.data);
      if (available < amountCents) {
        throw new HttpsError(
          "failed-precondition",
          `El saldo a favor disponible es de ${available / 100} pesos; no cubre los ${amountCents / 100} solicitados.`
        );
      }
      const pending = pendingCents(dest.data);
      if (pending < amountCents) {
        throw new HttpsError("failed-precondition", `El pedido solo debe ${pending / 100} pesos; no cabe más crédito.`);
      }

      const at = isoNow();
      const by = req.auth.uid;
      tx.update(origin.ref, {
        creditConsumedCents: FieldValue.increment(amountCents),
        creditLedger: FieldValue.arrayUnion({
          id: mirrorId,
          kind: "consumption",
          fromOrderId: toOrderId,
          amountCents,
          at,
          by,
        }),
        revision: FieldValue.increment(1),
        updatedAt: at,
      });
      tx.update(dest.ref, {
        creditAppliedCents: FieldValue.increment(amountCents),
        creditLedger: FieldValue.arrayUnion({
          id: entryId,
          kind: "application",
          fromOrderId,
          amountCents,
          at,
          by,
        }),
        revision: FieldValue.increment(1),
        updatedAt: at,
      });
      return { applied: true, amountCents };
    });
  }
);

/**
 * Release outstanding credit from one order back to its origins — the
 * trusted path for cancellations and incident restitutions.
 * data: { storeId, orderId, intentId, capCents?, idPrefix? }
 *   capCents: release AT MOST this much (an incident's own obligation);
 *             without it, the whole outstanding net is restituted.
 *   idPrefix: tags the destination entries (incidents tag rel_<eventId>_).
 * Idempotent per intent: retries see the already-tagged entries and no-op.
 */
export const releaseCredit = onCall(
  {
    region: "us-east1",
    maxInstances: 3,
    retry: false,
    memory: "256MiB",
    timeoutSeconds: 30,
    minInstances: 0,
  },
  async (req) => {
    const { storeId, orderId, intentId } = req.data ?? {};
    const capCents = req.data?.capCents;
    const idPrefix = typeof req.data?.idPrefix === "string" && req.data.idPrefix ? req.data.idPrefix : "release_";
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("invalid-argument", "Falta la tienda.");
    if (typeof orderId !== "string" || !orderId) throw new HttpsError("invalid-argument", "Falta el pedido.");
    if (typeof intentId !== "string" || !intentId) throw new HttpsError("invalid-argument", "Falta el identificador de intento.");
    if (capCents !== undefined && (!Number.isSafeInteger(capCents) || capCents <= 0)) {
      throw new HttpsError("invalid-argument", "El tope no es válido.");
    }

    const db = getFirestore();
    await requireOperator(db, storeId, req.auth);

    return db.runTransaction(async (tx) => {
      const dest = await readOrderOrThrow(tx, db, orderId, storeId, "el pedido");
      const ledger = ledgerOf(dest.data);

      // Idempotency per intent: the tag IS the intent identity.
      const tagged = ledger.filter((saved) => saved.kind === "release" && saved.id.startsWith(`${idPrefix}${intentId}`));
      const alreadyReleased = tagged.reduce((sum, saved) => sum + (Number.isSafeInteger(saved.amountCents) ? saved.amountCents : 0), 0);
      let budget = capCents !== undefined ? Math.max(0, capCents - alreadyReleased) : Number.POSITIVE_INFINITY;
      if (budget <= 0) return { released: 0, alreadyReleased };

      const net = netByOrigin(ledger);
      const at = isoNow();
      const by = req.auth.uid;
      const entries = [];
      const originWrites = [];
      let total = 0;

      for (const [fromOrderId, netCents] of net) {
        if (netCents <= 0 || budget <= 0) continue;
        const origin = await tx.get(db.collection("orders").doc(fromOrderId));
        if (!origin.exists || (origin.data().storeId ?? "") !== storeId) continue;
        // Cap by the origin's REAL committed mirror (drift stays conservative).
        const consumed = Math.max(0, typeof origin.data().creditConsumedCents === "number" && Number.isSafeInteger(origin.data().creditConsumedCents) ? origin.data().creditConsumedCents : 0);
        const amount = Math.min(netCents, consumed, budget);
        if (amount <= 0) continue;
        const ordinal = ledger.filter((e) => e.kind === "release" && e.fromOrderId === fromOrderId).length + 1;
        const releaseEntry = {
          id: `${idPrefix}${intentId}_${orderId}_${fromOrderId}_${ordinal}`,
          kind: "release",
          fromOrderId,
          amountCents: amount,
          at,
          by,
        };
        entries.push(releaseEntry);
        originWrites.push({
          ref: origin.ref,
          mirror: {
            id: `res_${releaseEntry.id}`,
            kind: "restitution",
            fromOrderId: orderId,
            amountCents: amount,
            at,
            by,
          },
          amount,
        });
        total += amount;
        budget -= amount;
      }

      if (entries.length === 0) return { released: 0, alreadyReleased };
      tx.update(dest.ref, {
        creditAppliedCents: FieldValue.increment(-total),
        creditLedger: FieldValue.arrayUnion(...entries),
        revision: FieldValue.increment(1),
        updatedAt: at,
      });
      for (const write of originWrites) {
        tx.update(write.ref, {
          creditConsumedCents: FieldValue.increment(-write.amount),
          creditLedger: FieldValue.arrayUnion(write.mirror),
          revision: FieldValue.increment(1),
          updatedAt: at,
        });
      }
      return { released: total, alreadyReleased };
    });
  }
);
