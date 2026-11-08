// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// Capture Firestore writes without a backend: republishStockSignals must be
// read-free (no getDocs) and idempotent (recomputed, merge-only on details).
const setDoc = vi.fn();
const docRef = vi.fn();
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/firestore")>()),
  setDoc: (...args: unknown[]) => setDoc(...args),
  doc: (...args: unknown[]) => {
    docRef(...args);
    return { path: args.join("/"), id: String(args[args.length - 1]) };
  },
}));
vi.mock("./config", () => ({ getFirebase: () => ({ db: {} }) }));

import { buildPublicCatalogDoc, republishStockSignals } from "./firestoreData";
import type { Category, Product, Store } from "../../types";

const store: Store = { id: "s1", name: "S1", slug: "s1", type: "inventory_tiered", createdAt: "", updatedAt: "" };
const product = (id: string, overrides: Partial<Product> = {}): Product => ({
  id, storeId: "s1", name: `Pieza ${id}`, category: "jewelry", isPublic: true, slug: `pieza-${id}`,
  status: "published", createdAt: "", updatedAt: "", ...overrides,
});
const categories: Category[] = [];

describe("buildPublicCatalogDoc (#229)", () => {
  it("recomputes every published product's stock signal from the canonical products", () => {
    const doc = buildPublicCatalogDoc(store, [
      product("a", { quantityOnHand: 0, lowStockAt: 2 }),
      product("b", { quantityOnHand: 5 }),
      product("c", { isPublic: false, status: "draft" }), // not published → excluded
    ], categories);
    const signals = Object.fromEntries((doc.products as Array<{ productSlug: string; stockSignal: string }>).map((p) => [p.productSlug, p.stockSignal]));
    expect(signals).toEqual({ "pieza-a": "agotado", "pieza-b": "disponible" });
  });
});

describe("republishStockSignals (#229)", () => {
  it("rewrites the catalog doc once and patches ONLY the changed published details", async () => {
    setDoc.mockClear();
    docRef.mockClear();
    const changed = ["a", "hidden"];
    await republishStockSignals(store, [
      product("a", { quantityOnHand: 0 }),
      product("b", { quantityOnHand: 5 }),
      product("hidden", { isPublic: false, status: "draft", slug: "no-publicado" }),
    ], categories, changed);

    const calls = setDoc.mock.calls as unknown as Array<[unknown, unknown, unknown?]>;
    const paths = docRef.mock.calls.map((c) => c.join("/"));
    // 1 catalog write + 1 detail merge (published & changed only).
    expect(paths.filter((p) => p.includes("publicCatalogs"))).toHaveLength(1);
    expect(paths.filter((p) => p.includes("publicProducts"))).toEqual([expect.stringContaining("publicProducts/s1__pieza-a")]);
    const catalog = calls[0][1] as { products: Array<{ productSlug: string; stockSignal: string }> };
    expect(catalog.products.find((p) => p.productSlug === "pieza-a")?.stockSignal).toBe("agotado");
    const detail = calls[1];
    expect(detail[1]).toEqual({ stockSignal: "agotado" });
    expect(detail[2]).toEqual({ merge: true });
  });

  it("is read-free: no queries against publicProducts", async () => {
    // getDocs would appear as an import-time spy target; the mock spreads the
    // original module, so any getDocs call would hit Firestore. Assert the
    // write count instead: an agotado→disponible flip retries as the same two writes.
    setDoc.mockClear();
    await republishStockSignals(store, [product("a", { quantityOnHand: 3 })], categories, ["a"]);
    await republishStockSignals(store, [product("a", { quantityOnHand: 3 })], categories, ["a"]);
    expect(setDoc).toHaveBeenCalledTimes(4); // 2 runs × (1 catalog + 1 detail), zero reads
  });
});
