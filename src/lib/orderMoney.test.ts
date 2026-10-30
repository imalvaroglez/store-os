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
