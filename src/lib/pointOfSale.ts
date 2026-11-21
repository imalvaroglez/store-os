import type { Order, PointEntry, Product } from "../types";
import { orderAmountCents } from "./orderMoney";
import { orderItems } from "./orders";
import { isVariantProduct } from "./variants";

// #524 — physical points of sale. Pure model + rules for the FIRST surtido
// (the "Usar como surtido inicial" conversion of a confirmed order and the
// warehouse stocking that precedes it). Money is integer cents here; callers
// write state. Cut #2 (corte/cobro/anulación) builds on these entries.

/** Why a single order line cannot travel to the point (operator Spanish). */
export type ConversionLineIssue = {
  lineId?: string;
  productName: string;
  reason: string;
};

/** Full eligibility verdict for «Usar como surtido inicial». */
export type ConversionCheck = {
  canConvert: boolean;
  reasons: string[];
  lineIssues: ConversionLineIssue[];
};

const ORDER_STATUS_LABEL: Partial<Record<string, string>> = {
  asked: "Preguntó",
  quoted: "Cotizado",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

/**
 * Can this order become a point's first surtido? The rules (#524): the order
 * must be confirmed and free of money (anticipos, cobros, crédito aplicado),
 * deliveries, incidents and a prior conversion; every line must name an
 * existing product (and color, for variant designs) whose shelf is not
 * negative; a stale revision (concurrent edit) stops the whole conversion.
 * Nothing is mutated — the caller decides what to do with the verdict.
 */
export function orderConversionImpediments(
  order: Order,
  products: Product[],
  opts: { latestOrderRevision?: number } = {}
): ConversionCheck {
  const reasons: string[] = [];
  const lineIssues: ConversionLineIssue[] = [];

  if (order.orderStatus !== "confirmed") {
    reasons.push(
      `El pedido debe estar confirmado para usarse como surtido (estado actual: ${
        ORDER_STATUS_LABEL[order.orderStatus ?? ""] ?? order.orderStatus
      }).`
    );
  }

  if (order.convertedToPointId) {
    reasons.push("El pedido ya fue convertido a un punto de venta; solo puede convertirse una vez.");
  }
  if ((order.deposit ?? 0) > 0) {
    reasons.push("El pedido tiene un anticipo registrado; conviértelo solo cuando no tenga dinero recibido.");
  }
  if ((order.paymentsReceivedCents ?? 0) > 0 || order.paymentStatus === "partial" || order.paymentStatus === "paid") {
    reasons.push("El pedido ya tiene cobros registrados.");
  }
  if ((order.creditAppliedCents ?? 0) > 0) {
    reasons.push("El pedido tiene crédito aplicado desde otro pedido.");
  }
  if (order.deliveries && order.deliveries.length > 0) {
    reasons.push("El pedido ya registra entregas.");
  }
  if (order.incidents && order.incidents.length > 0) {
    reasons.push("El pedido tiene incidencias registradas.");
  }
  if (
    typeof opts.latestOrderRevision === "number" &&
    typeof order.revision === "number" &&
    order.revision !== opts.latestOrderRevision
  ) {
    reasons.push("La información del pedido cambió mientras se revisaba (revisión desactualizada); abre de nuevo la vista previa.");
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  for (const item of orderItems(order)) {
    const productName = item.productName || "Pieza sin nombre";
    if (!item.productId) {
      lineIssues.push({ lineId: item.lineId, productName, reason: "La línea no tiene un producto identificable del catálogo." });
      continue;
    }
    const product = byId.get(item.productId);
    if (!product) {
      lineIssues.push({ lineId: item.lineId, productName, reason: "El producto de la línea ya no existe en el catálogo." });
      continue;
    }
    if (isVariantProduct(product)) {
      const variant = product.variants!.find((v) => v.id === item.variantId);
      if (!variant) {
        lineIssues.push({ lineId: item.lineId, productName, reason: "La línea no indica un color existente del diseño." });
        continue;
      }
      if (typeof variant.quantityOnHand === "number" && variant.quantityOnHand < 0) {
        lineIssues.push({
          lineId: item.lineId,
          productName,
          reason: `El color ${variant.color} tiene existencias negativas; revisa el inventario antes de convertir.`,
        });
      }
    } else if (typeof product.quantityOnHand === "number" && product.quantityOnHand < 0) {
      lineIssues.push({ lineId: item.lineId, productName, reason: "El producto tiene existencias negativas; revisa el inventario antes de convertir." });
    }
  }

  return { canConvert: reasons.length === 0 && lineIssues.length === 0, reasons, lineIssues };
}

/** A first-surtido entry proposal, before ids/store/point are assigned. */
export type FirstSurtidoEntry = Omit<PointEntry, "id" | "storeId" | "pointId" | "createdAt" | "updatedAt">;

/**
 * Build the point entries a converted order contributes (#524): one entry per
 * product + color + marked price (+ known cost), quantities merged across
 * identical lines. The marked price and the historical cost come from the
 * order line (pesos, order precision) converted to exact cents — nothing is
 * recaptured. A missing line cost stays undefined = pending valuation.
 */
export function buildFirstSurtidoFromOrder(order: Order, products: Product[], physicalDate: string): FirstSurtidoEntry[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const entries = new Map<string, FirstSurtidoEntry>();
  for (const item of orderItems(order)) {
    if (!item.productId) continue;
    const product = byId.get(item.productId);
    if (!product) continue;
    if (isVariantProduct(product) && !product.variants!.some((v) => v.id === item.variantId)) continue;
    const markedPriceCents = orderAmountCents(item.unitPrice, 1);
    const unitCostCents = typeof item.cost === "number" ? orderAmountCents(item.cost, 1) : undefined;
    const key = [item.productId, item.variantId ?? "", markedPriceCents, unitCostCents ?? "-"].join("|");
    const existing = entries.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      continue;
    }
    entries.set(key, {
      productId: item.productId,
      ...(item.variantId ? { variantId: item.variantId } : {}),
      productName: item.productName || product.name,
      ...(item.variantColor ? { variantColor: item.variantColor } : {}),
      entryDate: physicalDate,
      quantity: item.quantity,
      consumedQty: 0,
      markedPriceCents,
      ...(unitCostCents !== undefined ? { unitCostCents } : {}),
      originOrderId: order.id,
    });
  }
  return [...entries.values()];
}

/** Pieces an entry still holds. */
function remaining(entry: { quantity: number; consumedQty: number }): number {
  return Math.max(0, entry.quantity - entry.consumedQty);
}

/** FIFO order: oldest physical date, then creation, then id (stable). */
function fifoKey(entry: { entryDate: string; createdAt?: string; id?: string }): string {
  return [entry.entryDate, entry.createdAt ?? "", entry.id ?? ""].join("|");
}

export type FifoAllocation = { entryId: string; quantity: number };

/**
 * Which entries pieces leave from when a sale/write-off consumes `quantity`
 * (#524): oldest entry first among identical units. When several marked
 * prices coexist the operator chooses which price sold, so `priceCents`
 * restricts consumption to entries at exactly that price (still oldest
 * first). `shortUnits` reports what the point could not cover.
 */
export function consumeFromEntries(
  entries: Array<Pick<PointEntry, "id" | "entryDate" | "quantity" | "consumedQty" | "markedPriceCents"> & { createdAt?: string }>,
  quantity: number,
  opts: { priceCents?: number } = {}
): { allocations: FifoAllocation[]; shortUnits: number } {
  const candidates = entries
    .filter((entry) => (opts.priceCents === undefined || entry.markedPriceCents === opts.priceCents) && remaining(entry) > 0)
    .sort((a, b) => fifoKey(a).localeCompare(fifoKey(b)));

  let left = quantity;
  const allocations: FifoAllocation[] = [];
  for (const entry of candidates) {
    if (left <= 0) break;
    const take = Math.min(remaining(entry), left);
    allocations.push({ entryId: entry.id, quantity: take });
    left -= take;
  }
  return { allocations, shortUnits: Math.max(0, left) };
}

export type PointValuation = {
  units: number;
  markedValueCents: number;
  costValueCents: number;
  pendingCostUnits: number;
  costComplete: boolean;
};

/**
 * What the point holds (#524): pieces, value at the marked price and value at
 * cost. Entries without a known cost count as pending units and leave the
 * cost valuation explicitly incomplete — a missing cost is never zero.
 */
export function pointValuation(
  entries: Array<Pick<PointEntry, "quantity" | "consumedQty" | "markedPriceCents" | "unitCostCents">>
): PointValuation {
  let units = 0;
  let markedValueCents = 0;
  let costValueCents = 0;
  let pendingCostUnits = 0;
  for (const entry of entries) {
    const left = remaining(entry);
    units += left;
    markedValueCents += left * entry.markedPriceCents;
    if (typeof entry.unitCostCents === "number") costValueCents += left * entry.unitCostCents;
    else pendingCostUnits += left;
  }
  return { units, markedValueCents, costValueCents, pendingCostUnits, costComplete: pendingCostUnits === 0 };
}

/**
 * Estimated antiquity of the point's oldest remaining pieces (#524): the
 * physical date of the oldest entry that still holds merchandise. Estimated
 * because FIFO consumption is recorded per entry, not per piece.
 */
export function oldestRemainingDate(
  entries: Array<Pick<PointEntry, "entryDate" | "quantity" | "consumedQty">>
): string | null {
  let oldest: string | null = null;
  for (const entry of entries) {
    if (remaining(entry) <= 0) continue;
    if (oldest === null || entry.entryDate < oldest) oldest = entry.entryDate;
  }
  return oldest;
}
