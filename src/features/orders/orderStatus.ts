import type { Order, OrderStatus, PaymentStatus } from "../../types";
import { effectiveOrderStatus } from "../../lib/orders";

// Spanish labels for order statuses + the linear next step in the flow.
// Labels are the product language; the enum stays in English.

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  requested: "Solicitud",
  asked: "Por cotizar",
  quoted: "Cotizado",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Sin anticipo",
  partial: "Anticipo parcial",
  paid: "Pagado",
};

const ORDER_FLOW: OrderStatus[] = [
  "asked",
  "quoted",
  "confirmed",
  "preparing",
  "ready",
  "delivered",
];

// Imperative verbs for the next-action BUTTON (the action to take), keyed by the
// status the action advances TO. Distinct from ORDER_STATUS_LABELS (participles
// for the status badge). M3: the button said "Confirmado" (state) instead of
// "Confirmar" (action).
const ORDER_ACTION_VERBS: Record<OrderStatus, string> = {
  requested: "",
  asked: "",
  quoted: "Cotizar",
  confirmed: "Confirmar",
  preparing: "Preparar",
  ready: "Marcar listo",
  delivered: "Entregar",
  cancelled: "",
};

export function nextStatus(status: OrderStatus): OrderStatus | null {
  const i = ORDER_FLOW.indexOf(status);
  if (i < 0 || i >= ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[i + 1];
}

// The verb the next-action button shows, e.g. "Confirmar", "Comprar", "Cobrar".
export function nextActionVerb(status: OrderStatus): string | null {
  const next = nextStatus(status);
  if (!next) return null;
  return ORDER_ACTION_VERBS[next];
}

/** One order advanced to its next status (new updatedAt), or null when terminal.
 * Derives the effective status itself so legacy orders advance without the
 * caller pre-normalizing them. */
export function advanceOrder<T extends Order>(order: T): T | null {
  const next = nextStatus(effectiveOrderStatus(order));
  return next ? { ...order, orderStatus: next, updatedAt: new Date().toISOString() } : null;
}
