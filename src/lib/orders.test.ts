import { describe, expect, it } from "vitest";
import type { Order } from "../types";
import {
  effectiveOrderStatus,
  migrateOrder,
  migrateOrders,
  orderBucket,
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
    expect(migrated.items).toEqual([{ lineId: "order_old_L0", productId: "p1", productName: "A", quantity: 3, priceTier: "t_wholesale", unitPrice: 80, subtotal: 240, cost: 40 }]);
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
});


describe("lineId — identidad estable de línea (E1)", () => {
  const legacy = {
    id: "o1",
    storeId: "s1",
    customerId: "c1",
    items: [
      { productId: "p1", productName: "Anillo", quantity: 2, unitPrice: 50, subtotal: 100 },
      { productId: "p2", productName: "Aretes", quantity: 1, unitPrice: 30, subtotal: 30 },
    ],
    deposit: 0,
    orderStatus: "asked" as const,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
  };

  it("asigna lineId determinista orderId_Lindex en la primera migración", () => {
    const migrated = migrateOrder(legacy);
    expect(migrated.items[0].lineId).toBe("o1_L0");
    expect(migrated.items[1].lineId).toBe("o1_L1");
  });

  it("es estable: re-migrar conserva los lineIds ya asignados", () => {
    const once = migrateOrder(legacy);
    // Simulate a persisted edit: first line renamed, order kept in v2 shape.
    const edited = { ...once, items: [...once.items.slice(1), once.items[0]] };
    const again = migrateOrder(edited);
    expect(again.items.map((i) => i.lineId)).toEqual(["o1_L1", "o1_L0"]);
  });

  it("conserva el lineId que traía la línea (ediciones v2)", () => {
    const withIds = migrateOrder({ ...legacy, items: [{ ...legacy.items[0], lineId: "custom_9" }, legacy.items[1]] });
    expect(withIds.items[0].lineId).toBe("custom_9");
  });
});
