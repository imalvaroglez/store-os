// #584 end-to-end against the REAL rules + auth emulators: an edit that
// strands delivery evidence (removes the delivered line or drops below the
// delivered count) is rejected by the transaction WITHOUT partial effects —
// items, delivery ledger, revision and stock all stay exactly as they were.
// The way out (raise the quantity, edit other lines) keeps working.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, initializeFirestore, setDoc } from "firebase/firestore";
import { initializeApp, type FirebaseApp } from "firebase/app";
import { readFileSync } from "node:fs";
import type { Order } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any, app: null as any }));
vi.mock("./config", () => ({
  getFirebase: () => ({ app: holder.app, db: holder.db }),
  isFirebaseConfigured: () => true,
  FIREBASE_EMULATOR_ENABLED: true,
}));
import { saveOrderWithStockTx } from "./firestoreData";
import { DeliveryEvidenceError } from "../../lib/deliveries";

let env: RulesTestEnvironment;

const STORE = "dev584-store";
const ORDER = "dev584-order";

const asOrder = (items: unknown[], extra: Record<string, unknown> = {}): Order =>
  ({ id: ORDER, storeId: STORE, customerId: "dev584-clienta", items: items as Order["items"], deposit: 0,
     orderStatus: "confirmed", paymentStatus: "unpaid",
     createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-26T12:00:00.000Z", ...extra } as unknown as Order);

/** A client app connected to the auth/firestore emulators with a freshly
 * created signed-in user (same recipe as the #560 suite). */
async function emulatedClientApp(name: string): Promise<{ app: FirebaseApp; uid: string }> {
  const app = initializeApp(
    { projectId: "store-os-dev", apiKey: "demo-api-key", authDomain: "store-os-dev.firebaseapp.com" },
    name
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`, { disableWarnings: true });
  const created = await createUserWithEmailAndPassword(auth, `${name}-${Date.now()}@example.test`, "password123");
  const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
  connectFirestoreEmulator(db, fsHost, Number(fsPort));
  return { app, uid: created.user.uid };
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("evidencia de entrega en la transacción (#584)", () => {
  let operator: { app: FirebaseApp; uid: string };

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    operator = await emulatedClientApp(`dev584-op-${Date.now()}`);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/dev584-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), `adminStores/${STORE}`), { ownerUid: "dev584-user", memberUids: ["dev584-user", operator.uid] });
      await setDoc(doc(ctx.firestore(), "products/dev584-p1"), {
        storeId: STORE, name: "Anillo", sku: "QA-584-A", category: "jewelry",
        quantityOnHand: 10, price: 100, cost: 40, status: "draft", createdAt: "", updatedAt: "",
      });
      await setDoc(doc(ctx.firestore(), "products/dev584-p2"), {
        storeId: STORE, name: "Guante", sku: "QA-584-B", category: "jewelry",
        quantityOnHand: 5, price: 80, cost: 30, status: "draft", createdAt: "", updatedAt: "",
      });
      // Pedido confirmado con entrega parcial firmada: 2 de 5 anillos.
      await setDoc(doc(ctx.firestore(), `orders/${ORDER}`), {
        id: ORDER, storeId: STORE, customerId: "dev584-clienta",
        items: [
          { lineId: "L1", productId: "dev584-p1", productName: "Anillo", quantity: 5, unitPrice: 100, subtotal: 500 },
          { lineId: "L2", productId: "dev584-p2", productName: "Guante", quantity: 1, unitPrice: 80, subtotal: 80 },
        ],
        deliveries: [
          { id: "dev1", orderId: ORDER, storeId: STORE, deliveredAt: "2026-11-26",
            recordedAt: "2026-11-26T20:00:00.000Z", by: "dev584-user", lines: [{ productId: "dev584-p1", quantity: 2 }] },
        ],
        deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid", revision: 1,
        createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-26T12:00:00.000Z",
      });
    });
    holder.app = operator.app;
    holder.db = env.authenticatedContext("dev584-user").firestore();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  const savedDoc = () => getDoc(doc(holder.db, `orders/${ORDER}`)).then((s) => s.data()!);

  it("quitar la línea entregada se rechaza SIN efectos parciales", async () => {
    const before = await savedDoc();
    await expect(
      saveOrderWithStockTx(
        { uid: "dev584-user" } as never,
        asOrder([{ lineId: "L2", productId: "dev584-p2", productName: "Guante", quantity: 1, unitPrice: 80, subtotal: 80 }]),
        before.revision,
        "mut-584-remove"
      )
    ).rejects.toThrow(DeliveryEvidenceError);
    const after = await savedDoc();
    expect(after.items.length).toBe(2);
    expect(after.deliveries.length).toBe(1);
    expect(after.deliveries[0].lines[0].quantity).toBe(2);
    expect(after.revision).toBe(before.revision);
    // El almacén no se tocó: nada se liberó ni devolvió.
    const p1 = (await getDoc(doc(holder.db, "products/dev584-p1"))).data()!;
    expect(p1.quantityOnHand).toBe(10);
  });

  it("reducir por debajo de lo entregado se rechaza igual", async () => {
    const before = await savedDoc();
    await expect(
      saveOrderWithStockTx(
        { uid: "dev584-user" } as never,
        asOrder([
          { lineId: "L1", productId: "dev584-p1", productName: "Anillo", quantity: 1, unitPrice: 100, subtotal: 100 },
          { lineId: "L2", productId: "dev584-p2", productName: "Guante", quantity: 1, unitPrice: 80, subtotal: 80 },
        ]),
        before.revision,
        "mut-584-reduce"
      )
    ).rejects.toThrow(DeliveryEvidenceError);
    const after = await savedDoc();
    expect(after.revision).toBe(before.revision);
    expect(after.deliveries.length).toBe(1);
  });

  it("subir la cantidad de la línea entregada guarda y conserva la evidencia", async () => {
    const before = await savedDoc();
    const saved = await saveOrderWithStockTx(
      { uid: "dev584-user" } as never,
      asOrder([
        { lineId: "L1", productId: "dev584-p1", productName: "Anillo", quantity: 6, unitPrice: 100, subtotal: 600 },
        { lineId: "L2", productId: "dev584-p2", productName: "Guante", quantity: 1, unitPrice: 80, subtotal: 80 },
      ]),
      before.revision,
      "mut-584-raise"
    );
    expect(saved.order.items[0].quantity).toBe(6);
    const after = await savedDoc();
    expect(after.deliveries.length).toBe(1);
    expect(after.revision).toBe((before.revision ?? 0) + 1);
  });
});
