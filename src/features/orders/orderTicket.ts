import type { Order } from "../../types";
import { formatMoneyExact } from "../../lib/money";
import { orderAmountCents } from "../../lib/orderMoney";
import { orderItems } from "../../lib/orders";
import { docReceivedCents } from "./payments";

/**
 * Canonical order ticket (PO 2026-11-04): client name + order date, numbered
 * pieces with line totals, Total — plus a single "Saldo" line ONLY when money
 * is still owed, using the canonical received amount (transactional
 * accumulator + still-unmaterialized legacy deposit, #168 F4). Private notes
 * and costs never appear. ONE data builder feeds both the WhatsApp text
 * (copy from the order card) and the printable receipt (#139): the PDF can
 * never drift from the text Fer already sends.
 */
export type OrderTicketLine = { index: number; label: string; amount: string };
export type OrderTicketData = {
  storeName: string;
  customer: string;
  dateLabel: string;
  lines: OrderTicketLine[];
  total: string;
  /** Present ONLY when money is still owed — mirrors the text format. */
  saldo?: string;
};

export function orderTicketData(order: Order, storeName: string, currentCustomerName?: string): OrderTicketData {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const items = orderItems(order);
  const totalCents = items.reduce((sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity), 0);
  const hasPaymentRecords = typeof order.paymentsReceivedCents === "number";
  const receivedCents = hasPaymentRecords
    ? docReceivedCents(order)
    : orderAmountCents(Math.max(0, typeof order.deposit === "number" && Number.isFinite(order.deposit) ? order.deposit : 0));
  const balanceCents = Math.max(0, totalCents - receivedCents);

  return {
    storeName,
    customer: clean(order.customerName || currentCustomerName || "Sin cliente"),
    dateLabel: order.createdAt ? longDate(order.createdAt) : "",
    lines: items.map((item, index) => ({
      index: index + 1,
      label: `${item.quantity > 1 ? `${item.quantity} × ` : ""}${clean(item.productName)}`,
      amount: formatMoneyExact(orderAmountCents(item.unitPrice, item.quantity) / 100),
    })),
    total: formatMoneyExact(totalCents / 100),
    ...(balanceCents > 0 ? { saldo: formatMoneyExact(balanceCents / 100) } : {}),
  };
}

/** WhatsApp text in Fer's own message format — same builder as the receipt. */
export function orderTicketText(order: Order, storeName: string, currentCustomerName?: string): string {
  const data = orderTicketData(order, storeName, currentCustomerName);
  return [
    data.dateLabel ? `${data.customer} ${data.dateLabel}` : data.customer,
    ...data.lines.map((line) => `${line.index}. ${line.label} ${line.amount}`),
    `Total ${data.total}`,
    ...(data.saldo ? [`Saldo ${data.saldo}`] : []),
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
