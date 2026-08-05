import type { Product, PurchaseLine, Order, OrderStatus } from "../types";

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
// Once delivered/paid, the stock is no longer committed (it's gone out).
const OPEN_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "asked",
  "confirmed",
  "to_buy",
  "bought",
  "arrived",
]);

/**
 * Sum of quantities of open (non-terminal) orders for a product in a store.
 * Used to show "Comprometido" alongside the available quantityOnHand.
 */
export function committedForProduct(
  orders: Order[],
  storeId: string,
  productId: string
): number {
  return orders
    .filter(
      (o) =>
        o.storeId === storeId &&
        o.productId === productId &&
        OPEN_STATUSES.has(o.status)
    )
    .reduce((sum, o) => sum + o.quantity, 0);
}

/**
 * The stock delta to apply when an order's reserved quantity changes.
 * Returns negative for reserve (more stock held), positive for release.
 * oldQty undefined = new order; newQty undefined = deletion.
 */
export function reservationDelta(
  oldQty: number | undefined,
  newQty: number | undefined
): number {
  const oldResolved = oldQty ?? 0;
  const newResolved = newQty ?? 0;
  return oldResolved - newResolved; // negative = reserve, positive = release
}
