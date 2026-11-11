// @vitest-environment jsdom
// Edge-case hunt for the canonical money model (#225/#218/#203/#189) BEFORE
// release: an exhaustive matrix over the money-bearing fields of the ORDER
// DOCUMENT, asserted with INVARIANTS derived from the model's own documented
// rules — not copied values. Any failure here is either a model bug or an
// undefined business rule; both must be explicit before merging the wave.
import { describe, expect, it } from "vitest";
import { orderTotals, paymentStatusForOrder } from "./orders";
import { docReceivedCents, incidentsSaleAdjustmentCents } from "./orderMoney";
import { orderTicketText } from "../features/orders/orderTicket";
import { formatMoneyPlain } from "./money";
import type { Order, OrderIncident } from "../types";

type MatrixOrder = Partial<Order> & Record<string, unknown>;

const line = (unitPrice: number, quantity = 1) => ({ productName: "Pieza", unitPrice, quantity, subtotal: unitPrice * quantity });

const refundIncident = (unitCents: number, qty = 1): OrderIncident => ({
  id: "inc-refund", productName: "Pieza", quantity: qty, reason: "Defecto",
  originalUnitPriceCents: unitCents,
  resolution: { kind: "refund", saleAdjustmentUnitCents: unitCents },
  events: [],
}) as unknown as OrderIncident;

const upgradeIncident = (fromCents: number, toCents: number, qty = 1): OrderIncident => ({
  id: "inc-up", productName: "Pieza", quantity: qty, reason: "Cambio",
  originalUnitPriceCents: fromCents,
  resolution: { kind: "replacement_with_difference", saleAdjustmentUnitCents: fromCents },
  replacement: { productName: "Otra", unitPriceCents: toCents, unitCostCents: 1000, chargeDifference: true },
  events: [],
}) as unknown as OrderIncident;

// The matrix: every combination of the money-bearing canonical fields over a
// fixed 2-line sale ($720.00 total: 2 × $360).
const received = [0, 59_000, 72_000, 90_000, -2_000] as const; // paymentsReceivedCents (incl. overpay & negative adj)
const deposits = [0, 15_000, 59_000] as const; // legacy deposit (pesos field on the doc)
const materialized = [undefined, true, false] as const;
const creditsApplied = [0, 3_000] as const;
const creditsConsumed = [0, 2_000] as const;
const incidentSets = [
  [],
  [refundIncident(36_000)],
  [refundIncident(36_000, 2)], // refund both pieces → effective total 0
  [upgradeIncident(36_000, 41_000)], // charged upgrade +$50 total
  [upgradeIncident(41_000, 36_000)], // downgrade −$50
] as const;

const base: MatrixOrder = {
  id: "edge-1", storeId: "s1", customerId: "c1",
  items: [line(360), line(360)],
  orderStatus: "asked", paymentStatus: "unpaid",
  createdAt: "2026-11-08", updatedAt: "2026-11-08",
};

describe("modelo de dinero — invariantes sobre la matriz exhaustiva (#225 pre-release)", () => {
  it.each(
    received.flatMap((p) =>
      deposits.flatMap((d) =>
        materialized.flatMap((m) =>
          creditsApplied.flatMap((a) =>
            creditsConsumed.flatMap((c) =>
              incidentSets.map((incidents, i) => ({
                p, d, m, a, c, incidents, key: `p${p}-d${d}-m${String(m)}-a${a}-c${c}-i${i}`,
              }))
            )
          )
        )
      )
    )
  )("combo $key", ({ p, d, m, a, c, incidents }) => {
    const order: MatrixOrder = {
      ...base,
      paymentsReceivedCents: p,
      deposit: d,
      ...(m === undefined ? {} : { inheritedDepositMaterialized: m }),
      creditAppliedCents: a,
      creditConsumedCents: c,
      incidents: [...incidents],
    };

    // I0 — cents math never yields NaN/Infinity for any combo.
    const totals = orderTotals(order);
    for (const [name, value] of Object.entries(totals)) {
      expect(Number.isFinite(value as number), `${name} finito`).toBe(true);
    }

    // I1 — received money = accumulator + pending deposit, exact.
    const receivedCents = Math.round(totals.paid * 100);
    expect(receivedCents).toBe(docReceivedCents(order));

    // I2 — a materialized deposit NEVER counts again (#218).
    if (m === true) {
      expect(docReceivedCents(order)).toBe(p);
    }

    // I3 — balance is net of credit, never negative, cents-exact.
    const effective = Math.max(0, 72_000 + incidentsSaleAdjustmentCents(order.incidents));
    expect(totals.balance).toBe(Math.max(0, effective - receivedCents - a) / 100);

    // I4 — credit applied/available are reported separately from paid money.
    expect(totals.appliedCredit).toBe(a / 100);
    const surplus = Math.max(0, receivedCents - effective);
    expect(totals.availableCredit).toBe(Math.max(0, surplus - c) / 100);
    expect(totals.availableCredit, "el crédito nunca inventa dinero").toBeLessThanOrEqual(surplus / 100);

    // I5 — the WhatsApp ticket tells the SAME money story as the read model.
    const text = orderTicketText(order as Order, "Tienda", "Clienta");
    // #222: Fer's WhatsApp format renders the money lines in *bold*.
    const totalLine = text.split("\n").find((l) => l.startsWith("*Total* "));
    expect(totalLine, "el ticket siempre muestra Total").toBeTruthy();
    expect(totalLine).toBe(`*Total* ${formatMoneyPlain(totals.estimatedTotal)}`);
    const saldoLine = text.split("\n").find((l) => l.startsWith("*Saldo* "));
    const moneyMoved = totals.paid > 0 || totals.appliedCredit > 0;
    const totalCents = Math.round(totals.estimatedTotal * 100);
    const balanceCents = Math.round(totals.balance * 100);
    // #306 (revisión adversarial P1): the Saldo hides ONLY when it would repeat
    // the Total verbatim. An incident without cash changes the real debt and
    // MUST show — moneyMoved alone was too coarse.
    if (balanceCents > 0 && (moneyMoved || balanceCents !== totalCents)) {
      expect(saldoLine, "con cobro parcial o deuda ≠ Total, el ticket muestra el saldo del modelo").toBe(`*Saldo* ${formatMoneyPlain(totals.balance)}`);
    } else {
      expect(saldoLine, "sin saldo pendiente o cuando el Saldo repetiría el Total, no hay línea").toBeUndefined();
    }
    const favorLine = text.split("\n").find((l) => l.startsWith("*Saldo a favor* "));
    if (totals.availableCredit > 0) {
      expect(favorLine, "el excedente real se etiqueta como saldo a favor").toBe(`*Saldo a favor* ${formatMoneyPlain(totals.availableCredit)}`);
    } else {
      expect(favorLine).toBeUndefined();
    }

    // I6 — payment status never contradicts a fully settled balance.
    if (totals.balance === 0) {
      expect(["paid"]).toContain(paymentStatusForOrder(order));
    }
  });

  it("I7 — depósitos absurdos se rechazan sin NaN (RangeError), nunca dinero corrupto", () => {
    const corrupt: MatrixOrder = { ...base, paymentsReceivedCents: 0, deposit: 1e308 };
    expect(() => docReceivedCents(corrupt)).not.toThrow();
    const totals = orderTotals(corrupt);
    expect(Number.isFinite(totals.paid)).toBe(true);
  });

  it("I8 — campos de crédito corruptos (negativos, string) se leen como cero", () => {
    const corrupt: MatrixOrder = { ...base, creditAppliedCents: -5000, creditConsumedCents: "x" as unknown as number, paymentsReceivedCents: 10_000 };
    const totals = orderTotals(corrupt);
    expect(totals.appliedCredit).toBe(0);
    expect(Number.isFinite(totals.availableCredit)).toBe(true);
  });
});
