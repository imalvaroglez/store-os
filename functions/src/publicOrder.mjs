// submitPublicOrder: anonymous public-cart checkout. Validates the cart
// server-side against the publicProducts projection, then in one transaction:
// upserts a customer by phone, creates a multi-item order (status "asked",
// origin "public"), and reserves stock (decrements quantityOnHand) for
// inventory products.
//
// Zero-cost guardrails (mirrors importPurchasePdf):
//   - callable only, no triggers; small quota (≤20 items → ≤22 reads + writes)
//   - strict input validation; prices come from the server, never the client
//   - Firestore writes stay inside one transaction
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

const MAX_ITEMS = 20;
const PHONE_RE = /^\+?\d{10,15}$/;

export const submitPublicOrder = onCall(
  {
    region: "us-east1",
    maxInstances: 10,
    retry: false,
    timeoutSeconds: 60,
    minInstances: 0,
  },
  async (req) => {
    const { storeSlug, name, phone, items } = req.data ?? {};
    if (typeof storeSlug !== "string" || !/^[a-z0-9-]{1,60}$/.test(storeSlug)) {
      throw new HttpsError("invalid-argument", "Tienda inválida.");
    }
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) {
      throw new HttpsError("invalid-argument", "Escribe tu nombre (máx. 80 caracteres).");
    }
    if (typeof phone !== "string" || !PHONE_RE.test(phone)) {
      throw new HttpsError("invalid-argument", "Tu WhatsApp debe tener entre 10 y 15 dígitos.");
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
      throw new HttpsError("invalid-argument", `El pedido debe tener entre 1 y ${MAX_ITEMS} productos.`);
    }
    // Aggregate duplicate slugs; validate shape.
    const quantities = new Map();
    for (const it of items) {
      const slug = it?.productSlug;
      const qty = it?.quantity;
      if (typeof slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(slug)) {
        throw new HttpsError("invalid-argument", "Producto inválido.");
      }
      if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
        throw new HttpsError("invalid-argument", "Cantidad inválida.");
      }
      quantities.set(slug, (quantities.get(slug) ?? 0) + qty);
    }

    const db = getFirestore();
    const storeSnap = await db.collection("publicStores").doc(storeSlug).get();
    if (!storeSnap.exists) throw new HttpsError("not-found", "Tienda no encontrada.");
    // Some deployed publicStores docs predate the storeId field (prod
    // 2026-08-25): fall back to publicCatalogs, which always carries it.
    const storeId =
      storeSnap.get("storeId") ??
      (await db.collection("publicCatalogs").doc(storeSlug).get()).get("storeId");
    if (typeof storeId !== "string") throw new HttpsError("not-found", "Tienda no encontrada.");

    // Resolve every line against the public projection: the SERVER's price and
    // availability are authoritative; the client only sends slug + quantity.
    // Sold-out / short-stock items are NOT rejected — they enter the order as
    // needsReview ("por surtir") and the store decides when fulfilling.
    const resolved = [];
    for (const [slug, quantity] of quantities) {
      const snap = await db.collection("publicProducts").doc(`${storeId}__${slug}`).get();
      if (!snap.exists || typeof snap.get("price") !== "number") {
        throw new HttpsError("failed-precondition", `Ya no está disponible: ${snap.get("name") ?? slug}.`);
      }
      resolved.push({
        productId: typeof snap.get("productId") === "string" ? snap.get("productId") : null,
        productName: snap.get("name") ?? slug,
        price: snap.get("price"),
        quantity,
        needsReview: snap.get("availability") === "sold_out",
      });
    }

    const nowIso = new Date().toISOString();
    const cleanName = name.trim();

    // ponytail: customer lookup happens before the transaction; two
    // simultaneous orders from the same phone could create a duplicate
    // customer. Harmless (same phone/name); re-check inside if it matters.
    const custSnap = await db.collection("customers").where("phone", "==", phone).limit(10).get();
    const existing = custSnap.docs.find((d) => d.get("storeId") === storeId);
    const customerRef = existing ? existing.ref : db.collection("customers").doc();

    const orderRef = db.collection("orders").doc();
    await db.runTransaction(async (tx) => {
      // Firestore transactions require ALL reads before ANY write.
      const productSnaps = new Map();
      for (const r of resolved) {
        if (!r.productId) continue;
        productSnaps.set(r.productId, await tx.get(db.collection("products").doc(r.productId)));
      }

      if (existing) {
        if (!existing.get("name")) tx.update(customerRef, { name: cleanName, updatedAt: nowIso });
      } else {
        tx.set(customerRef, { storeId, name: cleanName, phone, createdAt: nowIso, updatedAt: nowIso });
      }

      for (const r of resolved) {
        if (!r.productId || r.needsReview) continue; // sold out: never touch stock
        const snap = productSnaps.get(r.productId);
        if (!snap || !snap.exists) continue; // deleted since projection: order still created
        const qoh = snap.get("quantityOnHand");
        if (typeof qoh !== "number") continue; // on-demand product: nothing to reserve
        // ponytail: compares against raw on-hand, not minus other open
        // orders' committed stock. Back-order semantics (negative stock)
        // are already tolerated by the admin flow.
        if (qoh >= r.quantity) {
          tx.update(db.collection("products").doc(r.productId), { quantityOnHand: qoh - r.quantity, updatedAt: nowIso });
        } else {
          // Short stock: never go negative here — flag for the store to review
          // ("por surtir") and decide when fulfilling.
          r.needsReview = true;
        }
      }

      const first = resolved[0];
      tx.set(orderRef, {
        storeId,
        customerId: customerRef.id,
        // Flat mirror of the first item (older readers); items[] is canonical.
        productId: first.productId ?? null,
        productName: first.productName,
        quantity: first.quantity,
        price: first.price,
        deposit: 0,
        status: "asked",
        origin: "public",
        items: resolved.map((r) => ({
          productId: r.productId,
          productName: r.productName,
          price: r.price,
          quantity: r.quantity,
          ...(r.needsReview ? { needsReview: true } : {}),
        })),
        notes: `WhatsApp: ${phone}`,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });

    return {
      orderId: orderRef.id,
      items: resolved.map(({ productName, price, quantity }) => ({ productName, price, quantity })),
    };
  }
);
