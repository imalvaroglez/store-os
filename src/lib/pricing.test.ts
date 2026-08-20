import { describe, expect, it } from "vitest";
import { defaultTier, suggestedPrice, tiersForStore, CANONICAL_TIERS } from "./pricing";
import { migrateCatalog } from "./catalog";
import { CURRENT_PRODUCT_SCHEMA_VERSION } from "../types";
import type { AppState, Store, Product, Order } from "../types";

describe("suggestedPrice", () => {
  it("applies markup over cost, rounded to whole MXN", () => {
    expect(suggestedPrice(500, { kind: "markup", percent: 120 })).toBe(1100);
    expect(suggestedPrice(99.6, { kind: "markup", percent: 50 })).toBe(149);
  });
  it("is undefined without cost or rule", () => {
    expect(suggestedPrice(undefined, { kind: "markup", percent: 100 })).toBeUndefined();
    expect(suggestedPrice(100, undefined)).toBeUndefined();
  });
});

describe("tiersForStore / defaultTier", () => {
  const store = {
    priceTiers: [
      { id: "t_b", label: "Mayoreo", order: 1 },
      { id: "t_a", label: "Menudeo", order: 0, hidden: true },
      { id: "t_c", label: "Emprendedora", order: 2 },
    ],
    defaultTierId: "t_b",
  } as unknown as Store;

  it("returns visible tiers ordered, hiding hidden ones", () => {
    expect(tiersForStore(store).map((t) => t.id)).toEqual(["t_b", "t_c"]);
  });
  it("falls back to the canonical 3 when the store has none", () => {
    expect(tiersForStore({}).map((t) => t.id)).toEqual(CANONICAL_TIERS.map((t) => t.id));
  });
  it("defaultTier never returns a hidden or missing tier", () => {
    expect(defaultTier(store)?.id).toBe("t_b");
    expect(defaultTier({ ...store, defaultTierId: "t_a" })?.id).toBe("t_b"); // hidden → fallback
    expect(defaultTier({ ...store, defaultTierId: "nope" })?.id).toBe("t_b"); // missing → fallback
  });
});

describe("migrateCatalog — scalable pricing (v2)", () => {
  function legacyState() {
    const store: Store = {
      id: "s1", name: "S", slug: "s", type: "inventory_tiered",
      createdAt: "", updatedAt: "",
    };
    const product = {
      id: "p1", storeId: "s1", name: "X", category: "jewelry" as const,
      isPublic: true,
      prices: { retail: 100, wholesale: 80 },
      createdAt: "", updatedAt: "",
    } as unknown as Product;
    const order = {
      id: "o1", storeId: "s1", customerId: "c1", productName: "X",
      quantity: 1, price: 100, deposit: 0, status: "asked" as const,
      priceTier: "wholesale", createdAt: "", updatedAt: "",
    } as unknown as Order;
    return { stores: [store], products: [product], orders: [order] } as unknown as AppState;
  }

  it("migrates store tiers, product price keys, and order tier ids", () => {
    const out = migrateCatalog(legacyState());
    expect(out.stores[0].priceTiers?.map((t) => t.id)).toEqual(["t_retail", "t_wholesale", "t_reseller"]);
    expect(out.stores[0].defaultTierId).toBe("t_retail");
    const p = out.products[0];
    expect(p.schemaVersion).toBe(CURRENT_PRODUCT_SCHEMA_VERSION);
    expect(p.prices).toEqual({ t_retail: 100, t_wholesale: 80 });
    expect(out.orders[0].priceTier).toBe("t_wholesale");
  });

  it("is idempotent and keeps references for unchanged docs", () => {
    const first = migrateCatalog(legacyState());
    const second = migrateCatalog(first);
    expect(second).toBe(first); // fully no-op returns the same state object
    expect(second.stores[0]).toBe(first.stores[0]);
    expect(second.products[0]).toBe(first.products[0]);
    expect(second.orders[0]).toBe(first.orders[0]);
  });
});
