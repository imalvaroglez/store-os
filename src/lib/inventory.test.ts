import { describe, it, expect } from "vitest";
import {
  weightedAverageCost,
  applyPurchaseLines,
  committedForProduct,
  reservationDeltas,
  reservationDeltasForOrderChange,
  DEFAULT_LOW_STOCK_AT,
  effectiveLowStockAt,
  stockAlertLevel,
  stockAlertText,
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

describe("stockAlertLevel", () => {
  const tracked = (quantityOnHand: number | undefined, lowStockAt?: number): Product =>
    ({ quantityOnHand, lowStockAt }) as Product;

  it("flags stock at or below the explicit per-product threshold as low", () => {
    expect(stockAlertLevel(tracked(5, 5))).toBe("low");
    expect(stockAlertLevel(tracked(2, 5))).toBe("low");
  });

  it("does not alert when stock is above the explicit threshold", () => {
    expect(stockAlertLevel(tracked(6, 5))).toBeNull();
  });

  it("falls back to the default threshold when the product has none saved", () => {
    expect(stockAlertLevel(tracked(DEFAULT_LOW_STOCK_AT))).toBe("low");
    expect(stockAlertLevel(tracked(DEFAULT_LOW_STOCK_AT + 1))).toBeNull();
    expect(stockAlertLevel(tracked(undefined, 5))).toBeNull(); // no tracking, no alert
  });

  it("flags zero and negative stock as out even without a threshold", () => {
    expect(stockAlertLevel(tracked(0))).toBe("out");
    expect(stockAlertLevel(tracked(-2))).toBe("out");
    expect(stockAlertLevel(tracked(0, 100))).toBe("out");
  });

  it("ignores non-finite legacy thresholds (never NaN into the alert)", () => {
    expect(effectiveLowStockAt({ lowStockAt: Number.NaN })).toBe(DEFAULT_LOW_STOCK_AT);
    expect(stockAlertLevel(tracked(1, Number.NaN))).toBe("low");
  });

  it("renders clear Spanish text per level", () => {
    expect(stockAlertText({ quantityOnHand: 0 })).toBe("Agotado");
    expect(stockAlertText({ quantityOnHand: -2 })).toBe("Faltan 2");
    expect(stockAlertText({ quantityOnHand: 2 })).toBe("Quedan 2");
  });
});

describe("installment-order stock holding (#165)", () => {
  const item = (productId: string, quantity: number) => ({ productId, productName: productId, quantity, unitPrice: 10, subtotal: quantity * 10 });
  const plan = { count: 3, frequency: "monthly" as const, firstDueDate: "2026-11-15", agreedAt: "", agreedBy: "u1" };
  const planOrder = (o: Partial<Order> = {}): Order => ({
    id: "o1", storeId: "s1", customerId: "c1", items: [item("p1", 2)], deposit: 0,
    orderStatus: "confirmed", paymentStatus: "unpaid", createdAt: "", updatedAt: "",
    installments: plan,
    ...o,
  });

  it("a plan order reserves AT CREATION like an ordinary one (PO 2026-11-03 R8)", () => {
    expect(reservationDeltasForOrderChange(undefined, planOrder())).toEqual(new Map([["p1", -2]]));
    // Open-status churn moves nothing while held.
    expect(reservationDeltasForOrderChange(planOrder(), planOrder({ orderStatus: "ready" }))).toEqual(new Map());
    // Item edits move only the difference.
    expect(reservationDeltasForOrderChange(planOrder(), planOrder({ items: [item("p1", 5)] }))).toEqual(new Map([["p1", -3]]));
    // Cancelling a plan order WITHOUT received money releases the pieces.
    expect(reservationDeltasForOrderChange(planOrder(), { ...planOrder(), orderStatus: "cancelled" })).toEqual(new Map([["p1", 2]]));
  });

  it("money-backed pieces stay held — even on cancellation (witness or accumulator)", () => {
    const reserved = planOrder({ installmentsReservedAt: "2026-11-02T10:00:00.000Z" });
    // Cancelling must not release stock by inference: money was received.
    expect(reservationDeltasForOrderChange(reserved, { ...reserved, orderStatus: "cancelled" })).toEqual(new Map());
    expect(reservationDeltasForOrderChange(reserved, { ...reserved, orderStatus: "delivered" })).toEqual(new Map());
    // Item changes while held still apply the difference.
    expect(reservationDeltasForOrderChange(reserved, planOrder({ installmentsReservedAt: "2026-11-02T10:00:00.000Z", items: [item("p1", 3)] }))).toEqual(new Map([["p1", -1]]));
    // Money in the accumulator holds the pieces even without the witness.
    const paid = planOrder({ paymentsReceivedCents: 10000 });
    expect(reservationDeltasForOrderChange(paid, { ...paid, orderStatus: "cancelled" })).toEqual(new Map());
  });

  it("converting an ordinary open order to a plan keeps holding the pieces (R8)", () => {
    const ordinary = { ...planOrder(), installments: undefined } as Order;
    expect(reservationDeltasForOrderChange(ordinary, planOrder())).toEqual(new Map());
  });
});

describe("installment reservation visibility and identity (#171 C3)", () => {
  const plan = { count: 2, frequency: "monthly" as const, firstDueDate: "2026-11-15", agreedAt: "2026-11-01", agreedBy: "u1" };
  const make = (overrides: Partial<Order> = {}): Order => ({
    id: "reserved", storeId: "s1", customerId: "c1", deposit: 0,
    items: [{ lineId: "line", productId: "p1", productName: "Caja", quantity: 2, unitPrice: 50, subtotal: 100 }],
    orderStatus: "asked", paymentStatus: "unpaid", createdAt: "", updatedAt: "",
    installments: plan, ...overrides,
  });
  it("does not commit stock before the first abono", () => {
    expect(committedForProduct([make()], "s1", "p1")).toBe(0);
  });
  it("shows retained cancelled reservations but excludes delivered and foreign orders", () => {
    const reserved = { installmentsReservedAt: "2026-11-02" };
    expect(committedForProduct([
      make({ ...reserved, orderStatus: "cancelled" }),
      make({ ...reserved, id: "delivered", orderStatus: "delivered" }),
      make({ ...reserved, id: "foreign", storeId: "s2" }),
    ], "s1", "p1")).toBe(2);
  });
  it("removing the plan keeps the reservation's identity and quantity", () => {
    const previous = make({ installmentsReservedAt: "2026-11-02", orderStatus: "cancelled" });
    const next = { ...previous, installments: undefined };
    expect(reservationDeltasForOrderChange(previous, next).size).toBe(0);
    expect(committedForProduct([next], "s1", "p1")).toBe(2);
  });
});
