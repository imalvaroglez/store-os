// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { buildPublicCatalogDoc } from "./firestoreData";
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
