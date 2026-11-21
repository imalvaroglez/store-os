// #524 — manual stock movements end-to-end against the REAL rules + auth +
// functions emulators: Surtir moves available warehouse pieces to the point
// (with the operator-confirmed label price and known cost as evidence);
// Retirar returns sellable pieces to their exact variant (FIFO over entries).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { connectFirestoreEmulator, doc, getDoc, setDoc } from "firebase/firestore";
import { initializeFirestore } from "firebase/firestore";
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

const NOW = "2026-11-22T12:00:00.000Z";
const PT = "pt-store__mostrador";

async function callStock(app: FirebaseApp, name: string, data: Record<string, unknown>) {
  const fns = getFunctions(app, "us-east1");
  const [fnHost, fnPort] = (process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001").split(":");
  connectFunctionsEmulator(fns, fnHost, Number(fnPort));
  return httpsCallable(fns, name)(data);
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#524 surtir del almacén y retirar (callables)", () => {
  let operator: { app: FirebaseApp; uid: string };
  let outsider: { app: FirebaseApp; uid: string };

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    operator = await emulatedClientApp(`stk-op-${Date.now()}`);
    outsider = await emulatedClientApp(`stk-out-${Date.now()}`);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "users/tx-user"), { role: "member" });
      await setDoc(doc(fs, "adminStores/pt-store"), { ownerUid: "tx-user", memberUids: ["tx-user", operator.uid] });
      await setDoc(doc(fs, "points/" + PT), {
        id: PT, storeId: "pt-store", name: "Mostrador centro", active: true,
        priceTierId: "t_retail", commissionRate: 0.2, createdAt: NOW, updatedAt: NOW,
      });
      await setDoc(doc(fs, "products/p1"), {
        storeId: "pt-store", name: "Perfume", sku: "P1", category: "perfume", isPublic: true,
        cost: 400, prices: { t_retail: 950 }, quantityOnHand: 6, createdAt: NOW, updatedAt: NOW,
      });
      await setDoc(doc(fs, "products/p2"), {
        storeId: "pt-store", name: "Cartera", sku: "P2", category: "other", isPublic: true,
        variants: [{ id: "v-cafe", color: "Café", quantityOnHand: 4, cost: 300, createdAt: NOW, updatedAt: NOW }],
        createdAt: NOW, updatedAt: NOW,
      });
      // Existing point stock for the retiro tests: 3 perfumes at $950.
      await setDoc(doc(fs, "pointEntries/pe-prev"), {
        id: "pe-prev", storeId: "pt-store", pointId: PT, productId: "p1", productName: "Perfume",
        entryDate: "2026-11-01", quantity: 3, consumedQty: 0, markedPriceCents: 95000,
        unitCostCents: 40000, createdAt: NOW, updatedAt: NOW,
      });
    });
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("surtir descuenta el almacén y crea entradas con el precio confirmado y el costo conocido", async () => {
    const res = await callStock(operator.app, "stockPointFromWarehouse", {
      storeId: "pt-store", pointId: PT, intentId: "sur-1", physicalDate: "2026-11-22",
      lines: [
        { productId: "p1", qty: 2, markedPriceCents: 95000, unitCostCents: 40000 },
        { productId: "p2", variantId: "v-cafe", qty: 1, markedPriceCents: 68000 },
      ],
    });
    expect(res.data).toMatchObject({ stocked: true, entryCount: 2, units: 3 });
    const perfume = (await getDoc(doc(holder.db, "products/p1"))).data()!;
    expect(perfume.quantityOnHand).toBe(4); // 6 − 2
    const cartera = (await getDoc(doc(holder.db, "products/p2"))).data()!;
    expect(cartera.variants[0].quantityOnHand).toBe(3); // 4 − 1
    const e1 = (await getDoc(doc(holder.db, "pointEntries/pe_sur-1_0"))).data()!;
    expect(e1).toMatchObject({
      storeId: "pt-store", pointId: PT, productId: "p1", productName: "Perfume",
      entryDate: "2026-11-22", quantity: 2, consumedQty: 0, markedPriceCents: 95000,
      unitCostCents: 40000, originOperationId: "surt_sur-1",
    });
    const e2 = (await getDoc(doc(holder.db, "pointEntries/pe_sur-1_1"))).data()!;
    expect(e2).toMatchObject({ productId: "p2", variantId: "v-cafe", variantColor: "Café", quantity: 1, markedPriceCents: 68000 });
    expect(e2.unitCostCents).toBe(30000); // costo del color como evidencia
    const op = (await getDoc(doc(holder.db, "pointOperations/surt_sur-1"))).data()!;
    expect(op).toMatchObject({ kind: "surtido", units: 3, physicalDate: "2026-11-22" });
  });

  it("reintentar el MISMO intento no duplica nada", async () => {
    const res = await callStock(operator.app, "stockPointFromWarehouse", {
      storeId: "pt-store", pointId: PT, intentId: "sur-1", physicalDate: "2026-11-22",
      lines: [{ productId: "p1", qty: 2, markedPriceCents: 95000, unitCostCents: 40000 }],
    });
    expect(res.data).toMatchObject({ stocked: false, alreadyStocked: true, units: 3 });
    const perfume = (await getDoc(doc(holder.db, "products/p1"))).data()!;
    expect(perfume.quantityOnHand).toBe(4);
  });

  it("surtir más de lo disponible en almacén se rechaza y no mueve nada", async () => {
    await expect(callStock(operator.app, "stockPointFromWarehouse", {
      storeId: "pt-store", pointId: PT, intentId: "sur-2", physicalDate: "2026-11-22",
      lines: [{ productId: "p1", qty: 99, markedPriceCents: 95000 }],
    })).rejects.toThrow(/almac[eé]n/i);
    const perfume = (await getDoc(doc(holder.db, "products/p1"))).data()!;
    expect(perfume.quantityOnHand).toBe(4);
    expect((await getDoc(doc(holder.db, "pointOperations/surt_sur-2"))).exists()).toBe(false);
  });

  it("retirar devuelve piezas a su variante exacta y consume las entradas FIFO", async () => {
    const res = await callStock(operator.app, "withdrawFromPoint", {
      storeId: "pt-store", pointId: PT, intentId: "ret-1",
      lines: [{ productId: "p1", qty: 2 }],
    });
    expect(res.data).toMatchObject({ withdrawn: true, units: 2 });
    // La entrada previa (más antigua) se consume primero.
    const prev = (await getDoc(doc(holder.db, "pointEntries/pe-prev"))).data()!;
    expect(prev.consumedQty).toBe(2);
    const surtida = (await getDoc(doc(holder.db, "pointEntries/pe_sur-1_0"))).data()!;
    expect(surtida.consumedQty).toBe(0);
    const perfume = (await getDoc(doc(holder.db, "products/p1"))).data()!;
    expect(perfume.quantityOnHand).toBe(6); // 4 + 2 devueltas
    const op = (await getDoc(doc(holder.db, "pointOperations/reti_ret-1"))).data()!;
    expect(op).toMatchObject({ kind: "retiro", units: 2 });
    expect(op.entryAllocations).toEqual([{ entryId: "pe-prev", quantity: 2 }]);
  });

  it("retirar más de lo que hay en el punto se rechaza sin cambios", async () => {
    await expect(callStock(operator.app, "withdrawFromPoint", {
      storeId: "pt-store", pointId: PT, intentId: "ret-2",
      lines: [{ productId: "p2", variantId: "v-cafe", qty: 5 }],
    })).rejects.toThrow(/retirar/i);
    const cartera = (await getDoc(doc(holder.db, "products/p2"))).data()!;
    expect(cartera.variants[0].quantityOnHand).toBe(3);
  });

  it("una operadora ajena a la tienda no puede mover mercancía", async () => {
    await expect(callStock(outsider.app, "stockPointFromWarehouse", {
      storeId: "pt-store", pointId: PT, intentId: "sur-x", physicalDate: "2026-11-22",
      lines: [{ productId: "p1", qty: 1, markedPriceCents: 95000 }],
    })).rejects.toThrow();
    await expect(callStock(outsider.app, "withdrawFromPoint", {
      storeId: "pt-store", pointId: PT, intentId: "ret-x",
      lines: [{ productId: "p1", qty: 1 }],
    })).rejects.toThrow();
  });
});
