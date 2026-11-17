import { describe, expect, it } from "vitest";

import {
  creditAvailableCents as portAvailable,
  pendingCents as portPending,
  docReceivedCents as portReceived,
  incidentsSaleAdjustmentCents as portSaleAdjust,
  incidentsRefundCommittedCents as portRefundCommitted,
  orderAmountCents as portAmount,
} from "../../../functions/src/creditMath.mjs"; // plain-JS port — this suite locks its output to the TS truth
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { creditAvailableCents, pendingCents } from "./customerCredit";
import {
  docReceivedCents,
  incidentsSaleAdjustmentCents,
  incidentsRefundCommittedCents,
  orderAmountCents,
} from "../../lib/orderMoney";
import type { Order, OrderIncident } from "../../types";

// #380 prototype: the trusted callables run the app's credit math from a
// plain-JS port (functions are .mjs; importing TS app code is not viable
// there). This suite LOCKS the port to the TypeScript source of truth —
// every fixture must produce identical cents on both sides. If they ever
// diverge, the callable must not ship.

const incident = (resolution: OrderIncident["resolution"], replacement?: OrderIncident["replacement"]): OrderIncident => ({
  id: "i1",
  productId: "p1",
  productName: "Pieza",
  quantity: 1,
  reason: "R",
  originalUnitPriceCents: 12000,
  ...(replacement ? { replacement } : {}),
  events: [],
  ...(resolution ? { resolution } : {}),
});

type Fixture = { name: string; order: Partial<Order> & Record<string, unknown> };

const fixtures: Fixture[] = [
  { name: "simple overpaid order", order: { items: [{ productName: "A", quantity: 1, unitPrice: 100, subtotal: 100 }], paymentsReceivedCents: 20000, inheritedDepositMaterialized: true } },
  { name: "exact payment", order: { items: [{ productName: "A", quantity: 2, unitPrice: 50.5, subtotal: 101 }], paymentsReceivedCents: 10100, inheritedDepositMaterialized: true } },
  { name: "partial consumption", order: { items: [{ productName: "A", quantity: 1, unitPrice: 100, subtotal: 100 }], paymentsReceivedCents: 20000, inheritedDepositMaterialized: true, creditConsumedCents: 7500 } },
  { name: "consumption beyond surplus (corrupt)", order: { items: [{ productName: "A", quantity: 1, unitPrice: 100, subtotal: 100 }], paymentsReceivedCents: 12000, inheritedDepositMaterialized: true, creditConsumedCents: 999999 } },
  { name: "legacy deposit not materialized", order: { items: [{ productName: "A", quantity: 1, unitPrice: 100, subtotal: 100 }], deposit: 150 } },
  { name: "credit applied reduces pending", order: { items: [{ productName: "A", quantity: 1, unitPrice: 300, subtotal: 300 }], paymentsReceivedCents: 0, inheritedDepositMaterialized: true, creditAppliedCents: 10000 } },
  { name: "corrupt numbers never NaN", order: { items: [{ productName: "A", quantity: 1, unitPrice: 100, subtotal: 100 }], paymentsReceivedCents: Number.NaN, creditConsumedCents: Number.NaN, inheritedDepositMaterialized: true } },
  { name: "refund incident blocks surplus", order: { items: [{ productName: "A", quantity: 1, unitPrice: 100, subtotal: 100 }], paymentsReceivedCents: 30000, inheritedDepositMaterialized: true, incidents: [incident({ kind: "refund", refundOwedCents: 5000 })] } },
  { name: "charged replacement adjusts total", order: { items: [{ productName: "A", quantity: 1, unitPrice: 100, subtotal: 100 }], paymentsReceivedCents: 30000, inheritedDepositMaterialized: true, incidents: [incident({ kind: "replacement_with_difference", saleAdjustmentUnitCents: 12000 }, { productId: "p2", productName: "B", unitPriceCents: 18000, unitCostCents: 0, chargeDifference: true })] } },
  { name: "legacy refund fields", order: { items: [{ productName: "A", quantity: 1, unitPrice: 100, subtotal: 100 }], paymentsReceivedCents: 30000, inheritedDepositMaterialized: true, incidents: [incident({ kind: "refund", refundUnitPriceCents: 8000 })] } },
  { name: "legacy flat order", order: { productName: "Legacy", quantity: 2, price: 75 } },
];

describe("#380 prototype — el puerto de matemáticas de crédito coincide con la fuente de verdad TS", () => {
  for (const fixture of fixtures) {
    it(`${fixture.name} — available/pending/received idénticos`, () => {
      const order = fixture.order;
      expect(portAvailable(order)).toBe(creditAvailableCents(order));
      expect(portPending(order)).toBe(pendingCents(order));
      expect(portReceived(order)).toBe(docReceivedCents(order));
    });
  }

  it("incident money helpers coincide en toda la matriz", () => {
    const incidentSets = [
      undefined,
      [],
      [incident(undefined)],
      [incident({ kind: "refund", refundOwedCents: 5000 })],
      [incident({ kind: "refund", refundUnitPriceCents: 8000 })],
      [incident({ kind: "wait_restock", waitUntil: "2026-12-01" })],
      [incident({ kind: "replacement_with_difference", saleAdjustmentUnitCents: 12000 }, { productId: "p2", productName: "B", unitPriceCents: 18000, unitCostCents: 0, chargeDifference: true })],
    ] as OrderIncident[][];
    for (const set of incidentSets) {
      expect(portSaleAdjust(set)).toBe(incidentsSaleAdjustmentCents(set));
      expect(portRefundCommitted(set)).toBe(incidentsRefundCommittedCents(set));
    }
  });

  it("orderAmountCents coincide en importes con decimales y cantidades", () => {
    const cases: Array<[number, number]> = [[100, 1], [0.1, 3], [33.33, 3], [1460.5, 2], [0.5, 1], [12.345, 1]];
    for (const [amount, quantity] of cases) {
      expect(portAmount(amount, quantity)).toBe(orderAmountCents(amount, quantity));
    }
  });
});
