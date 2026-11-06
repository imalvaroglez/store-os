import type { InstallmentFrequency, Order, OrderCreditLedgerEntry, OrderItem, OrderStatus, PaymentStatus, PriceTierDef } from "../types";
import { CURRENT_ORDER_SCHEMA_VERSION } from "../types";
import { formatMoney } from "./money";
import { docReceivedCents, orderAmountCents } from "./orderMoney";
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
      const category = item.categorySnapshot as { id?: unknown; name?: unknown } | undefined;
      return {
        ...(typeof item.lineId === "string" && item.lineId ? { lineId: item.lineId } : {}),
        ...(item.priceSource === "automatic" || item.priceSource === "manual" ? { priceSource: item.priceSource } : {}),
        ...(typeof category?.id === "string" && category.id && typeof category.name === "string" && category.name ? { categorySnapshot: { id: category.id, name: category.name } } : {}),
        ...(typeof item.productId === "string" && item.productId ? { productId: item.productId } : {}),
        productName: String(item.productName ?? item.name ?? "Producto").trim() || "Producto",
        quantity,
        ...(tierId(item.priceTier) ? { priceTier: tierId(item.priceTier) } : {}),
        unitPrice,
        subtotal: orderAmountCents(unitPrice, quantity) / 100,
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
    subtotal: orderAmountCents(unitPrice, quantity) / 100,
    ...(typeof order.cost === "number" && Number.isFinite(order.cost) ? { cost: order.cost } : {}),
  }];
}

export type OrderTotals = {
  estimatedTotal: number;
  /** Real money received on THIS order (credit is never "received" here). */
  paid: number;
  /** #189: what the clienta still owes, NET of saldo a favor applied to this order. */
  balance: number;
  /** #189: saldo a favor applied to this order from sister orders, pesos. */
  appliedCredit: number;
  /** #189: unconsumed surplus this order still holds for the clienta, pesos. */
  availableCredit: number;
  pieces: number;
};

/** Safe cents read of an optional credit accumulator (corrupt → 0, never NaN). */
function creditFieldCents(order: Partial<Order> & Record<string, unknown>, field: "creditAppliedCents" | "creditConsumedCents"): number {
  const value = order[field];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Totals always use the frozen line snapshots, never the current catalog. */
export function orderTotals(order: Partial<Order> & Record<string, unknown>): OrderTotals {
  const items = orderItems(order);
  const totalCents = items.reduce((sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity), 0);
  if (!Number.isSafeInteger(totalCents)) throw new RangeError("Order total exceeds safe precision");
  const estimatedTotal = totalCents / 100;
  const pieces = items.reduce((sum, item) => sum + item.quantity, 0);
  const paidCents = typeof order.paymentsReceivedCents === "number"
    ? docReceivedCents(order) : orderAmountCents(Math.max(0, finite(order.deposit)));
  const paid = paidCents / 100;
  // #189: `balance` is NET of the credit applied to this order (the PO read:
  // "Pendiente por pagar"); `paid` stays real money so sales/cobros months
  // never move. `availableCredit` subtracts what sister orders consumed.
  const appliedCents = creditFieldCents(order, "creditAppliedCents");
  const surplusCents = Math.max(0, paidCents - totalCents);
  const availableCents = Math.max(0, surplusCents - creditFieldCents(order, "creditConsumedCents"));
  return {
    estimatedTotal,
    paid,
    balance: Math.max(0, totalCents - paidCents - appliedCents) / 100,
    appliedCredit: appliedCents / 100,
    availableCredit: availableCents / 100,
    pieces,
  };
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

const FREQUENCIES: ReadonlySet<string> = new Set(["weekly", "biweekly", "monthly"]);

/**
 * #165: pass the installment agreement through migration VERBATIM when it is
 * well-formed; drop it when corrupt (never invent or repair money agreements).
 */
function migratedInstallments(raw: unknown): Order["installments"] {
  if (!raw || typeof raw !== "object") return undefined;
  const plan = raw as Record<string, unknown>;
  const count = plan.count;
  const frequency = plan.frequency;
  const firstDueDate = plan.firstDueDate;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) return undefined;
  if (typeof frequency !== "string" || !FREQUENCIES.has(frequency)) return undefined;
  if (typeof firstDueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) return undefined;
  return {
    count,
    frequency: frequency as InstallmentFrequency,
    firstDueDate,
    ...(typeof plan.agreedAt === "string" ? { agreedAt: plan.agreedAt } : {}),
    ...(typeof plan.agreedBy === "string" ? { agreedBy: plan.agreedBy } : {}),
  };
}

function migratedInstallmentHistory(raw: unknown): Order["installmentsHistory"] {
  if (!Array.isArray(raw)) return undefined;
  const history = raw
    .map((entry) => {
      const plan = migratedInstallments(entry);
      const replacedAt = (entry as Record<string, unknown> | null)?.replacedAt;
      return plan && typeof replacedAt === "string" ? { ...plan, replacedAt } : null;
    })
    .filter((entry): entry is NonNullable<Order["installmentsHistory"]>[number] => entry != null);
  return history.length > 0 ? history : undefined;
}

export function effectiveOrderStatus(order: Partial<Order> & Record<string, unknown>): OrderStatus {
  return migratedStatus(order.orderStatus ?? order.status);
}

/** Idempotent legacy order migration. The returned object contains no flat fields. */
/** #189: a persisted ledger entry is carried verbatim only when well-formed. */
function isWellFormedCreditEntry(entry: unknown): entry is OrderCreditLedgerEntry {
  const e = entry as Record<string, unknown>;
  return typeof e?.id === "string" && !!e.id
    && (e.kind === "application" || e.kind === "release")
    && typeof e.fromOrderId === "string" && !!e.fromOrderId
    && typeof e.amountCents === "number" && Number.isSafeInteger(e.amountCents) && e.amountCents > 0
    && typeof e.at === "string" && typeof e.by === "string";
}

export function migrateOrder(rawOrder: unknown, now = new Date().toISOString()): Order {
  const raw = (rawOrder ?? {}) as Partial<Order> & Record<string, unknown>;
  const id = String(raw.id ?? "");
  // Stable line identity for grouping/allocations: keep an existing lineId, else
  // derive deterministically from order id + position (fixed on first migration).
  const items = orderItems(raw).map((item, index) => ({
    ...item,
    lineId: item.lineId ?? `${id}_L${index}`,
  }));
  const orderStatus = migratedStatus(raw.orderStatus ?? raw.status);
  const itemsTotal = items.reduce((sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity), 0) / 100;
  const base = {
    id,
    ...(typeof raw.revision === "number" ? { revision: raw.revision } : {}),
    ...(typeof raw.lastMutationId === "string" ? { lastMutationId: raw.lastMutationId } : {}),
    storeId: String(raw.storeId ?? ""),
    customerId: String(raw.customerId ?? ""),
    ...(typeof raw.customerName === "string" && raw.customerName ? { customerName: raw.customerName } : {}),
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
    ...(migratedInstallments(raw.installments) ? { installments: migratedInstallments(raw.installments) } : {}),
    ...(typeof raw.installmentsReservedAt === "string" && raw.installmentsReservedAt
      ? { installmentsReservedAt: raw.installmentsReservedAt }
      : {}),
    ...(migratedInstallmentHistory(raw.installmentsHistory) ? { installmentsHistory: migratedInstallmentHistory(raw.installmentsHistory) } : {}),
    // #168 doc-level money truth: passed verbatim when well-formed, dropped
    // when corrupt — money fields are never repaired or invented here.
    ...(typeof raw.paymentsReceivedCents === "number" && Number.isFinite(raw.paymentsReceivedCents)
      ? { paymentsReceivedCents: raw.paymentsReceivedCents }
      : {}),
    ...(typeof raw.paymentsRevision === "number" && Number.isSafeInteger(raw.paymentsRevision) && raw.paymentsRevision >= 0
      ? { paymentsRevision: raw.paymentsRevision } : {}),
    ...(typeof raw.lastPaymentId === "string" ? { lastPaymentId: raw.lastPaymentId } : {}),
    ...(raw.inheritedDepositMaterialized === true ? { inheritedDepositMaterialized: true } : {}),
    // #189 credit accumulators + evidence: same verbatim-when-well-formed
    // discipline as the #168 money fields — never repaired, never invented.
    ...(typeof raw.creditAppliedCents === "number" && Number.isSafeInteger(raw.creditAppliedCents) && raw.creditAppliedCents >= 0
      ? { creditAppliedCents: raw.creditAppliedCents } : {}),
    ...(typeof raw.creditConsumedCents === "number" && Number.isSafeInteger(raw.creditConsumedCents) && raw.creditConsumedCents >= 0
      ? { creditConsumedCents: raw.creditConsumedCents } : {}),
    ...(Array.isArray(raw.creditLedger) && raw.creditLedger.length > 0
      ? { creditLedger: raw.creditLedger.filter(isWellFormedCreditEntry) } : {}),
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
    if (typeof item.lineId !== "string" || !item.lineId) return true;
    const quantity = item.quantity;
    const unitPrice = item.unitPrice;
    if (typeof item.productName !== "string" || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) return true;
    if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0) return true;
    return item.subtotal !== quantity * unitPrice && item.subtotal !== orderAmountCents(unitPrice, quantity) / 100;
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
