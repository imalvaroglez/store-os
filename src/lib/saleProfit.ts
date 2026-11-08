import type { Order, OrderItem, Purchase } from "../types";
import { effectivePurchaseStatus } from "../types";
import { orderItems } from "./orders";
import { orderAmountCents } from "./orderMoney";
import { purchaseProductSaleCosts } from "./purchases";

/**
 * Full sale cost and profit per order (FER-03). Profit = sold price −
 * acquisition cost − per-piece sale expenses. Acquisition comes from the
 * line's cost snapshot (OrderItem.cost, captured from Product.cost which
 * already excludes sale expenses per FER-02); sale expenses are estimated at
 * view time from the purchase evidence, so the two never overlap.
 */
export type OrderProfitBreakdown = {
  /** Σ unitPrice × quantity over lines with a known cost. */
  revenueCents: number;
  /** Σ cost × quantity over lines with a known cost. */
  acquisitionCents: number;
  /** Σ per-piece sale-expense estimates over lines with a known cost. */
  saleExpenseCents: number;
  /** revenue − acquisition − saleExpense. Null when NO line has a known cost:
   * an honest "sin costo", never an invented profit. */
  profitCents: number | null;
  /** Lines excluded from the estimate because their cost is unknown. */
  linesWithoutCost: number;
};

/** Latest received trip that bought the product, like latest_purchase costing:
 * older trips' sale expenses were consumed by earlier sales and are not
 * re-counted (no ledger, no double counting). */
function latestSaleCost(purchases: Purchase[], storeId: string, productId: string): { cents: number; pieces: number } | undefined {
  let winner: { at: string; cents: number; pieces: number } | undefined;
  for (const purchase of purchases) {
    if (purchase.storeId !== storeId || effectivePurchaseStatus(purchase) !== "received") continue;
    if (!purchase.lines.some((line) => line.productId === productId)) continue;
    const entry = purchaseProductSaleCosts(purchase).get(productId);
    if (!entry || entry.quantity <= 0) continue;
    const at = purchase.receivedAt ?? purchase.updatedAt ?? purchase.createdAt ?? "";
    if (!winner || at > winner.at) winner = { at, cents: entry.cents, pieces: entry.quantity };
  }
  return winner ? { cents: winner.cents, pieces: winner.pieces } : undefined;
}

/** Sale-expense cents for a sale line: quantity × per-piece estimate, rounded
 * half-up to the exact cent in integer arithmetic. Zero when there is no
 * purchase evidence for the product. */
export function lineSaleExpenseCents(purchases: Purchase[], storeId: string, productId: string | undefined, quantity: number): number {
  if (!productId || !Number.isSafeInteger(quantity) || quantity <= 0) return 0;
  const estimate = latestSaleCost(purchases, storeId, productId);
  if (!estimate) return 0;
  const total = quantity * estimate.cents;
  if (!Number.isSafeInteger(total)) throw new RangeError("Sale expense estimate exceeds safe precision");
  return Math.floor((total * 2 + estimate.pieces) / (estimate.pieces * 2));
}

export function itemsProfitBreakdown(items: OrderItem[], storeId: string, purchases: Purchase[]): OrderProfitBreakdown {
  let revenueCents = 0;
  let acquisitionCents = 0;
  let saleExpenseCents = 0;
  let linesWithoutCost = 0;
  let known = false;
  for (const item of items) {
    // Unknown or malformed cost stays unknown: it never becomes a zero-cost
    // line that would inflate the estimate.
    if (item.cost == null || !Number.isFinite(item.cost) || item.cost < 0) {
      linesWithoutCost += 1;
      continue;
    }
    known = true;
    revenueCents += orderAmountCents(item.unitPrice, item.quantity);
    acquisitionCents += orderAmountCents(item.cost, item.quantity);
    saleExpenseCents += lineSaleExpenseCents(purchases, storeId, item.productId, item.quantity);
  }
  return {
    revenueCents,
    acquisitionCents,
    saleExpenseCents,
    profitCents: known ? revenueCents - acquisitionCents - saleExpenseCents : null,
    linesWithoutCost,
  };
}

export function orderProfitBreakdown(order: Order, purchases: Purchase[]): OrderProfitBreakdown {
  const breakdown = itemsProfitBreakdown(orderItems(order), order.storeId, purchases);
  // #184: direct sale-side charges on this order (loose expense assignments
  // and supply consumptions) reduce the profit — never the sale total nor the
  // clienta's balance. Append-only evidence, exact cents.
  const directCents = (order.saleExpenses ?? []).reduce(
    (sum, charge) => sum + (Number.isSafeInteger(charge.amountCents) ? charge.amountCents : 0),
    0
  );
  if (directCents === 0) return breakdown;
  return {
    ...breakdown,
    saleExpenseCents: breakdown.saleExpenseCents + directCents,
    profitCents: breakdown.profitCents == null ? null : breakdown.profitCents - directCents,
  };
}
