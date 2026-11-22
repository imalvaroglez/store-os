// #524 cortes/cobros: TRUSTED point-of-sale operations. Firestore rules deny
// every client write to pointEntries/pointOperations (the Admin SDK bypasses
// rules), so THESE callables are the only way to register a corte, its cobro
// or its anulación. Each callable: authenticates the caller, resolves
// membership, re-derives the WHOLE plan from fresh data inside ONE
// transaction (never trusting client figures — the same math the app's
// preview shows, kept in lockstep by pointCutMathPort.test), and writes the
// entry consumptions + append-only evidence atomically. Idempotent per
// intentId: a retry after success writes nothing.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { planCortePort } from "./pointCutMath.mjs";

// Mirrors firestore.rules isAllowlistedSuperAdmin (see applyCredit.mjs).
const PLATFORM_ADMIN_EMAILS = new Set([
  "admin@store.os",
  "imalvaroglez@gmail.com",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function isRealDate(text) {
  if (typeof text !== "string" || !DATE_RE.test(text)) return false;
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isoNow() {
  return new Date().toISOString();
}

async function readPoint(tx, db, storeId, pointId) {
  const snap = await tx.get(db.collection("points").doc(pointId));
  if (!snap.exists || (snap.get("storeId") ?? "") !== storeId) {
    throw new HttpsError("not-found", "No se encontró el punto de venta de esta tienda.");
  }
  if (snap.get("active") === false) {
    throw new HttpsError("failed-precondition", "El punto de venta está desactivado.");
  }
  return snap;
}

function validateLines(lines, writeOffs) {
  for (const line of lines ?? []) {
    if (typeof line?.productId !== "string" || !line.productId) {
      throw new HttpsError("invalid-argument", "Cada línea de venta necesita su producto.");
    }
    if (!Number.isSafeInteger(line.markedPriceCents) || line.markedPriceCents <= 0) {
      throw new HttpsError("invalid-argument", "Cada línea de venta necesita el precio marcado de las piezas vendidas.");
    }
    if (!Number.isSafeInteger(line.soldQty) || line.soldQty < 0) {
      throw new HttpsError("invalid-argument", "Las cantidades vendidas deben ser enteras no negativas.");
    }
  }
  for (const writeOff of writeOffs ?? []) {
    if (typeof writeOff?.productId !== "string" || !writeOff.productId) {
      throw new HttpsError("invalid-argument", "Cada baja necesita su producto.");
    }
    if (!Number.isSafeInteger(writeOff.qty) || writeOff.qty <= 0) {
      throw new HttpsError("invalid-argument", "Cada baja necesita una cantidad mayor a cero.");
    }
    if (typeof writeOff.reason !== "string" || !writeOff.reason.trim()) {
      throw new HttpsError("invalid-argument", "Cada baja necesita su motivo.");
    }
  }
}

/**
 * Register a point's corte (visit): sold quantities + write-offs + the
 * confirmed commission rate, on an EFFECTIVE date (the month that collects
 * the sale, even when the payment lands later).
 * data: { storeId, pointId, intentId, effectiveDate, commissionRate,
 *         lines: [{productId, variantId?, markedPriceCents, soldQty}],
 *         writeOffs: [{productId, variantId?, qty, reason}] }
 */
// #524 QA dictamen (mayor): the store's AUTHORIZED monthly closes — read
// INSIDE each transaction so a close that lands mid-flight is honored.
async function sealedPeriods(tx, db, storeId) {
  const snap = await tx.get(db.collection("closes").where("storeId", "==", storeId));
  return new Set(snap.docs.map((doc) => doc.get("period")).filter(Boolean));
}

function assertOpenPeriod(sealed, isoDate, message) {
  const period = String(isoDate ?? "").slice(0, 7);
  if (period && sealed.has(period)) {
    throw new HttpsError("failed-precondition", `Ese mes ya está cerrado y autorizado; no se puede ${message}.`);
  }
}

export const registerPointCut = onCall(
  { region: "us-east1", maxInstances: 3, retry: false, memory: "256MiB", timeoutSeconds: 30, minInstances: 0 },
  async (req) => {
    const { storeId, pointId, intentId, effectiveDate, commissionRate } = req.data ?? {};
    const lines = Array.isArray(req.data?.lines) ? req.data.lines : [];
    const writeOffs = Array.isArray(req.data?.writeOffs) ? req.data.writeOffs : [];
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("invalid-argument", "Falta la tienda.");
    if (typeof pointId !== "string" || !pointId) throw new HttpsError("invalid-argument", "Falta el punto de venta.");
    if (typeof intentId !== "string" || !intentId) throw new HttpsError("invalid-argument", "Falta el identificador de intento.");
    if (!isRealDate(effectiveDate)) throw new HttpsError("invalid-argument", "La fecha efectiva del corte no es una fecha real.");
    if (typeof commissionRate !== "number" || !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 1) {
      throw new HttpsError("invalid-argument", "La comisión debe ser una fracción entre 0 y 1.");
    }
    if (lines.length === 0 && writeOffs.length === 0) {
      throw new HttpsError("invalid-argument", "El corte no tiene ventas ni bajas.");
    }
    validateLines(lines, writeOffs);

    const db = getFirestore();
    await requireOperator(db, storeId, req.auth);

    const opId = `corte_${intentId}`;
    return db.runTransaction(async (tx) => {
      // #524 QA dictamen (mayor): sealed months are enforced by the SERVER —
      // a backdated cut of an authorized month never lands, with no partial
      // writes (the transaction aborts whole).
      const sealed = await sealedPeriods(tx, db, storeId);
      assertOpenPeriod(sealed, effectiveDate, "registrar un corte de un mes cerrado");
      // Idempotency first: this exact intent already landed → nothing to do.
      const opRef = db.collection("pointOperations").doc(opId);
      const saved = await tx.get(opRef);
      if (saved.exists) {
        return { registered: false, alreadyRegistered: true, corteId: opId, totals: saved.get("totals") };
      }
      await readPoint(tx, db, storeId, pointId);

      // Fresh evidence — the plan is re-derived server-side, never trusted.
      const entriesSnap = await tx.get(db.collection("pointEntries").where("pointId", "==", pointId));
      const entries = entriesSnap.docs.map((docSnap) => docSnap.data());
      const plan = planCortePort(entries, lines, writeOffs, commissionRate);
      if (plan.errors.length > 0) {
        throw new HttpsError("failed-precondition", plan.errors.join(" "));
      }

      const at = isoNow();
      const by = req.auth.uid;
      // Sales before write-offs is already the plan's order; each allocation
      // lands on ITS entry (the FIFO evidence #524 demands).
      const consumption = new Map();
      for (const group of [...plan.saleAllocations, ...plan.writeOffAllocations]) {
        for (const allocation of group.allocations) {
          consumption.set(allocation.entryId, (consumption.get(allocation.entryId) ?? 0) + allocation.quantity);
        }
      }
      for (const [entryId, quantity] of consumption) {
        const entryDoc = entriesSnap.docs.find((docSnap) => docSnap.id === entryId);
        tx.update(entryDoc.ref, {
          consumedQty: FieldValue.increment(quantity),
          updatedAt: at,
        });
      }
      const totals = plan.totals;
      tx.set(opRef, {
        id: opId,
        storeId,
        pointId,
        kind: "corte",
        intentionId: intentId,
        effectiveDate,
        commissionRate,
        lines,
        writeOffs,
        saleAllocations: plan.saleAllocations,
        writeOffAllocations: plan.writeOffAllocations,
        totals,
        // A zero net needs no collection trip; anything else waits for its
        // cobro (full amount, real date — partials are out of this version).
        status: totals.netCents === 0 ? "sin_cobro" : "pendiente_de_cobro",
        confirmedBy: by,
        confirmedAt: at,
      });
      return { registered: true, corteId: opId, totals };
    });
  }
);

/**
 * Register the corte's cobro: the FULL net (the issue fixes the proposal),
 * on the REAL date the money arrived, with its method.
 * data: { storeId, pointId, corteId, intentId, method: "cash"|"transfer", date }
 */
export const registerPointCutPayment = onCall(
  { region: "us-east1", maxInstances: 3, retry: false, memory: "256MiB", timeoutSeconds: 30, minInstances: 0 },
  async (req) => {
    const { storeId, pointId, corteId, intentId, method, date } = req.data ?? {};
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("invalid-argument", "Falta la tienda.");
    if (typeof pointId !== "string" || !pointId) throw new HttpsError("invalid-argument", "Falta el punto de venta.");
    if (typeof corteId !== "string" || !corteId) throw new HttpsError("invalid-argument", "Falta el corte.");
    if (typeof intentId !== "string" || !intentId) throw new HttpsError("invalid-argument", "Falta el identificador de intento.");
    if (method !== "cash" && method !== "transfer") throw new HttpsError("invalid-argument", "El medio de cobro no es válido.");
    if (!isRealDate(date)) throw new HttpsError("invalid-argument", "La fecha real del cobro no es una fecha real.");

    const db = getFirestore();
    await requireOperator(db, storeId, req.auth);

    const paymentOpId = `cobro_${intentId}`;
    return db.runTransaction(async (tx) => {
      // #524 QA (mayor): the payment's OWN date cannot belong to a sealed
      // month — the authorized close already fixed that month's money.
      const sealed = await sealedPeriods(tx, db, storeId);
      assertOpenPeriod(sealed, date, "registrar un cobro de un mes cerrado");
      const paymentRef = db.collection("pointOperations").doc(paymentOpId);
      const savedPayment = await tx.get(paymentRef);
      if (savedPayment.exists) {
        return { registered: false, alreadyRegistered: true, amountCents: savedPayment.get("amountCents") };
      }
      await readPoint(tx, db, storeId, pointId);

      const corteRef = db.collection("pointOperations").doc(corteId);
      const corteSnap = await tx.get(corteRef);
      if (!corteSnap.exists || corteSnap.get("kind") !== "corte" || (corteSnap.get("pointId") ?? "") !== pointId) {
        throw new HttpsError("not-found", "No se encontró el corte de este punto.");
      }
      const status = corteSnap.get("status");
      if (status === "cobrado") {
        throw new HttpsError("failed-precondition", "Este corte ya tiene su cobro registrado.");
      }
      if (status !== "pendiente_de_cobro") {
        throw new HttpsError("failed-precondition", "Este corte no espera cobro (sin cobro o anulado).");
      }
      const amountCents = corteSnap.get("totals")?.netCents;
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw new HttpsError("failed-precondition", "El corte no tiene un neto por cobrar.");
      }

      const at = isoNow();
      const by = req.auth.uid;
      tx.set(paymentRef, {
        id: paymentOpId,
        storeId,
        pointId,
        kind: "cobro",
        intentionId: intentId,
        corteId,
        amountCents,
        method,
        date,
        confirmedBy: by,
        confirmedAt: at,
      });
      tx.update(corteRef, { status: "cobrado", paymentOperationId: paymentOpId, updatedAt: at });
      return { registered: true, amountCents, date, method };
    });
  }
);

/**
 * Annul a corte: motive required, only the LATEST corte of the point, still
 * unpaid, with no later operations on the point (its entries must not have
 * moved again). Restores the SAME entries the corte consumed so the operator
 * can capture it again. The month-open check joins with the cierre cut.
 * data: { storeId, pointId, corteId, intentId, motive }
 */
export const annulPointCut = onCall(
  { region: "us-east1", maxInstances: 3, retry: false, memory: "256MiB", timeoutSeconds: 30, minInstances: 0 },
  async (req) => {
    const { storeId, pointId, corteId, intentId, motive } = req.data ?? {};
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("invalid-argument", "Falta la tienda.");
    if (typeof pointId !== "string" || !pointId) throw new HttpsError("invalid-argument", "Falta el punto de venta.");
    if (typeof corteId !== "string" || !corteId) throw new HttpsError("invalid-argument", "Falta el corte.");
    if (typeof intentId !== "string" || !intentId) throw new HttpsError("invalid-argument", "Falta el identificador de intento.");
    if (typeof motive !== "string" || !motive.trim()) throw new HttpsError("invalid-argument", "La anulación necesita su motivo.");

    const db = getFirestore();
    await requireOperator(db, storeId, req.auth);

    const annulmentOpId = `anul_${intentId}`;
    return db.runTransaction(async (tx) => {
      // #524 QA (mayor): an authorized close fixed this month's money — its
      // cuts cannot be annulled; the recomposition would stop reconciling
      // with the close and its profit distribution.
      const sealed = await sealedPeriods(tx, db, storeId);
      const annulRef = db.collection("pointOperations").doc(annulmentOpId);
      const savedAnnul = await tx.get(annulRef);
      if (savedAnnul.exists) {
        return { registered: false, alreadyRegistered: true };
      }
      await readPoint(tx, db, storeId, pointId);

      const corteRef = db.collection("pointOperations").doc(corteId);
      const corteSnap = await tx.get(corteRef);
      if (!corteSnap.exists || corteSnap.get("kind") !== "corte" || (corteSnap.get("pointId") ?? "") !== pointId) {
        throw new HttpsError("not-found", "No se encontró el corte de este punto.");
      }
      if (corteSnap.get("status") === "cobrado") {
        throw new HttpsError("failed-precondition", "Un corte ya cobrado no se puede anular.");
      }
      if (corteSnap.get("status") === "anulado") {
        throw new HttpsError("failed-precondition", "Este corte ya está anulado.");
      }
      assertOpenPeriod(sealed, corteSnap.get("effectiveDate"), "anular un corte de un mes cerrado");
      const corteAt = corteSnap.get("confirmedAt") ?? "";

      // Only the LATEST corte, and no later operations touching the point —
      // otherwise restoring entries would rewrite history under newer moves.
      const opsSnap = await tx.get(db.collection("pointOperations").where("pointId", "==", pointId));
      for (const opDoc of opsSnap.docs) {
        if (opDoc.id === corteId) continue;
        const data = opDoc.data();
        if ((data.confirmedAt ?? "") > corteAt && data.kind !== "cobro") {
          throw new HttpsError(
            "failed-precondition",
            "Hay movimientos posteriores en este punto; la anulación sólo aplica al último corte sin cobrar."
          );
        }
        if (data.kind === "cobro" && data.corteId === corteId) {
          throw new HttpsError("failed-precondition", "El corte ya tiene cobro registrado.");
        }
      }

      const at = isoNow();
      const by = req.auth.uid;
      // Restore the SAME entries (evidence rides on the allocation lists).
      const consumption = new Map();
      for (const group of [...(corteSnap.get("saleAllocations") ?? []), ...(corteSnap.get("writeOffAllocations") ?? [])]) {
        for (const allocation of group.allocations ?? []) {
          consumption.set(allocation.entryId, (consumption.get(allocation.entryId) ?? 0) + allocation.quantity);
        }
      }
      for (const [entryId, quantity] of consumption) {
        tx.update(db.collection("pointEntries").doc(entryId), {
          consumedQty: FieldValue.increment(-quantity),
          updatedAt: at,
        });
      }
      tx.set(annulRef, {
        id: annulmentOpId,
        storeId,
        pointId,
        kind: "anulacion",
        intentionId: intentId,
        corteId,
        motive: motive.trim(),
        restoredAllocations: corteSnap.get("saleAllocations") ?? [],
        restoredWriteOffAllocations: corteSnap.get("writeOffAllocations") ?? [],
        confirmedBy: by,
        confirmedAt: at,
      });
      tx.update(corteRef, { status: "anulado", annulmentOperationId: annulRef.id, updatedAt: at });
      return { registered: true };
    });
  }
);
