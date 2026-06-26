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

export function nextStatus(status: OrderStatus): OrderStatus | null {
  const i = ORDER_FLOW.indexOf(status);
  if (i < 0 || i >= ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[i + 1];
}

// The verb the next-action button shows, e.g. "Confirmar", "Comprar", "Cobrar".
export function nextActionVerb(status: OrderStatus): string | null {
  const next = nextStatus(status);
  if (!next) return null;
  return ORDER_STATUS_LABELS[next];
}
