import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, Store } from "../../types";
import { FIREBASE_DEV_PROJECT_ID } from "./projectIds";

type TestFirestore = ReturnType<RulesTestContext["firestore"]>;
const config = vi.hoisted(() => ({ db: null as TestFirestore | null }));
vi.mock("./config", () => ({ getFirebase: () => config }));
import {
  PurchaseAlreadyReceived,
  projectPublicForStore,
  receivePurchaseTx,
  rebuildPublicCatalog,
  republishStockSignals,
  upsertPublicProduct,
} from "./firestoreData";

const store: Store = {
  id: "stock-test", name: "Tienda de prueba", slug: "stock-test", type: "inventory_tiered",
  createdAt: "", updatedAt: "", defaultTierId: "t_retail",
};
const product: Product = {
  id: "stock-watch", storeId: store.id, name: "Reloj de prueba", category: "other",
  slug: "reloj", status: "published", isPublic: true, quantityOnHand: 0, cost: 20,
  prices: { t_retail: 80 }, createdAt: "", updatedAt: "",
};
const productPath = "products/stock-watch";
const detailPath = "publicProducts/stock-test__reloj";
const purchasePath = "purchases/stock-test";
let env: RulesTestEnvironment;
let db: TestFirestore;

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("stock projection with Firestore rules", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: FIREBASE_DEV_PROJECT_ID,
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    db = env.authenticatedContext("stock-member").firestore();
    config.db = db;
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, "adminStores", store.id), {
        ownerUid: "stock-member", memberUids: ["stock-member"],
      });
      await setDoc(doc(admin, "stores", store.id), store);
      await setDoc(doc(admin, productPath), product);
    });
  });

  afterAll(async () => { await env?.cleanup(); });

  it("creates a complete public detail after receiving once when the detail was missing", async () => {
    await setDoc(doc(db, purchasePath), {
      storeId: store.id, status: "ready", costingMethod: "latest_purchase",
      tickets: [{ id: "ticket", totalConfirmed: 80 }],
      lines: [{ lineId: "line", ticketId: "ticket", productId: product.id, name: product.name, quantity: 4, unitCost: 20 }],
      subtotal: 80, totalConfirmed: 80,
    });
    const result = await receivePurchaseTx("stock-test");
    const received = { ...product, ...result.stockUpdates.get(product.id) };

    await republishStockSignals(store, [received], [], [product.id]);
    await republishStockSignals(store, [received], [], [product.id]);
    await expect(receivePurchaseTx("stock-test")).rejects.toBeInstanceOf(PurchaseAlreadyReceived);
    expect((await getDoc(doc(db, purchasePath))).data()?.status).toBe("received");
    expect((await getDoc(doc(db, productPath))).data()?.quantityOnHand).toBe(4);

    const publicDb = env.unauthenticatedContext().firestore();
    const detail = (await getDoc(doc(publicDb, detailPath))).data();
    expect(detail).toMatchObject({
      storeId: store.id, productSlug: product.slug, name: product.name, price: 80, stockSignal: "disponible",
    });
    expect(detail).not.toHaveProperty("cost");
    expect(detail).not.toHaveProperty("quantityOnHand");
  });

  it("uses fresh stock and preserves the existing detail when retrying with stale input", async () => {
    const images = [{ url: "https://example.com/reloj.jpg", isPrimary: true }];
    await setDoc(doc(db, detailPath), { storeId: store.id, price: 95, images, stockSignal: "agotado" });
    await updateDoc(doc(db, productPath), { quantityOnHand: 5 });

    await republishStockSignals(store, [product], [], [product.id]);

    expect((await getDoc(doc(db, detailPath))).data()).toEqual({
      storeId: store.id, price: 95, images, stockSignal: "disponible",
    });
    const catalog = (await getDoc(doc(db, "publicCatalogs", store.slug))).data();
    expect(catalog?.products[0].stockSignal).toBe("disponible");
  });

  it("keeps other public summaries and concurrent pricing edits on stock retry", async () => {
    const unrelated = { productSlug: "otra-pieza", name: "Otra pieza", price: 99, stockSignal: "pocas" };
    await setDoc(doc(db, "publicCatalogs", store.slug), {
      storeId: store.id,
      storeSlug: store.slug,
      categories: [{ id: "keep", name: "Keep" }],
      products: [{ productSlug: product.slug, price: 95, stockSignal: "agotado" }, unrelated],
    });
    await updateDoc(doc(db, productPath), { quantityOnHand: 5 });

    await republishStockSignals(store, [product], [], [product.id]);

    const catalog = (await getDoc(doc(db, "publicCatalogs", store.slug))).data();
    expect(catalog?.categories).toEqual([{ id: "keep", name: "Keep" }]);
    expect(catalog?.products).toEqual([
      { productSlug: product.slug, price: 95, stockSignal: "disponible" },
      unrelated,
    ]);
  });

  it("leaves retired products out when rebuilding a missing catalog", async () => {
    const retired = { ...product, id: "retired", slug: "retired" };
    await setDoc(doc(db, "products", retired.id), { ...retired, status: "draft", isPublic: false });

    await republishStockSignals(store, [product, retired], [], [product.id]);

    const catalog = (await getDoc(doc(db, "publicCatalogs", store.slug))).data();
    expect(catalog?.products.map((entry: { productSlug: string }) => entry.productSlug)).toEqual([product.slug]);
  });

  it("restores a missing summary and preserves unrelated summaries", async () => {
    const unrelated = { productSlug: "otra-pieza", stockSignal: "pocas" };
    const catalogRef = doc(db, "publicCatalogs", store.slug);
    await setDoc(catalogRef, { storeId: store.id, storeSlug: store.slug, products: [unrelated] });

    await republishStockSignals(store, [product], [], [product.id]);

    expect((await getDoc(catalogRef)).data()?.products).toEqual([
      unrelated,
      expect.objectContaining({ productSlug: product.slug, price: 80, stockSignal: "agotado" }),
    ]);
  });

  it.each([{ status: "draft", isPublic: false }, { slug: "reloj-nuevo" }])(
    "never recreates the old public route after %o",
    async (change) => {
      await updateDoc(doc(db, productPath), change);
      await republishStockSignals(store, [product], [], [product.id]);

      expect((await getDoc(doc(db, detailPath))).exists()).toBe(false);
      const catalog = (await getDoc(doc(db, "publicCatalogs", store.slug))).data();
      expect(catalog?.products.some((entry: { productSlug: string }) => entry.productSlug === product.slug)).toBe(false);
    },
  );

  // #353 (PO review, riesgo 1): a stale client saving one product must never
  // regress the public availability another device already published.
  it("keeps a fresh public signal when a stale client saves another product", async () => {
    const chain = { ...product, id: "stock-chain", name: "Cadena", slug: "cadena" };
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      // The save persisted the rename to canonical before the public write.
      await setDoc(doc(admin, "products", chain.id), { ...chain, name: "Cadena actualizada" });
      // Another device received 4 watches and published the fresh signal.
      await updateDoc(doc(admin, productPath), { quantityOnHand: 4 });
      await setDoc(doc(admin, "publicCatalogs", store.slug), {
        storeId: store.id,
        storeSlug: store.slug,
        products: [
          { productSlug: product.slug, price: 80, stockSignal: "disponible" },
          { productSlug: chain.slug, price: 70, stockSignal: "agotado" },
        ],
      });
    });
    // This client still remembers stock 0 for the watch (stale) and only edits the chain's name.
    const staleWatch = { ...product, quantityOnHand: 0 };
    const editedChain = { ...chain, name: "Cadena actualizada" };

    await upsertPublicProduct(editedChain, store.slug, [staleWatch, editedChain], [], store);

    const catalog = (await getDoc(doc(db, "publicCatalogs", store.slug))).data();
    const bySlug = new Map<string, Record<string, unknown>>(
      catalog?.products.map((entry: { productSlug: string }) => [entry.productSlug, entry] as const)
    );
    expect(bySlug.get(product.slug!)?.stockSignal).toBe("disponible");
    expect(bySlug.get(chain.slug)?.name).toBe("Cadena actualizada");
    expect(bySlug.get(chain.slug)?.stockSignal).toBe("agotado");
  });

  it("projects the saved product's detail from canonical, not from the stale copy", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      // The save persisted price 120; a concurrent reception added stock afterwards.
      await updateDoc(doc(admin, productPath), { quantityOnHand: 4, prices: { t_retail: 120 } });
      await setDoc(doc(admin, detailPath), { storeId: store.id, price: 95, stockSignal: "disponible" });
    });
    const savedButStale = { ...product, prices: { t_retail: 120 }, quantityOnHand: 0 };

    await upsertPublicProduct(savedButStale, store.slug, [savedButStale], [], store);

    expect((await getDoc(doc(db, detailPath))).data()).toMatchObject({ price: 120, stockSignal: "disponible" });
  });

  it("does update availability for the touched product (manual stock edit)", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await updateDoc(doc(admin, productPath), { quantityOnHand: 2 });
      await setDoc(doc(admin, "publicCatalogs", store.slug), {
        storeId: store.id,
        storeSlug: store.slug,
        products: [{ productSlug: product.slug, price: 80, stockSignal: "agotado" }],
      });
    });
    const adjusted = { ...product, quantityOnHand: 2 };

    await upsertPublicProduct(adjusted, store.slug, [adjusted], [], store);

    const catalog = (await getDoc(doc(db, "publicCatalogs", store.slug))).data();
    expect(catalog?.products[0].stockSignal).toBe("disponible");
    expect((await getDoc(doc(db, detailPath))).data()?.stockSignal).toBe("disponible");
  });

  it("keeps other products' availability when a delete rebuilds the catalog", async () => {
    const chain = { ...product, id: "stock-chain", name: "Cadena", slug: "cadena" };
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, "products", chain.id), chain);
      await updateDoc(doc(admin, productPath), { quantityOnHand: 4 });
      await setDoc(doc(admin, "publicCatalogs", store.slug), {
        storeId: store.id,
        storeSlug: store.slug,
        products: [
          { productSlug: product.slug, price: 80, stockSignal: "disponible" },
          { productSlug: chain.slug, price: 70, stockSignal: "pocas" },
        ],
      });
    });

    // The delete path rebuilds with the remaining list and no touched products.
    await rebuildPublicCatalog(store.slug, store.id, [{ ...product, quantityOnHand: 0 }], store);

    const catalog = (await getDoc(doc(db, "publicCatalogs", store.slug))).data();
    expect(catalog?.products).toEqual([
      expect.objectContaining({ productSlug: product.slug, stockSignal: "disponible" }),
    ]);
  });

  it("full republish from a stale snapshot keeps fresh availability and prunes retired routes", async () => {
    const retired = { ...product, id: "retired-piece", slug: "retirada" };
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, "products", retired.id), { ...retired, status: "draft", isPublic: false });
      // A reception on another device already published fresh availability.
      await updateDoc(doc(admin, productPath), { quantityOnHand: 4 });
      await setDoc(doc(admin, "publicProducts", `${store.id}__retirada`), {
        storeId: store.id, storeSlug: store.slug, productSlug: "retirada", stockSignal: "disponible",
      });
    });
    // Stale memory: stock 0, and it still believes the retired piece is published.
    const staleMemory: Product[] = [
      { ...product, quantityOnHand: 0 },
      { ...retired, status: "published" as const, isPublic: true },
    ];

    await projectPublicForStore(store, staleMemory, []);

    const catalog = (await getDoc(doc(db, "publicCatalogs", store.slug))).data();
    expect(catalog?.products).toEqual([
      expect.objectContaining({ productSlug: product.slug, stockSignal: "disponible" }),
    ]);
    expect((await getDoc(doc(db, detailPath))).data()).toMatchObject({ price: 80, stockSignal: "disponible" });
    expect((await getDoc(doc(db, "publicProducts", `${store.id}__retirada`))).exists()).toBe(false);
  });

  // #353 (PO review, riesgo 2): selection of affected products must not depend
  // on the caller's local cache — a stale client still gets its changed
  // products repaired from canonical.
  it("repairs a changed product missing from the caller's stale list", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await updateDoc(doc(admin, productPath), { quantityOnHand: 4 });
      await setDoc(doc(admin, "publicCatalogs", store.slug), {
        storeId: store.id,
        storeSlug: store.slug,
        products: [{ productSlug: "otra-pieza", stockSignal: "pocas" }],
      });
    });

    await republishStockSignals(store, [], [], [product.id]);

    expect((await getDoc(doc(db, detailPath))).data()).toMatchObject({ price: 80, stockSignal: "disponible" });
    const catalog = (await getDoc(doc(db, "publicCatalogs", store.slug))).data();
    expect(catalog?.products).toEqual([
      { productSlug: "otra-pieza", stockSignal: "pocas" },
      expect.objectContaining({ productSlug: product.slug, stockSignal: "disponible" }),
    ]);
  });

  // #353 (PO review, riesgo 3): Fer's real case — several arracadas with equal
  // sizes and different codes created from Compras, plus a color line.
  // Reception must keep every ficha's identity, cost and stock separate.
  it("keeps identity, cost and stock separate for similar products and color lines", async () => {
    const arrSmall1 = { ...product, id: "arr-1", name: "Arracada Silver Small", slug: "arracada-silver-small", sku: "ACE22-1", prices: { t_retail: 80 } };
    const arrSmall2 = { ...product, id: "arr-2", name: "Arracada Silver Small", slug: "arracada-silver-small-2", sku: "ACE22-2", prices: { t_retail: 85 } };
    const arrBig = { ...product, id: "arr-3", name: "Arracada Silver", slug: "arracada-silver", sku: "AAR0081", prices: { t_retail: 95 } };
    const austin = {
      ...product, id: "austin", name: "Reloj Austin", slug: "reloj-austin", sku: "OLIV-RELOJ-AUSTIN",
      variants: [
        { id: "austin-g", color: "Gold", quantityOnHand: 0, createdAt: "" },
        { id: "austin-s", color: "Silver", quantityOnHand: 0, createdAt: "" },
      ],
    };
    const lines = [
      { lineId: "l1", ticketId: "ticket", productId: arrSmall1.id, name: "Arracada Silver Small", quantity: 2, unitCost: 25 },
      { lineId: "l2", ticketId: "ticket", productId: arrSmall2.id, name: "Arracada Silver Small", quantity: 3, unitCost: 30 },
      { lineId: "l3", ticketId: "ticket", productId: arrBig.id, name: "Arracada Silver", quantity: 1, unitCost: 40 },
      { lineId: "l4", ticketId: "ticket", productId: austin.id, variantId: "austin-g", name: "Reloj Austin Gold", quantity: 4, unitCost: 100 },
    ];
    await env.withSecurityRulesDisabled(async (context) => {
      const admin = context.firestore();
      await setDoc(doc(admin, "products", arrSmall1.id), arrSmall1);
      await setDoc(doc(admin, "products", arrSmall2.id), arrSmall2);
      await setDoc(doc(admin, "products", arrBig.id), arrBig);
      await setDoc(doc(admin, "products", austin.id), austin);
    });
    await setDoc(doc(db, purchasePath), {
      storeId: store.id, status: "ready", costingMethod: "latest_purchase",
      tickets: [{ id: "ticket", totalConfirmed: 580 }],
      lines,
      subtotal: 580, totalConfirmed: 580,
    });

    await receivePurchaseTx("stock-test");

    const canonical = async (id: string) => (await getDoc(doc(db, "products", id))).data();
    expect((await canonical(arrSmall1.id))?.quantityOnHand).toBe(2);
    expect((await canonical(arrSmall2.id))?.quantityOnHand).toBe(3);
    expect((await canonical(arrBig.id))?.quantityOnHand).toBe(1);
    const austinAfter = await canonical(austin.id);
    const shelf = (variantId: string) =>
      austinAfter?.variants.find((variant: { id: string }) => variant.id === variantId);
    expect(shelf("austin-g")?.quantityOnHand).toBe(4);
    expect(shelf("austin-s")?.quantityOnHand).toBe(0);
    // A color design keeps no product-level shelf of its own.
    expect(austinAfter?.quantityOnHand).toBe(0);

    // The purchase keeps each line's captured identity and cost untouched.
    const purchase = (await getDoc(doc(db, purchasePath))).data();
    expect(purchase?.status).toBe("received");
    expect(purchase?.lines).toEqual(lines);

    // Each ficha keeps its own public route and price; the design keeps one
    // route with per-color signals.
    await republishStockSignals(
      store,
      [
        { ...arrSmall1, quantityOnHand: 2 },
        { ...arrSmall2, quantityOnHand: 3 },
        { ...arrBig, quantityOnHand: 1 },
        { ...austin, variants: austinAfter?.variants },
      ],
      [],
      [arrSmall1.id, arrSmall2.id, arrBig.id, austin.id]
    );
    const detail = async (slug: string) =>
      (await getDoc(doc(db, "publicProducts", `${store.id}__${slug}`))).data();
    expect(await detail("arracada-silver-small")).toMatchObject({ price: 80, stockSignal: "disponible" });
    expect(await detail("arracada-silver-small-2")).toMatchObject({ price: 85, stockSignal: "disponible" });
    expect(await detail("arracada-silver")).toMatchObject({ price: 95, stockSignal: "disponible" });
    expect(await detail("reloj-austin")).toMatchObject({
      variants: [
        expect.objectContaining({ id: "austin-g", stockSignal: "disponible" }),
        expect.objectContaining({ id: "austin-s", stockSignal: "agotado" }),
      ],
    });
    const catalog = (await getDoc(doc(db, "publicCatalogs", store.slug))).data();
    expect(catalog?.products.map((entry: { productSlug: string }) => entry.productSlug).sort()).toEqual([
      "arracada-silver",
      "arracada-silver-small",
      "arracada-silver-small-2",
      "reloj-austin",
    ]);
  });
});
