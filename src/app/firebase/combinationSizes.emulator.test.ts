import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { saveOrderWithStockTx } from "./firestoreData";

let env: RulesTestEnvironment;

// #461 corte 3: an order line carrying variantSizeId moves EXACTLY its
// color×size shelf inside the transaction — create, edit and delete.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("combination sizes reserve their exact shelf (#461)", () => {
  const sizeLine = (quantity: number) => ({
    lineId: "l-s6",
    productId: "p-461",
    productName: "Anillo Sol",
    quantity,
    unitPrice: 300,
    subtotal: 300 * quantity,
    variantId: "v_gold",
    variantColor: "Dorado",
    variantSizeId: "s6",
    variantSize: "6",
  });
  const asOrder = (quantity: number): Order =>
    ({
      id: "ord-461aaa",
      storeId: "inv461-store",
      customerId: "ana",
      items: [sizeLine(quantity)] as Order["items"],
      deposit: 0,
      orderStatus: "confirmed",
      paymentStatus: "unpaid",
      installmentsReservedAt: "2026-11-22T00:00:00.000Z",
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
    }) as unknown as Order;

  async function readSizes(): Promise<{ s6: number | undefined; s5: number | undefined; colorLevel: number | undefined }> {
    const snap = await getDoc(doc(holder.db, "products", "p-461"));
    const variants = snap.data()?.variants as Array<{ id: string; quantityOnHand?: number; sizes?: Array<{ id: string; quantityOnHand?: number }> }>;
    const gold = variants.find((v) => v.id === "v_gold")!;
    return {
      s6: gold.sizes?.find((s) => s.id === "s6")?.quantityOnHand,
      s5: gold.sizes?.find((s) => s.id === "s5")?.quantityOnHand,
      colorLevel: gold.quantityOnHand,
    };
  }

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/inv461-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/inv461-store"), { ownerUid: "inv461-user", memberUids: ["inv461-user"] });
      await setDoc(doc(ctx.firestore(), "products/p-461"), {
        storeId: "inv461-store",
        name: "Anillo Sol",
        sku: "SOL",
        category: "other",
        status: "published",
        variants: [{
          id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100,
          sizes: [
            { id: "s6", size: "6", sku: "SOL-D-6", cost: 100, quantityOnHand: 5, createdAt: "", updatedAt: "" },
            { id: "s5", size: "5", sku: "SOL-D-5", cost: 100, quantityOnHand: 2, createdAt: "", updatedAt: "" },
          ],
          createdAt: "", updatedAt: "",
        }],
      });
    });
    holder.db = env.authenticatedContext("inv461-user").firestore();
  });

  afterAll(async () => { await env.cleanup(); });

  it("reservar 2 de la talla 6 descuenta SOLO s6; la talla 5 y el nivel del color quedan intactos", async () => {
    await saveOrderWithStockTx({ uid: "inv461-user" } as never, asOrder(2), null, "mut-461-a");
    const shelves = await readSizes();
    expect(shelves.s6).toBe(3);
    expect(shelves.s5).toBe(2);
    expect(shelves.colorLevel).toBeUndefined();
  });

  it("editar el pedido a 1 pieza devuelve la diferencia a la MISMA combinación", async () => {
    await saveOrderWithStockTx({ uid: "inv461-user" } as never, asOrder(1), 1, "mut-461-b");
    const shelves = await readSizes();
    expect(shelves.s6).toBe(4);
    expect(shelves.s5).toBe(2);
  });

  it("retirar la línea del pedido devuelve la pieza a su combinación exacta", async () => {
    const emptied = { ...asOrder(0), items: [] } as unknown as Order;
    await saveOrderWithStockTx({ uid: "inv461-user" } as never, emptied, 2, "mut-461-c");
    const shelves = await readSizes();
    expect(shelves.s6).toBe(5);
    expect(shelves.s5).toBe(2);
  });

  it("una talla que ya no existe en el diseño: la toma falla cerrado, sin mover nada", async () => {
    const ghost = { ...asOrder(1), id: "ord-461bbb", items: [{ ...sizeLine(1), variantSizeId: "s99" }] } as Order;
    await expect(
      saveOrderWithStockTx({ uid: "inv461-user" } as never, ghost, null, "mut-461-d")
    ).rejects.toThrow(/talla elegida ya no existe/i);
    const shelves = await readSizes();
    expect(shelves.s6).toBe(5);
    expect(shelves.s5).toBe(2);
  });
});

// #461 corte 5: the assisted conversion transaction — shelves move to their
// exact combination, origins retire (archived + fusion note), blockers and
// freshness fail CLOSED with no partial writes, and a retry after commit
// finishes the public side without moving stock again.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("assisted conversion of separated fichas (#461 corte 5)", () => {
  // Self-contained environment: suite order (or -t filters) must not decide
  // whether `env` was initialized by another describe's beforeAll.
  let envConv: RulesTestEnvironment;
  beforeAll(async () => {
    envConv = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
  });
  afterAll(async () => { await envConv.cleanup(); });

  const STORE = "conv-store";
  const seedBase = {
    main: { id: "p-conv-main", storeId: STORE, name: "Anillo Sol", sku: "SOL", category: "other", status: "published", slug: "anillo-sol",
      prices: { t_retail: 1400 },
      variants: [{ id: "v_dorado", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 110,
        sizes: [{ id: "s6", size: "6", sku: "SOL-D-6", cost: 110, quantityOnHand: 5, createdAt: "", updatedAt: "" }],
        createdAt: "", updatedAt: "" }] },
    o1: { id: "p-conv-o1", storeId: STORE, name: "Anillo Sol Dorado 7", sku: "SOL-X-7", category: "other", status: "published", cost: 105, prices: { t_retail: 1350 }, quantityOnHand: 3, createdAt: "", updatedAt: "" },
    o2: { id: "p-conv-o2", storeId: STORE, name: "Anillo Sol Plateado 9", sku: "SOL-X-9", category: "other", status: "published", cost: 100, quantityOnHand: 4, createdAt: "", updatedAt: "" },
  };

  async function seed() {
    await envConv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/conv-user"), { role: "member" });
      await setDoc(doc(db, "adminStores/conv-store"), { ownerUid: "conv-user", memberUids: ["conv-user"] });
      await setDoc(doc(db, "stores/conv-store"), { id: STORE, name: "Conversión", slug: "conv", type: "inventory_tiered", ownerUid: "conv-user", memberUids: ["conv-user"], pendingInvites: [] });
      await setDoc(doc(db, "slugs/conv"), { storeId: STORE });
      await deleteDoc(doc(db, "orders", "ord-conv-hold")).catch(() => undefined); // blocker test's holding order
      await setDoc(doc(db, "products/p-conv-main"), seedBase.main);
      await setDoc(doc(db, "products/p-conv-o1"), seedBase.o1);
      await setDoc(doc(db, "products/p-conv-o2"), seedBase.o2);
    });
    holder.db = envConv.authenticatedContext("conv-user").firestore();
  }

  const readProduct = async (id: string) => (await getDoc(doc(holder.db, "products", id))).data() as Record<string, any>;
  const doradoShelf = async () => {
    const data = await readProduct("p-conv-main");
    const dorado = (data.variants as any[]).find((v: any) => v.id === "v_dorado");
    return {
      s6: dorado.sizes?.find((s: any) => s.id === "s6")?.quantityOnHand as number | undefined,
      s7: dorado.sizes?.find((s: any) => s.size === "7") as any | undefined,
    };
  };

  it("mueve cada estante a SU combinación, archiva los orígenes con nota y conserva el total (12 antes = 12 después)", async () => {
    await seed();
    const { convertProductVariantsTx } = await import("./firestoreData");
    const expected = {
      "p-conv-o1": { physical: 3, quarantine: 0 },
      "p-conv-o2": { physical: 4, quarantine: 0 },
    };
    await convertProductVariantsTx({
      storeId: STORE, mainId: "p-conv-main", expected,
      mappings: [
        { productId: "p-conv-o1", color: "Dorado", size: "7" },
        { productId: "p-conv-o2", color: "Plateado", size: "9" },
      ],
    });
    const shelf = await doradoShelf();
    expect(shelf.s6).toBe(5); // intacta
    expect(shelf.s7).toMatchObject({ sku: "SOL-X-7", cost: 105, quantityOnHand: 3 });
    const plateado = ((await readProduct("p-conv-main")).variants as any[]).find((v: any) => v.color === "Plateado");
    expect(plateado).toBeTruthy();
    expect(plateado.sizes[0]).toMatchObject({ size: "9", sku: "SOL-X-9", quantityOnHand: 4 });
    // total conservado: 5 + 3 + 4
    const o1 = await readProduct("p-conv-o1");
    const o2 = await readProduct("p-conv-o2");
    expect(o1.quantityOnHand).toBe(0);
    expect(o1.status).toBe("archived");
    expect(o1.mergedInto).toMatchObject({ productId: "p-conv-main" });
    expect(o2.quantityOnHand).toBe(0);
    expect(o2.mergedInto.productId).toBe("p-conv-main");
    // identidad conservada para el historial
    expect(o1.sku).toBe("SOL-X-7");
  });

  it("un pedido que sostiene piezas del origen BLOQUEA la conversión completa, sin cambios parciales", async () => {
    await seed();
    const { convertProductVariantsTx, saveOrderWithStockTx } = await import("./firestoreData");
    const holding = {
      id: "ord-conv-hold", storeId: STORE, customerId: "c1",
      items: [{ productId: "p-conv-o1", productName: "Anillo Sol Dorado 7", quantity: 2, unitPrice: 1350, subtotal: 2700 }],
      deposit: 0, orderStatus: "confirmed", paymentStatus: "unpaid", installmentsReservedAt: "2026-11-22T00:00:00.000Z",
      createdAt: "2026-11-22T00:00:00.000Z", updatedAt: "2026-11-22T00:00:00.000Z",
    } as never as Order;
    await saveOrderWithStockTx({ uid: "conv-user" } as never, holding, null, "mut-conv-hold");
    await expect(convertProductVariantsTx({
      storeId: STORE, mainId: "p-conv-main",
      mappings: [{ productId: "p-conv-o1", color: "Dorado", size: "7" }],
      expected: { "p-conv-o1": { physical: 1, quarantine: 0 } },
    })).rejects.toThrow(/Pedido|por entregar|resu[eé]lvelo/i);
    // nada se movió
    const shelf = await doradoShelf();
    expect(shelf.s7).toBeUndefined();
    expect((await readProduct("p-conv-o1")).status).toBe("published");
  });

  it("existencia distinta a la de la vista previa: STALE sin mover nada", async () => {
    await seed();
    const { convertProductVariantsTx } = await import("./firestoreData");
    await expect(convertProductVariantsTx({
      storeId: STORE, mainId: "p-conv-main",
      mappings: [{ productId: "p-conv-o1", color: "Dorado", size: "7" }],
      expected: { "p-conv-o1": { physical: 99, quarantine: 0 } },
    })).rejects.toThrow(/cambió de existencia/i);
    expect((await doradoShelf()).s7).toBeUndefined();
  });

  it("el reintento tras commit termina la vía pública SIN volver a mover piezas (envoltorio idempotente)", async () => {
    await seed();
    const { convertProductVariants } = await import("./firestoreData");
    const params = {
      store: { id: STORE, slug: "conv", type: "inventory_tiered" as const, priceTiers: [{ id: "t_retail", label: "Regular", order: 1 }], defaultTierId: "t_retail" },
      categories: [] as never[],
      allStoreProducts: [seedBase.main, seedBase.o1, seedBase.o2] as never[],
      mainId: "p-conv-main",
      mappings: [
        { productId: "p-conv-o1", color: "Dorado", size: "7" },
        { productId: "p-conv-o2", color: "Plateado", size: "9" },
      ],
      expected: { "p-conv-o1": { physical: 3, quarantine: 0 }, "p-conv-o2": { physical: 4, quarantine: 0 } },
    };
    await convertProductVariants(params);
    const afterFirst = await doradoShelf();
    expect(afterFirst.s7.quantityOnHand).toBe(3);
    // RETRY: origins already merged → public side only, shelves untouched.
    await convertProductVariants(params);
    const afterRetry = await doradoShelf();
    expect(afterRetry.s7.quantityOnHand).toBe(3);
    expect(afterRetry.s6).toBe(5);
  });
});
