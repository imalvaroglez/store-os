import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
// registerDeliveryTx stamps the signed-in uid on the event.
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db, auth: { currentUser: { uid: "qa461-user" } } }) }));
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
    o1: { id: "p-conv-o1", storeId: STORE, name: "Anillo Sol Dorado 7", sku: "SOL-X-7", category: "other", status: "published", cost: 105, prices: { t_retail: 1400 }, quantityOnHand: 3, createdAt: "", updatedAt: "" },
    o2: { id: "p-conv-o2", storeId: STORE, name: "Anillo Sol Plateado 9", sku: "SOL-X-9", category: "other", status: "published", cost: 100, prices: { t_retail: 1400 }, quantityOnHand: 4, createdAt: "", updatedAt: "" },
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

  it("dictamen QA (mayor): precio distinto al unificar con un color EXISTENTE bloquea la transacción, sin cambios parciales", async () => {
    await seed();
    await envConv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), "products/p-conv-o1"), { prices: { t_retail: 1350 } }, { merge: true })
    );
    const { convertProductVariantsTx } = await import("./firestoreData");
    await expect(convertProductVariantsTx({
      storeId: STORE, mainId: "p-conv-main",
      mappings: [{ productId: "p-conv-o1", color: "Dorado", size: "7" }],
      expected: { "p-conv-o1": { physical: 3, quarantine: 0 } },
    })).rejects.toThrow(/precios distintos.*1,350.*1,400.*Fer decide cu[aá]l conservar/i);
    expect((await doradoShelf()).s7).toBeUndefined(); // nada se movió
    expect((await readProduct("p-conv-o1")).status).toBe("published");
    expect((await readProduct("p-conv-o1")).quantityOnHand).toBe(3);
  });

  it("dictamen QA (crítico 3): el color del diseño tiene 5 piezas sin talla — bloquea en vez de volverlas 3", async () => {
    await seed();
    // La ficha principal vende Dorado sin tallas, con 5 piezas contadas (la repro: 8 antes → 3 después).
    await envConv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), "products/p-conv-main"), {
        variants: [{ id: "v_dorado", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 110, quantityOnHand: 5, createdAt: "", updatedAt: "" }],
      }, { merge: true })
    );
    const { convertProductVariantsTx } = await import("./firestoreData");
    await expect(convertProductVariantsTx({
      storeId: STORE, mainId: "p-conv-main",
      mappings: [{ productId: "p-conv-o1", color: "Dorado", size: "7" }],
      expected: { "p-conv-o1": { physical: 3, quarantine: 0 } },
    })).rejects.toThrow(/color Dorado de la ficha principal tiene 5 piezas contadas sin talla/);
    const main = await readProduct("p-conv-main");
    expect(main.variants[0].quantityOnHand).toBe(5); // las 5 siguen donde estaban
    expect(main.variants[0].sizes).toBeUndefined();
    expect((await readProduct("p-conv-o1")).quantityOnHand).toBe(3);
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

// #461 — devolución de QA (23-nov): los críticos de inventario reproducidos
// contra las transacciones reales. La venta descuenta SU combinación, una
// línea sin talla en un color que ya se vende por talla no aparta nada, la
// entrega lleva la talla y cancelar el remanente devuelve solo lo pendiente.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("pedido, entrega y cancelación por combinación (#461 — dictamen QA)", () => {
  let envQa: RulesTestEnvironment;
  const STORE = "qa461-store";
  const PRODUCT = "p-qa461";

  async function seed() {
    await envQa.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/qa461-user"), { role: "member" });
      await setDoc(doc(db, "adminStores/" + STORE), { ownerUid: "qa461-user", memberUids: ["qa461-user"] });
      // One order id for every test: each test starts from a clean slate.
      await deleteDoc(doc(db, "orders/ord-qa461")).catch(() => undefined);
      await setDoc(doc(db, "products/" + PRODUCT), {
        storeId: STORE, name: "Anillo Sol", sku: "SOL", category: "other", status: "published",
        variants: [
          { id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, createdAt: "", updatedAt: "",
            sizes: [
              { id: "d6", size: "6", sku: "SOL-D-6", cost: 100, quantityOnHand: 4, createdAt: "", updatedAt: "" },
              { id: "d5", size: "5", sku: "SOL-D-5", cost: 100, quantityOnHand: 3, createdAt: "", updatedAt: "" },
            ] },
        ],
      });
    });
    holder.db = envQa.authenticatedContext("qa461-user").firestore();
  }

  beforeAll(async () => {
    envQa = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
  });
  afterAll(async () => { await envQa.cleanup(); });

  const line = (sizeId: "d6" | "d5", quantity: number, lineId: string) => ({
    lineId, productId: PRODUCT, productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado",
    variantSizeId: sizeId, variantSize: sizeId === "d6" ? "6" : "5", quantity, unitPrice: 400, subtotal: 400 * quantity,
  });
  const orderOf = (items: unknown[], orderStatus: "ready" | "cancelled" = "ready"): Order =>
    ({
      id: "ord-qa461", storeId: STORE, customerId: "ana", items, deposit: 0, orderStatus, paymentStatus: "unpaid",
      createdAt: "2026-11-23T00:00:00.000Z", updatedAt: "2026-11-23T00:00:00.000Z",
    }) as unknown as Order;
  const shelves = async () => {
    const snap = await getDoc(doc(holder.db, "products", PRODUCT));
    const data = snap.data() as { quantityOnHand?: number; variants: Array<{ quantityOnHand?: number; sizes: Array<{ id: string; quantityOnHand?: number }> }> };
    const gold = data.variants[0];
    return {
      d6: gold.sizes.find((s) => s.id === "d6")?.quantityOnHand,
      d5: gold.sizes.find((s) => s.id === "d5")?.quantityOnHand,
      colorLevel: gold.quantityOnHand,
      designLevel: data.quantityOnHand,
    };
  };
  /** The same design once its color sells by talla (free pieces split 3 / 1 on top of the color's shelf). */
  async function seedProductWithSizes(colorLevel = 0) {
    await envQa.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/" + PRODUCT), {
        storeId: STORE, name: "Anillo Sol", sku: "SOL", category: "other", status: "published",
        variants: [{ id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, quantityOnHand: colorLevel, createdAt: "", updatedAt: "",
          sizes: [
            { id: "d6", size: "6", sku: "SOL-D-6", cost: 100, quantityOnHand: 3, createdAt: "", updatedAt: "" },
            { id: "d5", size: "5", sku: "SOL-D-5", cost: 100, quantityOnHand: 1, createdAt: "", updatedAt: "" },
          ] }],
      });
    });
  }

  const freshOrder = async (): Promise<Order> => {
    const snap = await getDoc(doc(holder.db, "orders", "ord-qa461"));
    return { ...snap.data(), id: "ord-qa461" } as unknown as Order;
  };

  it("crítico 1 — vender Dorado·6 ×1 descuenta SOLO esa combinación (d6 4→3); d5, el color y el diseño quedan intactos", async () => {
    await seed();
    await saveOrderWithStockTx({ uid: "qa461-user" } as never, orderOf([line("d6", 1, "l1")]), null, "mut-qa461-a");
    expect(await shelves()).toEqual({ d6: 3, d5: 3, colorLevel: undefined, designLevel: undefined });
  });

  it("crítico 1 (falla cerrado) — una línea del color SIN talla no aparta nada y dice qué elegir", async () => {
    await seed();
    const colorless = { ...line("d6", 1, "l1"), variantSizeId: undefined, variantSize: undefined };
    await expect(
      saveOrderWithStockTx({ uid: "qa461-user" } as never, orderOf([colorless]), null, "mut-qa461-b")
    ).rejects.toThrow(/se vende por talla/i);
    expect(await shelves()).toEqual({ d6: 4, d5: 3, colorLevel: undefined, designLevel: undefined });
    expect((await getDoc(doc(holder.db, "orders", "ord-qa461"))).exists()).toBe(false);
  });

  it("crítico 2 — entrega parcial por talla y cancelación del remanente: vuelve SOLO lo pendiente de cada combinación (d6→3, d5→3), nunca piezas entregadas", async () => {
    await seed();
    const { registerDeliveryTx } = await import("./firestoreData");
    // Pedido listo con Dorado·6 ×2 + Dorado·5 ×1 → d6 4→2, d5 3→2
    await saveOrderWithStockTx({ uid: "qa461-user" } as never, orderOf([line("d6", 2, "l1"), line("d5", 1, "l2")]), null, "mut-qa461-c");
    expect(await shelves()).toEqual({ d6: 2, d5: 2, colorLevel: undefined, designLevel: undefined });
    // Se entrega 1 pieza de la talla 6 (la hoja registra SU talla)
    const beforeDelivery = await freshOrder();
    await registerDeliveryTx({
      orderId: "ord-qa461", storeId: STORE,
      delivery: {
        id: "dev-qa461", orderId: "ord-qa461", storeId: STORE, deliveredAt: "2026-11-23",
        recordedAt: "2026-11-23T10:00:00.000Z", by: "qa461-user",
        lines: [{ productId: PRODUCT, variantId: "v_gold", variantSizeId: "d6", quantity: 1 }],
      },
    });
    const delivered = await freshOrder();
    expect(delivered.deliveries?.[0].lines).toEqual([{ productId: PRODUCT, variantId: "v_gold", variantSizeId: "d6", quantity: 1 }]);
    expect(delivered.revision).toBe((beforeDelivery.revision ?? 0) + 1);
    // Cancelación del remanente: 1 de la 6 y 1 de la 5 pendientes; la entregada queda consumida
    const beforeCancel = await shelves();
    await saveOrderWithStockTx({ uid: "qa461-user" } as never, { ...delivered, orderStatus: "cancelled" } as Order, delivered.revision ?? null, "mut-qa461-d");
    expect(await shelves()).toEqual({ d6: 3, d5: 3, colorLevel: undefined, designLevel: undefined });
    expect(beforeCancel).toEqual({ d6: 2, d5: 2, colorLevel: undefined, designLevel: undefined });
  });

  it("línea vendida sin talla: cancelar deja esas piezas «sin talla» en el color (la ficha pide repartirlas) y no las pierde", async () => {
    await seed();
    // El pedido se vendió cuando Dorado aún no tenía tallas
    await envQa.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/" + PRODUCT), {
        storeId: STORE, name: "Anillo Sol", sku: "SOL", category: "other", status: "published",
        variants: [{ id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, quantityOnHand: 4, createdAt: "", updatedAt: "" }],
      });
    });
    const soldWithoutSize = { ...line("d6", 2, "l1"), variantSizeId: undefined, variantSize: undefined };
    await saveOrderWithStockTx({ uid: "qa461-user" } as never, orderOf([soldWithoutSize]), null, "mut-qa461-e");
    // Dorado pasa a venderse por talla con sus 4 piezas libres repartidas 3 / 1
    await envQa.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/" + PRODUCT), {
        storeId: STORE, name: "Anillo Sol", sku: "SOL", category: "other", status: "published",
        variants: [{ id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, createdAt: "", updatedAt: "",
          sizes: [
            { id: "d6", size: "6", sku: "SOL-D-6", cost: 100, quantityOnHand: 3, createdAt: "", updatedAt: "" },
            { id: "d5", size: "5", sku: "SOL-D-5", cost: 100, quantityOnHand: 1, createdAt: "", updatedAt: "" },
          ] }],
      }, { merge: true });
    });
    const sold = await freshOrder();
    await saveOrderWithStockTx({ uid: "qa461-user" } as never, { ...sold, orderStatus: "cancelled" } as Order, sold.revision ?? null, "mut-qa461-f");
    const after = await shelves();
    expect(after.d6).toBe(3); // sin inventar la talla de las piezas
    expect(after.d5).toBe(1);
    expect(after.colorLevel).toBe(2); // las 2 piezas del pedido quedan a la vista, sin talla
    expect(after.designLevel).toBeUndefined();
  });

  it("línea vendida sin talla: asignar la talla en el mismo cambio manda las piezas a ESA combinación (sin pasar por «sin talla»)", async () => {
    await seed();
    await envQa.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/" + PRODUCT), {
        storeId: STORE, name: "Anillo Sol", sku: "SOL", category: "other", status: "published",
        variants: [{ id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, quantityOnHand: 4, createdAt: "", updatedAt: "" }],
      });
    });
    const soldWithoutSize = { ...line("d6", 2, "l1"), variantSizeId: undefined, variantSize: undefined };
    await saveOrderWithStockTx({ uid: "qa461-user" } as never, orderOf([soldWithoutSize]), null, "mut-qa461-g");
    await envQa.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/" + PRODUCT), {
        storeId: STORE, name: "Anillo Sol", sku: "SOL", category: "other", status: "published",
        variants: [{ id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, createdAt: "", updatedAt: "",
          sizes: [
            { id: "d6", size: "6", sku: "SOL-D-6", cost: 100, quantityOnHand: 3, createdAt: "", updatedAt: "" },
            { id: "d5", size: "5", sku: "SOL-D-5", cost: 100, quantityOnHand: 1, createdAt: "", updatedAt: "" },
          ] }],
      }, { merge: true });
    });
    const sold = await freshOrder();
    // Fer edita el pedido y elige la talla 6 para la línea: nada se mueve (misma reserva, ahora con talla)
    const mapped = { ...sold, items: [line("d6", 2, "l1")] } as Order;
    await saveOrderWithStockTx({ uid: "qa461-user" } as never, mapped, sold.revision ?? null, "mut-qa461-h");
    expect(await shelves()).toEqual({ d6: 3, d5: 1, colorLevel: undefined, designLevel: undefined });
    // Y al cancelar, las 2 piezas vuelven a la talla 6 — no al limbo
    const mappedSaved = await freshOrder();
    await saveOrderWithStockTx({ uid: "qa461-user" } as never, { ...mappedSaved, orderStatus: "cancelled" } as Order, mappedSaved.revision ?? null, "mut-qa461-i");
    expect(await shelves()).toEqual({ d6: 5, d5: 1, colorLevel: undefined, designLevel: undefined });
  });
  // ── Revisión de código independiente, 23-nov: protecciones que no tenían prueba ──
  it("borrar un pedido devuelve cada pieza a SU talla (d6 2→3, d5 2→3) y nada al color ni al diseño", async () => {
    await seed();
    const { deleteOrderWithStockTx } = await import("./firestoreData");
    const saved = await saveOrderWithStockTx({ uid: "qa461-user" } as never, orderOf([line("d6", 2, "l1"), line("d5", 1, "l2")]), null, "mut-qa461-j");
    expect(await shelves()).toEqual({ d6: 2, d5: 2, colorLevel: undefined, designLevel: undefined });
    await deleteOrderWithStockTx({ uid: "qa461-user" } as never, saved.order.id, saved.order.revision ?? 1);
    expect(await shelves()).toEqual({ d6: 4, d5: 3, colorLevel: undefined, designLevel: undefined });
    expect((await getDoc(doc(holder.db, "orders", "ord-qa461"))).exists()).toBe(false);
  });

  it("asignar la talla a una línea con entrega ya registrada SIN talla falla cerrado, sin mover nada", async () => {
    await seed();
    // Se vendió y se entregó cuando Dorado aún no tenía tallas; después el color pasó a venderse por talla.
    await envQa.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/" + PRODUCT), {
        storeId: STORE, name: "Anillo Sol", sku: "SOL", category: "other", status: "published",
        variants: [{ id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, quantityOnHand: 1, createdAt: "", updatedAt: "" }],
      });
    });
    const soldWithoutSize = { ...line("d6", 3, "l1"), variantSizeId: undefined, variantSize: undefined };
    await saveOrderWithStockTx({ uid: "qa461-user" } as never, orderOf([soldWithoutSize]), null, "mut-qa461-k");
    const { registerDeliveryTx } = await import("./firestoreData");
    await registerDeliveryTx({
      orderId: "ord-qa461", storeId: STORE,
      delivery: { id: "dev-qa461-k", orderId: "ord-qa461", storeId: STORE, deliveredAt: "2026-11-23", recordedAt: "2026-11-23T10:00:00.000Z", by: "qa461-user",
        lines: [{ productId: PRODUCT, variantId: "v_gold", quantity: 1 }] },
    });
    await seedProductWithSizes();
    const before = await shelves();
    const delivered = await freshOrder();
    await expect(
      saveOrderWithStockTx({ uid: "qa461-user" } as never, { ...delivered, items: [line("d6", 3, "l1")] } as Order, delivered.revision ?? null, "mut-qa461-l")
    ).rejects.toThrow(/entrega registrada sin talla/);
    expect(await shelves()).toEqual(before);
  });

  it("la talla ya no existe pero el color sí: cancelar devuelve las piezas al color «sin talla» (visibles), no al campo del diseño", async () => {
    await seed();
    const saved = await saveOrderWithStockTx({ uid: "qa461-user" } as never, orderOf([line("d6", 1, "l1")]), null, "mut-qa461-m");
    // La ficha quitó la talla 6 después de la venta (sus piezas libres se fueron a la 5).
    const data = (await getDoc(doc(holder.db, "products", PRODUCT))).data() as { variants: any[] };
    const variants = data.variants.map((v) => (v.id === "v_gold" ? { ...v, sizes: v.sizes.filter((s: any) => s.id !== "d6") } : v));
    await envQa.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "products/" + PRODUCT), { variants }, { merge: true }));
    await saveOrderWithStockTx({ uid: "qa461-user" } as never, { ...saved.order, orderStatus: "cancelled" } as Order, saved.order.revision ?? null, "mut-qa461-n");
    const after = await shelves();
    expect(after.d6).toBeUndefined();
    expect(after.d5).toBe(3); // la talla hermana no recibe piezas ajenas
    expect(after.colorLevel).toBe(1); // a la vista «sin talla», para repartir desde la ficha
    expect(after.designLevel).toBeUndefined(); // nunca al estante que la app ignora
  });

  it("borrar un pedido cuya talla ya no existe también devuelve las piezas al color «sin talla» (rama sin prueba, re-revisión 23-nov)", async () => {
    await seed();
    const { deleteOrderWithStockTx } = await import("./firestoreData");
    const saved = await saveOrderWithStockTx({ uid: "qa461-user" } as never, orderOf([line("d6", 1, "l1")]), null, "mut-qa461-o");
    const data = (await getDoc(doc(holder.db, "products", PRODUCT))).data() as { variants: any[] };
    const variants = data.variants.map((v) => (v.id === "v_gold" ? { ...v, sizes: v.sizes.filter((s: any) => s.id !== "d6") } : v));
    await envQa.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "products/" + PRODUCT), { variants }, { merge: true }));
    await deleteOrderWithStockTx({ uid: "qa461-user" } as never, saved.order.id, saved.order.revision ?? 1);
    const after = await shelves();
    expect(after.colorLevel).toBe(1); // a la vista «sin talla»
    expect(after.d5).toBe(3); // la talla hermana no recibe piezas ajenas
    expect(after.designLevel).toBeUndefined(); // nunca al campo que la app ignora
  });

});
