// #524 Exhibidores tab: TRUSTED callables for the fixture-piece registry of a
// point of sale (deliveries, cost confirmations, withdrawals). Firestore rules
// deny every client write to pointExhibitors, so all evidence lands here with
// membership re-checked inside ONE transaction and deterministic per-intent
// doc ids — a retry after a lost response can never duplicate a piece. The
// registry is OPERATIONAL ONLY: nothing here touches products, pointEntries,
// pointOperations, cash, cortes or the monthly close.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

// Mirrors firestore.rules isAllowlistedSuperAdmin (see applyCredit.mjs).
const PLATFORM_ADMIN_EMAILS = new Set([
  "admin@store.os",
  "imalvaroglez@gmail.com",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAME_MAX_CHARS = 80;
const QUANTITY_MAX = 500;
// One Firestore transaction caps at 500 writes; deliveries are piece docs
// only, so 400 leaves generous headroom.
const MAX_PIECES_PER_DELIVERY = 400;

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

/** Oldest-first pick key: physical delivery date, then creation, then id. */
function pieceAgeKey(piece) {
  return [piece.deliveredAt ?? "", piece.createdAt ?? "", piece.id ?? ""].join("|");
}

/**
 * Entrega de exhibidores (#524): register one delivery — several rows (name +
 * piece count + optional unit cost) under one physical date and the
 * «Entrega de apertura» flag. One doc PER PIECE (`pex_${intentId}_${i}`),
 * grouped in the interface by deliveryId + lineIndex.
 * data: { storeId, pointId, intentId, physicalDate, opening,
 *         lines: [{name, quantity, unitCostCents?}] }
 */
export const deliverPointExhibitors = onCall(
  { region: "us-east1", maxInstances: 3, retry: false, memory: "256MiB", timeoutSeconds: 30, minInstances: 0 },
  async (req) => {
    const { storeId, pointId, intentId, physicalDate, opening } = req.data ?? {};
    const lines = Array.isArray(req.data?.lines) ? req.data.lines : [];
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("invalid-argument", "Falta la tienda.");
    if (typeof pointId !== "string" || !pointId) throw new HttpsError("invalid-argument", "Falta el punto de venta.");
    if (typeof intentId !== "string" || !intentId) throw new HttpsError("invalid-argument", "Falta el identificador de intento.");
    if (!isRealDate(physicalDate)) throw new HttpsError("invalid-argument", "La fecha de entrega no es una fecha real.");
    if (typeof opening !== "boolean") throw new HttpsError("invalid-argument", "Indica si la entrega es de apertura.");
    if (lines.length === 0) throw new HttpsError("invalid-argument", "La entrega no tiene exhibidores.");
    let pieces = 0;
    for (const line of lines) {
      const name = typeof line?.name === "string" ? line.name.trim() : "";
      if (!name) throw new HttpsError("invalid-argument", "Cada renglón necesita el nombre del exhibidor.");
      if (name.length > NAME_MAX_CHARS) {
        throw new HttpsError("invalid-argument", `El nombre no puede pasar de ${NAME_MAX_CHARS} caracteres.`);
      }
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
        throw new HttpsError("invalid-argument", "Cada renglón necesita una cantidad de piezas mayor a cero.");
      }
      if (line.quantity > QUANTITY_MAX) {
        throw new HttpsError("invalid-argument", `Registra hasta ${QUANTITY_MAX} piezas por renglón.`);
      }
      if (line.unitCostCents !== undefined && (!Number.isSafeInteger(line.unitCostCents) || line.unitCostCents <= 0)) {
        throw new HttpsError("invalid-argument", "El costo por pieza debe ser un importe mayor a cero.");
      }
      pieces += line.quantity;
    }
    if (pieces > MAX_PIECES_PER_DELIVERY) {
      throw new HttpsError("invalid-argument", `Registra la entrega en partes de hasta ${MAX_PIECES_PER_DELIVERY} piezas.`);
    }

    const db = getFirestore();
    await requireOperator(db, storeId, req.auth);

    return db.runTransaction(async (tx) => {
      // Idempotency probe: the delivery's FIRST piece carries the intent id.
      const saved = await tx.get(db.collection("pointExhibitors").doc(`pex_${intentId}_0`));
      if (saved.exists) {
        return { delivered: false, alreadyDelivered: true };
      }
      await readPoint(tx, db, storeId, pointId);

      const at = isoNow();
      const by = req.auth.uid;
      let index = 0;
      lines.forEach((line, lineIndex) => {
        for (let n = 0; n < line.quantity; n += 1) {
          tx.set(db.collection("pointExhibitors").doc(`pex_${intentId}_${index}`), {
            id: `pex_${intentId}_${index}`,
            storeId,
            pointId,
            deliveryId: intentId,
            lineIndex,
            name: line.name.trim(),
            deliveredAt: physicalDate,
            opening,
            ...(line.unitCostCents !== undefined
              ? {
                  unitCostCents: line.unitCostCents,
                  costConfirmedBy: by,
                  costConfirmedAt: at,
                }
              : {}),
            deliveredBy: by,
            createdAt: at,
            updatedAt: at,
          });
          index += 1;
        }
      });
      return { delivered: true, pieces: index };
    });
  }
);

/**
 * Confirmar costo pendiente (#524): seal the unit cost of pieces that were
 * delivered without one. A confirmed cost is immutable evidence — confirming
 * the SAME value again is a no-op, a DIFFERENT value is rejected (withdraw
 * and re-deliver to correct a mistake). Only still-assigned pieces accept a
 * confirmation.
 * data: { storeId, pointId, items: [{exhibitorId, unitCostCents}] }
 */
export const confirmPointExhibitorCost = onCall(
  { region: "us-east1", maxInstances: 3, retry: false, memory: "256MiB", timeoutSeconds: 30, minInstances: 0 },
  async (req) => {
    const { storeId, pointId } = req.data ?? {};
    const items = Array.isArray(req.data?.items) ? req.data.items : [];
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("invalid-argument", "Falta la tienda.");
    if (typeof pointId !== "string" || !pointId) throw new HttpsError("invalid-argument", "Falta el punto de venta.");
    if (items.length === 0) throw new HttpsError("invalid-argument", "No hay piezas que confirmar.");
    const seen = new Set();
    for (const item of items) {
      if (typeof item?.exhibitorId !== "string" || !item.exhibitorId) {
        throw new HttpsError("invalid-argument", "Cada pieza necesita su identificador.");
      }
      if (seen.has(item.exhibitorId)) {
        throw new HttpsError("invalid-argument", "La misma pieza aparece dos veces.");
      }
      seen.add(item.exhibitorId);
      if (!Number.isSafeInteger(item.unitCostCents) || item.unitCostCents <= 0) {
        throw new HttpsError("invalid-argument", "El costo por pieza debe ser un importe mayor a cero.");
      }
    }

    const db = getFirestore();
    await requireOperator(db, storeId, req.auth);

    return db.runTransaction(async (tx) => {
      await readPoint(tx, db, storeId, pointId);
      // READ PHASE — every piece doc before any write (Firestore tx rule).
      const snaps = new Map();
      for (const item of items) {
        const snap = await tx.get(db.collection("pointExhibitors").doc(item.exhibitorId));
        if (!snap.exists || (snap.get("storeId") ?? "") !== storeId || (snap.get("pointId") ?? "") !== pointId) {
          throw new HttpsError("not-found", "Una pieza de la confirmación ya no existe en este punto.");
        }
        snaps.set(item.exhibitorId, snap);
      }
      const at = isoNow();
      const by = req.auth.uid;
      let confirmed = 0;
      let alreadyConfirmed = 0;
      for (const item of items) {
        const snap = snaps.get(item.exhibitorId);
        if (snap.get("withdrawnAt") !== undefined) {
          throw new HttpsError("failed-precondition", "Una pieza de la confirmación ya fue retirada.");
        }
        const current = snap.get("unitCostCents");
        if (current === item.unitCostCents) {
          alreadyConfirmed += 1; // idempotent retry
          continue;
        }
        if (current !== undefined) {
          throw new HttpsError("failed-precondition", "Una pieza ya tiene un costo confirmado distinto; retírala y registra la entrega de nuevo.");
        }
        tx.update(snap.ref, {
          unitCostCents: item.unitCostCents,
          costConfirmedBy: by,
          costConfirmedAt: at,
          updatedAt: at,
        });
        confirmed += 1;
      }
      return { confirmed, alreadyConfirmed };
    });
  }
);

/**
 * Retirar exhibidores (#524): mark pieces as returned, keeping the full
 * history (what stayed, what left, when). The client asks per row
 * (deliveryId + lineIndex + quantity); the server re-reads the assigned
 * pieces of that row and takes the OLDEST first, so concurrent withdrawals
 * that overdraw the row fail cleanly without partial effects.
 * data: { storeId, pointId, intentId, physicalDate,
 *         lines: [{deliveryId, lineIndex, quantity}] }
 */
export const withdrawPointExhibitors = onCall(
  { region: "us-east1", maxInstances: 3, retry: false, memory: "256MiB", timeoutSeconds: 30, minInstances: 0 },
  async (req) => {
    const { storeId, pointId, intentId, physicalDate } = req.data ?? {};
    const lines = Array.isArray(req.data?.lines) ? req.data.lines : [];
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("invalid-argument", "Falta la tienda.");
    if (typeof pointId !== "string" || !pointId) throw new HttpsError("invalid-argument", "Falta el punto de venta.");
    if (typeof intentId !== "string" || !intentId) throw new HttpsError("invalid-argument", "Falta el identificador de intento.");
    if (!isRealDate(physicalDate)) throw new HttpsError("invalid-argument", "La fecha del retiro no es una fecha real.");
    if (lines.length === 0) throw new HttpsError("invalid-argument", "El retiro no tiene exhibidores.");
    // ACCUMULATE per row before touching anything: duplicate rows of the same
    // renglón must sum, never double-pick past the assigned pieces (the
    // #524 QA accumulator lesson from surtido multilínea).
    const wanted = new Map();
    for (const line of lines) {
      if (typeof line?.deliveryId !== "string" || !line.deliveryId) {
        throw new HttpsError("invalid-argument", "Cada renglón necesita su entrega de origen.");
      }
      if (!Number.isSafeInteger(line.lineIndex) || line.lineIndex < 0) {
        throw new HttpsError("invalid-argument", "Cada renglón necesita su número de línea.");
      }
      if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
        throw new HttpsError("invalid-argument", "Cada renglón necesita una cantidad de piezas mayor a cero.");
      }
      const key = `${line.deliveryId}#${line.lineIndex}`;
      wanted.set(key, (wanted.get(key) ?? 0) + line.quantity);
    }

    const db = getFirestore();
    await requireOperator(db, storeId, req.auth);

    return db.runTransaction(async (tx) => {
      // Idempotency probe: a retry of this intent finds its own stamps.
      const prior = await tx.get(
        db.collection("pointExhibitors").where("withdrawalIntentionId", "==", intentId).limit(1)
      );
      if (!prior.empty) {
        return { withdrawn: false, alreadyWithdrawn: true };
      }
      await readPoint(tx, db, storeId, pointId);

      // Fresh picture of the point's pieces (single-field query: no composite
      // index needed), scoped to this store in memory.
      const piecesSnap = await tx.get(db.collection("pointExhibitors").where("pointId", "==", pointId));
      const pieces = piecesSnap.docs
        .map((docSnap) => ({ ref: docSnap.ref, ...docSnap.data() }))
        .filter((piece) => (piece.storeId ?? "") === storeId && piece.withdrawnAt === undefined);

      const byRow = new Map();
      for (const piece of pieces) {
        const key = `${piece.deliveryId}#${piece.lineIndex}`;
        const row = byRow.get(key) ?? [];
        row.push(piece);
        byRow.set(key, row);
      }
      for (const [key, row] of byRow) {
        row.sort((a, b) => pieceAgeKey(a).localeCompare(pieceAgeKey(b)));
      }

      const at = isoNow();
      const by = req.auth.uid;
      const picked = [];
      for (const [key, quantity] of wanted) {
        const row = byRow.get(key) ?? [];
        if (row.length < quantity) {
          throw new HttpsError(
            "failed-precondition",
            `No hay suficientes exhibidores asignados para retirar ${quantity}: hay ${row.length}.`
          );
        }
        for (const piece of row.slice(0, quantity)) {
          tx.update(piece.ref, {
            withdrawnAt: physicalDate,
            withdrawnBy: by,
            withdrawalIntentionId: intentId,
            updatedAt: at,
          });
          picked.push(piece.id);
        }
      }
      return { withdrawn: true, pieces: picked.length };
    });
  }
);
