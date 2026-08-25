import {
  getStorage,
  connectStorageEmulator,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  type FirebaseStorage,
} from "firebase/storage";
import { getFirebase } from "./config";

// Cloud image transport for product photos. The only module that imports the
// Storage SDK. Reads are public (the anonymous catalog loads imageUrl); writes
// are gated by storage.rules via a Firestore membership check. The path is
// deterministic (products/{storeId}/{productId}.jpg) so a replace overwrites the
// same object and a product delete removes it — no orphans from replaces.

// Emulator mode mirrors config.ts: same opt-in, DEV/TEST-only, never in prod.
// String compare (Vite injects .env as strings — `!!` would treat "false" as on).
const EMULATOR =
  import.meta.env.MODE !== "production" &&
  import.meta.env.VITE_FIREBASE_EMULATOR === "true";
// Explicit emulator bucket — the Web SDK needs a real bucket name, and config.ts
// forces the "store-os-demo" namespace, so we do the same for Storage.
const EMULATOR_BUCKET = "store-os-demo.appspot.com";

let storage: FirebaseStorage | null = null;
let emulatorConnected = false;

function getStorageInstance(): FirebaseStorage {
  const { app } = getFirebase();
  if (!storage) {
    const bucket = EMULATOR ? EMULATOR_BUCKET : undefined;
    storage = getStorage(app, bucket);
  }
  if (EMULATOR && !emulatorConnected) {
    const host = import.meta.env.VITE_FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199";
    const [hostname, port] = host.split(":");
    connectStorageEmulator(storage, hostname, Number(port));
    emulatorConnected = true;
  }
  return storage;
}

const MAX_EDGE = 1600; // longest edge after resize, in px (storefront detail)

/**
 * Downscale an image File to a JPEG Blob, longest edge ≤ MAX_EDGE.
 * Never upscales. DOM-only (canvas) — caller is the browser; verified by e2e.
 * Throws on a non-decodable file so the caller can show an inline error.
 */
export async function resizeImageFile(file: File): Promise<Blob> {
  const bitmap = await loadImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen.");
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.8)
  );
  if (!blob) throw new Error("No se pudo procesar la imagen.");
  return blob;
}

// createImageBitmap is the modern path; fall back to HTMLImageElement on Safari
// versions that lack it or reject HEIC etc. Either way a bad file throws.
async function loadImageBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // imageOrientation: 'from-image' honors the EXIF Orientation tag so a
      // portrait phone photo doesn't render sideways after the canvas re-encode.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("No se pudo leer esa imagen."));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Upload (overwriting) the product's photo; returns its public download URL. */
export async function uploadProductImage(
  storeId: string,
  productId: string,
  blob: Blob
): Promise<string> {
  const s = getStorageInstance();
  const r = ref(s, `products/${storeId}/${productId}.jpg`);
  await uploadBytes(r, blob, { contentType: "image/jpeg" });
  return getDownloadURL(r);
}

/** Delete a supplier-order PDF (purchases/{storeId}/...). Cloud-only. */
export async function deletePurchasePdf(storagePath: string): Promise<void> {
  const s = getStorageInstance();
  await deleteObject(ref(s, storagePath));
}

/**
 * Upload one gallery image to products/{storeId}/{productId}/{imgId}.jpg and
 * return its public URL + storage path. Accepts up to 10 MB at the edge (the
 * caller should resize first); stored optimized JPEG only.
 */
export async function uploadGalleryImage(
  storeId: string,
  productId: string,
  imgId: string,
  blob: Blob
): Promise<{ url: string; storagePath: string }> {
  const s = getStorageInstance();
  const storagePath = `products/${storeId}/${productId}/${imgId}.jpg`;
  const r = ref(s, storagePath);
  await uploadBytes(r, blob, { contentType: "image/jpeg" });
  const url = await getDownloadURL(r);
  return { url, storagePath };
}

/** Remove the product's photo object. Swallows not-found (already gone). */
export async function deleteProductImage(
  storeId: string,
  productId: string
): Promise<void> {
  const s = getStorageInstance();
  try {
    await deleteObject(ref(s, `products/${storeId}/${productId}.jpg`));
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (!code.includes("object-not-found")) throw err;
  }
}

/** Remove one gallery image by its storage path. Swallows not-found. */
export async function deleteGalleryImage(storagePath: string): Promise<void> {
  const s = getStorageInstance();
  try {
    await deleteObject(ref(s, storagePath));
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (!code.includes("object-not-found")) throw err;
  }
}
