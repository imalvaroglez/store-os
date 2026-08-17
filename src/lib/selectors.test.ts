import { describe, it, expect } from "vitest";
import {
  productsForStore,
  publicProductsForStore,
  ordersForStore,
  customersForStore,
  suppliersForStore,
  purchasesForStore,
  committedForProduct,
} from "./selectors";
import { fixtureState } from "./testFixtures";
import type { Supplier, Purchase, Order } from "../types";

describe("store isolation", () => {
  const state = fixtureState();
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
  const state = fixtureState();
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

describe("suppliers / purchases isolation", () => {
  const supplier = (storeId: string, id: string): Supplier => ({
    id, storeId, name: `S-${id}`, createdAt: "", updatedAt: "",
  });
  const purchase = (storeId: string, id: string): Purchase => ({
    id, storeId, date: "2026-08-04", lines: [], subtotal: 0, totalConfirmed: 0,
    createdAt: "", updatedAt: "",
  });

  it("suppliersForStore keeps only the store's suppliers", () => {
    const all = [supplier("s1", "a"), supplier("s2", "b"), supplier("s1", "c")];
    expect(suppliersForStore(all, "s1").map((s) => s.id)).toEqual(["a", "c"]);
    expect(suppliersForStore(all, "s2").map((s) => s.id)).toEqual(["b"]);
  });

  it("purchasesForStore keeps only the store's purchases", () => {
    const all = [purchase("s1", "p1"), purchase("s2", "p2")];
    expect(purchasesForStore(all, "s1").map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("committedForProduct re-export", () => {
  // Confirms the selector barrel delegates to inventory.committedForProduct
  // and stays store-scoped (the cross-tenant invariant from firestore memory).
  const order = (o: Partial<Order>): Order =>
    ({
      id: "o", storeId: "s1", customerId: "c", productName: "X",
      quantity: 1, price: 10, deposit: 0, status: "asked",
      createdAt: "", updatedAt: "",
      ...o,
    }) as Order;

  it("sums open orders for the product in the store", () => {
    const orders = [
      order({ id: "a", productId: "p1", quantity: 3, status: "confirmed" }),
      order({ id: "b", productId: "p1", quantity: 2, status: "delivered" }),
      order({ id: "c", storeId: "s2", productId: "p1", quantity: 9, status: "asked" }),
    ];
    expect(committedForProduct(orders, "s1", "p1")).toBe(3);
  });

  it("returns 0 when nothing matches", () => {
    expect(committedForProduct([], "s1", "p1")).toBe(0);
  });
});
