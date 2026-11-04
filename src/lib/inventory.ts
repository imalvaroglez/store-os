import type { Product, PurchaseLine, Order, OrderItem, OrderStatus } from "../types";
import { effectiveOrderStatus, orderItems, orderStatusIsOpen } from "./orders";

// Inventory math — pure functions used by the StoreProvider (to apply purchases
// and reserve stock on order changes) and by the inventory UI (committed stock).
// Unit-tested in inventory.test.ts. No side effects; callers write to state.

/**
 * Weighted-average cost after a purchase.
 * ((currentQty × currentCost) + (buyQty × buyCost)) / (currentQty + buyQty)
 *
 * Per the spec: when `currentCost` is undefined (first purchase) OR
 * `currentQty` is undefined/0/negative, the existing stock contributes nothing
 * — the new unit cost establishes the cost. Averaging a known cost against
 * unknown-cost stock as if it were $0 would understate the cost, so the
 * undefined-cost case must short-circuit, not zero-fill.
 */
export function weightedAverageCost(
  currentCost: number | undefined,
  currentQty: number | undefined,
  buyQty: number,
  buyCost: number
): number {
  const hasExisting =
    typeof currentQty === "number" && currentQty > 0 && typeof currentCost === "number";
  if (!hasExisting) return buyCost;
  const totalQty = currentQty + buyQty;
  if (totalQty <= 0) return buyCost;
  return (currentQty * currentCost + buyQty * buyCost) / totalQty;
}

export type ProductStockUpdate = { quantityOnHand: number; cost: number };

// --- Stock alerts (FER-09) ---------------------------------------------------

/**
 * Conservative default low-stock threshold, used when a product has no
 * `lowStockAt` saved. Applied at derivation time only — never written back to
 * Firestore (zero extra writes/reads; alerts derive from synced state).
 * Matches the "Alerta en" placeholder in ProductForm. PO-autonomy adoption,
 * reversible by changing this constant.
 */
export const DEFAULT_LOW_STOCK_AT = 3;

/** Effective alert threshold: the product's own, else the store-wide default. */
export function effectiveLowStockAt(p: Pick<Product, "lowStockAt">): number {
  return typeof p.lowStockAt === "number" && Number.isFinite(p.lowStockAt)
    ? p.lowStockAt
    : DEFAULT_LOW_STOCK_AT;
}

export type StockAlertLevel = "out" | "low";

/**
 * Restock alert level for a product, always derived (never stored):
 * - "out": quantityOnHand <= 0 — Agotado (0) or Faltan N (negative).
 * - "low": 0 < quantityOnHand <= effectiveLowStockAt — "Quedan N".
 * - null: untracked stock (on-demand stores) or healthy stock — no alert.
 */
export function stockAlertLevel(
  p: Pick<Product, "quantityOnHand" | "lowStockAt">
): StockAlertLevel | null {
  if (typeof p.quantityOnHand !== "number" || !Number.isFinite(p.quantityOnHand)) return null;
  if (p.quantityOnHand <= 0) return "out";
  return p.quantityOnHand <= effectiveLowStockAt(p) ? "low" : null;
}

/** Clear Spanish (Mexico) text for a product flagged by stockAlertLevel. */
export function stockAlertText(p: Pick<Product, "quantityOnHand">): string {
  const qty = p.quantityOnHand ?? 0;
  if (qty < 0) return `Faltan ${Math.abs(qty)}`;
  if (qty === 0) return "Agotado";
  return `Quedan ${qty}`;
}

/**
 * Compute the stock + cost updates a purchase applies to each product.
 * Returns a Map<productId, ProductStockUpdate>. Lines whose product isn't in
 * the array are ignored (the product was deleted). When the same product
 * appears in multiple lines, the updates accumulate (each line builds on the
 * previous one's result). Pure — caller writes.
 */
export function applyPurchaseLines(
  products: Product[],
  lines: PurchaseLine[]
): Map<string, ProductStockUpdate> {
  const byId = new Map(products.map((p) => [p.id, p]));
  const updates = new Map<string, ProductStockUpdate>();
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) continue;
    // If a prior line already updated this product, build on top of it so two
    // lines for the same product both count (weighted in order).
    const prev = updates.get(line.productId);
    const baseQty = prev?.quantityOnHand ?? product.quantityOnHand ?? 0;
    const baseCost = prev?.cost ?? product.cost;
    const newQty = baseQty + line.quantity;
    const newCost = weightedAverageCost(baseCost, baseQty, line.quantity, line.unitCost);
    updates.set(line.productId, { quantityOnHand: newQty, cost: newCost });
  }
  return updates;
}

// Order statuses that are "still open" — the stock is still committed.
// Once delivered/cancelled, the stock is no longer committed.
const OPEN_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "asked",
  "quoted",
  "confirmed",
  "preparing",
  "ready",
]);

/**
 * Sum of stock still held for pending delivery, including retained reservations.
 * Used to show "Comprometido" alongside the available quantityOnHand.
 */
export function committedForProduct(
  orders: Order[],
  storeId: string,
  productId: string
): number {
  return orders
    .filter((o) => {
      if (o.storeId !== storeId) return false;
      const status = effectiveOrderStatus(o);
      if (o.installmentsReservedAt) return status !== "delivered";
      return !o.installments && OPEN_STATUSES.has(status);
    })
    .reduce((sum, o) => sum + orderItems(o).filter((item) => item.productId === productId).reduce((lineSum, item) => lineSum + item.quantity, 0), 0);
}

/** Aggregate reservation changes by product across all lines in an order. */
export function reservationDeltas(oldItems: OrderItem[], newItems: OrderItem[]): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const item of oldItems) {
    if (item.productId) deltas.set(item.productId, (deltas.get(item.productId) ?? 0) + item.quantity);
  }
  for (const item of newItems) {
    if (item.productId) deltas.set(item.productId, (deltas.get(item.productId) ?? 0) - item.quantity);
  }
  return new Map([...deltas].filter(([, delta]) => delta !== 0));
}

/**
 * Reservation delta for a lifecycle transition, expressed as a contribution
 * model: open AND delivered orders both hold stock (reserved or consumed —
 * either way it is out of the shelf); cancelled orders hold none. Cancelling a
 * delivered sale returns the goods; re-delivering takes them again, so every
 * cycle nets to exactly one consumption. Stateless — no provenance flag.
 *
 * Installment orders (PO decision 2026-11-03 R8, replacing the #165 deferral):
 * a plan reserves AT CREATION exactly like an ordinary order. Once money backs
 * the pieces (`installmentsReservedAt` witness or `paymentsReceivedCents` > 0)
 * they STAY held — even after cancellation — because money was received
 * against them: releasing stock or refunding is an explicit human action,
 * never an inference.
 */
export function reservationDeltasForOrderChange(previous: Order | undefined, next: Order): Map<string, number> {
  const heldItems = (order: Order | undefined): OrderItem[] => {
    if (!order) return [];
    // The reservation survives removing the plan (#174): it is stock evidence,
    // not a property of the currently selected payment schedule. PO 2026-11-03
    // (R8): plans hold from creation like ordinary orders; received money
    // keeps the pieces held even after cancellation.
    if (order.installmentsReservedAt || (order.installments && (order.paymentsReceivedCents ?? 0) > 0)) {
      return orderItems(order);
    }
    const status = effectiveOrderStatus(order);
    return orderStatusIsOpen(status) || status === "delivered" ? orderItems(order) : [];
  };
  return reservationDeltas(heldItems(previous), heldItems(next));
}
