// #524 first surtido: TRUSTED order→point conversion ("Usar como surtido
// inicial"). Firestore rules deny every client write to pointEntries/
// pointOperations (the Admin SDK bypasses rules), so THIS callable is the
// only way to convert a confirmed order into a point's first stock. It:
//   1. authenticates the caller and resolves membership (G-P02, applyCredit
//      idiom),
//   2. reads order + point + every referenced product fresh inside ONE
//      transaction (authoritative re-validation of the client's preview —
//      the pure rules live in src/lib/pointOfSale.ts),
//   3. transfers the EXISTING reservation: the order gets convertedToPointId
//      (leaves "Falta cobrar"/"Comprometido" via the selectors), warehouse
//      product docs are NOT touched again, and the pieces become point
//      entries with their exact cents, physical date and known cost,
//   4. writes order link + entries + operation evidence atomically.
// Idempotent per intentId: a retry after success returns
// { converted: false, alreadyConverted: true } and writes nothing.
// Zero-cost guardrails mirror applyCredit: callable only, no retry, small
// memory, tight timeout.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { orderAmountCents } from "./creditMath.mjs";

// Mirrors firestore.rules isAllowlistedSuperAdmin (see applyCredit.mjs).
const PLATFORM_ADMIN_EMAILS = new Set([
  "admin@store.os",
  "imalvaroglez@gmail.com",
]);

// One conversion writes 1 order + 1 evidence + N entry docs inside a single
// transaction. Hard cap keeps the tx bounded (the operator splits huge
// orders manually — never silently).
const MAX_ENTRY_DOCS = 200;

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

function itemsOf(order) {
  return Array.isArray(order.items) ? order.items : [];
}

function isoNow() {
  return new Date().toISOString();
}

/**
 * Convert a confirmed order into a point's first surtido.
 * data: { storeId, pointId, orderId, physicalDate, intentId }
 * physicalDate: the real delivery date (YYYY-MM-DD) the pieces entered the
 * point. Returns { converted, entryCount, units } — or
 * { converted: false, alreadyConverted: true } on an idempotent retry.
 */
export const convertOrderToFirstSurtido = onCall(
  {
    region: "us-east1",
    maxInstances: 3,
    retry: false,
    memory: "256MiB",
    timeoutSeconds: 30,
    minInstances: 0,
  },
  async (req) => {
    const { storeId, pointId, orderId, physicalDate, intentId } = req.data ?? {};
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("invalid-argument", "Falta la tienda.");
    if (typeof pointId !== "string" || !pointId) throw new HttpsError("invalid-argument", "Falta el punto de venta.");
    if (typeof orderId !== "string" || !orderId) throw new HttpsError("invalid-argument", "Falta el pedido.");
    if (typeof intentId !== "string" || !intentId) throw new HttpsError("invalid-argument", "Falta el identificador de intento.");
    if (typeof physicalDate !== "string" || !DATE_RE.test(physicalDate)) {
      throw new HttpsError("invalid-argument", "La fecha física no es válida.");
    }

    const db = getFirestore();
    await requireOperator(db, storeId, req.auth);

    const opId = `conv_${intentId}`;

    return db.runTransaction(async (tx) => {
      // Idempotency first: this exact intent already landed → nothing to do.
      const opRef = db.collection("pointOperations").doc(opId);
      const savedOp = await tx.get(opRef);
      if (savedOp.exists) {
        return { converted: false, alreadyConverted: true, pointId: savedOp.get("pointId") };
      }

      const orderSnap = await tx.get(db.collection("orders").doc(orderId));
      if (!orderSnap.exists) throw new HttpsError("not-found", "No se encontró el pedido.");
      const order = orderSnap.data();
      if ((order.storeId ?? "") !== storeId) {
        throw new HttpsError("permission-denied", "El pedido pertenece a otra tienda.");
      }

      const pointSnap = await tx.get(db.collection("points").doc(pointId));
      if (!pointSnap.exists || (pointSnap.get("storeId") ?? "") !== storeId) {
        throw new HttpsError("not-found", "No se encontró el punto de venta de esta tienda.");
      }
      if (pointSnap.get("active") === false) {
        throw new HttpsError("failed-precondition", "El punto de venta está desactivado.");
      }

      if (order.convertedToPointId) {
        throw new HttpsError("failed-precondition", "El pedido ya fue convertido a un punto de venta; solo puede convertirse una vez.");
      }
      if (order.orderStatus !== "confirmed") {
        throw new HttpsError("failed-precondition", "Solo un pedido confirmado puede usarse como surtido inicial.");
      }
      if ((order.deposit ?? 0) > 0) {
        throw new HttpsError("failed-precondition", "El pedido tiene un anticipo registrado; no puede convertirse.");
      }
      if ((order.paymentsReceivedCents ?? 0) > 0 || order.paymentStatus === "partial" || order.paymentStatus === "paid") {
        throw new HttpsError("failed-precondition", "El pedido ya tiene cobros registrados.");
      }
      if ((order.creditAppliedCents ?? 0) > 0) {
        throw new HttpsError("failed-precondition", "El pedido tiene crédito aplicado desde otro pedido.");
      }
      if (Array.isArray(order.deliveries) && order.deliveries.length > 0) {
        throw new HttpsError("failed-precondition", "El pedido ya registra entregas.");
      }
      if (Array.isArray(order.incidents) && order.incidents.length > 0) {
        throw new HttpsError("failed-precondition", "El pedido tiene incidencias registradas.");
      }

      // Authoritative line/product checks (mirrors orderConversionImpediments).
      const items = itemsOf(order);
      if (items.length === 0) {
        throw new HttpsError("failed-precondition", "El pedido no tiene piezas para surtir.");
      }
      const products = new Map();
      for (const raw of items) {
        const item = raw ?? {};
        if (typeof item.productId !== "string" || !item.productId) {
          throw new HttpsError("failed-precondition", `La línea «${item.productName ?? "sin nombre"}» no tiene un producto identificable del catálogo.`);
        }
        if (!products.has(item.productId)) {
          const snap = await tx.get(db.collection("products").doc(item.productId));
          if (!snap.exists || (snap.get("storeId") ?? "") !== storeId) {
            throw new HttpsError("failed-precondition", `El producto de la línea «${item.productName}» ya no existe en el catálogo.`);
          }
          products.set(item.productId, snap.data());
        }
        const product = products.get(item.productId);
        const variants = Array.isArray(product.variants) ? product.variants : [];
        if (variants.length > 0) {
          const variant = variants.find((v) => v?.id === item.variantId);
          if (!variant) {
            throw new HttpsError("failed-precondition", `La línea «${item.productName}» no indica un color existente del diseño.`);
          }
          if (typeof variant.quantityOnHand === "number" && variant.quantityOnHand < 0) {
            throw new HttpsError("failed-precondition", `El color ${variant.color} tiene existencias negativas; revisa el inventario antes de convertir.`);
          }
        } else if (typeof product.quantityOnHand === "number" && product.quantityOnHand < 0) {
          throw new HttpsError("failed-precondition", `«${item.productName}» tiene existencias negativas; revisa el inventario antes de convertir.`);
        }
      }

      // Build the entries: one per product + color + marked price (+ known
      // cost), quantities merged across identical lines — the same grouping
      // the client preview shows (src/lib/pointOfSale.ts).
      const grouped = new Map();
      for (const raw of items) {
        const item = raw ?? {};
        if (typeof item.productId !== "string" || !item.productId) continue;
        const product = products.get(item.productId);
        const quantity = Math.max(0, Math.round(Number(item.quantity ?? 0)));
        if (quantity <= 0) continue;
        const markedPriceCents = orderAmountCents(Math.max(0, Number(item.unitPrice ?? 0)), 1);
        const rawCost = item.cost === undefined || item.cost === null ? undefined : orderAmountCents(Math.max(0, Number(item.cost)), 1);
        const key = [item.productId, item.variantId ?? "", markedPriceCents, rawCost ?? "-"].join("|");
        const existing = grouped.get(key);
        if (existing) existing.quantity += quantity;
        else {
          const productName = String(item.productName ?? product.name ?? "Pieza");
          grouped.set(key, {
            productId: item.productId,
            ...(item.variantId ? { variantId: item.variantId } : {}),
            productName,
            ...(item.variantColor ? { variantColor: item.variantColor } : {}),
            quantity,
            markedPriceCents,
            ...(rawCost !== undefined ? { unitCostCents: rawCost } : {}),
          });
        }
      }
      const entries = [...grouped.values()];
      if (entries.length === 0) throw new HttpsError("failed-precondition", "El pedido no tiene piezas para surtir.");
      if (entries.length > MAX_ENTRY_DOCS) {
        throw new HttpsError("failed-precondition", `El pedido produce ${entries.length} entradas distintas; divídelo en más de una operación.`);
      }
      const units = entries.reduce((sum, entry) => sum + entry.quantity, 0);

      const at = isoNow();
      const by = req.auth.uid;
      tx.update(orderSnap.ref, {
        convertedToPointId: pointId,
        revision: FieldValue.increment(1),
        updatedAt: at,
      });
      entries.forEach((entry, index) => {
        tx.set(db.collection("pointEntries").doc(`pe_${intentId}_${index}`), {
          id: `pe_${intentId}_${index}`,
          storeId,
          pointId,
          ...entry,
          entryDate: physicalDate,
          consumedQty: 0,
          originOrderId: orderId,
          createdAt: at,
          updatedAt: at,
        });
      });
      tx.set(opRef, {
        id: opId,
        storeId,
        pointId,
        kind: "first_surtido",
        intentionId: intentId,
        orderId,
        physicalDate,
        entryCount: entries.length,
        units,
        confirmedBy: by,
        confirmedAt: at,
      });
      return { converted: true, entryCount: entries.length, units };
    });
  }
);
