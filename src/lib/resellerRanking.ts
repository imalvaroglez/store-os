import type { Customer, Order } from "../types";
import { orderAmountCents } from "./orderMoney";
import { orderItems } from "./orders";
import { stockDimensionKey } from "./inventory";

// FER-17 (#132): monthly top of EMPRENDEDORAS — net amount of products
// EFFECTIVELY DELIVERED in the calendar month (America/Mexico_City), at the
// REAL prices applied, minus confirmed refunds of the same month. Only
// customers explicitly marked `segment: "entrepreneur"` participate — never
// inferred from tiers, order counts or amounts. Tie-break #1: more delivered
// pieces; a PERSISTENT tie (amount AND pieces) stays TIED for Fer to resolve
// and record — never a technical presentation order.
//
// Read-only derivation: no writes, no external data, and returns for Olivia
// only (#205 multi-store isolation by storeId).

export type RankingMonth = { year: number; month: number };

export type RankingEntry = {
  customerId: string;
  customerName: string;
  /** Net delivered amount, exact cents, refunds of the month discounted. */
  netCents: number;
  /** Pieces effectively delivered in the month (deliveries, not orders). */
  pieces: number;
  /** True when amount AND pieces tie with another entry (Fer resolves). */
  tie: boolean;
};

export type RankingInputs = {
  storeId: string;
  month: RankingMonth;
  orders: Order[];
  customers: Customer[];
};

export type MonthRanking = {
  month: RankingMonth;
  entries: RankingEntry[]; // sorted; ties kept adjacent and marked
  needsManualResolution: boolean;
};

/** Calendar month (YYYY-MM) in America/Mexico_City; a date-only string IS its
 * own local date (same rule as the monthly close #129 — day 1 never leaks to
 * the previous month via UTC midnight). */
export function rankingMonthKey(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(0, 7);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit" }).format(new Date(iso));
  return date.slice(0, 7);
}

/** Pure monthly ranking. Never mutates orders; no listeners; no extra reads. */
export function monthRanking(inputs: RankingInputs): MonthRanking {
  const { storeId, month, orders, customers } = inputs;
  const monthKey = `${month.year}-${String(month.month).padStart(2, "0")}`;

  const entrepreneurs = new Set(
    customers.filter((c) => c.storeId === storeId && c.segment === "entrepreneur").map((c) => c.id)
  );
  const nameOf = new Map(customers.map((c) => [c.id, c.name]));

  type Agg = { netCents: number; pieces: number };
  const byCustomer = new Map<string, Agg>();

  const add = (customerId: string, cents: number, pieces: number) => {
    const agg = byCustomer.get(customerId) ?? { netCents: 0, pieces: 0 };
    agg.netCents += cents;
    agg.pieces += pieces;
    byCustomer.set(customerId, agg);
  };

  for (const order of orders) {
    if (order.storeId !== storeId) continue;
    if (!entrepreneurs.has(order.customerId)) continue; // participants only, by explicit mark
    const items = orderItems(order);

    // ── Delivered pieces (the ONLY metric source): delivery events with their
    // effective local date; repeated event ids (retries) count once.
    const seenDeliveryIds = new Set<string>();
    for (const delivery of order.deliveries ?? []) {
      if (seenDeliveryIds.has(delivery.id)) continue;
      seenDeliveryIds.add(delivery.id);
      if (rankingMonthKey(delivery.deliveredAt) !== monthKey) continue;
      for (const line of delivery.lines) {
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue;
        const item = items.find(
          (candidate) => stockDimensionKey(candidate.productId ?? "", candidate.variantId) === stockDimensionKey(line.productId, line.variantId)
        );
        if (!item) continue; // line left the order — nothing verifiable to count
        add(order.customerId, orderAmountCents(item.unitPrice, line.quantity), line.quantity);
      }
    }

    // ── Confirmed refunds of the SAME month discount the piece at its real
    // (historical) price — the #203 incident math already froze it.
    for (const incident of order.incidents ?? []) {
      const confirmed = (incident.events ?? []).some((event) => event.kind === "confirmed");
      const refunded = incident.resolution?.kind === "refund";
      if (!confirmed || !refunded) continue;
      const confirmedAt = (incident.events ?? []).find((event) => event.kind === "confirmed")?.at;
      if (!confirmedAt || rankingMonthKey(confirmedAt) !== monthKey) continue;
      const unit = incident.resolution?.saleAdjustmentUnitCents ?? incident.originalUnitPriceCents;
      const qty = Math.max(1, Math.round(incident.quantity || 1));
      add(order.customerId, -unit * qty, -qty);
    }
  }

  const raw = [...byCustomer.entries()].map(([customerId, agg]) => ({
    customerId,
    customerName: nameOf.get(customerId) ?? customerId,
    netCents: agg.netCents,
    pieces: agg.pieces,
    tie: false,
  }));

  // Sort: net amount desc, then delivered pieces desc; persistent ties stay
  // TIED (marked) for Fer's manual resolution — no third technical criterion.
  raw.sort((a, b) => b.netCents - a.netCents || b.pieces - a.pieces || a.customerName.localeCompare(b.customerName, "es"));
  let needsManualResolution = false;
  for (let i = 0; i < raw.length; i++) {
    const other = raw.find(
      (candidate) =>
        candidate !== raw[i] &&
        candidate.netCents === raw[i].netCents &&
        candidate.pieces === raw[i].pieces
    );
    if (other) {
      raw[i].tie = true;
      needsManualResolution = true;
    }
  }

  return { month, entries: raw, needsManualResolution };
}
