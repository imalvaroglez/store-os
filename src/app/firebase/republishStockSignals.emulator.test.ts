import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, Store } from "../../types";
import { FIREBASE_DEV_PROJECT_ID } from "./projectIds";

type TestFirestore = ReturnType<RulesTestContext["firestore"]>;
const config = vi.hoisted(() => ({ db: null as TestFirestore | null }));
vi.mock("./config", () => ({ getFirebase: () => config }));
import { PurchaseAlreadyReceived, receivePurchaseTx, republishStockSignals } from "./firestoreData";

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
        ownerUid: "stock-owner", memberUids: ["stock-member"],
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
});
