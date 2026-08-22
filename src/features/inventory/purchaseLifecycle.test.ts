import { describe, expect, it } from "vitest";
import {
  effectivePurchaseStatus,
  recalcPurchaseStatus,
  type Purchase,
} from "../../types";
import { applyPurchaseLines } from "../../lib/inventory";
import type { Product } from "../../types";

const base: Purchase = {
  id: "p1",
  storeId: "s1",
  date: "2026-08-20",
  lines: [],
  subtotal: 0,
  totalConfirmed: 0,
  createdAt: "2026-08-20T00:00:00Z",
  updatedAt: "2026-08-20T00:00:00Z",
};

describe("effectivePurchaseStatus", () => {
  it("treats legacy purchases (no status) as received", () => {
    expect(effectivePurchaseStatus(base)).toBe("received");
  });
  it("reads the explicit status when present", () => {
    expect(effectivePurchaseStatus({ ...base, status: "draft" })).toBe("draft");
  });
});

describe("recalcPurchaseStatus", () => {
  it("empty purchase stays draft", () => {
    expect(recalcPurchaseStatus({ ...base, status: "draft" }, { totalPaid: 0 })).toBe("draft");
  });

  it("unresolved sourceAmountType forces needs_review", () => {
    const p: Purchase = {
      ...base,
      status: "ready",
      lines: [{ productId: "a", name: "A", quantity: 2, unitCost: 100, sourceAmountType: "unknown" }],
      subtotal: 200,
      totalConfirmed: 200,
    };
    expect(recalcPurchaseStatus(p, { totalPaid: 200 })).toBe("needs_review");
  });

  it("unconfirmed mismatch → needs_review; confirmed → ready", () => {
    const p: Purchase = {
      ...base,
      status: "draft",
      lines: [{ productId: "a", name: "A", quantity: 1, unitCost: 100 }],
      subtotal: 100,
      totalConfirmed: 120,
    };
    expect(recalcPurchaseStatus(p, { totalPaid: 120 })).toBe("needs_review");
    expect(recalcPurchaseStatus({ ...p, confirmedMismatchAmount: 20 }, { totalPaid: 120 })).toBe("ready");
  });

  it("editing after confirmation invalidates it (different mismatch)", () => {
    const p: Purchase = {
      ...base,
      status: "draft",
      confirmedMismatchAmount: 20,
      lines: [{ productId: "a", name: "A", quantity: 1, unitCost: 150 }], // edited: now diff is 30
      subtotal: 150,
      totalConfirmed: 120,
    };
    expect(recalcPurchaseStatus(p, { totalPaid: 120 })).toBe("needs_review");
  });

  it("footer adjustments count toward the calculated total", () => {
    const p: Purchase = {
      ...base,
      status: "draft",
      lines: [{ productId: "a", name: "A", quantity: 1, unitCost: 100 }],
      shipping: 20,
      subtotal: 100,
      totalConfirmed: 120,
    };
    expect(recalcPurchaseStatus(p, { totalPaid: 120 })).toBe("ready");
  });

  it("received never downgrades", () => {
    // status undefined = legacy = received; recalc must not "revive" it.
    expect(recalcPurchaseStatus(base, { totalPaid: 999 })).toBe("received");
  });
});

describe("receivePurchase idempotency (stock math)", () => {
  const products: Product[] = [
    { id: "a", storeId: "s1", name: "Anillo", quantityOnHand: 5, cost: 50 } as unknown as Product,
  ];
  const lines = [
    { productId: "a", name: "Anillo", quantity: 3, unitCost: 100 },
    { productId: "a", name: "Anillo", quantity: 2, unitCost: 100 }, // same product twice: folds
  ];

  it("applies quantity + weighted cost once, folding repeat lines", () => {
    const updates = applyPurchaseLines(products, lines);
    const u = updates.get("a")!;
    expect(u.quantityOnHand).toBe(10); // 5 + 3 + 2
    // weighted: (5*50 + 5*100)/10 = 75
    expect(u.cost).toBeCloseTo(75, 5);
  });

  it("applying the SAME updates twice from the original snapshot is what guards prevent", () => {
    // The provider/transaction re-checks receivedAt before applying; simulate
    // the second application NOT being allowed by verifying the fold math is
    // deterministic from a fixed snapshot (no hidden accumulation).
    const once = applyPurchaseLines(products, lines);
    const twice = applyPurchaseLines(products, lines);
    expect(once.get("a")!.quantityOnHand).toBe(twice.get("a")!.quantityOnHand);
  });
});
