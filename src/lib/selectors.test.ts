import { describe, it, expect } from "vitest";
import {
  productsForStore,
  publicProductsForStore,
  ordersForStore,
  customersForStore,
  suppliersForStore,
  purchasesForStore,
  productsToRestock,
} from "./selectors";
import { fixtureState } from "./testFixtures";
import type { Supplier, Purchase, Product } from "../types";

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


describe("productsToRestock (stock alerts)", () => {
  const stock = (
    id: string,
    storeId: string,
    quantityOnHand: number | undefined,
    lowStockAt?: number
  ): Product => ({ id, storeId, name: id, quantityOnHand, lowStockAt }) as Product;

  it("includes agotado and low stock, worst first", () => {
    const all = [
      stock("healthy", "s1", 10),
      stock("low_default", "s1", 2), // no threshold saved → default applies
      stock("out", "s1", 0),
      stock("shortage", "s1", -3),
      stock("low_explicit", "s1", 5, 5),
      stock("above_explicit", "s1", 5, 2),
    ];
    expect(productsToRestock(all, "s1").map((p) => p.id)).toEqual([
      "shortage",
      "out",
      "low_default",
      "low_explicit",
    ]);
  });

  it("no alert for untracked stock (on-demand stores) and other stores' products", () => {
    const state = fixtureState(); // Santi is on_demand
    const all = [
      ...state.products, // includes Santi's untracked product
      stock("olivia_out", "store_olivia", 0),
    ];
    const restock = productsToRestock(all, "store_olivia");
    expect(restock.map((p) => p.id)).toEqual(["olivia_out"]);
    // The on-demand store itself derives nothing.
    expect(productsToRestock(all, "store_santi")).toEqual([]);
  });

  // #365: color designs disappeared from "Por surtir" because the alert read
  // only the (erased) design-level quantityOnHand. Same aggregate as the card
  // (totalStock) — and the urgency ORDER must use it too, or a design at −3
  // sorts as if it had none.
  it("#365 includes color designs by variant aggregate, worst first", () => {
    const design = (id: string, quantities: Array<number | undefined>): Product =>
      ({
        id,
        storeId: "s1",
        name: id,
        quantityOnHand: undefined,
        variants: quantities.map((quantityOnHand, i) => ({
          id: `v${i}`,
          color: `Color ${i}`,
          quantityOnHand,
        })),
      }) as Product;
    const all = [
      stock("plain_out", "s1", 0),
      design("color_negative", [-4, 1]), // aggregate −3, worst of all
      design("color_out", [0, 0]),
      design("color_low", [2, 0]), // aggregate 2 ≤ default 3
      design("color_healthy", [10, 5]),
      design("color_untracked", [undefined, undefined]), // sin dato, never 0
    ];
    expect(productsToRestock(all, "s1").map((p) => p.id)).toEqual([
      "color_negative",
      "plain_out", // ties with color_out at 0; stable sort keeps DOM-agnostic insertion order
      "color_out",
      "color_low",
    ]);
  });
});
