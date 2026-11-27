import { describe, expect, it } from "vitest";
import {
  creditAppliedCents,
  creditAvailableCents,
  customerBalanceSummary,
  ordersForCustomer,
  pendingCents,
  planCreditApplications,
  priorDebtsView,
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

// ── #560: la corrección del renglón tras el cierre «Sin cambio» ──────────────
describe("corrección del renglón tras cierre sin cambio (#560)", () => {
  const closedNoChangeIncident = {
    id: "inc1",
    lineId: "l30",
    productId: "p30",
    productName: "Aro cambio",
    quantity: 1,
    reason: "Piedra fallada",
    originalUnitPriceCents: 3000,
    events: [
      { id: "e1", kind: "opened" as const, at: "2026-11-20T10:00:00Z", by: "fer" },
      { id: "e2", kind: "closed_no_change" as const, at: "2026-11-21T10:00:00Z", by: "fer", detail: { reason: "La clienta ya no quiere el cambio" } },
    ],
  };

  it("regresión $790 cobrados $820: al retirar el renglón de $30 quedan $60 de excedente; con $30 ya aplicados, quedan $30", () => {
    // Antes de corregir: total $790, recibido $820 → saldo a favor $30.
    const uncorrected = priced("a", 790, 820, "2026-11-20T10:00:00Z");
    expect(creditAvailableCents(uncorrected)).toBe(3000);
    // Los $30 ya se aplicaron a otro pedido → nada disponible todavía.
    expect(creditAvailableCents({ ...uncorrected, creditConsumedCents: 3000 })).toBe(0);
    // Tras el cierre sin cambio la operadora retira el renglón: total $760.
    // El cobro original queda intacto → excedente real $60, $30 adicionales.
    const corrected = priced("a", 760, 820, "2026-11-20T10:00:00Z", {
      incidents: [closedNoChangeIncident] as Order["incidents"],
    });
    expect(creditAvailableCents(corrected)).toBe(6000);
    expect(creditAvailableCents({ ...corrected, creditConsumedCents: 3000 })).toBe(3000);
  });

  it("el reembolso acordado y luego anulado por el cierre no bloquea el crédito", () => {
    const anulledRefund = priced("a", 760, 820, "2026-11-20T10:00:00Z", {
      incidents: [{
        ...closedNoChangeIncident,
        resolution: { kind: "refund", saleAdjustmentUnitCents: 3000, refundOwedCents: 3000, destination: "refund_pending" },
      }] as Order["incidents"],
    });
    expect(creditAvailableCents(anulledRefund)).toBe(6000);
  });

  it("el crédito reconciliado se aplica al siguiente pedido elegible (#189)", () => {
    const corrected = priced("a", 760, 820, "2026-11-20T10:00:00Z", {
      creditConsumedCents: 3000,
      incidents: [closedNoChangeIncident] as Order["incidents"],
    });
    const next = priced("n", 50, 0, "2026-11-22T10:00:00Z");
    expect(planCreditApplications([next, corrected])).toEqual([
      { fromOrderId: "a", toOrderId: "n", amountCents: 3000 },
    ]);
    // Tras la aplicación (acumuladores espejo #189 escritos en la misma
    // transacción), el destino debe $20 y el plan queda vacío (idempotente).
    const applied = { ...next, creditAppliedCents: 3000 };
    const consumed = { ...corrected, creditConsumedCents: 6000 };
    expect(pendingCents(applied)).toBe(2000);
    expect(planCreditApplications([applied, consumed])).toEqual([]);
  });
});

// ── #559: adeudos anteriores al consultar cuánto cobrar ─────────────────────
describe("priorDebtsView (#559)", () => {
  // The reported case: a prior $850 order with $750 received left $100 owed;
  // consulting a NEW $350 order must show both figures next to its saldo.
  const prior = priced("prior", 850, 750, "2026-11-20T10:00:00Z"); // pending 10000

  it("the reported case: the $100 prior debt is a traceable row, oldest first", () => {
    const view = priorDebtsView([prior], "store_a", "clienta_1", "nuevo");
    expect(view.priorPendingCents).toBe(10000);
    expect(view.rows).toEqual([{ orderId: "prior", orderStatus: "confirmed", pendingCents: 10000 }]);
  });

  it("each prior order counts once (partial payments included) and the current order is excluded", () => {
    const older = priced("older", 200, 0, "2026-11-18T10:00:00Z");
    const newer = priced("newer", 100, 40, "2026-11-25T10:00:00Z"); // partial payment → pending 6000
    const current = priced("current", 350, 0, "2026-11-26T10:00:00Z");
    const view = priorDebtsView([prior, older, newer, current], "store_a", "clienta_1", "current");
    expect(view.rows.map((row) => row.orderId)).toEqual(["older", "prior", "newer"]);
    expect(view.priorPendingCents).toBe(20000 + 10000 + 6000);
  });

  it("settled, cancelled and converted priors are not adeudos; delivered with authorized balance IS", () => {
    const settled = priced("settled", 300, 300, "2026-11-19T10:00:00Z");
    const cancelled = priced("cx", 500, 0, "2026-11-19T11:00:00Z", { orderStatus: "cancelled" });
    const converted = priced("cv", 500, 0, "2026-11-19T12:00:00Z", { convertedToPointId: "point_x" });
    const deliveredWithBalance = priced("dwb", 400, 250, "2026-11-19T13:00:00Z", {
      orderStatus: "delivered",
      deliveredWithBalanceCents: 15000,
    });
    const view = priorDebtsView([settled, cancelled, converted, deliveredWithBalance], "store_a", "clienta_1", "actual");
    expect(view.rows.map((row) => row.orderId)).toEqual(["dwb"]);
    expect(view.rows[0].orderStatus).toBe("delivered");
    expect(view.priorPendingCents).toBe(15000);
  });

  it("never mixes clientas or stores", () => {
    const otherStore = { ...priced("os", 900, 0, "2026-11-19T10:00:00Z"), storeId: "store_b" };
    const otherCustomer = { ...priced("oc", 900, 0, "2026-11-19T10:00:00Z"), customerId: "clienta_2" };
    expect(priorDebtsView([otherStore, otherCustomer], "store_a", "clienta_1", "actual").rows).toEqual([]);
  });

  it("exposes her OTHER orders' available credit so the caller nets it exactly once (#189)", () => {
    const surplus = priced("surplus", 100, 115, "2026-11-01T10:00:00Z"); // credit 1500
    const debt = priced("debt", 200, 0, "2026-11-02T10:00:00Z"); // pending 20000
    const view = priorDebtsView([surplus, debt], "store_a", "clienta_1", "actual");
    expect(view.priorPendingCents).toBe(20000);
    expect(view.priorCreditCents).toBe(1500);
  });

  it("credit already applied to a prior order is never counted twice", () => {
    // The surplus was consumed by the prior debt: its pending is already net
    // of the application, and the consumed credit is not available again.
    const surplus = priced("s", 100, 115, "2026-11-01T10:00:00Z", { creditConsumedCents: 1500 });
    const debt = priced("d", 200, 0, "2026-11-02T10:00:00Z", { creditAppliedCents: 1500 }); // pending 18500
    const view = priorDebtsView([surplus, debt], "store_a", "clienta_1", "actual");
    expect(view.priorPendingCents).toBe(18500);
    expect(view.priorCreditCents).toBe(0);
  });

  it("a converted order's stray credit is not surfaced as available (#524)", () => {
    const convertedSurplus = priced("cs", 100, 115, "2026-11-01T10:00:00Z", { convertedToPointId: "p" });
    expect(priorDebtsView([convertedSurplus], "store_a", "clienta_1", "actual").priorCreditCents).toBe(0);
  });

  it("nets to exactly the clienta view's netCents — allocation-independent (#189)", () => {
    // Whatever order the oldest-first compensation lands on, the TOTAL the
    // operator must collect is the same: Σ pending − Σ available credit.
    const current = priced("current", 350, 0, "2026-11-26T10:00:00Z");
    const orders = [prior, priced("favor", 100, 115, "2026-11-01T10:00:00Z"), current];
    const view = priorDebtsView(orders, "store_a", "clienta_1", "current");
    const panelTotal = view.priorPendingCents + pendingCents(current)
      - view.priorCreditCents - creditAvailableCents(current);
    expect(panelTotal).toBe(customerBalanceSummary(orders, "store_a", "clienta_1").netCents); // 350 + 100 − 15
  });
});

// ── #524: a converted order is history — it never gives, receives or owes credit
describe("converted orders stay out of the saldo a favor compensation (#524)", () => {
  const origin = priced("origin", 760, 820, "2026-11-01T10:00:00Z"); // credit 6000
  // Its sale and cobro live in the point's cut; on paper it still "owes" 500000.
  const converted = priced("converted", 5000, 0, "2026-11-02T10:00:00Z", { convertedToPointId: "point_a" });
  const next = priced("next", 500, 0, "2026-11-03T10:00:00Z"); // the real debt: pending 50000

  it("the credit reaches the next real order, never the converted one (release repro)", () => {
    // Older than `next`, the converted order used to soak up the $60 first.
    expect(planCreditApplications([origin, converted, next])).toEqual([
      { fromOrderId: "origin", toOrderId: "next", amountCents: 6000 },
    ]);
  });

  it("a converted order holding a surplus never acts as a credit source", () => {
    const convertedCredit = priced("cc", 100, 115, "2026-11-01T10:00:00Z", { convertedToPointId: "point_a" }); // surplus 1500
    expect(planCreditApplications([convertedCredit, next])).toEqual([]);
  });

  it("the clienta view reports it like a cancelled order: nothing pending, no credit, no totals", () => {
    const summary = customerBalanceSummary([origin, converted, next], "store_a", "clienta_1");
    expect(summary.orders.map((o) => o.orderId)).toEqual(["origin", "converted", "next"]); // still listed as history
    expect(summary.orders.find((o) => o.orderId === "converted")).toMatchObject({ pendingCents: 0, creditCents: 0 });
    expect(summary.pendingCents).toBe(50000); // `next` only
    expect(summary.creditCents).toBe(6000); // `origin` only
    expect(summary.netCents).toBe(44000);
  });

  it("a stray application that landed on a converted order is evidence, never debt", () => {
    // Written before this rule existed (the release repro): origin's $60 sits
    // on the converted order. It stays visible for its restitution through
    // releaseCredit, without turning the converted order into what she owes.
    const stray = customerBalanceSummary(
      [{ ...origin, creditConsumedCents: 6000 }, { ...converted, creditAppliedCents: 6000 }, next],
      "store_a", "clienta_1",
    );
    expect(stray.orders.find((o) => o.orderId === "converted")).toMatchObject({
      pendingCents: 0, creditCents: 0, creditAppliedCents: 6000,
    });
    expect(stray.pendingCents).toBe(50000); // `next` only
    expect(stray.creditCents).toBe(0); // origin's surplus is parked on the converted order
    expect(stray.netCents).toBe(50000);
  });
});
