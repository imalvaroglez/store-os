import { describe, it, expect } from "vitest";
import {
  productsForStore,
  publicProductsForStore,
  ordersForStore,
  customersForStore,
} from "./selectors";
import { buildSeedState } from "./seed";

describe("store isolation", () => {
  const state = buildSeedState();
  const santi = state.stores.find((s) => s.slug === "santi")!;
  const joyeria = state.stores.find((s) => s.slug === "joyeria")!;

  it("products are isolated per store", () => {
    const santiProducts = productsForStore(state.products, santi.id);
    const joyeriaProducts = productsForStore(state.products, joyeria.id);
    expect(santiProducts.every((p) => p.storeId === santi.id)).toBe(true);
    expect(joyeriaProducts.every((p) => p.storeId === joyeria.id)).toBe(true);
    // A product in Santi must not appear in Joyería.
    const santiIds = new Set(santiProducts.map((p) => p.id));
    expect(joyeriaProducts.some((p) => santiIds.has(p.id))).toBe(false);
  });

  it("orders are isolated per store", () => {
    const santiOrders = ordersForStore(state.orders, santi.id);
    expect(santiOrders.length).toBeGreaterThan(0);
    expect(santiOrders.every((o) => o.storeId === santi.id)).toBe(true);
  });

  it("customers are isolated per store", () => {
    const joyeriaCustomers = customersForStore(state.customers, joyeria.id);
    expect(joyeriaCustomers.every((c) => c.storeId === joyeria.id)).toBe(true);
  });
});

describe("public catalog filtering", () => {
  const state = buildSeedState();
  const joyeria = state.stores.find((s) => s.slug === "joyeria")!;

  it("only shows isPublic products", () => {
    const pub = publicProductsForStore(state.products, joyeria.id);
    expect(pub.every((p) => p.isPublic)).toBe(true);
    // The private "Anillo grabado" must be excluded.
    expect(pub.some((p) => p.privateNotes && !p.isPublic)).toBe(false);
    expect(pub.some((p) => p.name.includes("privado"))).toBe(false);
  });

  it("filters by store too", () => {
    const pub = publicProductsForStore(state.products, joyeria.id);
    expect(pub.every((p) => p.storeId === joyeria.id)).toBe(true);
  });
});
