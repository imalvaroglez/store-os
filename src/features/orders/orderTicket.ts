import type { Order } from "../../types";
import { formatMoneyExact } from "../../lib/money";
import { orderAmountCents } from "../../lib/orderMoney";
import { effectiveOrderStatus, orderItems, orderReference, orderTotals } from "../../lib/orders";
import { groupOrderLines } from "./orderGrouping";
import { ORDER_STATUS_LABELS } from "./orderStatus";

/**
 * WhatsApp order detail in Fer's own message format (production feedback
 * 2026-11-06, #187/#220): bold header (order reference, store, client,
 * status, long es-MX date), pieces grouped by their frozen capture category
 * with running numbers in reading order, Total — plus a single "Saldo" line
 * ONLY when money is still owed, using the canonical received amount
 * (transactional accumulator + still-unmaterialized legacy deposit, #168 F4).
 * Bold uses WhatsApp's *...* markup so the pasted message renders headings
 * and category names in bold. Private notes, costs and payment breakdown
 * lines never appear. One click copies this from the order card's
 * "Detalle para compartir" sheet.
 */
export function orderTicketText(order: Order, storeName: string, currentCustomerName?: string): string {
  // Names must not carry literal '*' or they would break WhatsApp's bold pairing.
  const clean = (value: string) => value.replace(/\*/g, "").replace(/\s+/g, " ").trim();
  const items = orderItems(order);
  const totalCents = items.reduce((sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity), 0);
  // #168 F4 + #189 + #203: the ticket's Saldo is THE canonical balance from
  // the read model — net of applied saldo a favor and posventa adjustments —
  // never a hand-rolled subtraction (which overstated debt after refunds or
  // credit). "Total" stays the sum of the listed pieces.
  const balanceCents = Math.round(orderTotals(order).balance * 100);
  const date = order.createdAt ? longDate(order.createdAt) : "";

  const lines: string[] = [
    `*Detalle de pedido #${orderReference(order.id)}*`,
    `*Tienda:* ${clean(storeName) || "Tienda"}`,
    `*Cliente:* ${clean(order.customerName || currentCustomerName || "Sin cliente")}`,
    `*Estado:* ${ORDER_STATUS_LABELS[effectiveOrderStatus(order)]}`,
    ...(date ? [`*Fecha:* ${date}`] : []),
  ];

  // Running number follows the EMITTED order (categories first, uncategorized
  // last), so the sequence read top-to-bottom is always 1..N monotonic.
  let itemNumber = 0;
  const groups = groupOrderLines(items).flatMap((group) => [
    `*${clean(group.name)}*`,
    ...group.lines.map((item) => {
      itemNumber += 1;
      const quantity = item.quantity > 1 ? `${item.quantity} × ` : "";
      return `${itemNumber}. ${quantity}${clean(item.productName)} ${formatMoneyExact(orderAmountCents(item.unitPrice, item.quantity) / 100)}`;
    }),
  ]);

  lines.push(...(groups.length ? ["", ...groups] : []), "", `*Total* ${formatMoneyExact(totalCents / 100)}`);
  if (balanceCents > 0) lines.push(`*Saldo* ${formatMoneyExact(balanceCents / 100)}`);
  return lines.join("\n");
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
