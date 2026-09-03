import {
  getFunctions,
  httpsCallable,
  type Functions,
} from "firebase/functions";
import { getFirebase } from "./config";
import { loadPublicOrderClientId, savePublicOrderClientId } from "../../lib/storage";

export type PublicOrderRequestLine = {
  productId: string;
  productSlug: string;
  quantity: number;
};

export type SubmitPublicOrderRequestInput = {
  requestId: string;
  clientId: string;
  storeSlug: string;
  customerName: string;
  lines: PublicOrderRequestLine[];
};

export type SubmitPublicOrderRequestResult = {
  orderId: string;
  reference: string;
};

let functions: Functions | null = null;

function functionsInstance(): Functions {
  const { app } = getFirebase();
  if (!functions) functions = getFunctions(app, "us-east1");
  return functions;
}

/** Stable per-browser identifier used only as an input to the server hash. */
export function publicOrderClientId(): string {
  try {
    const current = loadPublicOrderClientId();
    if (current && UUID_RE.test(current)) return current;
    const next = randomUuid();
    savePublicOrderClientId(next);
    return next;
  } catch {
    return randomUuid();
  }
}

export function newPublicOrderRequestId(): string {
  return randomUuid();
}

export async function submitPublicOrderRequest(
  input: SubmitPublicOrderRequestInput
): Promise<SubmitPublicOrderRequestResult> {
  const call = httpsCallable<SubmitPublicOrderRequestInput, SubmitPublicOrderRequestResult>(
    functionsInstance(),
    "submitPublicOrderRequest"
  );
  return (await call(input)).data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function randomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
