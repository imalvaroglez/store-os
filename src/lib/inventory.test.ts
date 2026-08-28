import { describe, it, expect } from "vitest";
import {
  weightedAverageCost,
  applyPurchaseLines,
  committedForProduct,
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

