// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearOrderDraft, loadOrderDraft, orderDraftKey, saveOrderDraft, type OrderDraftSnapshot } from "./orderDraft";

function snapshot(overrides: Partial<OrderDraftSnapshot> = {}): OrderDraftSnapshot {
  return {
    orderUpdatedAt: "2026-10-28T10:00:00.000Z",
    savedAt: "2026-10-28T10:05:00.000Z",
    customerId: "c1",
    customerQuery: "Sofía",
    lines: [{ key: "k", lineId: "l1", productId: "p1", productName: "Anillo", quantity: 2, unitPrice: 50, subtotal: 100 }],
    deposit: "50",
    promisedDate: "",
    orderStatus: "asked",
    notes: "",
    ...overrides,
  };
}

describe("orderDraft — borrador offline del editor (E1)", () => {
  beforeEach(() => localStorage.clear());

  it("keys separate the new-order editor from a saved order", () => {
    expect(orderDraftKey("s1", "o1", true)).toBe("store_os_order_draft_v2::s1::new");
    expect(orderDraftKey("s1", "o1", false)).toBe("store_os_order_draft_v2::s1::o1");
  });

  it("round-trips a meaningful draft and restores it", () => {
    const key = orderDraftKey("s1", "o1", false);
    saveOrderDraft(key, snapshot());
    const restored = loadOrderDraft(key, { updatedAt: "2026-10-28T10:00:00.000Z" }, false);
    expect(restored?.lines).toHaveLength(1);
    expect(restored?.deposit).toBe("50");
  });

  it("refuses a stale draft: the saved order moved past it (another device)", () => {
    const key = orderDraftKey("s1", "o1", false);
    saveOrderDraft(key, snapshot());
    expect(loadOrderDraft(key, { updatedAt: "2026-10-28T11:00:00.000Z" }, false)).toBeNull();
  });

  it("restores a stale-checked draft for the NEW-order editor (no saved version yet)", () => {
    const key = orderDraftKey("s1", "whatever", true);
    saveOrderDraft(key, snapshot());
    expect(loadOrderDraft(key, { updatedAt: "2026-10-28T23:00:00.000Z" }, true)).not.toBeNull();
  });

  it("ignores corrupt, empty or meaningless drafts", () => {
    localStorage.setItem("k1", "{not json");
    expect(loadOrderDraft("k1", { updatedAt: "x" }, true)).toBeNull();
    localStorage.setItem("k2", JSON.stringify(snapshot({ lines: [] })));
    expect(loadOrderDraft("k2", { updatedAt: "x" }, true)).toBeNull();
    localStorage.setItem("k3", JSON.stringify(snapshot({ lines: [{ key: "k", productName: "  " }] })));
    expect(loadOrderDraft("k3", { updatedAt: "x" }, true)).toBeNull();
  });

  it("clears on demand (successful save)", () => {
    const key = orderDraftKey("s1", "o1", false);
    saveOrderDraft(key, snapshot());
    clearOrderDraft(key);
    expect(localStorage.getItem(key)).toBeNull();
  });
});
