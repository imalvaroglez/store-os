import { describe, expect, it } from "vitest";
import {
  bestTierForCart,
  calculateOrderPricing,
  cartSavings,
  suggestedPrice,
  tierQualifies,
  defaultTier,
  tiersForStore,
  CANONICAL_TIERS,
  REGULAR_TIER_ID,
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
// Números del owner: Regular $140 / Girly $120 (desde 5 piezas) / Iconic $90
// (desde $1,000 A PRECIO ICONIC — nunca a precio menudeo).
const cartTiers: PriceTierDef[] = [
  { id: "t_retail", label: "Regular", order: 0 },
  { id: "t_girly", label: "Girly", order: 1, minPieces: 5 },
  { id: "t_iconic", label: "Iconic", order: 2, minAmount: 1000 },
];
const tenPieces: CartQtyLine[] = [
  { qty: 10, unitPrices: { t_retail: 140, t_girly: 120, t_iconic: 90 } },
];

describe("tierQualifies — mínimos del carrito", () => {
  it("minPieces califica por el total de piezas del carrito", () => {
    const girly = cartTiers[1];
    expect(tierQualifies(girly, [{ qty: 4, unitPrices: {} }])).toBe(false);
    expect(tierQualifies(girly, [{ qty: 3, unitPrices: {} }, { qty: 2, unitPrices: {} }])).toBe(true);
  });

  it("minAmount se evalúa al precio DEL PROPIO tier, no al menudeo", () => {
    const iconic = cartTiers[2];
    // 11 × $140 (Regular) = $1,540 NO califican: a precio Iconic son $990.
    expect(tierQualifies(iconic, [{ qty: 11, unitPrices: tenPieces[0].unitPrices }])).toBe(false);
    // 12 × $90 = $1,080 sí.
    expect(tierQualifies(iconic, [{ qty: 12, unitPrices: tenPieces[0].unitPrices }])).toBe(true);
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
    expect(bestTierForCart(cartTiers, [{ qty: 12, unitPrices: tenPieces[0].unitPrices }])?.id).toBe("t_iconic");
    expect(bestTierForCart(cartTiers, [{ qty: 2, unitPrices: tenPieces[0].unitPrices }])?.id).toBe("t_retail");
  });
});

describe("cartSavings — ahorro frente a menudeo", () => {
  it("Σ cantidad × (precio base − precio del tier)", () => {
    expect(cartSavings(cartTiers[1], "t_retail", tenPieces)).toBe(200); // 10 × (140 − 120)
  });
});

describe("calculateOrderPricing — resumen canónico del pedido", () => {
  it("resuelve Regular, Girly e Iconic con subtotales reales", () => {
    const one = calculateOrderPricing(cartTiers, [{ qty: 1, unitPrices: tenPieces[0].unitPrices }])!;
    expect(one.activeTier.tier.id).toBe("t_retail");
    expect(one.estimatedSubtotal).toBe(140);
    expect(one.tiers.find((entry) => entry.tier.id === "t_girly")?.piecesRemaining).toBe(4);
    expect(one.aspirationalTier.amountRemaining).toBe(910);

    const five = calculateOrderPricing(cartTiers, [{ qty: 5, unitPrices: tenPieces[0].unitPrices }])!;
    expect(five.activeTier.tier.id).toBe("t_girly");
    expect(five.estimatedSubtotal).toBe(600);
    expect(five.savingsVsBase).toBe(100);

    const eleven = calculateOrderPricing(cartTiers, [{ qty: 11, unitPrices: tenPieces[0].unitPrices }])!;
    expect(eleven.activeTier.tier.id).toBe("t_girly");
    expect(eleven.aspirationalTier.subtotal).toBe(990);
    expect(eleven.aspirationalTier.amountRemaining).toBe(10);

    const twelve = calculateOrderPricing(cartTiers, [{ qty: 12, unitPrices: tenPieces[0].unitPrices }])!;
    expect(twelve.activeTier.tier.id).toBe("t_iconic");
    expect(twelve.estimatedSubtotal).toBe(1080);
    expect(twelve.savingsVsBase).toBe(600);
  });

  it("Iconic tiene prioridad aunque no se hayan desbloqueado 5 piezas", () => {
    const expensive = [{ qty: 2, unitPrices: { t_retail: 700, t_girly: 650, t_iconic: 600 } }];
    expect(calculateOrderPricing(cartTiers, expensive)?.activeTier.tier.id).toBe("t_iconic");
  });

  it("no calcula un subtotal parcial cuando falta un precio público", () => {
    expect(calculateOrderPricing(cartTiers, [
      { qty: 1, unitPrices: { t_retail: 140, t_girly: 120 } },
    ])).toBeNull();
  });

  it("usa Regular por id estable aunque el arreglo llegue reordenado", () => {
    const reordered = [cartTiers[2], cartTiers[0], cartTiers[1]];
    const pricing = calculateOrderPricing(reordered, [{ qty: 5, unitPrices: tenPieces[0].unitPrices }])!;

    expect(REGULAR_TIER_ID).toBe("t_retail");
    expect(pricing.baseTier.tier.id).toBe(REGULAR_TIER_ID);
    expect(pricing.savingsVsBase).toBe(100);
  });

  it("usa el primer tier visible como fallback para tiendas sin Regular canónico", () => {
    const customTiers = cartTiers.filter((tier) => tier.id !== REGULAR_TIER_ID);
    const pricing = calculateOrderPricing(customTiers, [{ qty: 5, unitPrices: tenPieces[0].unitPrices }])!;

    expect(pricing.baseTier.tier.id).toBe("t_girly");
  });
});
