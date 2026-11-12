import type { Order, OrderDelivery } from "../types";
import { orderItems } from "./orders";
import { deliveredByDimension, stockDimensionKey } from "./inventory";

export { deliveredByDimension };

// #333: delivery-evidence math — pure derivations over the append-only
// `deliveries` ledger. The reservation already took the pieces when the order
// was confirmed; delivery events move quantities from "pending" to
// "delivered" WITHOUT touching stock or money again. Unit-tested in
// deliveries.test.ts.

export type PendingDeliveryLine = {
  key: string;
  productId: string;
  variantId?: string;
  quantity: number;
};

/** Ordered pieces per stock dimension, with each dimension's identity (the
 * reservation's own base). Custom free-text lines carry no productId and no
 * stock dimension — delivery evidence tracks product lines; a custom-only
 * order keeps the plain one-tap Entregar (legacy status advance). */
function orderedDimensions(order: Order): Map<string, PendingDeliveryLine> {
  const ordered = new Map<string, PendingDeliveryLine>();
  for (const item of orderItems(order)) {
    if (!item.productId) continue;
    const key = stockDimensionKey(item.productId, item.variantId);
    const current = ordered.get(key);
    if (current) current.quantity += item.quantity;
    else
      ordered.set(key, {
        key,
        productId: item.productId,
        ...(item.variantId ? { variantId: item.variantId } : {}),
        quantity: item.quantity,
      });
  }
  return ordered;
}

/** Pieces still NOT handed to the clienta: current order items minus what the
 * events already delivered (never negative). The delivery UI validates
 * against THIS — an event may never deliver more than its pending. */
export function pendingDeliveries(order: Order): PendingDeliveryLine[] {
  const delivered = deliveredByDimension(order);
  const pending: PendingDeliveryLine[] = [];
  for (const [key, line] of orderedDimensions(order)) {
    const remaining = line.quantity - (delivered.get(key) ?? 0);
    if (remaining > 0) pending.push({ ...line, quantity: remaining });
  }
  return pending;
}

/** Total pieces still pending across dimensions. */
export function pendingDeliveryPieces(order: Order): number {
  return pendingDeliveries(order).reduce((sum, line) => sum + line.quantity, 0);
}

/** An order reads as fully delivered only when EVERY tracked (product) piece
 * has its delivery evidence. Custom free-text lines and empty orders never
 * read as delivered here — they keep the plain status advance. */
export function orderFullyDelivered(order: Order): boolean {
  if (pendingDeliveries(order).length > 0) return false;
  // At least one tracked dimension with all its pieces covered.
  return (order.deliveries ?? []).some((event) => event.lines.length > 0)
    && pendingDeliveries(order).length === 0
    && orderItems(order).some((item) => item.productId);
}

/** Validate a candidate event against the CURRENT pending: every line must
 * name a pending dimension and stay within it (partial deliveries welcome,
 * over-delivery denied). Returns an error message or null when valid. */
export function deliveryValidationError(order: Order, event: Pick<OrderDelivery, "lines">): string | null {
  if (event.lines.length === 0) return "Registra al menos una pieza entregada.";
  const pending = new Map(pendingDeliveries(order).map((line) => [line.key, line.quantity]));
  const requested = new Map<string, number>();
  for (const line of event.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) return "Las cantidades entregadas deben ser piezas enteras mayores a cero.";
    const key = stockDimensionKey(line.productId, line.variantId);
    if (!pending.has(key)) return "Esa pieza ya está entregada por completo o no pertenece al pedido.";
    requested.set(key, (requested.get(key) ?? 0) + line.quantity);
  }
  for (const [key, quantity] of requested) {
    if (quantity > (pending.get(key) ?? 0)) return "No puedes entregar más piezas de las que siguen pendientes.";
  }
  return null;
}

/** The effective delivery date of record for a fully delivered order: the
 * date of the event that completed it (the last one that left nothing
 * pending). Old orders without evidence → undefined ("Fecha de entrega por
 * confirmar" wherever the monthly close needs the fact). */
export function effectiveDeliveryDate(order: Order): string | undefined {
  if (!orderFullyDelivered(order)) return undefined;
  // The order was physically complete the day its LAST piece reached the
  // clienta: the MAX effective date across events. (Replaying by recordedAt
  // returned the completing CAPTURE's date — wrong when a late capture hides
  // an earlier physical delivery; review P2.)
  const events = order.deliveries ?? [];
  if (events.length === 0) return undefined;
  return events.reduce((max, event) => (event.deliveredAt > max ? event.deliveredAt : max), events[0].deliveredAt);
}
