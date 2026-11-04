import { describe, expect, it } from "vitest";
import { orderAmountCents, formatOrderUnitPrice } from "./orderMoney";
import { orderTotals } from "./orders";

describe("order money", () => {
  it("adds fractional prices in cents and rounds each line half up", () => {
    expect(orderTotals({ items: [
      { productName: "A", quantity: 1, unitPrice: 0.1, subtotal: 0.1 },
      { productName: "B", quantity: 1, unitPrice: 0.2, subtotal: 0.2 },
    ], deposit: 0 }).estimatedTotal).toBe(0.3);
    expect(orderAmountCents(0.335, 3)).toBe(101);
    expect(orderAmountCents(1.005)).toBe(101);
    expect(orderAmountCents(1e-7, 50000)).toBe(1);
  });
  it("keeps legacy unit precision visible and rejects unsafe amounts", () => {
    expect(formatOrderUnitPrice(0.335)).toContain("0.335");
    expect(() => orderAmountCents(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => orderAmountCents(1, Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

it("uses the order's canonical receipts in list and home balances", () => {
  expect(orderTotals({ items: [{ productName: "Pieza", quantity: 1, unitPrice: 1000, subtotal: 1000 }], deposit: 0, paymentsReceivedCents: 40000 })).toMatchObject({ paid: 400, balance: 600 });
});

it("keeps receipt version and canonical link through order normalization", async () => {
  const { migrateOrder } = await import("./orders");
  expect(migrateOrder({ id: "o1", storeId: "s1", deposit: 0, items: [], paymentsReceivedCents: 40000, paymentsRevision: 2, lastPaymentId: "p2" })).toMatchObject({ paymentsRevision: 2, lastPaymentId: "p2" });
});
