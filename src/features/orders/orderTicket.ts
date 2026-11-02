import type { Order } from "../../types";
import { formatMoneyExact } from "../../lib/money";
import { formatOrderUnitPrice, orderAmountCents } from "../../lib/orderMoney";
import { effectiveOrderStatus, orderItems, orderReference, orderTotals } from "../../lib/orders";
import { groupOrderLines } from "./orderGrouping";
import { ORDER_STATUS_LABELS } from "./orderStatus";

/** A shareable summary of the saved snapshot; private notes and costs stay out. */
export function orderTicketText(order: Order, storeName: string, currentCustomerName?: string): string {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const sections = groupOrderLines(orderItems(order));
  const totals = orderTotals(order);
  const excessCents = Math.max(0, orderAmountCents(totals.paid) - orderAmountCents(totals.estimatedTotal));
  return [
    `Detalle de pedido #${orderReference(order.id)}`,
    `Tienda: ${clean(storeName)}`,
    `Cliente: ${clean(order.customerName || currentCustomerName || "Sin cliente")}`,
    `Estado: ${ORDER_STATUS_LABELS[effectiveOrderStatus(order)]}`,
    ...sections.flatMap((group) => ["", clean(group.name), ...group.lines.map((item) =>
      `• ${item.quantity} × ${clean(item.productName)} — ${formatOrderUnitPrice(item.unitPrice)} c/u = ${formatMoneyExact(orderAmountCents(item.unitPrice, item.quantity) / 100)}`
    )]),
    "",
    `Total: ${formatMoneyExact(totals.estimatedTotal)}`,
    `Anticipo registrado: ${formatMoneyExact(totals.paid)}`,
    `Saldo: ${formatMoneyExact(totals.balance)}`,
    ...(excessCents ? [`Anticipo mayor al total: ${formatMoneyExact(excessCents / 100)}`] : []),
  ].join("\n");
}
