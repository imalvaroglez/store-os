import type { Order, OrderItem, OrderStatus, PaymentStatus, PriceTierDef } from "../types";
import { CURRENT_ORDER_SCHEMA_VERSION } from "../types";
import { formatMoney } from "./money";
import { LEGACY_TIER_IDS } from "./pricing";

const ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "asked", "quoted", "confirmed", "preparing", "ready", "delivered", "cancelled",
]);

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function tierId(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return LEGACY_TIER_IDS[value] ?? value;
}

/** One compatibility boundary for legacy one-product orders and early items[]. */
export function orderItems(order: Partial<Order> & Record<string, unknown>): OrderItem[] {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items.map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const quantity = Math.max(1, Math.round(finite(item.quantity, 1)));
      const unitPrice = Math.max(0, finite(item.unitPrice ?? item.price));
      return {
        ...(typeof item.productId === "string" && item.productId ? { productId: item.productId } : {}),
        productName: String(item.productName ?? item.name ?? "Producto").trim() || "Producto",
        quantity,
        ...(tierId(item.priceTier) ? { priceTier: tierId(item.priceTier) } : {}),
        unitPrice,
        subtotal: quantity * unitPrice,
        ...(typeof item.cost === "number" && Number.isFinite(item.cost) ? { cost: item.cost } : {}),
      };
    });
  }

  const name = typeof order.productName === "string" ? order.productName.trim() : "";
  if (!name && typeof order.productId !== "string") return [];
  const quantity = Math.max(1, Math.round(finite(order.quantity, 1)));
  const unitPrice = Math.max(0, finite(order.price));
  return [{
    ...(typeof order.productId === "string" && order.productId ? { productId: order.productId } : {}),
    productName: name || "Producto",
    quantity,
    ...(tierId(order.priceTier) ? { priceTier: tierId(order.priceTier) } : {}),
    unitPrice,
    subtotal: quantity * unitPrice,
    ...(typeof order.cost === "number" && Number.isFinite(order.cost) ? { cost: order.cost } : {}),
  }];
}

export type OrderTotals = { estimatedTotal: number; paid: number; balance: number; pieces: number };

/** Totals always use the frozen line snapshots, never the current catalog. */
export function orderTotals(order: Partial<Order> & Record<string, unknown>): OrderTotals {
  const items = orderItems(order);
  const estimatedTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const pieces = items.reduce((sum, item) => sum + item.quantity, 0);
  const paid = Math.max(0, finite(order.deposit));
  return { estimatedTotal, paid, balance: Math.max(0, estimatedTotal - paid), pieces };
}

export function paymentStatusForOrder(order: Partial<Order> & Record<string, unknown>): PaymentStatus {
  const { estimatedTotal, paid } = orderTotals(order);
  // A $0 sale owes nothing: it is paid by definition.
  if (paid >= estimatedTotal) return "paid";
  return paid > 0 ? "partial" : "unpaid";
}

export function orderReference(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase() || id.slice(-6).toUpperCase();
}

export function orderStatusIsOpen(status: OrderStatus | undefined): boolean {
  return status === "asked" || status === "quoted" || status === "confirmed" || status === "preparing" || status === "ready";
}

export type OrderBucket = "pending" | "active" | "completed" | "cancelled" | "other";

export function orderBucket(order: Partial<Order> & Record<string, unknown>): OrderBucket {
  const status = effectiveOrderStatus(order);
  if (status === "cancelled") return "cancelled";
  if (status === "asked" || status === "quoted") return "pending";
  if (status === "delivered") return orderTotals(order).balance > 0 ? "active" : "completed";
  if (status === "confirmed" || status === "preparing" || status === "ready") return "active";
  return "other";
}

/** One predicate for "Falta cobrar": every unresolved sale (pending or active)
 * counts, so Home and the customer card can never disagree. */
export function orderCountsTowardToPay(order: Partial<Order> & Record<string, unknown>): boolean {
  const bucket = orderBucket(order);
  return bucket === "pending" || bucket === "active";
}

function migratedStatus(raw: unknown): OrderStatus {
  if (typeof raw === "string" && ORDER_STATUSES.has(raw as OrderStatus)) return raw as OrderStatus;
  if (raw === "to_buy" || raw === "bought") return "preparing";
  if (raw === "arrived") return "ready";
  if (raw === "paid") return "delivered";
  return "asked";
}

export function effectiveOrderStatus(order: Partial<Order> & Record<string, unknown>): OrderStatus {
  return migratedStatus(order.orderStatus ?? order.status);
}

/** Idempotent legacy order migration. The returned object contains no flat fields. */
export function migrateOrder(rawOrder: unknown, now = new Date().toISOString()): Order {
  const raw = (rawOrder ?? {}) as Partial<Order> & Record<string, unknown>;
  const items = orderItems(raw);
  const orderStatus = migratedStatus(raw.orderStatus ?? raw.status);
  const itemsTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const base = {
    id: String(raw.id ?? ""),
    storeId: String(raw.storeId ?? ""),
    customerId: String(raw.customerId ?? ""),
    items,
    // v1 advanced to status='paid' without ever raising deposit; a migrated
    // collected sale must not show a phantom balance ("Falta cobrar").
    deposit: (raw.orderStatus ?? raw.status) === "paid"
      ? Math.max(0, finite(raw.deposit), itemsTotal)
      : Math.max(0, finite(raw.deposit)),
    orderStatus,
    paymentStatus: "unpaid" as PaymentStatus,
    ...(typeof raw.promisedDate === "string" && raw.promisedDate ? { promisedDate: raw.promisedDate } : {}),
    ...(typeof raw.notes === "string" && raw.notes ? { notes: raw.notes } : {}),
    schemaVersion: CURRENT_ORDER_SCHEMA_VERSION,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  } satisfies Omit<Order, "paymentStatus"> & { paymentStatus: PaymentStatus };
  const paymentStatus = paymentStatusForOrder(base);
  return { ...base, paymentStatus };
}

export function isMigratedOrder(raw: unknown): raw is Order {
  const order = raw as Partial<Order> & Record<string, unknown>;
  if (order.schemaVersion !== CURRENT_ORDER_SCHEMA_VERSION || !Array.isArray(order.items)) return false;
  if (!ORDER_STATUSES.has(order.orderStatus as OrderStatus)) return false;
  if (order.paymentStatus !== paymentStatusForOrder(order)) return false;
  if (order.items.some((rawItem) => {
    const item = rawItem as Partial<OrderItem>;
    const quantity = item.quantity;
    const unitPrice = item.unitPrice;
    if (typeof item.productName !== "string" || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) return true;
    if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0) return true;
    return item.subtotal !== quantity * unitPrice;
  })) return false;
  return !("productId" in order || "productName" in order || "quantity" in order || "price" in order || "status" in order);
}

export function migrateOrders(orders: Order[], now = new Date().toISOString()): Order[] {
  return orders.map((order) => (isMigratedOrder(order) ? order : migrateOrder(order, now)));
}

export function tierWarning(item: Pick<OrderItem, "quantity" | "subtotal">, tier: PriceTierDef): string | null {
  if (tier.minPieces != null && item.quantity < tier.minPieces) {
    return `${tier.label} normalmente aplica desde ${tier.minPieces} piezas.`;
  }
  if (tier.minAmount != null && item.subtotal < tier.minAmount) {
    return `${tier.label} normalmente aplica desde ${formatMoney(tier.minAmount)}.`;
  }
  return null;
}
