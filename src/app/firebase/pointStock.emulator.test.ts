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


  // --- Dictamen QA #524 (22-nov) — Crítico 1: multi-line moves of the SAME
  // design must accumulate; each line rebuilt the variants array from the
  // ORIGINAL snapshot, so the second write erased the first (silent drift).
  it("surtir dos colores del mismo diseño en UN diálogo descuenta AMBAS variantes (repro QA)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "products/p3"), {
        storeId: "pt-store", name: "Cinturón", sku: "P3", category: "other", isPublic: true,
        variants: [
          { id: "v-cafe", color: "Café", quantityOnHand: 4, cost: 300, createdAt: NOW, updatedAt: NOW },
          { id: "v-negra", color: "Negra", quantityOnHand: 5, cost: 300, createdAt: NOW, updatedAt: NOW },
        ],
        createdAt: NOW, updatedAt: NOW,
      });
    });
    const res = await callStock(operator.app, "stockPointFromWarehouse", {
      storeId: "pt-store", pointId: PT, intentId: "sur-multi", physicalDate: "2026-11-22",
      lines: [
        { productId: "p3", variantId: "v-cafe", qty: 3, markedPriceCents: 68000 },
        { productId: "p3", variantId: "v-negra", qty: 2, markedPriceCents: 68000 },
      ],
    });
    expect(res.data).toMatchObject({ stocked: true, entryCount: 2, units: 5 });
    const p3 = (await getDoc(doc(holder.db, "products/p3"))).data()!;
    expect(p3.variants.find((v: { id: string; quantityOnHand?: number }) => v.id === "v-cafe").quantityOnHand).toBe(1); // 4 − 3
    expect(p3.variants.find((v: { id: string; quantityOnHand?: number }) => v.id === "v-negra").quantityOnHand).toBe(3); // 5 − 2
  });

  it("líneas duplicadas de la MISMA variante acumulan el guard: rechazo sin existencias negativas ni deriva", async () => {
    // v-cafe only has 1 left after the previous test: 1 + 1 must NOT fit.
    await expect(callStock(operator.app, "stockPointFromWarehouse", {
      storeId: "pt-store", pointId: PT, intentId: "sur-dup", physicalDate: "2026-11-22",
      lines: [
        { productId: "p3", variantId: "v-cafe", qty: 1, markedPriceCents: 68000 },
        { productId: "p3", variantId: "v-cafe", qty: 1, markedPriceCents: 68000 },
      ],
    })).rejects.toThrow(/almac[eé]n/i);
    const p3 = (await getDoc(doc(holder.db, "products/p3"))).data()!;
    expect(p3.variants.find((v: { id: string; quantityOnHand?: number }) => v.id === "v-cafe").quantityOnHand).toBe(1); // intact
    expect((await getDoc(doc(holder.db, "pointOperations/surt_sur-dup"))).exists()).toBe(false);
  });

  it("producto simple: líneas duplicadas acumulan el guard del estante (sin negativos vía increment)", async () => {
    // p1 is back at 6 here (the earlier retiro returned its 2 pieces): each
    // line fits alone (4 ≤ 6, 3 ≤ 6) but 4 + 3 must NOT.
    await expect(callStock(operator.app, "stockPointFromWarehouse", {
      storeId: "pt-store", pointId: PT, intentId: "sur-dup-plain", physicalDate: "2026-11-22",
      lines: [
        { productId: "p1", qty: 4, markedPriceCents: 95000 },
        { productId: "p1", qty: 3, markedPriceCents: 95000 },
      ],
    })).rejects.toThrow(/almac[eé]n/i);
    const perfume = (await getDoc(doc(holder.db, "products/p1"))).data()!;
    expect(perfume.quantityOnHand).toBe(6); // intact — no negative drift
  });

  it("retirar dos colores del mismo diseño en UN diálogo devuelve AMBAS variante exactas", async () => {
    const res = await callStock(operator.app, "withdrawFromPoint", {
      storeId: "pt-store", pointId: PT, intentId: "wd-multi", physicalDate: "2026-11-22",
      lines: [
        { productId: "p3", variantId: "v-cafe", qty: 1 },
        { productId: "p3", variantId: "v-negra", qty: 1 },
      ],
    });
    expect(res.data).toMatchObject({ withdrawn: true, units: 2 });
    const p3 = (await getDoc(doc(holder.db, "products/p3"))).data()!;
    expect(p3.variants.find((v: { id: string; quantityOnHand?: number }) => v.id === "v-cafe").quantityOnHand).toBe(2); // 1 + 1
    expect(p3.variants.find((v: { id: string }) => v.id === "v-negra").quantityOnHand).toBe(4); // 3 + 1
  });

  // --- Dictamen QA r2 (22-nov) — Mayor: withdrawing entries of a variant
  // whose design NO LONGER sells per color must FAIL CLOSED (the accumulator
  // regression restored increment(0) and the pieces vanished silently).
  it("retirar piezas de un diseño convertido a simple se rechaza: nada cambia (repro QA r2)", async () => {
    await callStock(operator.app, "stockPointFromWarehouse", {
      storeId: "pt-store", pointId: PT, intentId: "sur-conv", physicalDate: "2026-11-22",
      lines: [{ productId: "p2", variantId: "v-cafe", qty: 3, markedPriceCents: 68000 }],
    });
    // Fer disables «Se vende por color» in Productos — the design goes simple.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/p2"), {
        storeId: "pt-store", name: "Cartera", sku: "P2", category: "other", isPublic: true,
        cost: 300, prices: { t_retail: 680 }, quantityOnHand: 2,
        createdAt: NOW, updatedAt: NOW,
      });
    });
    await expect(callStock(operator.app, "withdrawFromPoint", {
      storeId: "pt-store", pointId: PT, intentId: "wd-conv", physicalDate: "2026-11-22",
      lines: [{ productId: "p2", variantId: "v-cafe", qty: 3 }],
    })).rejects.toThrow(/dej[oó] de venderse por color|variante/i);
    // NOTHING changed: the shelf stays as the conversion left it, the point
    // entry is intact and no operation was registered.
    const product = (await getDoc(doc(holder.db, "products/p2"))).data()!;
    expect(product.quantityOnHand).toBe(2);
    expect(product.variants).toBeUndefined();
    const entry = (await getDoc(doc(holder.db, "pointEntries/pe_sur-conv_0"))).data()!;
    expect(entry.consumedQty).toBe(0);
    expect((await getDoc(doc(holder.db, "pointOperations/wd_wd-conv"))).exists()).toBe(false);
  });

  it("retiro con una línea válida y otra incompatible: TODA la operación se rechaza sin cambios parciales", async () => {
    // p1 (plain) has a valid pending entry; p2's variant entry is now
    // incompatible after the conversion above.
    // Snapshot BEFORE: whatever earlier tests left on the valid dimension.
    const beforeEntry = (await getDoc(doc(holder.db, "pointEntries/pe-prev"))).data()!;
    const beforeShelf = (await getDoc(doc(holder.db, "products/p1"))).data()!;
    await expect(callStock(operator.app, "withdrawFromPoint", {
      storeId: "pt-store", pointId: PT, intentId: "wd-mixed", physicalDate: "2026-11-22",
      lines: [
        { productId: "p1", qty: 1 }, // válida: consume de pe-prev
        { productId: "p2", variantId: "v-cafe", qty: 1 }, // incompatible
      ],
    })).rejects.toThrow(/dej[oó] de venderse por color|variante/i);
    // The VALID line was not applied either: entry, shelf and op unchanged.
    const prev = (await getDoc(doc(holder.db, "pointEntries/pe-prev"))).data()!;
    expect(prev.consumedQty).toBe(beforeEntry.consumedQty);
    const perfume = (await getDoc(doc(holder.db, "products/p1"))).data()!;
    expect(perfume.quantityOnHand).toBe(beforeShelf.quantityOnHand);
    expect((await getDoc(doc(holder.db, "pointOperations/wd_wd-mixed"))).exists()).toBe(false);
  });

  // M2 (dictamen r2): two withdrawal lines of the SAME variant accumulate.
  it("M2: retirar dos líneas de la MISMA variante devuelve el total a su estante exacto", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "products/p4"), {
        storeId: "pt-store", name: "Bufanda", sku: "P4", category: "other", isPublic: true,
        variants: [{ id: "v-roja", color: "Roja", quantityOnHand: 0, cost: 150, createdAt: NOW, updatedAt: NOW }],
        createdAt: NOW, updatedAt: NOW,
      });
      await setDoc(doc(fs, "pointEntries/pe-m2"), {
        id: "pe-m2", storeId: "pt-store", pointId: PT, productId: "p4", productName: "Bufanda",
        variantId: "v-roja", variantColor: "Roja",
        entryDate: "2026-11-22", quantity: 5, consumedQty: 0, markedPriceCents: 40000,
        unitCostCents: 15000, createdAt: NOW, updatedAt: NOW,
      });
    });
    const res = await callStock(operator.app, "withdrawFromPoint", {
      storeId: "pt-store", pointId: PT, intentId: "wd-samevar", physicalDate: "2026-11-22",
      lines: [
        { productId: "p4", variantId: "v-roja", qty: 2 },
        { productId: "p4", variantId: "v-roja", qty: 3 },
      ],
    });
    expect(res.data).toMatchObject({ withdrawn: true, units: 5 });
    const p4 = (await getDoc(doc(holder.db, "products/p4"))).data()!;
    expect(p4.variants.find((v: { id: string }) => v.id === "v-roja").quantityOnHand).toBe(5);
    const entry = (await getDoc(doc(holder.db, "pointEntries/pe-m2"))).data()!;
    expect(entry.consumedQty).toBe(5);
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
