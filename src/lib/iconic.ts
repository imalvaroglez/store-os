import type { Customer, Order } from "../types";
import { effectiveOrderStatus, orderTotals } from "./orders";
import { orderAmountCents } from "./orderMoney";

// FER-05 · Iconic benefit: obtención, renovación y vencimiento.
//
// Business rules (PO review 2026-11-03, overriding the original capture-based
// design — see docs/superpowers/specs/fer-iconic-renewal-design.md):
// - A LIQUIDATED order (received money covers its total) with total ≥ $1,000
//   MXN grants Iconic, for a mobile 30-day window counted from the order's own
//   saved date (never inferred). Contraentrega: liquidation ≈ capture day.
// - ANY other liquidated order of the same customer inside the current window
//   renews it — no minimum amount. The new expiry is the renewing order's
//   date + 30 days (mobile period, not stacked on the old expiry).
// - After a window lapses, the next qualifying (≥ $1,000) liquidated order
//   simply starts a new one. A small liquidated order alone opens nothing.
// - Cancelled orders never count. Capture without money no longer activates.
// - A manual grant on the customer (iconic.since/until) adds to the automatic
//   window; automation never takes away what was granted by hand.
//
// Everything here is a pure derivation over already-synced state: zero extra
// Firestore reads or writes for activation, renewal and expiry.

/** "Desde $1,000" — at or above the threshold (PO 2026-11-03: incluye $1,000 justo). */
export const ICONIC_MIN_TOTAL = 1000;
/** Mobile renewal period, in days (periodo móvil, not calendar month). */
export const ICONIC_WINDOW_DAYS = 30;
/** Advance notice: Fer asked for "una semana antes" — 7 calendar days. */
export const ICONIC_NOTICE_DAYS = 7;

const DAY_MS = 86_400_000;
// Mexico City is a flat UTC-6 (no DST since 2022; see lib/dates.ts).
const MX_OFFSET_MS = 6 * 3_600_000;

export type IconicStatus = {
  /** True while the validity (automatic, manual or both) covers "now". */
  active: boolean;
  /** Day-granularity ISO dates (Mexico City calendar day). */
  since: string;
  /** Latest expiry date among the active sources — or the date it lapsed. */
  until: string;
  /** Whole calendar days (Mexico City) before expiry; 0 = expires today. */
  daysLeft: number;
  /** Active AND inside the advance-notice window. */
  expiringSoon: boolean;
  /** A manual grant sustains the current validity. */
  manual: boolean;
  /** A saved qualifying order sustains the current validity. */
  fromOrders: boolean;
};

type Window = { sinceMs: number; untilMs: number };

const DAY_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayIso(ms: number): string {
  const mx = new Date(ms - MX_OFFSET_MS);
  const y = mx.getUTCFullYear();
  const m = String(mx.getUTCMonth() + 1).padStart(2, "0");
  const d = String(mx.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Calendar-day distance in Mexico City between two instants. */
function daysBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - MX_OFFSET_MS) / DAY_MS) - Math.floor((fromMs - MX_OFFSET_MS) / DAY_MS);
}

/**
 * The manual grant, parsed to instants: since = local midnight, until = the END
 * of the local day (the grant covers its whole final day). Invalid, partial or
 * inverted data is ignored (null) — corrupted docs must never produce NaN.
 */
function manualWindow(customer: Customer): Window | null {
  const { since, until } = customer.iconic ?? {};
  if (typeof since !== "string" || typeof until !== "string") return null;
  if (!DAY_ISO_RE.test(since) || !DAY_ISO_RE.test(until)) return null;
  const sinceMs = Date.parse(`${since}T00:00:00-06:00`);
  const untilMs = Date.parse(`${until}T23:59:59.999-06:00`);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs < sinceMs) return null;
  return { sinceMs, untilMs };
}

/**
 * Received money in exact cents for the liquidation test. The doc accumulator
 * (#168) is the truth when payment records exist (any record implies the
 * inherited deposit materialized); a legacy order captured with only a deposit
 * counts it — paid-on-capture flows. Cancelled/garbage values never produce
 * NaN: the accumulator is an integer, the deposit coerces via parseAmount's
 * exact-cents helper.
 */
function receivedCents(o: Order): number {
  const acc = o.paymentsReceivedCents ?? 0;
  if (acc > 0) return acc;
  return orderAmountCents(Math.max(0, o.deposit ?? 0));
}

/** Order total in exact cents from the frozen-line snapshots (never NaN). */
function totalCents(o: Order): number {
  return orderAmountCents(orderTotals(o).estimatedTotal);
}

/** LIQUIDATED = received money covers the total (PO 2026-11-03: money, not capture). */
function isLiquidated(o: Order): boolean {
  return receivedCents(o) >= totalCents(o) && totalCents(o) > 0;
}

/**
 * The automatic window, chained over the customer's LIQUIDATED orders (this
 * store's only — isolation is re-checked here even though callers pass
 * store-scoped orders). A liquidated order with total ≥ ICONIC_MIN_TOTAL opens
 * (or re-opens) a window; ANY liquidated order inside the current window
 * renews it. Dates are each order's own saved createdAt.
 */
function ordersWindow(orders: Order[], customer: Customer): Window | null {
  const liquidated = orders
    .filter(
      (o) =>
        o.customerId === customer.id &&
        o.storeId === customer.storeId &&
        effectiveOrderStatus(o) !== "cancelled" &&
        isLiquidated(o)
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let window: Window | null = null;
  for (const o of liquidated) {
    const at = Date.parse(o.createdAt);
    if (!Number.isFinite(at)) continue;
    const qualifies = totalCents(o) >= orderAmountCents(ICONIC_MIN_TOTAL);
    if (window && at <= window.untilMs) {
      // Renewal inside the window: any liquidated order, no minimum. The
      // mobile period restarts at the renewing order's own date.
      window.untilMs = Math.max(window.untilMs, at + ICONIC_WINDOW_DAYS * DAY_MS);
    } else if (qualifies) {
      window = { sinceMs: at, untilMs: at + ICONIC_WINDOW_DAYS * DAY_MS };
    }
  }
  return window;
}

/**
 * Effective Iconic status of one customer. Returns null when there is no
 * Iconic history at all (no qualifying orders, no manual grant) — "cliente sin
 * Iconic". `orders` should be the customer's store's orders (already synced);
 * `noticeDays` widens/narrows the advance-notice flag.
 */
export function iconicStatus(
  customer: Customer,
  orders: Order[],
  now: Date = new Date(),
  noticeDays: number = ICONIC_NOTICE_DAYS
): IconicStatus | null {
  const nowMs = now.getTime();
  const fromOrdersWin = ordersWindow(orders, customer);
  const manualWin = manualWindow(customer);
  if (!fromOrdersWin && !manualWin) return null;

  const fromOrders = !!fromOrdersWin && fromOrdersWin.untilMs >= nowMs;
  const manual = !!manualWin && manualWin.untilMs >= nowMs;
  const active = fromOrders || manual;

  const windows = [fromOrdersWin, manualWin].filter((w): w is Window => w != null);
  const untilMs = Math.max(...windows.map((w) => w.untilMs));
  // While active, "since" is the earliest source still in effect; once lapsed,
  // the earliest recorded start of the latest cycle.
  const activeStarts = windows.filter((w) => w.untilMs >= nowMs).map((w) => w.sinceMs);
  const sinceMs = activeStarts.length > 0 ? Math.min(...activeStarts) : Math.min(...windows.map((w) => w.sinceMs));

  const daysLeft = daysBetween(nowMs, untilMs);
  return {
    active,
    since: dayIso(sinceMs),
    until: dayIso(untilMs),
    daysLeft,
    expiringSoon: active && daysLeft <= noticeDays,
    manual,
    fromOrders,
  };
}
