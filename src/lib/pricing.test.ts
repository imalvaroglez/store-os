import { describe, expect, it } from "vitest";
import {
  bestTierForCart,
  cartSavings,
  nextTierGap,
  suggestedPrice,
  tierQualifies,
  defaultTier,
  tiersForStore,
  CANONICAL_TIERS,
  type CartQtyLine,
} from "./pricing";
import type { PriceTierDef } from "../types";
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

// --- Carrito público: calificación de tiers (semántica del owner, 2026-08-29).
// Números del owner: Menudeo $140 / Girly $115 (desde 5 piezas) / Iconic $95
// (desde $1,000 A PRECIO ICONIC — nunca a precio menudeo).
const cartTiers: PriceTierDef[] = [
  { id: "t_retail", label: "Menudeo", order: 0 },
  { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
  { id: "t_iconic", label: "Iconic", order: 2, minAmount: 1000 },
];
const tenPieces: CartQtyLine[] = [
  { qty: 10, unitPrices: { t_retail: 140, t_girly: 115, t_iconic: 95 } },
];

describe("tierQualifies — mínimos del carrito", () => {
  it("minPieces califica por el total de piezas del carrito", () => {
    const girly = cartTiers[1];
    expect(tierQualifies(girly, [{ qty: 4, unitPrices: {} }])).toBe(false);
    expect(tierQualifies(girly, [{ qty: 3, unitPrices: {} }, { qty: 2, unitPrices: {} }])).toBe(true);
  });

  it("minAmount se evalúa al precio DEL PROPIO tier, no al menudeo", () => {
    const iconic = cartTiers[2];
    // 10 × $140 (menudeo) = $1,400 NO califican: a precio Iconic son $950.
    expect(tierQualifies(iconic, tenPieces)).toBe(false);
    // 11 × $95 = $1,045 sí.
    expect(tierQualifies(iconic, [{ qty: 11, unitPrices: tenPieces[0].unitPrices }])).toBe(true);
  });

  it("sin precio del tier en la línea no califica minAmount (conservador)", () => {
    const iconic = cartTiers[2];
    expect(tierQualifies(iconic, [{ qty: 100, unitPrices: { t_retail: 140 } }])).toBe(false);
  });

  it("un tier sin mínimos siempre califica", () => {
    expect(tierQualifies(cartTiers[0], [])).toBe(true);
  });
});

describe("bestTierForCart — el mejor tier visible que califica", () => {
  it("devuelve el primero por order que cumpla sus mínimos", () => {
    expect(bestTierForCart(cartTiers, tenPieces)?.id).toBe("t_girly");
    expect(bestTierForCart(cartTiers, [{ qty: 11, unitPrices: tenPieces[0].unitPrices }])?.id).toBe("t_iconic");
    expect(bestTierForCart(cartTiers, [{ qty: 2, unitPrices: tenPieces[0].unitPrices }])?.id).toBe("t_retail");
  });
});

describe("cartSavings — ahorro frente a menudeo", () => {
  it("Σ cantidad × (precio base − precio del tier)", () => {
    expect(cartSavings(cartTiers[1], "t_retail", tenPieces)).toBe(250); // 10 × (140 − 115)
  });
});

describe("nextTierGap — cuánto falta para el siguiente tier", () => {
  it("traduce la brecha en piezas enteras y valor a precio menudeo", () => {
    const gap = nextTierGap(cartTiers[2], "t_retail", tenPieces);
    // Faltan $50 a precio Iconic → 1 pieza más ($95 de gasto extra) = $140 de producto a menudeo.
    expect(gap).toEqual({ piecesMore: 1, extraSpend: 95, extraValueAtBase: 140 });
  });

  it("devuelve null cuando el tier ya califica o no aplica", () => {
    expect(nextTierGap(cartTiers[2], "t_retail", [{ qty: 11, unitPrices: tenPieces[0].unitPrices }])).toBeNull();
    expect(nextTierGap(cartTiers[0], "t_retail", tenPieces)).toBeNull(); // sin mínimos
  });
});
