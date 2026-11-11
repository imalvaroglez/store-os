import type { Order } from "../../types";
import { formatMoneyPlain } from "../../lib/money";
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
  const totals = orderTotals(order);
  const balanceCents = Math.round(totals.balance * 100);
  // #306: a fresh order with nothing received owes exactly the Total — the
  // Saldo line would just repeat it. Show Saldo only when money/credit already
  // moved (partial), and a real surplus as "A tu favor" (#306 Fer-reader
  // verdict: "Saldo a favor" reads as debt to a clienta).
  const moneyMoved = totals.paid > 0 || totals.appliedCredit > 0;
  // #306 + revisión adversarial: hide the Saldo ONLY when it would repeat the
  // Total verbatim (nothing received, no credit, no posventa adjustment). An
  // incident without cash changes the real debt — that Saldo must show.
  const saldoDiffers = balanceCents !== totalCents;
  const showSaldo = balanceCents > 0 && (moneyMoved || saldoDiffers);
  const favorCents = Math.round(totals.availableCredit * 100);
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
      return `${itemNumber}. ${quantity}${clean(item.productName)} ${formatMoneyPlain(orderAmountCents(item.unitPrice, item.quantity) / 100)}`;
    }),
  ]);

  lines.push(...(groups.length ? ["", ...groups] : []), "", `*Total* ${formatMoneyPlain(totalCents / 100)}`);
  if (showSaldo) lines.push(`*Saldo* ${formatMoneyPlain(balanceCents / 100)}`);
  if (favorCents > 0) lines.push(`*A tu favor* ${formatMoneyPlain(favorCents / 100)}`);
  return lines.join("\n");
}

/** #308 — filesystem-safe receipt name: Pedido-<REF>-<Clienta>. The print
 * flow sets it as document.title so the browser's "Guardar como PDF"
 * suggests it (the only filename StoreOS controls); accents transliterate,
 * anything else collapses to dashes, missing name falls back to ref-only. */
export function receiptFileName(orderId: string, customerName?: string): string {
  const safe = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+/g, "")
      .slice(0, 40)
      .replace(/-+$/g, ""); // a cut can land mid-separator — no trailing dash
  const client = safe(customerName ?? "");
  return `Pedido-${orderReference(orderId)}${client ? `-${client}` : ""}`;
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

// ── #139 printable receipt data — same money as the text above ──────────────
// One data builder feeds the printable receipt; the WhatsApp TEXT keeps Fer's
// exact bold format. Both read the SAME canonical money (received accumulator
// + pending legacy deposit, saldo net of credit/posventa per #189/#203), so
// the PDF can never drift from the message Fer already sends.

import { docReceivedCents } from "./payments";

export type OrderTicketLine = { index: number; label: string; amount: string };
export type OrderTicketData = {
  storeName: string;
  customer: string;
  dateLabel: string;
  lines: OrderTicketLine[];
  total: string;
  /** Canonical amount received, including an unmaterialized legacy deposit. */
  cobrado: string;
  /** Present ONLY when money is still owed (partial) — mirrors the text format. */
  saldo?: string;
  /** Real surplus in the clienta's favor — paid beyond the effective total;
   * shown to the client as "A tu favor" (#306 Fer-reader verdict). */
  availableCredit?: string;
};

export function orderTicketData(order: Order, storeName: string, currentCustomerName?: string): OrderTicketData {
  const clean = (value: string) => value.replace(/\*/g, "").replace(/\s+/g, " ").trim();
  const items = orderItems(order);
  const totalCents = items.reduce((sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity), 0);
  const receivedCents = docReceivedCents(order);
  const totals = orderTotals(order);
  const moneyMoved = totals.paid > 0 || totals.appliedCredit > 0;
  // Canonical balance (#168 F4 + #189 + #203): net of applied saldo a favor
  // and posventa adjustments — never a hand-rolled subtraction. The Saldo
  // hides only when it would repeat the Total verbatim (#306 review P1).
  const balanceCents = Math.round(totals.balance * 100);
  const favorCents = Math.round(totals.availableCredit * 100);
  const showSaldo = balanceCents > 0 && (moneyMoved || balanceCents !== totalCents);
  return {
    storeName,
    customer: clean(order.customerName || currentCustomerName || "Sin cliente"),
    dateLabel: order.createdAt ? longDate(order.createdAt) : "",
    lines: items.map((item, index) => ({
      index: index + 1,
      label: `${item.quantity > 1 ? `${item.quantity} × ` : ""}${clean(item.productName)}`,
      amount: formatMoneyPlain(orderAmountCents(item.unitPrice, item.quantity) / 100),
    })),
    total: formatMoneyPlain(totalCents / 100),
    cobrado: formatMoneyPlain(receivedCents / 100),
    ...(showSaldo ? { saldo: formatMoneyPlain(balanceCents / 100) } : {}),
    ...(favorCents > 0 ? { availableCredit: formatMoneyPlain(favorCents / 100) } : {}),
  };
}
