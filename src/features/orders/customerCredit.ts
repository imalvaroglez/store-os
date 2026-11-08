// Customer credit (#189): the money rules behind per-customer balances and
// the automatic compensation between orders of the same clienta and store.
//
// PO decisions 2026-11-05 (the issue is the contract — do not reopen):
// - A surplus (received > total) on one order is credit available to the
//   customer; it compensates the pending balance of her OTHER orders,
//   oldest first, automatically and without per-application confirmation.
// - A remainder with no applicable order stays available for future orders.
// - Compensation reduces what the customer owes; it is NOT a new payment,
//   never touches sales, costs, prices, or the month money was received.
// - Cancelling an order that used credit restitutes it (release entries).
// - Refunds and partial returns are OUT of scope here (#203 owns them);
//   cancelled orders are excluded from both sides and shown as information.
//
// Age and tie-break (agent decision, recorded per the issue): orders rank by
// `createdAt`, ties broken by `id` — deterministic and stable across sessions.
// All arithmetic is exact cents over the ORDER DOCUMENT money (#168 pattern:
// `docReceivedCents` accumulator), so planning needs zero extra reads.
import type { Order } from "../../types";
import { docReceivedCents, orderAmountCents } from "../../lib/orderMoney";
import { orderItems } from "../../lib/orders";
import { incidentsRefundCommittedCents, incidentsSaleAdjustmentCents } from "../../lib/orderMoney";


/** Any order-shaped record with unknown extra fields (migrated docs). */
type OrderLike = Partial<Order> & Record<string, unknown>;

/** Σ frozen line snapshots — the order's sales total in exact cents. */
function orderTotalCents(order: OrderLike): number {
  return orderItems(order).reduce((sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity), 0);
}

/**
 * #203: the EFFECTIVE total — the historical sale plus the incidents' sale
 * adjustments (a charged upgrade adds the difference; a refund removes the
 * piece at its historical price). The historical total is never rewritten;
 * this is what the clienta actually owes after posventa.
 */
function effectiveTotalCents(order: OrderLike): number {
  return Math.max(0, orderTotalCents(order) + incidentsSaleAdjustmentCents(order.incidents));
}

/** Net credit applied TO this order (destination accumulator; #168 pattern). */
export function creditAppliedCents(order: OrderLike): number {
  const applied = order.creditAppliedCents;
  return typeof applied === "number" && Number.isFinite(applied) ? applied : 0;
}

/** This order's surplus still available to compensate sister orders. */
export function creditAvailableCents(order: OrderLike): number {
  const surplus = docReceivedCents(order) - effectiveTotalCents(order);
  if (surplus <= 0) return 0;
  const consumed = order.creditConsumedCents;
  const consumedCents = typeof consumed === "number" && Number.isFinite(consumed) ? Math.max(0, consumed) : 0;
  // #203: refund money is NEVER credit — agreed refunds block the surplus
  // whether or not the cash has been handed back yet (executing the refund
  // must not surface it as saldo a favor; review #212 F1).
  return Math.max(0, surplus - consumedCents - incidentsRefundCommittedCents(order.incidents));
}

/** What the customer still owes on this order, net of credit applied to it
 * and of the incidents' sale adjustments (#203 effective total). */
export function pendingCents(order: OrderLike): number {
  const pending = effectiveTotalCents(order) - docReceivedCents(order) - creditAppliedCents(order);
  return Math.max(0, pending);
}

/** The customer's orders, isolated by store AND customer — never mix tenants. */
export function ordersForCustomer(orders: Order[], storeId: string, customerId: string): Order[] {
  return orders.filter((order) => order.storeId === storeId && order.customerId === customerId);
}

/** One planned compensation: `from` holds the credit, `to` owes the money. */
export type PlannedCreditApplication = {
  fromOrderId: string;
  toOrderId: string;
  amountCents: number;
};

/** Deterministic age: createdAt, ties broken by id (documented contract). */
function byAge(a: { id: string; createdAt: string }, b: { id: string; createdAt: string }): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * The pure reconciliation plan over one customer's orders: oldest debt first,
 * oldest credit first, never over-applying on either side. Re-running after a
 * successful application yields an empty plan (idempotent by construction:
 * the persisted accumulators feed the next computation).
 * Cancelled orders never give or receive credit.
 */
export function planCreditApplications(orders: Order[]): PlannedCreditApplication[] {
  const active = orders.filter((order) => order.orderStatus !== "cancelled");
  const credits = active
    .filter((order) => creditAvailableCents(order) > 0)
    .sort(byAge);
  const debts = active
    .filter((order) => pendingCents(order) > 0)
    .sort(byAge);
  const remaining = new Map(credits.map((order) => [order.id, creditAvailableCents(order)]));
  const plan: PlannedCreditApplication[] = [];
  for (const debt of debts) {
    let need = pendingCents(debt);
    for (const credit of credits) {
      if (need <= 0) break;
      const have = remaining.get(credit.id) ?? 0;
      if (have <= 0) continue;
      const amountCents = Math.min(need, have);
      plan.push({ fromOrderId: credit.id, toOrderId: debt.id, amountCents });
      remaining.set(credit.id, have - amountCents);
      need -= amountCents;
    }
  }
  return plan;
}

export type CustomerOrderBalance = {
  orderId: string;
  orderStatus: Order["orderStatus"];
  /** Positive: the customer owes this after credit. */
  pendingCents: number;
  /** Positive: this order still holds unconsumed credit. */
  creditCents: number;
  /** Credit applied TO this order from sister orders. */
  creditAppliedCents: number;
};

export type CustomerBalanceSummary = {
  /** Σ pending across the customer's non-cancelled orders. */
  pendingCents: number;
  /** Σ unconsumed credit across her non-cancelled orders. */
  creditCents: number;
  /** pending − credit: the net amount to collect from her today. */
  netCents: number;
  /** Money received on cancelled orders — excluded from compensation; its
   * destination (refund/credit) is decided through #203, never here. */
  cancelledWithPaymentsCents: number;
  /** Per-order breakdown, oldest first — the traceable evidence. */
  orders: CustomerOrderBalance[];
};

/** The read model for the per-customer balance view. */
export function customerBalanceSummary(orders: Order[], storeId: string, customerId: string): CustomerBalanceSummary {
  const mine = ordersForCustomer(orders, storeId, customerId).slice().sort(byAge);
  const rows = mine.map((order) => ({
    orderId: order.id,
    orderStatus: order.orderStatus,
    pendingCents: order.orderStatus === "cancelled" ? 0 : pendingCents(order),
    creditCents: order.orderStatus === "cancelled" ? 0 : creditAvailableCents(order),
    creditAppliedCents: creditAppliedCents(order),
  }));
  const pending = rows.filter((row) => row.orderStatus !== "cancelled").reduce((sum, row) => sum + row.pendingCents, 0);
  const credit = rows.filter((row) => row.orderStatus !== "cancelled").reduce((sum, row) => sum + row.creditCents, 0);
  const cancelledWithPaymentsCents = mine
    .filter((order) => order.orderStatus === "cancelled")
    .reduce((sum, order) => sum + Math.max(0, docReceivedCents(order)), 0);
  return {
    pendingCents: pending,
    creditCents: credit,
    netCents: pending - credit,
    cancelledWithPaymentsCents,
    orders: rows,
  };
}
