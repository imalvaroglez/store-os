import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import { ref, uploadBytes, getBlob } from "firebase/storage";
import { getFirebase } from "./config";
import { getStorageInstance } from "./storage";

// PDF import transport (purchase-pdf-import): upload the supplier PDF to
// Storage, then call importPurchasePdf (OCR) and get the parsed lines back.
// Demo/local mode (no Firebase) is handled by the caller — this module is
// only used when cloud is available.

const EMULATOR =
  import.meta.env.MODE !== "production" &&
  import.meta.env.VITE_FIREBASE_EMULATOR === "true";

export type ParsedPdfLine = {
  name: string;
  quantity: number;
  sourceAmount: number; // the printed amount, semantics from sourceAmountType
  variant?: string;
  unitCost?: number; // only set when the parser could reconcile semantics
};

export type ParsedPdfOrder = {
  supplierOrder?: string;
  dateLabel?: string;
  currency: string;
  supplierCandidate?: string;
  lines: ParsedPdfLine[];
  subtotal?: number;
  discount?: number;
  shipping?: number;
  total?: number;
  sourceAmountType: "unit" | "line" | "unknown";
  needsReview: boolean;
};

let fns: Functions | null = null;
let fnsConnected = false;
function functionsInstance(): Functions {
  const { app } = getFirebase();
  if (!fns) fns = getFunctions(app, "us-east1"); // region, never a project id
  if (EMULATOR && !fnsConnected) {
    const host = import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
    const [hostname, port] = host.split(":");
    connectFunctionsEmulator(fns, hostname, Number(port));
    fnsConnected = true;
  }
  return fns;
}

/**
 * Upload the PDF privately. Returns ONLY the storage path — we never persist a
 * download URL (those carry a reusable token); viewing goes through
 * `openPurchasePdf`, which fetches the bytes under the user's session and
 * exposes a short-lived in-memory object URL.
 */
export async function uploadPurchasePdf(
  storeId: string,
  file: File
): Promise<{ storagePath: string }> {
  const storagePath = `purchases/${storeId}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
  const r = ref(getStorageInstance(), storagePath);
  await uploadBytes(r, file, { contentType: "application/pdf" });
  return { storagePath };
}

/** OCR + parse the uploaded PDF (server-side, tesseract spa). */
export async function importPurchasePdf(storagePath: string): Promise<ParsedPdfOrder> {
  const call = httpsCallable<{ storagePath: string }, ParsedPdfOrder>(functionsInstance(), "importPurchasePdf");
  const res = await call({ storagePath });
  return res.data;
}

/**
 * Open the stored PDF for viewing: downloads the bytes with the Storage SDK
 * under the signed-in user's session (rules-checked, no lasting URL) and opens
 * a temporary object URL that the caller should revoke after use.
 */
export async function openPurchasePdf(documentPath: string): Promise<string> {
  const blob = await getBlob(ref(getStorageInstance(), documentPath));
  return URL.createObjectURL(blob);
}
