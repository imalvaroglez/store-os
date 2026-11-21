// #524: trusted point-of-sale operations. The Firestore rules deny EVERY
// client write to pointEntries/pointOperations (the Admin SDK bypasses rules
// via IAM), so the first-surtido conversion goes through the
// convertOrderToFirstSurtido callable. The callable authenticates the
// caller, resolves membership and re-validates the order inside its own
// transaction; this module is the typed client (creditFunctions idiom).
import { httpsCallable } from "firebase/functions";
import { functionsInstance } from "./functions";

export interface ConvertOrderParams {
  storeId: string;
  pointId: string;
  orderId: string;
  /** Physical delivery date (YYYY-MM-DD) the pieces entered the point. */
  physicalDate: string;
  intentId: string;
}

export interface ConvertOrderResult {
  converted: boolean;
  alreadyConverted?: boolean;
  entryCount?: number;
  units?: number;
  pointId?: string;
}

export async function convertOrderTrusted(params: ConvertOrderParams): Promise<ConvertOrderResult> {
  const call = httpsCallable<ConvertOrderParams, ConvertOrderResult>(functionsInstance(), "convertOrderToFirstSurtido");
  const res = await call(params);
  return res.data;
}
