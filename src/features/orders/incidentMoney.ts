// #203 correction (review round 2): the authoritative money reconciliation
// for an incident, BEFORE any UI shows a number. Three kept-apart concepts:
//  1. Sale adjustment — the piece (or the price difference) leaves the sale.
//  2. Reconciled value — the money the clienta is owed for this incident,
//     capped by what she actually covered and reduced by credit already
//     consumed elsewhere and refunds already committed.
//  3. Refund obligation — the CASH part (reconciled minus credit restitution)
//     when the clienta chose a pending refund; with accepted credit it is
//     zero and the value flows back through #189 (restitution + surplus).
// The UI may only ESTIMATE with this; the transaction recomputes it against
// the fresh document and stores the authoritative amounts.
import type { Order, OrderIncident } from "../../types";
import { docReceivedCents, orderAmountCents } from "../../lib/orderMoney";
import { orderItems } from "../../lib/orders";

function orderTotalCentsOf(order: Order): number {
  return orderItems(order).reduce((sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity), 0);
}

function creditAppliedOf(order: Order): number {
  return typeof order.creditAppliedCents === "number" && Number.isSafeInteger(order.creditAppliedCents) && order.creditAppliedCents > 0 ? order.creditAppliedCents : 0;
}

function creditConsumedOf(order: Order): number {
  return typeof order.creditConsumedCents === "number" && Number.isSafeInteger(order.creditConsumedCents) && order.creditConsumedCents > 0 ? order.creditConsumedCents : 0;
}

/** Σ refunds already committed by OTHER incidents on this order (new model +
 * legacy synthetic-transition fields), exact cents. */
function otherRefundsCommittedCents(order: Order, incident: OrderIncident): number {
  return (order.incidents ?? [])
    .filter((existing) => existing.id !== incident.id && existing.resolution)
    .reduce((sum, existing) => {
      const resolution = existing.resolution!;
      if (typeof resolution.refundOwedCents === "number") return sum + Math.max(0, resolution.refundOwedCents);
      // Legacy transition: unit price × quantity (pre-reconcile writes).
      return sum + Math.max(0, (resolution.refundUnitPriceCents ?? 0)) * Math.max(1, Math.round(existing.quantity || 1));
    }, 0);
}

function otherSaleAdjustmentsCents(order: Order, incident: OrderIncident): number {
  return (order.incidents ?? [])
    .filter((existing) => existing.id !== incident.id && existing.resolution)
    .reduce((sum, existing) => {
      const resolution = existing.resolution!;
      const quantity = Math.max(1, Math.round(existing.quantity || 1));
      if (typeof resolution.saleAdjustmentUnitCents === "number") {
        // Stored as the POSITIVE unit value; the adjustment it causes is negative.
        return sum - resolution.saleAdjustmentUnitCents * quantity;
      }
      // Legacy transition: refunds used refundUnitPriceCents as the
      // adjustment; charged replacements adjusted by the price difference
      // (mirrors orderMoney so siblings never diverge — r3 review F1).
      if (resolution.kind === "refund") {
        return sum - (resolution.refundUnitPriceCents ?? 0) * quantity;
      }
      if (existing.replacement?.chargeDifference) {
        return sum + (existing.replacement.unitPriceCents - Math.max(0, existing.originalUnitPriceCents)) * quantity;
      }
      return sum;
    }, 0);
}

export type IncidentMoney = {
  /** How this incident changes the sale (negative: the clienta's favor). */
  saleAdjustmentCents: number;
  /** The value the clienta is owed for this incident (capped, reconciled). */
  reconciledCents: number;
  /** Part recovered by RESTITUTING applied credit to its origins (no cash). */
  restitutionCents: number;
  /** The cash obligation when the clienta chose a pending refund. */
  refundOwedCents: (destination: "refund_pending" | "credit_accepted") => number;
};

/**
 * The reconciliation. Adjustment by operation (r2-criterio 2): a return takes
 * the whole piece out of the sale; a cheaper replacement takes only the price
 * difference out. Reconciled value (r2-criterio 1) counts money the clienta
 * actually covered — direct cobros AND applied credit — over the effective
 * sale after this adjustment, minus credit already consumed by sister orders
 * and refunds already committed; the credit part is restituted (never paid
 * twice), only the cash part becomes a refund obligation.
 */
export function reconcileIncidentMoney(order: Order, incident: OrderIncident): IncidentMoney {
  const quantity = Math.max(1, Math.round(incident.quantity || 1));
  const pieceCents = Math.max(0, incident.originalUnitPriceCents) * quantity;
  const resolution = incident.resolution;
  const kind = resolution?.kind;

  // 1. Sale adjustment, by operation.
  let saleAdjustmentCents = 0;
  if (kind === "refund") {
    saleAdjustmentCents = -pieceCents;
  } else if (kind === "replacement_with_difference" && incident.replacement?.chargeDifference) {
    saleAdjustmentCents = (incident.replacement.unitPriceCents - Math.max(0, incident.originalUnitPriceCents)) * quantity;
  }

  // 2. Effective sale after this and every other incident's adjustment.
  const effectiveTotalAfter = Math.max(0, orderTotalCentsOf(order) + otherSaleAdjustmentsCents(order, incident) + saleAdjustmentCents);

  // 3. Reconciled value: what she actually covered minus what she still owes.
  const coveredCents = docReceivedCents(order) + creditAppliedOf(order);
  const excedente = coveredCents - effectiveTotalAfter - creditConsumedOf(order) - otherRefundsCommittedCents(order, incident);
  const cap = kind === "refund" ? pieceCents : kind === "replacement_with_difference" ? Math.max(0, -saleAdjustmentCents) : 0;
  const reconciledCents = Math.max(0, Math.min(cap, excedente));

  // 4. Credit restitution first (undo the compensation; the origin recovers),
  //    cash remainder becomes the refund obligation when she chose refund.
  const restitutionCents = Math.min(creditAppliedOf(order), reconciledCents);
  const cashCents = reconciledCents - restitutionCents;
  return {
    saleAdjustmentCents,
    reconciledCents,
    restitutionCents,
    refundOwedCents: (destination) => (destination === "refund_pending" ? cashCents : 0),
  };
}
