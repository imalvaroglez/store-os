import type { Order } from "../../types";
import { formatMoneyExact } from "../../lib/money";
import { formatOrderUnitPrice, orderAmountCents } from "../../lib/orderMoney";
import { effectiveOrderStatus, orderItems, orderReference, orderTotals } from "../../lib/orders";
import { ORDER_STATUS_LABELS } from "./orderStatus";

/** A shareable summary of the saved snapshot; private notes and costs stay out. */
export function orderTicketText(order: Order, storeName: string, currentCustomerName?: string): string {
  const groups = new Map<string, { name: string; lines: string[] }>();
  const uncategorized: string[] = [];
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  for (const item of orderItems(order)) {
    const text = `• ${item.quantity} × ${clean(item.productName)} — ${formatOrderUnitPrice(item.unitPrice)} c/u = ${formatMoneyExact(orderAmountCents(item.unitPrice, item.quantity) / 100)}`;
    if (!item.categorySnapshot) { uncategorized.push(text); continue; }
    const category = item.categorySnapshot;
    const group = groups.get(category.id) ?? { name: clean(category.name), lines: [] };
    group.lines.push(text);
    groups.set(category.id, group);
  }
  const sections = [...groups.values(), ...(uncategorized.length ? [{ name: "Sin categoría", lines: uncategorized }] : [])];
  const totals = orderTotals(order);
  const excessCents = Math.max(0, orderAmountCents(totals.paid) - orderAmountCents(totals.estimatedTotal));
  return [
    `Detalle de pedido #${orderReference(order.id)}`,
    `Tienda: ${clean(storeName)}`,
    `Cliente: ${clean(order.customerName || currentCustomerName || "Sin cliente")}`,
    `Estado: ${ORDER_STATUS_LABELS[effectiveOrderStatus(order)]}`,
    ...sections.flatMap((group) => ["", group.name, ...group.lines]),
    "",
    `Total: ${formatMoneyExact(totals.estimatedTotal)}`,
    `Anticipo registrado: ${formatMoneyExact(totals.paid)}`,
    `Saldo: ${formatMoneyExact(totals.balance)}`,
    ...(excessCents ? [`Anticipo mayor al total: ${formatMoneyExact(excessCents / 100)}`] : []),
  ].join("\n");
}
