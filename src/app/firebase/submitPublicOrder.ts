import { httpsCallable } from "firebase/functions";
import { getFirebase } from "./config";
import { functionsInstance } from "./pdfImport";

// Public-cart checkout transport: calls the submitPublicOrder callable
// (anonymous). Prices are resolved server-side; the client only sends
// slug + quantity. Errors are re-thrown with user-facing Spanish messages
// (HttpsError#message already carries them).

export type PublicOrderItemInput = { productSlug: string; quantity: number };

export type PublicOrderResult = {
  orderId: string;
  items: { productName: string; price: number; quantity: number }[];
};

export async function submitPublicOrder(
  storeSlug: string,
  name: string,
  phone: string,
  items: PublicOrderItemInput[]
): Promise<PublicOrderResult> {
  void getFirebase(); // ensure init
  const call = httpsCallable<
    { storeSlug: string; name: string; phone: string; items: PublicOrderItemInput[] },
    PublicOrderResult
  >(functionsInstance(), "submitPublicOrder");
  const res = await call({ storeSlug, name, phone, items });
  return res.data;
}
