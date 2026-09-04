import { describe, expect, it } from "vitest";
import type { Order } from "../types";
import {
  effectiveOrderStatus,
  migrateOrder,
  migrateOrders,
  orderBucket,
  orderCountsTowardToPay,
  orderReference,
  orderTotals,
  paymentStatusForOrder,
  tierWarning,
} from "./orders";

const base = (patch: Partial<Order> = {}): Order => ({
  id: "order_abc-123",
  storeId: "store_1",
  customerId: "customer_1",
  items: [{ productName: "Anillo", quantity: 2, unitPrice: 150, subtotal: 300 }],
  deposit: 100,
  orderStatus: "confirmed",
  paymentStatus: "partial",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  schemaVersion: 2,
  ...patch,
});

describe("order domain helpers", () => {
  it("derives total, paid, balance and payment status from frozen snapshots", () => {
    const order = base({ items: [
      { productId: "p1", productName: "A", quantity: 2, unitPrice: 100, subtotal: 999 },
      { productId: "p2", productName: "B", quantity: 1, unitPrice: 250, subtotal: 1 },
    ], deposit: 450 });
    expect(orderTotals(order)).toEqual({ estimatedTotal: 450, paid: 450, balance: 0, pieces: 3 });
    expect(paymentStatusForOrder(order)).toBe("paid");
  });

  it("migrates a legacy order once and removes flat fields", () => {
    const legacy = {
      id: "order_old",
      storeId: "store_1",
      customerId: "customer_1",
      productId: "p1",
      productName: "A",
      quantity: 3,
      price: 80,
      cost: 40,
      priceTier: "wholesale",
      deposit: 100,
      status: "paid",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    };
    const migrated = migrateOrder(legacy);
    expect(migrated.items).toEqual([{ productId: "p1", productName: "A", quantity: 3, priceTier: "t_wholesale", unitPrice: 80, subtotal: 240, cost: 40 }]);
    expect(migrated.orderStatus).toBe("delivered");
    // 'paid' raises deposit to the items total: no phantom balance (see the
    // dedicated test below for the v1 short-deposit case).
    expect(migrated.deposit).toBe(240);
    expect(migrated.paymentStatus).toBe("paid");
    expect((migrated as unknown as Record<string, unknown>).price).toBeUndefined();
    expect(migrateOrders([migrated])[0]).toBe(migrated);
  });

  it("migrates a legacy 'paid' order with no phantom balance (v1 never touched deposit)", () => {
    // v1 advanceOrder set status='paid' without raising deposit; the migration
    // must treat the sale as fully collected or prod shows a false "Falta cobrar".
    const legacy = {
      id: "order_paid_short",
      storeId: "store_1",
      customerId: "customer_1",
      productName: "A",
      quantity: 2,
      price: 100,
      deposit: 100,
      status: "paid",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-02",
    };
    const migrated = migrateOrder(legacy);
    expect(migrated.orderStatus).toBe("delivered");
    expect(migrated.deposit).toBe(200);
    expect(migrated.paymentStatus).toBe("paid");
    expect(orderTotals(migrated).balance).toBe(0);
  });

  it("maps status buckets and warns without blocking tier edits", () => {
    expect(effectiveOrderStatus({ status: "bought" })).toBe("preparing");
    expect(orderBucket(base({ orderStatus: "delivered", deposit: 0 }))).toBe("active");
    expect(orderBucket(base({ orderStatus: "delivered", deposit: 300 }))).toBe("completed");
    expect(tierWarning({ quantity: 2, subtotal: 200 }, { id: "t", label: "Mayoreo", order: 1, minPieces: 5 })).toContain("5 piezas");
    expect(tierWarning({ quantity: 1, subtotal: 200 }, { id: "t", label: "Iconic", order: 1, minAmount: 1000 })).toContain("$1,000");
    expect(orderReference("order_abc-123")).toBe("ABC123");
  });

  it("keeps public requests pending without counting them as money due", () => {
    const request = base({ orderStatus: "requested", customerId: "", deposit: 0, source: "public_catalog", requesterName: "Ana" });
    expect(orderBucket(request)).toBe("pending");
    expect(paymentStatusForOrder(request)).toBe("unpaid");
    expect(orderCountsTowardToPay(request)).toBe(false);
    expect(migrateOrder(request).requesterName).toBe("Ana");
  });
});
