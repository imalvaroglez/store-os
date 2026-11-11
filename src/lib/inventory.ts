import type { Product, PurchaseLine, Order, OrderItem } from "../types";
import { variantReservationDeltas, type VariantStockDelta } from "./variants";
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

/**
 * Sum of stock still held for PENDING delivery — the "Comprometido" the
 * product card shows next to the available quantityOnHand. Mirrors
 * `holdsPieces` exactly (creation-time plan reservations included, R8) minus
 * delivered orders, whose pieces are consumed rather than committed.
 */
export function committedForProduct(
  orders: Order[],
  storeId: string,
  productId: string
): number {
  return orders
    .filter((o) => o.storeId === storeId && holdsPieces(o) && effectiveOrderStatus(o) !== "delivered")
    .reduce((sum, o) => sum + orderItems(o).filter((item) => item.productId === productId).reduce((lineSum, item) => lineSum + item.quantity, 0), 0);
}

/**
 * Aggregate reservation changes by product across all lines in an order.
 * #124: lines that carry a variantId move THEIR COLOR's stock (see
 * variantReservationDeltas) — a line moves exactly one stock dimension, so
 * product-level aggregation skips variant lines. Legacy lines (no variant)
 * on a design that later gained variants still land here, fail-closed.
 */
export function reservationDeltas(oldItems: OrderItem[], newItems: OrderItem[]): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const item of oldItems) {
    if (item.productId && !item.variantId) deltas.set(item.productId, (deltas.get(item.productId) ?? 0) + item.quantity);
  }
  for (const item of newItems) {
    if (item.productId && !item.variantId) deltas.set(item.productId, (deltas.get(item.productId) ?? 0) - item.quantity);
  }
  return new Map([...deltas].filter(([, delta]) => delta !== 0));
}

/** #124: per-color reservation deltas for a lifecycle change — mirrors
 * reservationDeltasForOrderChange (same holdsPieces truth). */
export function variantReservationDeltasForOrderChange(
  previous: Order | undefined,
  next: Order
): Map<string, VariantStockDelta> {
  const heldItems = (order: Order | undefined): OrderItem[] =>
    order && holdsPieces(order) ? orderItems(order) : [];
  return variantReservationDeltas(heldItems(previous), heldItems(next));
}

/**
 * Does this order currently hold pieces out of the shelf (reserved or
 * consumed)? The ONE truth shared by the reservation model and the
 * "Comprometido" count — they must never diverge again (Codex review
 * 2026-11-04 found the selector still excluding creation-time reservations).
 *
 * The reservation survives removing the plan (#174): it is stock evidence,
 * not a property of the currently selected payment schedule. Money-backed
 * pieces (witness or accumulator) stay held even after cancellation.
 * Everything else — ordinary orders and plans without money (PO decision
 * 2026-11-03 R8: plans reserve AT CREATION) — holds while open or delivered.
 */
function holdsPieces(o: Order): boolean {
  if (o.installmentsReservedAt || (o.installments && (o.paymentsReceivedCents ?? 0) > 0)) {
    return true;
  }
  const status = effectiveOrderStatus(o);
  return orderStatusIsOpen(status) || status === "delivered";
}

/**
 * Reservation delta for a lifecycle transition, expressed as a contribution
 * model over `holdsPieces`: open AND delivered orders both hold stock
 * (reserved or consumed — either way it is out of the shelf). Cancelling a
 * delivered sale returns the goods; re-delivering takes them again, so every
 * cycle nets to exactly one consumption. Stateless — no provenance flag.
 */
export function reservationDeltasForOrderChange(previous: Order | undefined, next: Order): Map<string, number> {
  const heldItems = (order: Order | undefined): OrderItem[] =>
    order && holdsPieces(order) ? orderItems(order) : [];
  return reservationDeltas(heldItems(previous), heldItems(next));
}

// --- #309: canonical shortage derivation (observability only) ------------

/** The stock dimension an order line moves — variant stock for variant lines,
 * product stock otherwise (#124: variant stock never lands on the design
 * level). Keyed exactly like variantReservationDeltas. */
export function stockDimensionKey(productId: string, variantId?: string): string {
  return variantId ? `${productId}:${variantId}` : productId;
}

export type DimensionShortage = {
  key: string;
  productId: string;
  variantId?: string;
  missing: number;
};

type ShortageProduct = Pick<Product, "id" | "quantityOnHand" | "variants">;

/** Pieces each stock dimension is SHORT (negative stock), derived from the
 * exact dimension every item moves. The card's "Faltan N" badge, the order
 * editor and the category review ALL share this function so they can never
 * disagree (#309). Pure — never mutates stock or orders. */
export function shortageByDimension(
  items: ReadonlyArray<Pick<OrderItem, "productId" | "variantId">>,
  products: ReadonlyArray<ShortageProduct>
): Map<string, DimensionShortage> {
  const byId = new Map(products.map((product) => [product.id, product]));
  const result = new Map<string, DimensionShortage>();
  for (const item of items) {
    if (!item.productId) continue;
    const key = stockDimensionKey(item.productId, item.variantId);
    if (result.has(key)) continue;
    const product = byId.get(item.productId);
    if (!product) continue;
    const stock = item.variantId
      ? product.variants?.find((variant) => variant.id === item.variantId)?.quantityOnHand
      : product.quantityOnHand;
    if (typeof stock === "number" && stock < 0) {
      result.set(key, {
        key,
        productId: item.productId,
        ...(item.variantId ? { variantId: item.variantId } : {}),
        missing: -stock,
      });
    }
  }
  return result;
}

/** Deterministic per-LINE attribution of dimension shortages (#309): lines
 * consume their dimension's missing count in capture order, so the line
 * indicators always sum EXACTLY to the badge total. Only entries > 0 are
 * returned. `key` is the caller's line identity (DraftLine key / lineId). */
export function attributeShortageToLines<T extends { key: string; productId?: string; variantId?: string; quantity: number }>(
  lines: ReadonlyArray<T>,
  products: ReadonlyArray<ShortageProduct>
): Map<string, number> {
  const remaining = new Map<string, number>();
  for (const shortage of shortageByDimension(lines, products).values()) {
    remaining.set(shortage.key, shortage.missing);
  }
  const perLine = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId) continue;
    const dimensionKey = stockDimensionKey(line.productId, line.variantId);
    const left = remaining.get(dimensionKey);
    if (!left) continue;
    const missing = Math.min(Math.max(0, line.quantity), left);
    if (missing > 0) {
      perLine.set(line.key, missing);
      remaining.set(dimensionKey, left - missing);
    }
  }
  return perLine;
}
