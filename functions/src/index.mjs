// importPurchasePdf: OCR a supplier-order PDF already uploaded to Storage and
// return the parsed lines for the client review screen.
//
// Zero-cost guardrails (spec purchase-pdf-import):
//   - callable ONLY (no storage trigger → no re-fire loops)
//   - maxInstances 1, retry disabled, 1 GB, 540s, no min instances
//   - returns data directly (no Firestore writes)
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createHash } from "node:crypto";
import { parseSupplierOrder } from "./parser.js";

// Initialize the default Admin app once for the deployed Firebase project.
if (!globalThis.__storeOsAdmin) globalThis.__storeOsAdmin = initializeApp();
import { initializeApp } from "firebase-admin/app";

const MAX_PAGES = 8;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

let tesseractWorker = null;
async function ocr(pngBuffer) {
  if (!tesseractWorker) {
    const { createWorker } = await import("tesseract.js");
    tesseractWorker = await createWorker("spa");
  }
  const { data } = await tesseractWorker.recognize(pngBuffer);
  return data.text || "";
}

async function pdfPagesToPng(pdfBuffer) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const pages = [];
  const n = Math.min(doc.countPages(), MAX_PAGES);
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const pix = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
    pages.push(Buffer.from(pix.asPNG()));
    page.delete?.();
  }
  doc.destroy?.();
  return pages;
}

export const importPurchasePdf = onCall(
  {
    // Co-located with the Storage bucket (us-east1): cross-region PDF
    // transfers would be billed egress. Client must pass the same region.
    region: "us-east1",
    maxInstances: 1,
    retry: false,
    memory: "1GiB",
    timeoutSeconds: 540,
    minInstances: 0,
  },
  async (req) => {
    const storagePath = req.data?.storagePath;
    if (typeof storagePath !== "string" || !/^purchases\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.pdf$/.test(storagePath)) {
      throw new HttpsError("invalid-argument", "Ruta de PDF inválida.");
    }
    const storeId = storagePath.split("/")[1];
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");

    // G-P02: membership resolves ONLY from the canonical adminStores control
    // doc. A super_admin who is not a member must NOT reach the data plane
    // (supplier PDFs). Mirrors firestore.rules isMember / storage.rules.
    const db = getFirestore();
    const adminSnap = await db.collection("adminStores").doc(storeId).get();
    const members = adminSnap.get("memberUids") ?? [];
    if (!members.includes(uid)) {
      throw new HttpsError("permission-denied", "No tienes acceso a esta tienda.");
    }

    const file = getStorage().bucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) throw new HttpsError("not-found", "No se encontró el PDF.");
    const [meta] = await file.getMetadata();
    if (meta.size > MAX_PDF_BYTES) throw new HttpsError("out-of-range", "El PDF es demasiado grande (máx 10 MB).");

    // Safe cleanup guard: only on PROCESSING failures (never auth/not-found),
    // and only when no purchase references this path. The path itself carries
    // the store, so a single-field query avoids a composite index (1 read max).
    const deleteIfUnreferenced = async () => {
      try {
        const linked = await db
          .collection("purchases")
          .where("documentPath", "==", storagePath)
          .limit(1)
          .get();
        if (linked.empty) {
          await file.delete().catch((e) => {
            console.error("cleanup-delete-failed", e?.message);
          });
        }
        // Linked (or query failed): keep the file — it may be re-processed.
      } catch (e) {
        console.error("cleanup-skipped", e?.message);
      }
    };

    const [buf] = await file.download();
    let text = "";
    try {
      const pages = await pdfPagesToPng(buf);
      for (const png of pages) text += (await ocr(png)) + "\n@@PAGE@@\n";
    } catch (e) {
      console.error("ocr-failed", e?.message);
      await deleteIfUnreferenced();
      throw new HttpsError("internal", "No se pudo leer el PDF. Captura la compra a mano.");
    }
    if (!text.trim()) {
      // Likely a scanned-but-blank or handwritten doc: report, don't crash.
      await deleteIfUnreferenced();
      return emptyResult();
    }
    const parsed = parseSupplierOrder(text);
    if (!parsed.lines.length) {
      await deleteIfUnreferenced();
      return { ...emptyResult(), warning: "no-lines" };
    }
    return parsed;
  }
);

// Public order requests deliberately use the existing orders collection. The
// function is the trust boundary: the browser sends only ids and quantities;
// all names, prices, publication state and stock are read again here.
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_ID_RE = /^[A-Za-z0-9_-]{1,160}$/;
const PRODUCT_SLUG_RE = /^[a-z0-9-]{1,160}$/;
const MAX_REQUEST_LINES = 20;
const MAX_REQUEST_PIECES = 100;
const BROWSER_WINDOW_MS = 5 * 60 * 1000;
const IP_WINDOW_MS = 60 * 1000;
const DAILY_REQUEST_CAP = 500;

export const submitPublicOrderRequest = onCall(
  {
    region: "us-east1",
    minInstances: 0,
    maxInstances: 1,
    concurrency: 1,
    memory: "256MiB",
    timeoutSeconds: 15,
    retry: false,
  },
  async (req) => {
    const input = req.data ?? {};
    const requestId = input.requestId;
    const clientId = input.clientId;
    const storeSlug = input.storeSlug;
    const customerName = typeof input.customerName === "string" ? input.customerName.trim() : "";
    if (!REQUEST_ID_RE.test(requestId) || !REQUEST_ID_RE.test(clientId)) {
      throw new HttpsError("invalid-argument", "Identificador de solicitud inválido.");
    }
    if (typeof storeSlug !== "string" || !/^[a-z0-9-]{1,80}$/.test(storeSlug)) {
      throw new HttpsError("invalid-argument", "Catálogo inválido.");
    }
    if (customerName.length < 1 || customerName.length > 80 || /[\u0000-\u001f\u007f]/.test(customerName)) {
      throw new HttpsError("invalid-argument", "Escribe tu nombre para enviar el pedido.");
    }
    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    if (rawLines.length < 1 || rawLines.length > MAX_REQUEST_LINES) {
      throw new HttpsError("invalid-argument", "El pedido debe tener entre 1 y 20 productos.");
    }
    const lines = [];
    const seen = new Set();
    let pieces = 0;
    for (const raw of rawLines) {
      const productId = raw?.productId;
      const productSlug = raw?.productSlug;
      const quantity = raw?.quantity;
      if (typeof productId !== "string" || !PRODUCT_ID_RE.test(productId)
        || typeof productSlug !== "string" || !PRODUCT_SLUG_RE.test(productSlug)
        || !Number.isSafeInteger(quantity) || quantity < 1) {
        throw new HttpsError("invalid-argument", "Hay una línea de pedido inválida.");
      }
      if (seen.has(productId)) throw new HttpsError("invalid-argument", "No repitas productos en el pedido.");
      seen.add(productId);
      pieces += quantity;
      if (pieces > MAX_REQUEST_PIECES) {
        throw new HttpsError("invalid-argument", "El pedido supera el máximo de 100 piezas.");
      }
      lines.push({ productId, productSlug, quantity });
    }

    const db = getFirestore();
    const publicStoreSnap = await db.collection("publicStores").doc(storeSlug).get();
    if (!publicStoreSnap.exists) throw new HttpsError("not-found", "Catálogo no disponible.");
    const storeId = publicStoreSnap.get("storeId");
    if (typeof storeId !== "string" || !storeId) throw new HttpsError("failed-precondition", "Catálogo no disponible.");

    // Firebase's proxy supplies the connecting IP. Never trust a client-provided
    // forwarded header.
    const ip = req.rawRequest?.ip || req.rawRequest?.socket?.remoteAddress || req.rawRequest?.connection?.remoteAddress || "unknown";
    const browserKey = `browser_${digest(`${storeId}|${clientId}`)}`;
    const ipKey = `ip_${digest(`${storeId}|${ip}`)}`;
    const orderId = `public_${digest(`${storeId}|${requestId}`).slice(0, 40)}`;
    const fingerprint = digest(JSON.stringify({ client: digest(clientId), name: customerName, lines }));
    const now = Date.now();
    const nowTimestamp = Timestamp.fromMillis(now);
    const expiresAt = Timestamp.fromMillis(now + 24 * 60 * 60 * 1000);
    const dailyKey = `daily_${new Date(now).toISOString().slice(0, 10)}`;

    const result = await db.runTransaction(async (tx) => {
      const orderRef = db.collection("orders").doc(orderId);
      const browserRef = db.collection("publicOrderLimits").doc(browserKey);
      const ipRef = db.collection("publicOrderLimits").doc(ipKey);
      const dailyRef = db.collection("publicOrderLimits").doc(dailyKey);
      const storeRef = db.collection("stores").doc(storeId);
      const productRefs = lines.map((line) => db.collection("products").doc(line.productId));
      const [oldOrder, browser, ipLimit, daily, storeSnap, ...productSnaps] = await Promise.all([
        tx.get(orderRef), tx.get(browserRef), tx.get(ipRef), tx.get(dailyRef), tx.get(storeRef),
        ...productRefs.map((ref) => tx.get(ref)),
      ]);
      if (oldOrder.exists) {
        if (oldOrder.get("source") === "public_catalog" && oldOrder.get("requestFingerprint") === fingerprint) {
          return { orderId, reference: orderId.slice(-6).toUpperCase(), idempotent: true };
        }
        throw new HttpsError("already-exists", "Esta solicitud ya fue utilizada.");
      }
      const dailyCount = Number(daily.get("count") ?? 0);
      if (dailyCount >= DAILY_REQUEST_CAP) {
        throw new HttpsError("resource-exhausted", "Por ahora no podemos recibir más solicitudes. Intenta mañana.");
      }
      if (withinWindow(browser.get("lastSubmittedAt"), now, BROWSER_WINDOW_MS)) {
        throw new HttpsError("resource-exhausted", "Ya recibimos una solicitud reciente desde este navegador. Intenta en unos minutos.");
      }
      if (withinWindow(ipLimit.get("lastSubmittedAt"), now, IP_WINDOW_MS)) {
        throw new HttpsError("resource-exhausted", "Ya recibimos una solicitud reciente desde esta conexión. Intenta en un minuto.");
      }
      if (!storeSnap.exists || storeSnap.get("id") && storeSnap.get("id") !== storeId || storeSnap.get("slug") !== storeSlug) {
        throw new HttpsError("not-found", "Tienda no disponible.");
      }
      const store = { id: storeId, ...storeSnap.data() };
      if (store.type !== "inventory_tiered" && store.type !== "on_demand") {
        throw new HttpsError("failed-precondition", "Tienda no disponible.");
      }
      const canonical = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const snap = productSnaps[i];
        if (!snap.exists) throw new HttpsError("failed-precondition", "Una pieza ya no está disponible.");
        const product = { id: line.productId, ...snap.data() };
        if (product.storeId !== storeId || product.slug !== line.productSlug || !isPublished(product)) {
          throw new HttpsError("failed-precondition", "Una pieza ya no está publicada.");
        }
        if (typeof product.name !== "string" || !product.name.trim()) {
          throw new HttpsError("failed-precondition", "Una pieza no tiene nombre válido.");
        }
        const available = typeof product.quantityOnHand === "number" && Number.isFinite(product.quantityOnHand)
          ? Math.max(0, Math.floor(product.quantityOnHand))
          : undefined;
        if (store.type === "inventory_tiered" && (available == null || line.quantity > available)) {
          throw new HttpsError("failed-precondition", "La existencia cambió.", {
            code: "OUT_OF_STOCK", productSlug: line.productSlug, availableQuantity: available ?? 0,
          });
        }
        canonical.push({ product, ...line, available });
      }
      const items = priceRequestItems(store, canonical);
      const order = {
        storeId,
        customerId: "",
        items,
        deposit: 0,
        orderStatus: "requested",
        paymentStatus: "unpaid",
        schemaVersion: 2,
        source: "public_catalog",
        requesterName: customerName,
        requestFingerprint: fingerprint,
        expiresAt,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      };
      tx.set(orderRef, order);
      tx.set(browserRef, { scope: "browser", storeId, lastSubmittedAt: nowTimestamp, expiresAt });
      tx.set(ipRef, { scope: "ip", storeId, lastSubmittedAt: nowTimestamp, expiresAt });
      tx.set(dailyRef, { scope: "daily", count: dailyCount + 1, expiresAt: Timestamp.fromMillis(now + 2 * 24 * 60 * 60 * 1000) });
      return { orderId, reference: orderId.slice(-6).toUpperCase(), idempotent: false };
    });
    return result;
  }
);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function withinWindow(value, now, windowMs) {
  const millis = value?.toMillis?.() ?? (typeof value === "number" ? value : 0);
  return millis > 0 && now - millis < windowMs;
}

function isPublished(product) {
  return typeof product.slug === "string" && product.slug.length > 0
    && (product.status ? product.status === "published" : product.isPublic === true);
}

const CANONICAL_TIERS = [
  { id: "t_retail", order: 0 }, { id: "t_wholesale", order: 1 }, { id: "t_reseller", order: 2 },
];
const LEGACY_TIERS = { retail: "t_retail", wholesale: "t_wholesale", reseller: "t_reseller" };

function priceRequestItems(store, lines) {
  const configured = Array.isArray(store.priceTiers)
    ? store.priceTiers.filter((tier) => tier && typeof tier.id === "string" && tier.id && Number.isFinite(tier.order) && !tier.hidden)
    : [];
  const tiers = (configured.length ? configured : CANONICAL_TIERS).sort((a, b) => a.order - b.order);
  const priced = lines.map(({ product, quantity }) => ({ product, quantity, unitPrices: unitPrices(product, tiers) }));
  const totalQuantity = priced.reduce((sum, line) => sum + line.quantity, 0);
  const qualifies = (tier) => {
    if (tier.minPieces != null && totalQuantity < tier.minPieces) return false;
    if (tier.minAmount != null && !priced.every((line) => Number.isFinite(line.unitPrices[tier.id]))) return false;
    if (tier.minAmount != null && priced.reduce((sum, line) => sum + line.unitPrices[tier.id] * line.quantity, 0) < tier.minAmount) return false;
    return true;
  };
  const own = (tier) => priced.every((line) => Number.isFinite(line.unitPrices[tier.id]));
  const active = [...tiers].reverse().find((tier) => qualifies(tier) && own(tier)) || tiers.find(own);
  return priced.map((line) => {
    const tierId = active?.id || store.defaultTierId || tiers[0]?.id;
    const unitPrice = line.unitPrices[tierId] ?? line.product.price ?? 0;
    return {
      ...(line.product.id ? { productId: line.product.id } : {}),
      productName: line.product.name,
      quantity: line.quantity,
      ...(tierId ? { priceTier: tierId } : {}),
      unitPrice,
      subtotal: unitPrice * line.quantity,
    };
  });
}

function unitPrices(product, tiers) {
  const source = product.prices ?? {};
  const prices = {};
  for (const tier of tiers) {
    const value = source[tier.id] ?? source[Object.keys(LEGACY_TIERS).find((key) => LEGACY_TIERS[key] === tier.id)];
    if (typeof value === "number" && Number.isFinite(value)) prices[tier.id] = value;
  }
  if (typeof product.price === "number" && Number.isFinite(product.price) && prices.t_retail == null) prices.t_retail = product.price;
  return prices;
}

function emptyResult() {
  return { supplierOrder: undefined, dateLabel: undefined, lines: [], warning: "no-text" };
}
