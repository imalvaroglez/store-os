// importPurchasePdf: OCR a supplier-order PDF already uploaded to Storage and
// return the parsed lines for the client review screen.
//
// Zero-cost guardrails (spec purchase-pdf-import):
//   - callable ONLY (no storage trigger → no re-fire loops)
//   - maxInstances 1, retry disabled, 1 GB, 540s, no min instances
//   - returns data directly (no Firestore writes)
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { parseSupplierOrder } from "./parser.js";
import { submitPublicOrder } from "./publicOrder.mjs";
import "./admin.mjs";

export { submitPublicOrder };

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

function emptyResult() {
  return { supplierOrder: undefined, dateLabel: undefined, lines: [], warning: "no-text" };
}
