import type { Product, PurchaseLine, Order, OrderItem } from "../types";
import {
  combinationReservationDeltas,
  totalStock,
  variantHasSizes,
  variantReservationDeltas,
  type CombinationStockDelta,
  type VariantStockDelta,
} from "./variants";
import { effectiveOrderStatus, orderItems, orderReference, orderStatusIsOpen } from "./orders";

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

/** #461: a delivery already recorded WITHOUT talla for this line's color.
 * That evidence keeps its own dimension: the line can no longer be assigned a
 * talla (the record would stop discounting it). */
export function lineSoldWithoutSize(
  order: Pick<Order, "deliveries"> | undefined,
  item: Pick<OrderItem, "productId" | "variantId" | "variantSizeId">
): boolean {
  if (!item.productId || !item.variantId || item.variantSizeId) return false;
  return (order?.deliveries ?? []).some((event) =>
    event.lines.some(
      (line) => line.productId === item.productId && line.variantId === item.variantId && !line.variantSizeId
    )
  );
}

/** #461: the capture must name the talla — the chosen color sells by size and
 * the line carries none. False when the color sells by color alone, and for a
 * line whose delivery was already recorded without talla (it stays as sold). */
export function lineNeedsSize(
  order: Pick<Order, "deliveries"> | undefined,
  item: Pick<OrderItem, "productId" | "variantId" | "variantSizeId">,
  product: Pick<Product, "variants"> | undefined
): boolean {
  if (!item.productId || !item.variantId || item.variantSizeId || !product) return false;
  const variant = product.variants?.find((candidate) => candidate.id === item.variantId);
  if (!variant || !variantHasSizes(variant)) return false;
  return !lineSoldWithoutSize(order, item);
}

export type StockAlertLevel = "out" | "low";

/**
 * Restock alert level for a product, always derived (never stored):
 * - "out": stock <= 0 — Agotado (0) or Faltan N (negative).
 * - "low": 0 < stock <= effectiveLowStockAt — "Quedan N".
 * - null: untracked stock (on-demand stores) or healthy stock — no alert.
 *
 * #365: stock is the SAME aggregate the card shows (totalStock) — for a color
 * design that is the sum of its variants' shelves (null when no color tracks
 * one: "sin dato", never 0). Reading the erased design-level quantityOnHand
 * here left converted designs blind to "Por surtir" and the Agotado/Faltan N
 * badge. The order line's shortage still measures ITS color (#309) — this
 * aggregate never proves a specific color's availability.
 */
export function stockAlertLevel(
  p: Pick<Product, "quantityOnHand" | "lowStockAt" | "variants">
): StockAlertLevel | null {
  const stock = totalStock(p);
  if (stock === null) return null;
  if (stock <= 0) return "out";
  return stock <= effectiveLowStockAt(p) ? "low" : null;
}

/** Clear Spanish (Mexico) text for a product flagged by stockAlertLevel
 * (variant aggregate included, #365). */
export function stockAlertText(p: Pick<Product, "quantityOnHand" | "variants">): string {
  const qty = totalStock(p) ?? 0;
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

/** #463: one row per order that still holds pending pieces of the product. */
export type CommittedLine = {
  variantId?: string;
  variantColor?: string;
  /** #461: the exact combination this pending line holds, when the line
   * carries a size. */
  variantSizeId?: string;
  variantSize?: string;
  quantity: number;
};

export type CommittedOrderRow = {
  orderId: string;
  /** The same visible reference Pedidos shows (#TOR…). */
  reference: string;
  customerId?: string;
  /** Cancelled but still holding (money-backed R9) — the row must say so. */
  cancelled: boolean;
  /** Pending pieces unified per variant (no variantId: design-level line). */
  lines: CommittedLine[];
  /** This order's pending pieces of the product (Σ lines). */
  total: number;
};

export type CommittedBreakdown = { total: number; rows: CommittedOrderRow[] };

/**
 * #463: THE single derivation of a product's "Comprometido" — the figure the
 * card shows AND its per-order breakdown both come from here, so they can
 * never disagree. Pieces still PENDING delivery, per stock dimension:
 * creation-time plan reservations included (R8), partial deliveries
 * subtract (#333 — the delivered piece left with the clienta, it is not
 * committed), fully delivered orders are consumed rather than committed, and
 * a money-backed cancelled order keeps its still-pending pieces off the
 * shelf with its row flagged cancelled.
 */
export function committedBreakdownForProduct(
  orders: Order[],
  storeId: string,
  productId: string
): CommittedBreakdown {
  const rows: CommittedOrderRow[] = [];
  let total = 0;
  for (const order of orders) {
    if (order.storeId !== storeId || !holdsPieces(order)) continue;
    const status = effectiveOrderStatus(order);
    if (status === "delivered") continue; // consumed, not committed
    // Delivered-so-far per dimension, consumed line by line so each pending
    // quantity lands on its own line (the same greedy walk heldOrderItems
    // uses — a delivered piece always discounts its own dimension).
    const delivered = new Map(deliveredByDimension(order));
    const byVariant = new Map<string, CommittedLine>();
    let orderTotal = 0;
    for (const item of orderItems(order)) {
      if (item.productId !== productId) continue;
      const key = stockDimensionKey(item.productId, item.variantId, item.variantSizeId);
      const left = Math.max(0, delivered.get(key) ?? 0);
      const take = Math.min(item.quantity, left);
      delivered.set(key, left - take);
      const pending = item.quantity - take;
      if (pending <= 0) continue;
      // #461: a line with a size is its OWN dimension (color × size); lines
      // of the same color without sizes keep sharing the color dimension.
      const variantKey = item.variantId && item.variantSizeId ? `${item.variantId}:${item.variantSizeId}` : (item.variantId ?? "");
      const existing = byVariant.get(variantKey);
      if (existing) existing.quantity += pending;
      else byVariant.set(variantKey, {
        ...(item.variantId ? { variantId: item.variantId } : {}),
        ...(item.variantColor ? { variantColor: item.variantColor } : {}),
        ...(item.variantSizeId ? { variantSizeId: item.variantSizeId, ...(item.variantSize ? { variantSize: item.variantSize } : {}) } : {}),
        quantity: pending,
      });
      orderTotal += pending;
    }
    if (orderTotal <= 0) continue;
    rows.push({
      orderId: order.id,
      reference: orderReference(order.id),
      ...(order.customerId ? { customerId: order.customerId } : {}),
      cancelled: status === "cancelled",
      lines: [...byVariant.values()],
      total: orderTotal,
    });
    total += orderTotal;
  }
  return { total, rows };
}

/**
 * Sum of stock still held for PENDING delivery — the "Comprometido" the
 * product card shows next to the available quantityOnHand. Derived from the
 * same breakdown the #463 drill-down shows (one truth for both).
 */
export function committedForProduct(
  orders: Order[],
  storeId: string,
  productId: string
): number {
  return committedBreakdownForProduct(orders, storeId, productId).total;
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
  // Same held-items truth as the plain reservation above (#333 partial cap
  // included) — variant stock must not diverge from design stock on a
  // partial-delivery cancellation.
  return variantReservationDeltas(heldOrderItems(previous), heldOrderItems(next));
}

/** #461: per-combination reservation deltas for a lifecycle change — the
 * size-level mirror of variantReservationDeltasForOrderChange (same
 * holdsPieces truth, same partial-delivery cap). */
export function combinationReservationDeltasForOrderChange(
  previous: Order | undefined,
  next: Order
): Map<string, CombinationStockDelta> {
  return combinationReservationDeltas(heldOrderItems(previous), heldOrderItems(next));
}

/** #461: what a line sold WITHOUT talla still holds across a change, when its
 * color now sells by size. The old reservation has no shelf of its own: if the
 * person assigns the talla in this same change (`nextSizeId`), the pieces go
 * to THAT combination; otherwise they stay «sin talla» on the color. */
export type ColorLevelLineMove = {
  lineId: string;
  productId: string;
  variantId: string;
  /** Pieces the line held before the change. */
  previousHeld: number;
  /** Pieces it still holds after (0 when released; the consumed pieces when
   * cancelled after a partial delivery). */
  nextHeld: number;
  /** The talla assigned to the line in this change — absent when it keeps no talla. */
  nextSizeId?: string;
  /** True when a talla was assigned but a delivery recorded WITHOUT talla
   * stops it: the save must fail closed (the evidence would no longer
   * discount the line). */
  remapBlocked?: boolean;
};

export function colorLevelLineMoves(
  previous: Order | undefined,
  next: Order,
  productId: string,
  variantId: string
): ColorLevelLineMove[] {
  if (!previous) return [];
  const isColorLevel = (item: OrderItem) =>
    item.productId === productId && item.variantId === variantId && !item.variantSizeId;
  const previousHeld = new Map<string, number>();
  for (const item of heldOrderItems(previous)) {
    if (!isColorLevel(item)) continue;
    const lineId = item.lineId ?? "";
    previousHeld.set(lineId, (previousHeld.get(lineId) ?? 0) + item.quantity);
  }
  if (previousHeld.size === 0) return [];
  // A delivery already recorded WITHOUT talla keeps its own dimension: the
  // line cannot be re-assigned (the evidence would stop discounting it).
  const deliveredWithoutSize = (next.deliveries ?? []).some((event) =>
    event.lines.some((line) => line.productId === productId && line.variantId === variantId && !line.variantSizeId)
  );
  const moves = new Map<string, ColorLevelLineMove>();
  for (const [lineId, held] of previousHeld) {
    moves.set(lineId, { lineId, productId, variantId, previousHeld: held, nextHeld: 0 });
  }
  // The talla the person assigned — read from the saved lines, held or not
  // (a cancelled order still names where its pieces came from).
  for (const item of orderItems(next)) {
    if (item.productId !== productId || item.variantId !== variantId || !item.variantSizeId) continue;
    const move = moves.get(item.lineId ?? "");
    if (!move) continue;
    if (deliveredWithoutSize) move.remapBlocked = true;
    else move.nextSizeId = item.variantSizeId;
  }
  for (const item of heldOrderItems(next)) {
    if (item.productId !== productId || item.variantId !== variantId) continue;
    const move = moves.get(item.lineId ?? "");
    if (!move) continue; // a line that only appears now is a plain take, not a re-routing
    move.nextHeld += item.quantity;
  }
  return [...moves.values()];
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
/** #333: pieces delivered so far per stock dimension (Σ delivery-event
 * lines). Lives beside the reservation math because both speak the same
 * dimension keys. */
export function deliveredByDimension(order: Order): Map<string, number> {
  const delivered = new Map<string, number>();
  for (const event of order.deliveries ?? []) {
    for (const line of event.lines) {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
      const key = stockDimensionKey(line.productId, line.variantId, line.variantSizeId);
      delivered.set(key, (delivered.get(key) ?? 0) + line.quantity);
    }
  }
  return delivered;
}

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
  return reservationDeltas(heldOrderItems(previous), heldOrderItems(next));
}

/** What an order still HOLDS on the shelf — the shared truth of both
 * reservation-delta functions (#333: a cancelled order with delivery evidence
 * keeps ONLY its delivered pieces consumed; money-backed holds R9 untouched). */
function heldOrderItems(order: Order | undefined): OrderItem[] {
  {
    if (!order) return [];
    const items = orderItems(order);
    // #333: cancelling an order with delivery evidence returns only the
    // STILL-PENDING pieces to the shelf; delivered pieces stay consumed (the
    // clienta keeps them — cancelling the remainder is not a full return).
    // Money-backed holds (#165 R9) are untouched: their pieces stay held.
    if (effectiveOrderStatus(order) === "cancelled" && !holdsPieces(order)) {
      if ((order.deliveries ?? []).length === 0) return [];
      const remaining = new Map(deliveredByDimension(order));
      return items.map((item) => {
        if (!item.productId) return { ...item, quantity: 0 };
        const key = stockDimensionKey(item.productId, item.variantId, item.variantSizeId);
        const left = Math.max(0, remaining.get(key) ?? 0);
        const take = Math.min(item.quantity, left);
        remaining.set(key, left - take);
        return { ...item, quantity: take };
      }).filter((item) => item.quantity > 0);
    }
    return holdsPieces(order) ? items : [];
  }
}

// --- #309: canonical shortage derivation (observability only) ------------

/** The stock dimension an order line moves — variant stock for variant lines,
 * product stock otherwise (#124: variant stock never lands on the design
 * level). Keyed exactly like variantReservationDeltas. */
export function stockDimensionKey(productId: string, variantId?: string, sizeId?: string): string {
  if (sizeId) return `${productId}:${variantId}:${sizeId}`;
  return variantId ? `${productId}:${variantId}` : productId;
}

export type DimensionShortage = {
  key: string;
  productId: string;
  variantId?: string;
  /** #461: the exact talla when the shortage is on a combination. */
  variantSizeId?: string;
  missing: number;
};

type ShortageProduct = Pick<Product, "id" | "quantityOnHand" | "variants">;

/** Pieces each stock dimension is SHORT (negative stock), derived from the
 * exact dimension every item moves. The card's "Faltan N" badge, the order
 * editor and the category review ALL share this function so they can never
 * disagree (#309). Pure — never mutates stock or orders. */
export function shortageByDimension(
  items: ReadonlyArray<Pick<OrderItem, "productId" | "variantId" | "variantSizeId">>,
  products: ReadonlyArray<ShortageProduct>
): Map<string, DimensionShortage> {
  const byId = new Map(products.map((product) => [product.id, product]));
  const result = new Map<string, DimensionShortage>();
  for (const item of items) {
    if (!item.productId) continue;
    const key = stockDimensionKey(item.productId, item.variantId, item.variantSizeId);
    if (result.has(key)) continue;
    const product = byId.get(item.productId);
    if (!product) continue;
    // #461: a size line reads its COMBINATION's shelf; a color line without
    // size keeps reading the color's (current modality).
    const stock = item.variantSizeId
      ? product.variants?.find((variant) => variant.id === item.variantId)?.sizes?.find((sz) => sz.id === item.variantSizeId)?.quantityOnHand
      : item.variantId
        ? product.variants?.find((variant) => variant.id === item.variantId)?.quantityOnHand
        : product.quantityOnHand;
    if (typeof stock === "number" && stock < 0) {
      result.set(key, {
        key,
        productId: item.productId,
        ...(item.variantId ? { variantId: item.variantId } : {}),
        ...(item.variantSizeId ? { variantSizeId: item.variantSizeId } : {}),
        missing: -stock,
      });
    }
  }
  return result;
}

/** Deterministic per-LINE attribution of dimension shortages (#309): the
 * FIRST line (capture order) with pieces on a short dimension claims that
 * dimension's FULL missing count — never capped by the line's quantity,
 * because the card badge shows the dimension total (a shared deficit across
 * orders reabasts the shelf, not just one line). Line badges therefore sum
 * EXACTLY to the card badge. Lines without pieces never claim. */
/** The stock dimension a draft/saved line names — talla included (#461). */
type LineDimension = { key: string; productId?: string; variantId?: string; variantSizeId?: string; quantity: number };

export function attributeShortageToLines<T extends LineDimension>(
  lines: ReadonlyArray<T>,
  products: ReadonlyArray<ShortageProduct>
): Map<string, number> {
  return attributeShortageMap(lines, shortageByDimension(lines, products));
}

/** First-line-wins attribution shared by the saved and the projected paths. */
function attributeShortageMap<T extends LineDimension>(
  lines: ReadonlyArray<T>,
  shortages: Map<string, DimensionShortage>
): Map<string, number> {
  const perLine = new Map<string, number>();
  for (const shortage of shortages.values()) {
    const line = lines.find(
      (candidate) =>
        candidate.productId != null &&
        candidate.quantity > 0 &&
        stockDimensionKey(candidate.productId, candidate.variantId, candidate.variantSizeId) === shortage.key
    );
    if (line) perLine.set(line.key, shortage.missing);
  }
  return perLine;
}

/** #325: LIVE shortage projection for a DRAFT (pre-save). Same canonical
 * dimension math as shortageByDimension, but projected onto the capture in
 * progress. Two DISTINCT inputs, matching what the save will actually do:
 * - `savedOrder`'s holds are what quantityOnHand ALREADY excludes (return them
 *   to the shelf before the draft takes pieces again);
 * - `draftWillHold` sets how many pieces the draft TAKES: a draft being
 *   cancelled takes none, so only a shelf already negative from OTHER orders
 *   still reads as faltante — exactly what the card shows, whatever the
 *   order's status (the card never filters by it).
 * Post-save, the card badge (negative stock from the reservation deltas)
 * shows the same number, so the two can never disagree. Pure — never mutates
 * stock or orders. */
export function projectedShortageByDimension<T extends LineDimension>(
  draftLines: ReadonlyArray<T>,
  savedOrder: Order | undefined,
  draftWillHold: boolean,
  products: ReadonlyArray<ShortageProduct>
): Map<string, DimensionShortage> {
  const held = new Map<string, number>();
  if (savedOrder && holdsPieces(savedOrder)) {
    for (const item of orderItems(savedOrder)) {
      if (!item.productId) continue;
      const key = stockDimensionKey(item.productId, item.variantId, item.variantSizeId);
      held.set(key, (held.get(key) ?? 0) + item.quantity);
    }
  }
  type DraftTotal = { productId: string; variantId?: string; variantSizeId?: string; quantity: number };
  const draftQty = new Map<string, DraftTotal>();
  for (const line of draftLines) {
    if (!line.productId) continue;
    const key = stockDimensionKey(line.productId, line.variantId, line.variantSizeId);
    const current = draftQty.get(key);
    const add = Math.max(0, line.quantity);
    if (current) current.quantity += add;
    else {
      draftQty.set(key, {
        productId: line.productId,
        ...(line.variantId ? { variantId: line.variantId } : {}),
        ...(line.variantSizeId ? { variantSizeId: line.variantSizeId } : {}),
        quantity: add,
      });
    }
  }
  const byId = new Map(products.map((product) => [product.id, product]));
  const result = new Map<string, DimensionShortage>();
  for (const [key, total] of draftQty) {
    if (total.quantity <= 0) continue;
    const product = byId.get(total.productId);
    if (!product) continue;
    let stock: number;
    if (total.variantId) {
      const variant = product.variants?.find((v) => v.id === total.variantId);
      if (!variant) continue; // stale variant reference — nothing to project against
      if (total.variantSizeId) {
        const size = variant.sizes?.find((candidate) => candidate.id === total.variantSizeId);
        if (!size) continue; // stale talla reference — nothing to project against
        // An untracked COMBINATION saves from base 0 (applyCombinationDelta).
        stock = size.quantityOnHand ?? 0;
      } else if (variantHasSizes(variant)) {
        // #461: sold without talla on a color that now sells by size — the
        // save fails closed (there is no sellable shelf); nothing to project.
        continue;
      } else {
        // An untracked COLOR saves from base 0 (applyVariantDelta) — the editor
        // must estimate from the same base or the card would disagree (#325 review P2).
        stock = variant.quantityOnHand ?? 0;
      }
    } else {
      // An untracked DESIGN is skipped by the save entirely — no estimate.
      if (typeof product.quantityOnHand !== "number" || !Number.isFinite(product.quantityOnHand)) continue;
      stock = product.quantityOnHand;
    }
    // A draft that will not hold takes nothing; the shelf's own deficit (other
    // orders' oversell) still shows, exactly as the card does post-save.
    const take = draftWillHold ? total.quantity : 0;
    const missing = take - (stock + (held.get(key) ?? 0));
    if (missing > 0) {
      result.set(key, {
        key,
        productId: total.productId,
        ...(total.variantId ? { variantId: total.variantId } : {}),
        ...(total.variantSizeId ? { variantSizeId: total.variantSizeId } : {}),
        missing,
      });
    }
  }
  return result;
}

/** Whether an order (or the order a draft would save) holds shelf pieces —
 * the same truth the reservation save applies (#325 editor projection). */
export function orderWillHoldPieces(order: Order): boolean {
  return holdsPieces(order);
}

/** #325: per-LINE attribution of the PROJECTED draft shortage (see
 *  projectedShortageByDimension) — same first-line-wins rule so editor badges
 *  sum exactly to the live summary and, after save, to the card badge. */
export function attributeProjectedShortageToLines<T extends LineDimension>(
  lines: ReadonlyArray<T>,
  savedOrder: Order | undefined,
  draftWillHold: boolean,
  products: ReadonlyArray<ShortageProduct>
): Map<string, number> {
  return attributeShortageMap(lines, projectedShortageByDimension(lines, savedOrder, draftWillHold, products));
}
