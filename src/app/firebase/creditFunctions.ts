// #380: trusted saldo-a-favor operations. The Firestore rules deny EVERY
// client write to the credit fields (the Admin SDK bypasses rules via IAM),
// so all credit movements — compensation, cancellation/deletion restitution,
// incident confirmations — go through the applyCredit/releaseCredit
// callables. Each callable authenticates the caller, resolves membership and
// validates the REAL fresh balance inside its own transaction; this module
// is just the typed client plus the legacy error-message contract the app
// already relies on (StoreProvider swallows the "cambió mientras se aplicaba"
// family as expected concurrency).
import { httpsCallable } from "firebase/functions";
import { functionsInstance } from "./functions";

export interface ApplyCreditParams {
  storeId: string;
  fromOrderId: string;
  toOrderId: string;
  amountCents: number;
  intentId: string;
}

export interface ApplyCreditResult {
  applied: boolean;
  amountCents?: number;
}

export interface ReleaseCreditParams {
  storeId: string;
  orderId: string;
  intentId: string;
  /** Release AT MOST this much (an incident's own obligation). */
  capCents?: number;
  /** Tags the destination entries (incidents tag `rel_<eventId>_`). */
  idPrefix?: string;
}

export interface ReleaseCreditResult {
  released: number;
  alreadyReleased: number;
}

function asFunctionsError(error: unknown): { code?: string; message: string } | null {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") {
    const raw = (error as { message?: unknown }).message;
    return { code: (error as { code: string }).code, message: typeof raw === "string" ? raw : String(raw) };
  }
  return null;
}

/**
 * Transport + legacy contract for applyCustomerCreditTx: the callable's
 * fresh-balance rejections (its messages name the real figures) are mapped to
 * the historical "cambió mientras se aplicaba" wording, because callers treat
 * that family as EXPECTED concurrency — the listener round-trip replans and
 * the sync-error banner stays quiet. Every other rejection keeps its Spanish
 * text and surfaces.
 */
export function mapApplyCreditError(error: unknown): unknown {
  const https = asFunctionsError(error);
  if (https?.code === "functions/failed-precondition") {
    if (/no cubre los /.test(https.message)) {
      return new Error("El saldo a favor cambió mientras se aplicaba. Se reintentará con las cifras nuevas.");
    }
    if (/no cabe más crédito/.test(https.message)) {
      return new Error("El saldo del pedido cambió mientras se aplicaba. Se reintentará con las cifras nuevas.");
    }
  }
  return error;
}

export async function applyCreditTrusted(params: ApplyCreditParams): Promise<ApplyCreditResult> {
  const call = httpsCallable<ApplyCreditParams, ApplyCreditResult>(functionsInstance(), "applyCredit");
  try {
    const res = await call(params);
    return res.data;
  } catch (error) {
    throw mapApplyCreditError(error);
  }
}

export async function releaseCreditTrusted(params: ReleaseCreditParams): Promise<ReleaseCreditResult> {
  const call = httpsCallable<ReleaseCreditParams, ReleaseCreditResult>(functionsInstance(), "releaseCredit");
  const res = await call(params);
  return res.data;
}
