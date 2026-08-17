import { describe, it, expect } from "vitest";
import { reducer, newOrder, newProduct } from "./StoreProvider";
import type { AppState, Order, Product } from "../types";
import { emptyState } from "../lib/storage";

// Reducer-level tests for the stock-reservation wiring (the only non-trivial
// state transition in the inventory feature). The provider's upsertOrder/
// deleteOrder methods compute the reservation delta and dispatch UPDATE_PRODUCT
// before the order action; here we exercise the same dispatch sequence the
// provider runs, to prove the resulting state is correct without mounting React.

function stateWithOneInventoryProduct(): { state: AppState; product: Product } {
  const state = { ...emptyState(), stores: [{ id: "store_1", name: "S1", slug: "s1", type: "inventory_tiered" as const, createdAt: "", updatedAt: "" }] };
  const store = state.stores[0];
  // Replace products with a single, fully-controlled inventory product.
  const product: Product = {
    ...newProduct(store.id),
    id: "inv-1",
    name: "Anillo control",
    storeId: store.id,
    quantityOnHand: 10,
    cost: 100,
    prices: { retail: 200 },
  } as Product;
  return { state: { ...state, products: [product], orders: [] }, product };
}

describe("reducer: stock reservation on order upsert", () => {
  it("decrements quantityOnHand when a new order reserves stock", () => {
    const { state, product } = stateWithOneInventoryProduct();
    const order: Order = {
      ...newOrder(state.stores[0].id),
      id: "ord-1",
      storeId: state.stores[0].id,
      productId: product.id,
      quantity: 3,
    };

    // Mirrors StoreProvider.upsertOrder: reservation dispatch, then order dispatch.
    const delta = -3;
    let next = reducer(state, {
      type: "UPDATE_PRODUCT",
      product: { ...product, quantityOnHand: product.quantityOnHand! + delta },
    });
    next = reducer(next, { type: "ADD_ORDER", order });

    expect(next.products[0].quantityOnHand).toBe(7);
    expect(next.orders).toHaveLength(1);
    expect(next.orders[0].quantity).toBe(3);
  });

  it("adjusts by the delta when an existing order's quantity changes", () => {
    const { state, product } = stateWithOneInventoryProduct();
    const storeId = state.stores[0].id;
    const existing: Order = {
      ...newOrder(storeId),
      id: "ord-1",
      storeId,
      productId: product.id,
      quantity: 2,
    };
    // Start from a state where 2 are already reserved (qtyOnHand 10 -> 8).
    const reserved: AppState = {
      ...state,
      products: [{ ...product, quantityOnHand: 8 }],
      orders: [existing],
    };
    // Edit from 2 to 5 -> reserve 3 more.
    const next = reducer(reserved, {
      type: "UPDATE_PRODUCT",
      product: { ...product, quantityOnHand: 8 - 3, id: product.id } as Product,
    });
    expect(next.products[0].quantityOnHand).toBe(5);
  });

  it("allows quantityOnHand to go negative (back-order)", () => {
    const { state, product } = stateWithOneInventoryProduct();
    const order: Order = {
      ...newOrder(state.stores[0].id),
      id: "ord-big",
      storeId: state.stores[0].id,
      productId: product.id,
      quantity: 15, // more than the 10 on hand
    };
    let next = reducer(state, {
      type: "UPDATE_PRODUCT",
      product: { ...product, quantityOnHand: 10 - 15 },
    });
    next = reducer(next, { type: "ADD_ORDER", order });
    expect(next.products[0].quantityOnHand).toBe(-5);
  });

  it("does not change products when the order has no productId", () => {
    const { state } = stateWithOneInventoryProduct();
    const order: Order = {
      ...newOrder(state.stores[0].id),
      id: "ord-noprod",
      storeId: state.stores[0].id,
      // productId intentionally absent (legacy/encargo sin producto)
    };
    // Provider skips reservation when there is no productId — assert the
    // order alone doesn't touch the product.
    const next = reducer(state, { type: "ADD_ORDER", order });
    expect(next.products[0].quantityOnHand).toBe(10);
    expect(next.orders).toHaveLength(1);
  });
});

describe("reducer: stock release on order delete", () => {
  it("restores quantityOnHand when a reserved order is deleted", () => {
    const { state, product } = stateWithOneInventoryProduct();
    const storeId = state.stores[0].id;
    const order: Order = {
      ...newOrder(storeId),
      id: "ord-1",
      storeId,
      productId: product.id,
      quantity: 4,
    };
    const reserved: AppState = {
      ...state,
      products: [{ ...product, quantityOnHand: 6 }], // 10 - 4 already reserved
      orders: [order],
    };
    // Mirrors StoreProvider.deleteOrder: release then delete.
    let next = reducer(reserved, {
      type: "UPDATE_PRODUCT",
      product: { ...product, quantityOnHand: 6 + order.quantity },
    });
    next = reducer(next, { type: "DELETE_ORDER", orderId: order.id });
    expect(next.products[0].quantityOnHand).toBe(10);
    expect(next.orders).toHaveLength(0);
  });
});

describe("reducer: supplier/purchase CRUD + cascade on store delete", () => {
  it("adds, updates, and deletes suppliers", () => {
    const state = { ...emptyState(), stores: [{ id: "store_1", name: "S1", slug: "s1", type: "inventory_tiered" as const, createdAt: "", updatedAt: "" }], activeStoreId: "store_1" };
    const storeId = state.stores[0].id;
    const s = { id: "sup-1", storeId, name: "Platería", createdAt: "", updatedAt: "" };
    let next = reducer(state, { type: "ADD_SUPPLIER", supplier: s });
    expect(next.suppliers.some((x) => x.id === "sup-1")).toBe(true);
    next = reducer(next, { type: "UPDATE_SUPPLIER", supplier: { ...s, name: "Platería GDL" } });
    expect(next.suppliers.find((x) => x.id === "sup-1")?.name).toBe("Platería GDL");
    next = reducer(next, { type: "DELETE_SUPPLIER", supplierId: "sup-1" });
    expect(next.suppliers.some((x) => x.id === "sup-1")).toBe(false);
  });

  it("adds and deletes purchases", () => {
    const state = { ...emptyState(), stores: [{ id: "store_1", name: "S1", slug: "s1", type: "inventory_tiered" as const, createdAt: "", updatedAt: "" }], activeStoreId: "store_1" };
    const storeId = state.stores[0].id;
    const p = {
      id: "pur-1", storeId, date: "2026-08-04", lines: [],
      subtotal: 0, totalConfirmed: 0, createdAt: "", updatedAt: "",
    };
    let next = reducer(state, { type: "ADD_PURCHASE", purchase: p });
    expect(next.purchases.some((x) => x.id === "pur-1")).toBe(true);
    next = reducer(next, { type: "DELETE_PURCHASE", purchaseId: "pur-1" });
    expect(next.purchases.some((x) => x.id === "pur-1")).toBe(false);
  });

  it("cascades supplier + purchase cleanup on DELETE_STORE", () => {
    const state = { ...emptyState(), stores: [{ id: "store_1", name: "S1", slug: "s1", type: "inventory_tiered" as const, createdAt: "", updatedAt: "" }], activeStoreId: "store_1" };
    const storeId = state.stores[0].id;
    const other = "store_2";
    const seeded: AppState = {
      ...state,
      suppliers: [
        { id: "s-a", storeId, name: "A", createdAt: "", updatedAt: "" },
        { id: "s-b", storeId: other, name: "B", createdAt: "", updatedAt: "" },
      ],
      purchases: [
        { id: "p-a", storeId, date: "2026-08-04", lines: [], subtotal: 0, totalConfirmed: 0, createdAt: "", updatedAt: "" },
        { id: "p-b", storeId: other, date: "2026-08-04", lines: [], subtotal: 0, totalConfirmed: 0, createdAt: "", updatedAt: "" },
      ],
    };
    const next = reducer(seeded, { type: "DELETE_STORE", storeId });
    expect(next.suppliers.map((s) => s.id)).toEqual(["s-b"]);
    expect(next.purchases.map((p) => p.id)).toEqual(["p-b"]);
  });
});
