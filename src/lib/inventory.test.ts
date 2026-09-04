import { describe, it, expect } from "vitest";
import {
  weightedAverageCost,
  applyPurchaseLines,
  committedForProduct,
  reservationDeltas,
  reservationDeltasForOrderChange,
} from "./inventory";
import type { Product, PurchaseLine, Order } from "../types";

describe("weightedAverageCost", () => {
  it("returns the new unit cost when there is no existing stock", () => {
    expect(weightedAverageCost(undefined, 0, 5, 10)).toBe(10);
    expect(weightedAverageCost(undefined, undefined, 3, 20)).toBe(20);
  });
  it("computes weighted average with existing stock at a known cost", () => {
    // 5 units @ $10 + 5 units @ $15 = 10 units @ $12.5
    expect(weightedAverageCost(10, 5, 5, 15)).toBe(12.5);
  });
  it("treats existing stock contribution as 0 when qty is 0 or negative", () => {
    expect(weightedAverageCost(10, 0, 5, 15)).toBe(15);
    expect(weightedAverageCost(10, -2, 5, 15)).toBe(15);
  });
  it("returns new unit cost when existing cost is undefined", () => {
    expect(weightedAverageCost(undefined, 5, 5, 15)).toBe(15);
  });
});

describe("applyPurchaseLines", () => {
  const baseProduct = (o: Partial<Product> = {}): Product =>
    ({
      id: "p1",
      storeId: "s1",
      name: "Anillo",
      category: "jewelry",
      isPublic: true,
      ...o,
    }) as Product;

  it("updates quantityOnHand and cost for each matching product", () => {
    const products = [baseProduct({ id: "a", quantityOnHand: 5, cost: 10 })];
    const lines: PurchaseLine[] = [
      { productId: "a", name: "Anillo", quantity: 5, unitCost: 15 },
    ];
    const result = applyPurchaseLines(products, lines);
    expect(result.get("a")).toEqual({ quantityOnHand: 10, cost: 12.5 });
  });
  it("handles multiple lines for different products", () => {
    const products = [
      baseProduct({ id: "a", quantityOnHand: 2, cost: 10 }),
      baseProduct({ id: "b", quantityOnHand: 0, cost: undefined }),
    ];
    const lines: PurchaseLine[] = [
      { productId: "a", name: "A", quantity: 3, unitCost: 20 },
      { productId: "b", name: "B", quantity: 4, unitCost: 7 },
    ];
    const result = applyPurchaseLines(products, lines);
    expect(result.get("a")).toEqual({ quantityOnHand: 5, cost: 16 });
    expect(result.get("b")).toEqual({ quantityOnHand: 4, cost: 7 });
  });
  it("ignores lines whose product is not in the array", () => {
    const products = [baseProduct({ id: "a", quantityOnHand: 1, cost: 5 })];
    const lines: PurchaseLine[] = [
      { productId: "missing", name: "X", quantity: 10, unitCost: 3 },
    ];
    const result = applyPurchaseLines(products, lines);
    expect(result.has("missing")).toBe(false);
  });
  it("accumulates when the same product appears in two lines", () => {
    const products = [baseProduct({ id: "a", quantityOnHand: 0, cost: undefined })];
    const lines: PurchaseLine[] = [
      { productId: "a", name: "A", quantity: 2, unitCost: 10 },
      { productId: "a", name: "A", quantity: 3, unitCost: 20 },
    ];
    const result = applyPurchaseLines(products, lines);
    // Line 1: 0 -> 2@10 = 2 @ $10. Line 2: (2*10 + 3*20)/5 = 80/5 = 16, qty 5.
    expect(result.get("a")).toEqual({ quantityOnHand: 5, cost: 16 });
  });
});

describe("committedForProduct", () => {
  const order = (o: Partial<Order> = {}): Order =>
    ({
      id: "o1",
      storeId: "s1",
      customerId: "c1",
      productName: "X",
      quantity: 1,
      price: 10,
      deposit: 0,
      status: "asked",
      createdAt: "",
      updatedAt: "",
      ...o,
    }) as Order;

  it("sums quantities of open orders for a product", () => {
    const orders = [
      order({ id: "a", productId: "p1", quantity: 3, status: "confirmed" }),
      order({ id: "b", productId: "p1", quantity: 2, status: "asked" }),
      order({ id: "c", productId: "p1", quantity: 5, status: "delivered" }),
      order({ id: "d", productId: "p2", quantity: 9, status: "asked" }),
    ];
    expect(committedForProduct(orders, "s1", "p1")).toBe(5); // 3+2, not delivered
  });
  it("returns 0 when no open orders reference the product", () => {
    expect(committedForProduct([], "s1", "p1")).toBe(0);
  });
  it("ignores terminal statuses (delivered, paid)", () => {
    const orders = [
      order({ productId: "p1", quantity: 4, status: "paid" }),
      order({ productId: "p1", quantity: 1, status: "delivered" }),
    ];
    expect(committedForProduct(orders, "s1", "p1")).toBe(0);
  });
  it("does not leak across stores", () => {
    const orders = [order({ storeId: "s2", productId: "p1", quantity: 7, status: "asked" })];
    expect(committedForProduct(orders, "s1", "p1")).toBe(0);
  });
});

describe("multi-product order reservations", () => {
  const item = (productId: string, quantity: number) => ({ productId, productName: productId, quantity, unitPrice: 10, subtotal: quantity * 10 });
  const order = (orderStatus: Order["orderStatus"], items = [item("p1", 2)]): Order => ({
    id: "o1", storeId: "s1", customerId: "c1", items, deposit: 0,
    orderStatus, paymentStatus: "unpaid", createdAt: "", updatedAt: "",
  });

  it("aggregates reserve and release deltas per product", () => {
    expect(reservationDeltas([item("p1", 2), item("p2", 1)], [item("p1", 5), item("p3", 4)])).toEqual(new Map([["p1", -3], ["p2", 1], ["p3", -4]]));
  });

  it("releases on cancellation but keeps stock consumed on delivery", () => {
    const open = order("preparing");
    expect(reservationDeltasForOrderChange(open, order("cancelled"))).toEqual(new Map([["p1", 2]]));
    expect(reservationDeltasForOrderChange(open, order("delivered"))).toEqual(new Map());
    expect(reservationDeltasForOrderChange(open, order("delivered", [item("p1", 3)]))).toEqual(new Map([["p1", -1]]));
  });

  it("does not reserve a public request until the owner accepts it", () => {
    const request = order("requested");
    expect(reservationDeltasForOrderChange(undefined, request)).toEqual(new Map());
    expect(reservationDeltasForOrderChange(request, order("asked"))).toEqual(new Map([["p1", -2]]));
    expect(reservationDeltasForOrderChange(order("asked"), order("cancelled"))).toEqual(new Map([["p1", 2]]));
  });

  it("never double-consumes on the delivered→cancelled→delivered cycle", () => {
    // Contribution model: open and delivered both hold stock, cancelled holds
    // none. Cancelling a delivered sale returns the goods; re-delivering takes
    // them again — the cycle nets to a single consumption.
    const open = order("preparing");
    const delivered = order("delivered");
    const cancelled = order("cancelled");
    expect(reservationDeltasForOrderChange(delivered, cancelled)).toEqual(new Map([["p1", 2]]));
    expect(reservationDeltasForOrderChange(cancelled, delivered)).toEqual(new Map([["p1", -2]]));
    expect(reservationDeltasForOrderChange(delivered, order("preparing"))).toEqual(new Map());
    // Full cycle from creation nets exactly one reservation/consumption.
    const cycle = [
      reservationDeltasForOrderChange(undefined, open),
      reservationDeltasForOrderChange(open, delivered),
      reservationDeltasForOrderChange(delivered, cancelled),
      reservationDeltasForOrderChange(cancelled, delivered),
    ];
    const net = [...cycle.flatMap((m) => [...m]).reduce((map, [id, delta]) => map.set(id, (map.get(id) ?? 0) + delta), new Map<string, number>())];
    expect(net).toEqual([["p1", -2]]);
  });
});
