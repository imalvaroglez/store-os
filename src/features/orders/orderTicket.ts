import type { Order } from "../../types";
import { formatMoneyExact } from "../../lib/money";
import { orderAmountCents } from "../../lib/orderMoney";
import { orderItems, orderTotals } from "../../lib/orders";

/**
 * WhatsApp order detail in Fer's own message format (PO 2026-11-04): client
 * name + order date, numbered pieces with line totals, Total — plus a single
 * "Saldo" line ONLY when money is still owed, using the canonical received
 * amount (transactional accumulator + still-unmaterialized legacy deposit,
 * #168 F4). Private notes and costs never appear. One click copies this from
 * the order card's "Detalle para compartir" sheet.
 */
export function orderTicketText(order: Order, _storeName: string, currentCustomerName?: string): string {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const items = orderItems(order);
  const totalCents = items.reduce((sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity), 0);
  // #168 F4 + #189 + #203: the ticket's Saldo is THE canonical balance from
  // the read model — net of applied saldo a favor and posventa adjustments —
  // never a hand-rolled subtraction (which overstated debt after refunds or
  // credit). "Total" stays the sum of the listed pieces.
  const balanceCents = Math.round(orderTotals(order).balance * 100);

  const customer = clean(order.customerName || currentCustomerName || "Sin cliente");
  return [
    order.createdAt ? `${customer} ${longDate(order.createdAt)}` : customer,
    ...items.map((item, index) => {
      const quantity = item.quantity > 1 ? `${item.quantity} × ` : "";
      return `${index + 1}. ${quantity}${clean(item.productName)} ${formatMoneyExact(orderAmountCents(item.unitPrice, item.quantity) / 100)}`;
    }),
    `Total ${formatMoneyExact(totalCents / 100)}`,
    ...(balanceCents > 0 ? [`Saldo ${formatMoneyExact(balanceCents / 100)}`] : []),
  ].join("\n");
}

/** "31 de octubre, 2026" — Fer's date style. Calendar dates parse at local
 * noon so no UTC conversion moves the day (same trap as lib/dates). */
function longDate(iso: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dateOnly ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  const withoutYear = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long" }).format(d);
  return `${withoutYear}, ${d.getFullYear()}`;
}
