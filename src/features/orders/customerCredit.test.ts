import { describe, expect, it } from "vitest";
import {
  creditAppliedCents,
  creditAvailableCents,
  customerBalanceSummary,
  ordersForCustomer,
  pendingCents,
  planCreditApplications,
} from "./customerCredit";
import type { Order } from "../../types";

/** Minimal order with exact money; cents are the only truth here. */
function order(fields: Partial<Order> & Pick<Order, "id" | "createdAt">): Order {
  return {
    storeId: "store_a",
    customerId: "clienta_1",
    customerName: "Fer",
    items: [],
    deposit: 0,
    orderStatus: "confirmed",
    paymentStatus: "partial",
    updatedAt: fields.createdAt,
    ...fields,
  } as Order;
}

/** total/received in pesos; the doc accumulator stores exact cents. */
function priced(id: string, total: number, received: number, createdAt: string, extra: Partial<Order> = {}): Order {
  return order({
    id,
    createdAt,
    items: [{ lineId: "l1", productName: "Pieza", quantity: 1, unitPrice: total } as Order["items"][number]],
    paymentsReceivedCents: Math.round(received * 100),
    inheritedDepositMaterialized: true,
    ...extra,
  });
}

describe("credit availability and pending (derived, never copied)", () => {
  it("an overpaid order holds credit: received − total, minus already consumed", () => {
    const a = priced("a", 100, 115, "2026-11-01T10:00:00Z");
    expect(creditAvailableCents(a)).toBe(1500);
    expect(creditAvailableCents({ ...a, creditConsumedCents: 500 })).toBe(1000);
    expect(creditAvailableCents({ ...a, creditConsumedCents: 2000 })).toBe(0); // corrupt/consumed past surplus clamps
  });

  it("an unpaid or partially paid order has no credit", () => {
    expect(creditAvailableCents(priced("a", 100, 0, "2026-11-01T10:00:00Z"))).toBe(0);
    expect(creditAvailableCents(priced("a", 100, 90, "2026-11-01T10:00:00Z"))).toBe(0);
  });

  it("pending is total − received − credit already applied to this order", () => {
    const b = priced("b", 200, 0, "2026-11-02T10:00:00Z");
    expect(pendingCents(b)).toBe(20000);
    expect(pendingCents({ ...b, creditAppliedCents: 1500 })).toBe(18500);
    expect(creditAppliedCents({ ...b, creditAppliedCents: 1500 })).toBe(1500);
    // Credit beyond the debt never turns pending negative.
    expect(pendingCents({ ...b, creditAppliedCents: 99999 })).toBe(0);
  });
});

describe("planCreditApplications (PO rules 2026-11-05)", () => {
  it("applies a $15 surplus to the oldest pending order of the same clienta", () => {
    const a = priced("a", 100, 115, "2026-11-01T10:00:00Z"); // credit 1500
    const b = priced("b", 200, 0, "2026-11-02T10:00:00Z"); // pending 20000
    expect(planCreditApplications([b, a])).toEqual([
      { fromOrderId: "a", toOrderId: "b", amountCents: 1500 },
    ]);
  });

  it("carries the remainder to the next pending order (oldest debts first)", () => {
    const credit = priced("c", 10, 40, "2026-11-01T10:00:00Z"); // credit 3000
    const old = priced("o", 10, 0, "2026-11-02T10:00:00Z"); // pending 1000
    const newer = priced("n", 40, 0, "2026-11-03T10:00:00Z"); // pending 4000
    expect(planCreditApplications([newer, old, credit])).toEqual([
      { fromOrderId: "c", toOrderId: "o", amountCents: 1000 },
      { fromOrderId: "c", toOrderId: "n", amountCents: 2000 },
    ]);
  });

  it("consumes the oldest credit first and breaks ties by id", () => {
    const sameMoment = "2026-11-01T10:00:00Z";
    const creditB = priced("b-credit", 10, 25, sameMoment); // credit 1500
    const creditA = priced("a-credit", 10, 25, sameMoment); // credit 1500
    const debt = priced("z-debt", 30, 0, "2026-11-05T10:00:00Z"); // pending 3000
    expect(planCreditApplications([debt, creditB, creditA])).toEqual([
      { fromOrderId: "a-credit", toOrderId: "z-debt", amountCents: 1500 },
      { fromOrderId: "b-credit", toOrderId: "z-debt", amountCents: 1500 },
    ]);
  });

  it("partial credit leaves the difference as pending, never inventing money", () => {
    const credit = priced("c", 10, 15, "2026-11-01T10:00:00Z"); // credit 500
    const debt = priced("d", 100, 0, "2026-11-02T10:00:00Z"); // pending 10000
    const [only] = planCreditApplications([debt, credit]);
    expect(only).toEqual({ fromOrderId: "c", toOrderId: "d", amountCents: 500 });
    expect(pendingCents({ ...debt, creditAppliedCents: 500 })).toBe(9500);
  });

  it("already-applied and already-consumed credit shapes the next plan (idempotent re-runs)", () => {
    // State AFTER a first application of 1500 from a→b.
    const a = { ...priced("a", 100, 115, "2026-11-01T10:00:00Z"), creditConsumedCents: 1500 };
    const b = { ...priced("b", 200, 0, "2026-11-02T10:00:00Z"), creditAppliedCents: 1500 };
    expect(planCreditApplications([a, b])).toEqual([]); // nothing new to do
  });

  it("cancelled orders never give or receive credit", () => {
    const cancelledCredit = priced("cc", 100, 115, "2026-11-01T10:00:00Z", { orderStatus: "cancelled" });
    const cancelledDebt = priced("cd", 200, 0, "2026-11-02T10:00:00Z", { orderStatus: "cancelled" });
    const liveDebt = priced("ld", 50, 0, "2026-11-03T10:00:00Z");
    expect(planCreditApplications([cancelledCredit, cancelledDebt, liveDebt])).toEqual([]);
  });

  it("#203: committed refund money is NEVER credit — pending or executed (#212 F1)", () => {
    const refunded = {
      ...priced("r", 120, 120, "2026-11-01T10:00:00Z"),
      orderStatus: "delivered" as const,
      incidents: [{
        id: "inc", productId: "p", productName: "Anillo", quantity: 1, reason: "Defecto",
        originalUnitPriceCents: 12000,
        resolution: { kind: "refund" as const, refundUnitPriceCents: 12000 },
        events: [{ id: "e1", kind: "opened" as const, at: "2026-11-02T10:00:00Z", by: "fer" }],
      }],
    };
    // Agreed, not yet executed: pending blocks the surplus.
    expect(creditAvailableCents(refunded)).toBe(0);
    // Executed (money left the store): the surplus must NOT surface as credit.
    const executed = {
      ...refunded,
      incidents: [{
        ...refunded.incidents![0],
        events: [
          ...refunded.incidents![0].events,
          { id: "e2", kind: "confirmed" as const, at: "2026-11-03T10:00:00Z", by: "fer", detail: { refundExecutedCents: 12000 } },
        ],
      }],
    };
    expect(creditAvailableCents(executed)).toBe(0);
    expect(pendingCents(executed)).toBe(0); // she owes nothing either
  });

  it("no credit, no plan", () => {
    expect(planCreditApplications([priced("x", 100, 100, "2026-11-01T10:00:00Z")])).toEqual([]);
  });
});

describe("ordersForCustomer + customerBalanceSummary (the clienta view)", () => {
  const a = { ...priced("a", 100, 115, "2026-11-01T10:00:00Z"), creditConsumedCents: 1500 }; // surplus consumed by b
  const b = { ...priced("b", 200, 0, "2026-11-02T10:00:00Z"), creditAppliedCents: 1500 }; // pending 18500
  const cancelledPaid = priced("cp", 80, 80, "2026-11-03T10:00:00Z", { orderStatus: "cancelled" }); // excluded, informational
  const otherStore = { ...priced("os", 100, 100, "2026-11-01T10:00:00Z"), storeId: "store_b" };
  const otherCustomer = { ...priced("oc", 100, 100, "2026-11-01T10:00:00Z"), customerId: "clienta_2" };

  it("isolates by store AND customer", () => {
    const mine = ordersForCustomer([a, b, cancelledPaid, otherStore, otherCustomer], "store_a", "clienta_1");
    expect(mine.map((o) => o.id).sort()).toEqual(["a", "b", "cp"]);
  });

  it("sums pending, available credit and net with per-order breakdown", () => {
    const summary = customerBalanceSummary([a, b, cancelledPaid], "store_a", "clienta_1");
    expect(summary.pendingCents).toBe(18500);
    expect(summary.creditCents).toBe(0); // a's surplus is consumed by b's application
    expect(summary.netCents).toBe(18500);
    expect(summary.cancelledWithPaymentsCents).toBe(8000);
    expect(summary.orders.map((o) => o.orderId)).toEqual(["a", "b", "cp"]);
    const rowB = summary.orders.find((o) => o.orderId === "b")!;
    expect(rowB.pendingCents).toBe(18500);
    expect(rowB.creditAppliedCents).toBe(1500);
  });
});
