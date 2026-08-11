import type { OrderStatus } from "../../types";

// Spanish labels for order statuses + the linear next step in the flow.
// Labels are the product language; the enum stays in English.

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  asked: "Preguntó",
  confirmed: "Confirmado",
  to_buy: "Comprar",
  bought: "Comprado",
  arrived: "Llegó",
  delivered: "Entregado",
  paid: "Cobrado",
};

const ORDER_FLOW: OrderStatus[] = [
  "asked",
  "confirmed",
  "to_buy",
  "bought",
  "arrived",
  "delivered",
  "paid",
];

// Imperative verbs for the next-action BUTTON (the action to take), keyed by the
// status the action advances TO. Distinct from ORDER_STATUS_LABELS (participles
// for the status badge). M3: the button said "Confirmado" (state) instead of
// "Confirmar" (action).
const ORDER_ACTION_VERBS: Record<OrderStatus, string> = {
  asked: "Confirmar",
  confirmed: "Confirmar",
  to_buy: "Comprar",
  bought: "Marcar comprado",
  arrived: "Marcar llegada",
  delivered: "Entregar",
  paid: "Cobrar",
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
