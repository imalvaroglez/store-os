// #524 — "Usar como surtido inicial" end-to-end against the REAL rules +
// auth + functions emulators. The rules deny every client write to the
// point evidence, so this suite drives the trusted convertOrderToFirstSurtido
// callable exactly as production would: a real Auth-emulator member of the
// seeded store signs in, the callable authenticates that identity, and the
// conversion (order link + entries + operation evidence) lands atomically.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { connectFirestoreEmulator, doc, getDoc, initializeFirestore, setDoc } from "firebase/firestore";
import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { readFileSync } from "node:fs";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({
  getFirebase: () => ({ db: holder.db }),
  isFirebaseConfigured: () => true,
  FIREBASE_EMULATOR_ENABLED: true,
}));

let env: RulesTestEnvironment;

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

const NOW = "2026-11-21T12:00:00.000Z";

const orderDoc = (id: string, extra: Record<string, unknown> = {}) => ({
  storeId: "pt-store",
  customerId: "pt-clienta",
  items: [
    { productName: "Perfume Chanel Chance 100 ml", productId: "p1", quantity: 2, unitPrice: 950, subtotal: 1900, cost: 400, lineId: `${id}_L0` },
    { productName: "Cartera de piel", productId: "p2", variantId: "v-cafe", variantColor: "Café", quantity: 3, unitPrice: 680, subtotal: 2040, cost: 300, lineId: `${id}_L1` },
  ],
  deposit: 0,
  orderStatus: "confirmed",
  paymentStatus: "unpaid",
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#524 conversión «Usar como surtido inicial» (callable)", () => {
  let operator: { app: FirebaseApp; uid: string };
  let outsider: { app: FirebaseApp; uid: string };

  async function convert(app: FirebaseApp, data: Record<string, unknown>) {
    const fns = getFunctions(app, "us-east1");
    const [fnHost, fnPort] = (process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001").split(":");
    connectFunctionsEmulator(fns, fnHost, Number(fnPort));
    return httpsCallable(fns, "convertOrderToFirstSurtido")(data);
  }

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    operator = await emulatedClientApp(`pt-op-${Date.now()}`);
    outsider = await emulatedClientApp(`pt-out-${Date.now()}`);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "users/tx-user"), { role: "member" });
      await setDoc(doc(fs, "adminStores/pt-store"), { ownerUid: "tx-user", memberUids: ["tx-user", operator.uid] });
      await setDoc(doc(fs, "products/p1"), {
        storeId: "pt-store", name: "Perfume Chanel Chance 100 ml", category: "perfume",
        quantityOnHand: 4, cost: 400, isPublic: true, createdAt: NOW, updatedAt: NOW,
      });
      await setDoc(doc(fs, "products/p2"), {
        storeId: "pt-store", name: "Cartera de piel", category: "other",
        variants: [{ id: "v-cafe", color: "Café", quantityOnHand: 3, createdAt: NOW, updatedAt: NOW }],
        isPublic: true, createdAt: NOW, updatedAt: NOW,
      });
      await setDoc(doc(fs, "points/pt-store__mostrador"), {
        id: "pt-store__mostrador", storeId: "pt-store", name: "Mostrador centro", active: true,
        createdAt: NOW, updatedAt: NOW,
      });
      await setDoc(doc(fs, "orders/order-ok"), orderDoc("order-ok"));
      await setDoc(doc(fs, "orders/order-paid"), orderDoc("order-paid", { paymentsReceivedCents: 5000 }));
      await setDoc(doc(fs, "orders/order-clean2"), orderDoc("order-clean2"));
      await setDoc(doc(fs, "orders/order-noline"), orderDoc("order-noline", {
        items: [{ productName: "Regalo suelto", quantity: 1, unitPrice: 100, subtotal: 100 }],
      }));
    });
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("convierte un pedido confirmado: entradas exactas, vínculo y evidencia; el almacén no vuelve a descontar", async () => {
    const res = await convert(operator.app, {
      storeId: "pt-store", pointId: "pt-store__mostrador", orderId: "order-ok",
      physicalDate: "2026-11-21", intentId: "int-1",
    });
    expect(res.data).toMatchObject({ converted: true, entryCount: 2, units: 5 });

    const order = (await getDoc(doc(holder.db, "orders/order-ok"))).data()!;
    expect(order.convertedToPointId).toBe("pt-store__mostrador");
    expect(typeof order.revision === "number").toBe(true);

    const perfume = (await getDoc(doc(holder.db, "pointEntries/pe_int-1_0"))).data()!;
    expect(perfume).toMatchObject({
      storeId: "pt-store", pointId: "pt-store__mostrador", productId: "p1",
      entryDate: "2026-11-21", quantity: 2, consumedQty: 0, markedPriceCents: 95000,
      unitCostCents: 40000, originOrderId: "order-ok",
    });
    const cartera = (await getDoc(doc(holder.db, "pointEntries/pe_int-1_1"))).data()!;
    expect(cartera).toMatchObject({ productId: "p2", variantId: "v-cafe", quantity: 3, markedPriceCents: 68000, unitCostCents: 30000 });

    const op = (await getDoc(doc(holder.db, "pointOperations/conv_int-1"))).data()!;
    expect(op).toMatchObject({ kind: "first_surtido", orderId: "order-ok", physicalDate: "2026-11-21", entryCount: 2, units: 5 });
    expect(op.confirmedBy).toBe(operator.uid);

    // El almacén no vuelve a descontar: los documentos de producto no cambian.
    const p1 = (await getDoc(doc(holder.db, "products/p1"))).data()!;
    expect(p1.quantityOnHand).toBe(4);
    const p2 = (await getDoc(doc(holder.db, "products/p2"))).data()!;
    expect(p2.variants[0].quantityOnHand).toBe(3);
  });

  it("reintentar el MISMO intento no duplica nada y reporta ya convertido", async () => {
    const res = await convert(operator.app, {
      storeId: "pt-store", pointId: "pt-store__mostrador", orderId: "order-ok",
      physicalDate: "2026-11-21", intentId: "int-1",
    });
    expect(res.data).toMatchObject({ converted: false, alreadyConverted: true });
    const order = (await getDoc(doc(holder.db, "orders/order-ok"))).data()!;
    expect(order.convertedToPointId).toBe("pt-store__mostrador");
    // Mismas entradas, sin duplicados.
    expect((await getDoc(doc(holder.db, "pointEntries/pe_int-1_0"))).exists()).toBe(true);
  });

  it("un intento DISTINTO sobre el pedido ya convertido se rechaza", async () => {
    await expect(convert(operator.app, {
      storeId: "pt-store", pointId: "pt-store__mostrador", orderId: "order-ok",
      physicalDate: "2026-11-21", intentId: "int-2",
    })).rejects.toThrow(/una vez/i);
  });

  it("un pedido con cobros no se convierte y no queda rastro", async () => {
    await expect(convert(operator.app, {
      storeId: "pt-store", pointId: "pt-store__mostrador", orderId: "order-paid",
      physicalDate: "2026-11-21", intentId: "int-3",
    })).rejects.toThrow(/cobro/i);
    const order = (await getDoc(doc(holder.db, "orders/order-paid"))).data()!;
    expect(order.convertedToPointId).toBeUndefined();
    expect((await getDoc(doc(holder.db, "pointOperations/conv_int-3"))).exists()).toBe(false);
  });

  it("una línea sin producto identificable detiene la conversión", async () => {
    await expect(convert(operator.app, {
      storeId: "pt-store", pointId: "pt-store__mostrador", orderId: "order-noline",
      physicalDate: "2026-11-21", intentId: "int-4",
    })).rejects.toThrow(/producto/i);
  });

  it("una operadora ajena a la tienda no puede convertir", async () => {
    await expect(convert(outsider.app, {
      storeId: "pt-store", pointId: "pt-store__mostrador", orderId: "order-ok",
      physicalDate: "2026-11-21", intentId: "int-5",
    })).rejects.toThrow();
  });

  it("#524 guarda (dictamen de código): un punto con entradas rechaza la conversión con mensaje de operadora", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "points/pt-store__ocupado"), {
        id: "pt-store__ocupado", storeId: "pt-store", name: "Mostrador ocupado", active: true,
        createdAt: NOW, updatedAt: NOW,
      });
      await setDoc(doc(ctx.firestore(), "pointEntries/pe-previa"), {
        id: "pe-previa", storeId: "pt-store", pointId: "pt-store__ocupado", productId: "p1",
        productName: "Perfume", entryDate: "2026-11-20", quantity: 1, consumedQty: 0, markedPriceCents: 95000,
        createdAt: NOW, updatedAt: NOW,
      });
    });
    await expect(convert(operator.app, {
      storeId: "pt-store", pointId: "pt-store__ocupado", orderId: "order-clean2",
      physicalDate: "2026-11-21", intentId: "guard-1",
    })).rejects.toThrow(/vac[ií]o|mercanc[ií]a/i);
  });
});
