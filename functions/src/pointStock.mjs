// #524 manual stock movements: TRUSTED callables that move pieces between
// the warehouse and a point of sale. Firestore rules deny every client write
// to pointEntries/pointOperations, and product stock itself only moves here
// with membership + availability re-checked inside ONE transaction. The
// catalog's public availability republication is the CLIENT wrapper's
// follow-up (best-effort, retryable alone) — never a second money path.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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

/** The sellable shelf this line draws from: the variant's own or the
 * product-level quantity, mirroring how order reservations decrement. */
function shelfOf(productData, variantId) {
  const variants = Array.isArray(productData.variants) ? productData.variants : [];
  if (variants.length > 0) {
    const variant = variants.find((v) => v?.id === variantId);
    if (!variant) throw new HttpsError("failed-precondition", "La línea no indica un color existente del diseño.");
    return {
      kind: "variant",
      variant,
      available: typeof variant.quantityOnHand === "number" ? variant.quantityOnHand : 0,
      unitCost: typeof variant.cost === "number" ? variant.cost : undefined,
    };
  }
  if (variantId) {
    throw new HttpsError("failed-precondition", "El producto no tiene colores; la línea no debe llevar uno.");
  }
  return {
    kind: "product",
    available: typeof productData.quantityOnHand === "number" ? productData.quantityOnHand : 0,
    unitCost: typeof productData.cost === "number" ? productData.cost : undefined,
  };
}

/**
 * Surtir: move AVAILABLE warehouse pieces to the point (#524). Each line
 * carries the operator-confirmed label price (the pilot proposes Regular)
 * and the known unit cost travels as evidence (absent = pending valuation).
 * data: { storeId, pointId, intentId, physicalDate,
 *         lines: [{productId, variantId?, qty, markedPriceCents, unitCostCents?}] }
 */
export const stockPointFromWarehouse = onCall(
  { region: "us-east1", maxInstances: 3, retry: false, memory: "256MiB", timeoutSeconds: 30, minInstances: 0 },
  async (req) => {
    const { storeId, pointId, intentId, physicalDate } = req.data ?? {};
    const lines = Array.isArray(req.data?.lines) ? req.data.lines : [];
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("invalid-argument", "Falta la tienda.");
    if (typeof pointId !== "string" || !pointId) throw new HttpsError("invalid-argument", "Falta el punto de venta.");
    if (typeof intentId !== "string" || !intentId) throw new HttpsError("invalid-argument", "Falta el identificador de intento.");
    if (!isRealDate(physicalDate)) throw new HttpsError("invalid-argument", "La fecha física no es una fecha real.");
    if (lines.length === 0) throw new HttpsError("invalid-argument", "El surtido no tiene piezas.");
    for (const line of lines) {
      if (typeof line?.productId !== "string" || !line.productId) {
        throw new HttpsError("invalid-argument", "Cada línea necesita su producto.");
      }
      if (!Number.isSafeInteger(line.qty) || line.qty <= 0) {
        throw new HttpsError("invalid-argument", "Cada línea necesita una cantidad mayor a cero.");
      }
      if (!Number.isSafeInteger(line.markedPriceCents) || line.markedPriceCents <= 0) {
        throw new HttpsError("invalid-argument", "Cada línea necesita el precio de etiqueta confirmado.");
      }
      if (line.unitCostCents !== undefined && (!Number.isSafeInteger(line.unitCostCents) || line.unitCostCents < 0)) {
        throw new HttpsError("invalid-argument", "El costo unitario no es válido.");
      }
    }

    const db = getFirestore();
    await requireOperator(db, storeId, req.auth);

    const opId = `surt_${intentId}`;
    return db.runTransaction(async (tx) => {
      const opRef = db.collection("pointOperations").doc(opId);
      const saved = await tx.get(opRef);
      if (saved.exists) {
        return { stocked: false, alreadyStocked: true, entryCount: saved.get("entryCount"), units: saved.get("units") };
      }
      await readPoint(tx, db, storeId, pointId);

      const at = isoNow();
      const by = req.auth.uid;
      let units = 0;
      let index = 0;
      // READ PHASE — every product doc before any write (Firestore tx rule).
      const productSnaps = new Map();
      for (const line of lines) {
        if (productSnaps.has(line.productId)) continue;
        const snap = await tx.get(db.collection("products").doc(line.productId));
        if (!snap.exists || (snap.get("storeId") ?? "") !== storeId) {
          throw new HttpsError("failed-precondition", "El producto de una línea ya no existe en el catálogo.");
        }
        productSnaps.set(line.productId, snap);
      }
      // WRITE PHASE.
      for (const line of lines) {
        const snap = productSnaps.get(line.productId);
        const shelf = shelfOf(snap.data(), line.variantId);
        if (shelf.available < line.qty) {
          throw new HttpsError(
            "failed-precondition",
            `No hay suficientes piezas en el almacén para surtir ${line.qty}: hay ${Math.max(0, shelf.available)}.`
          );
        }
        shelf.available -= line.qty;
        // Warehouse decrement (the reservation model already keeps
        // quantityOnHand as the sellable shelf).
        if (shelf.kind === "variant") {
          tx.update(snap.ref, {
            variants: snap.data().variants.map((v) =>
              v.id === line.variantId
                ? { ...v, quantityOnHand: (typeof v.quantityOnHand === "number" ? v.quantityOnHand : 0) - line.qty, updatedAt: at }
                : v
            ),
            updatedAt: at,
          });
        } else {
          tx.update(snap.ref, {
            quantityOnHand: FieldValue.increment(-line.qty),
            updatedAt: at,
          });
        }
        // Point entry: physical date, confirmed label price, known cost.
        tx.set(db.collection("pointEntries").doc(`pe_${intentId}_${index}`), {
          id: `pe_${intentId}_${index}`,
          storeId,
          pointId,
          productId: line.productId,
          ...(line.variantId ? { variantId: line.variantId } : {}),
          productName: snap.get("name") ?? "",
          ...(Array.isArray(snap.get("variants")) && line.variantId
            ? { variantColor: (snap.get("variants").find((v) => v?.id === line.variantId)?.color ?? "") }
            : {}),
          entryDate: physicalDate,
          quantity: line.qty,
          consumedQty: 0,
          markedPriceCents: line.markedPriceCents,
          // Cost evidence: the operator's figure wins; otherwise the
          // catalog's own (variant or product) cost; absent = pending.
          ...(line.unitCostCents !== undefined
            ? { unitCostCents: line.unitCostCents }
            : shelf.unitCost !== undefined
              ? { unitCostCents: Math.round(shelf.unitCost * 100) }
              : {}),
          originOperationId: opId,
          createdAt: at,
          updatedAt: at,
        });
        units += line.qty;
        index += 1;
      }
      tx.set(opRef, {
        id: opId,
        storeId,
        pointId,
        kind: "surtido",
        intentionId: intentId,
        physicalDate,
        lines,
        entryCount: lines.length,
        units,
        confirmedBy: by,
        confirmedAt: at,
      });
      return { stocked: true, entryCount: lines.length, units };
    });
  }
);

/**
 * Retirar: return sellable pieces from the point to their EXACT variant in
 * the warehouse (#524). Consumption is FIFO over the point's entries (the
 * allocations ride on the evidence); the warehouse shelf gets the pieces
 * back without touching its running cost average (the entry's cost evidence
 * stays in the operation).
 * data: { storeId, pointId, intentId,
 *         lines: [{productId, variantId?, qty}] }
 */
export const withdrawFromPoint = onCall(
  { region: "us-east1", maxInstances: 3, retry: false, memory: "256MiB", timeoutSeconds: 30, minInstances: 0 },
  async (req) => {
    const { storeId, pointId, intentId } = req.data ?? {};
    const lines = Array.isArray(req.data?.lines) ? req.data.lines : [];
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("invalid-argument", "Falta la tienda.");
    if (typeof pointId !== "string" || !pointId) throw new HttpsError("invalid-argument", "Falta el punto de venta.");
    if (typeof intentId !== "string" || !intentId) throw new HttpsError("invalid-argument", "Falta el identificador de intento.");
    if (lines.length === 0) throw new HttpsError("invalid-argument", "El retiro no tiene piezas.");
    for (const line of lines) {
      if (typeof line?.productId !== "string" || !line.productId) {
        throw new HttpsError("invalid-argument", "Cada línea necesita su producto.");
      }
      if (!Number.isSafeInteger(line.qty) || line.qty <= 0) {
        throw new HttpsError("invalid-argument", "Cada línea necesita una cantidad mayor a cero.");
      }
    }

    const db = getFirestore();
    await requireOperator(db, storeId, req.auth);

    const opId = `reti_${intentId}`;
    return db.runTransaction(async (tx) => {
      const opRef = db.collection("pointOperations").doc(opId);
      const saved = await tx.get(opRef);
      if (saved.exists) {
        return { withdrawn: false, alreadyWithdrawn: true, units: saved.get("units") };
      }
      await readPoint(tx, db, storeId, pointId);

      // Fresh entries; FIFO allocation per dimension (any price — a return
      // is not a sale).
      const entriesSnap = await tx.get(db.collection("pointEntries").where("pointId", "==", pointId));
      const entries = entriesSnap.docs.map((docSnap) => ({ ref: docSnap.ref, ...docSnap.data() }));
      const fifoSorted = entries
        .filter((entry) => entry.productId)
        .sort((a, b) =>
          [a.entryDate, a.createdAt ?? "", a.id].join("|").localeCompare([b.entryDate, b.createdAt ?? "", b.id].join("|"))
        );
      const state = new Map(entries.map((entry) => [entry.id, Math.max(0, (entry.quantity ?? 0) - (entry.consumedQty ?? 0))]));
      function consume(productId, variantId, qty) {
        const allocations = [];
        let need = qty;
        for (const entry of fifoSorted) {
          if (need <= 0) break;
          if (entry.productId !== productId || (entry.variantId ?? "") !== (variantId ?? "")) continue;
          const left = state.get(entry.id) ?? 0;
          if (left <= 0) continue;
          const take = Math.min(left, need);
          state.set(entry.id, left - take);
          allocations.push({ entryId: entry.id, quantity: take });
          need -= take;
        }
        return { allocations, short: need };
      }

      const at = isoNow();
      const by = req.auth.uid;
      const consumption = new Map();
      let units = 0;
      // READ PHASE — allocation math is local; products load before writes.
      const productSnaps = new Map();
      for (const line of lines) {
        if (productSnaps.has(line.productId)) continue;
        const snap = await tx.get(db.collection("products").doc(line.productId));
        if (!snap.exists || (snap.get("storeId") ?? "") !== storeId) {
          throw new HttpsError("failed-precondition", "El producto de una línea ya no existe en el catálogo.");
        }
        productSnaps.set(line.productId, snap);
      }
      // WRITE PHASE.
      for (const line of lines) {
        const { allocations, short } = consume(line.productId, line.variantId, line.qty);
        if (short > 0) {
          throw new HttpsError(
            "failed-precondition",
            `No hay suficientes piezas en el punto para retirar ${line.qty}: faltan ${short}.`
          );
        }
        for (const allocation of allocations) {
          consumption.set(allocation.entryId, (consumption.get(allocation.entryId) ?? 0) + allocation.quantity);
        }
        const snap = productSnaps.get(line.productId);
        const variants = Array.isArray(snap.get("variants")) ? snap.get("variants") : [];
        if (variants.length > 0 && !variants.some((v) => v?.id === line.variantId)) {
          throw new HttpsError("failed-precondition", "La línea no indica un color existente del diseño.");
        }
        if (variants.length > 0) {
          tx.update(snap.ref, {
            variants: variants.map((v) =>
              v.id === line.variantId
                ? { ...v, quantityOnHand: (typeof v.quantityOnHand === "number" ? v.quantityOnHand : 0) + line.qty, updatedAt: at }
                : v
            ),
            updatedAt: at,
          });
        } else {
          tx.update(snap.ref, {
            quantityOnHand: FieldValue.increment(line.qty),
            updatedAt: at,
          });
        }
        units += line.qty;
      }
      for (const [entryId, quantity] of consumption) {
        const entry = entries.find((candidate) => candidate.id === entryId);
        tx.update(entry.ref, { consumedQty: FieldValue.increment(quantity), updatedAt: at });
      }
      tx.set(opRef, {
        id: opId,
        storeId,
        pointId,
        kind: "retiro",
        intentionId: intentId,
        lines,
        entryAllocations: [...consumption.entries()].map(([entryId, quantity]) => ({ entryId, quantity })),
        units,
        confirmedBy: by,
        confirmedAt: at,
      });
      return { withdrawn: true, units };
    });
  }
);
