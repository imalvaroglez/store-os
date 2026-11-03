import type { Order } from "../../types";
import { formatMoneyExact } from "../../lib/money";
import { formatOrderUnitPrice, orderAmountCents } from "../../lib/orderMoney";
import { effectiveOrderStatus, orderItems, orderReference } from "../../lib/orders";
import { groupOrderLines } from "./orderGrouping";
import { ORDER_STATUS_LABELS } from "./orderStatus";
import { docReceivedCents } from "./payments";

/** A shareable summary of the saved snapshot; private notes and costs stay out. */
export function orderTicketText(order: Order, storeName: string, currentCustomerName?: string): string {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const sections = groupOrderLines(orderItems(order));
  const items = orderItems(order);
  const totalCents = items.reduce((sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity), 0);
  // #168 F4: orders with registered cobros report the DOC truth (transactional
  // accumulator + pending inherited deposit). The legacy `deposit` alone used
  // to print "Anticipo $0 / Saldo $1,800" with $1,500 actually received.
  const hasPaymentRecords = typeof order.paymentsReceivedCents === "number";
  const receivedCents = hasPaymentRecords
    ? docReceivedCents(order)
    : orderAmountCents(Math.max(0, typeof order.deposit === "number" && Number.isFinite(order.deposit) ? order.deposit : 0));
  const balanceCents = Math.max(0, totalCents - receivedCents);
  const excessCents = Math.max(0, receivedCents - totalCents);
  const receivedLabel = hasPaymentRecords ? "Recibido" : "Anticipo registrado";
  const excessLabel = hasPaymentRecords ? "Recibido mayor al total" : "Anticipo mayor al total";
  return [
    `Detalle de pedido #${orderReference(order.id)}`,
    `Tienda: ${clean(storeName)}`,
    `Cliente: ${clean(order.customerName || currentCustomerName || "Sin cliente")}`,
    `Estado: ${ORDER_STATUS_LABELS[effectiveOrderStatus(order)]}`,
    ...sections.flatMap((group) => ["", clean(group.name), ...group.lines.map((item) =>
      `• ${item.quantity} × ${clean(item.productName)} — ${formatOrderUnitPrice(item.unitPrice)} c/u = ${formatMoneyExact(orderAmountCents(item.unitPrice, item.quantity) / 100)}`
    )]),
    "",
    `Total: ${formatMoneyExact(totalCents / 100)}`,
    `${receivedLabel}: ${formatMoneyExact(receivedCents / 100)}`,
    `Saldo: ${formatMoneyExact(balanceCents / 100)}`,
    ...(excessCents ? [`${excessLabel}: ${formatMoneyExact(excessCents / 100)}`] : []),
  ].join("\n");
}
