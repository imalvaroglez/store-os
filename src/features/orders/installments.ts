// Installment plans (#165): the schedule/coverage rules layered on top of the
// #123 payment records. Pure functions only — persistence lives in
// firestoreData.ts. The read model recomputes from the order's current total
// plus the money truth of the ORDER DOC (#168): docReceivedCents — the
// transactional accumulator payments.ts maintains — never a session's view of
// the records, and the number of receipts is never the number of cuotas.
//
// Adopted decisions (issue #165 comment, 2026-11-02): the operator picks the
// first due date and a configurable frequency (weekly/biweekly/monthly); later
// dates derive from it; there is no settlement deadline separate from the
// order's promised date; an abono covers the nearest-due cuota first and the
// leftover flows to the next; lateness is shown without penalties; there is no
// separate down payment — any abono reduces the same total; no interest or
// charges of any kind exist in this model.
import type { InstallmentFrequency, Order, OrderInstallmentPlan } from "../../types";
import { parseAmount } from "../../lib/money";
import { orderAmountCents } from "../../lib/orderMoney";
import { orderItems } from "../../lib/orders";
import { incidentsSaleAdjustmentCents } from "../../lib/orderMoney";
import { docReceivedCents } from "./payments";

export type { InstallmentFrequency, OrderInstallmentPlan };

export const INSTALLMENT_FREQUENCY_LABELS: Record<InstallmentFrequency, string> = {
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
};

/** Cuota counts are operator-chosen per order; the bounds only keep the
 * derived calendar finite. No default count exists anywhere. */
export const MIN_INSTALLMENTS = 1;
export const MAX_INSTALLMENTS = 99;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD (round-trips through UTC). */
export function isValidIsoDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/**
 * Validate the operator's plan input. Throws (es-MX) with the exact reason so
 * forms surface it verbatim; never coerces invalid numbers into the plan.
 */
export function validateInstallmentPlanInput(input: {
  countText: string;
  frequency: string;
  firstDueDate: string;
  /** The order's CURRENT total in exact cents. */
  totalCents: number;
}): { count: number; frequency: InstallmentFrequency; firstDueDate: string } {
  const count = parseAmount(input.countText);
  if (
    count == null ||
    !Number.isSafeInteger(count) ||
    count < MIN_INSTALLMENTS ||
    count > MAX_INSTALLMENTS
  ) {
    throw new Error(`Captura un número de cuotas válido (entre ${MIN_INSTALLMENTS} y ${MAX_INSTALLMENTS}).`);
  }
  if (input.frequency !== "weekly" && input.frequency !== "biweekly" && input.frequency !== "monthly") {
    throw new Error("Elige la frecuencia de los pagos.");
  }
  if (!isValidIsoDate(input.firstDueDate)) {
    throw new Error("Captura la primera fecha de vencimiento.");
  }
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents <= 0) {
    throw new Error("El total del pedido debe ser mayor a cero para pagar por partes.");
  }
  return { count, frequency: input.frequency, firstDueDate: input.firstDueDate };
}

/**
 * Exact-cents cuota split: base = ⌊total/count⌋ cents; the division remainder
 * is assigned explicitly to the EARLIEST cuotas so Σ cuotas == total — never a
 * rounded average, never a lost or invented cent.
 */
export function splitInstallmentCents(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new RangeError("Invalid installment total");
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("Invalid installment count");
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Whole days added to an ISO date, in UTC (dates never shift by time zone). */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Calendar months added to an ISO date; nonexistent days clamp to the target
 * month's last day (ene 31 → feb 28/29) — the dates keep existing. */
function addMonthsIso(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const firstOfTarget = new Date(Date.UTC(year, month - 1 + months, 1));
  const y = firstOfTarget.getUTCFullYear();
  const m = firstOfTarget.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

/** The n-th due date (0-based) derived from the first due date + frequency. */
export function installmentDueDate(
  firstDueDate: string,
  frequency: InstallmentFrequency,
  n: number
): string {
  if (frequency === "monthly") return addMonthsIso(firstDueDate, n);
  return addDaysIso(firstDueDate, n * (frequency === "weekly" ? 7 : 14));
}

export type InstallmentCuotaStatus = "covered" | "partial" | "pending";

export type InstallmentCuota = {
  /** 1-based, for display only. */
  index: number;
  dueDate: string;
  amountCents: number;
  /** How much of the accumulated received money fills THIS cuota (waterfall). */
  coveredCents: number;
  status: InstallmentCuotaStatus;
  /** Informative only: the due date passed and the cuota is not fully
   * covered. No penalty/interest exists in this model. */
  late: boolean;
};

export type InstallmentPlanView = {
  plan: OrderInstallmentPlan;
  cuotas: InstallmentCuota[];
  /** FULLY covered cuotas — computed by the waterfall, never the receipt count. */
  coveredCount: number;
  lateCount: number;
  lastDueDate: string;
  /** Calendar sum == the order's CURRENT total, exact. */
  totalCents: number;
  receivedCents: number;
  balanceCents: number;
  /** Whether the first confirmed abono already reserved the pieces. */
  reserved: boolean;
  /** #165 delivery rule: an installment order cannot be CONFIRMED delivered
   * while money is owed. Liquidar enables delivery; it never auto-delivers. */
  deliveryBlocked: boolean;
};

/**
 * Waterfall application: the accumulated received money fills the nearest-due
 * cuota first; the leftover flows to the next. Signed adjustments participate
 * through the accumulated total, so a refund un-covers cuotas by itself.
 */
function applyReceivedToSchedule(amounts: number[], receivedCents: number): number[] {
  let remaining = Math.max(0, receivedCents);
  return amounts.map((amount) => {
    const covered = Math.min(amount, remaining);
    remaining -= covered;
    return covered;
  });
}

/**
 * The single read model for the installment UI. Recomputed every time from the
 * CURRENT total and the money truth of the ORDER DOC (docReceivedCents: the
 * transactional accumulator plus the pending inherited deposit), so a total or
 * plan change re-derives everything without touching a single payment — and a
 * fresh session with no payment records loaded shows the real numbers (#168).
 */
export function installmentPlanView(
  order: Partial<Order> & Record<string, unknown>,
  today: string = new Date().toISOString().slice(0, 10)
): InstallmentPlanView | null {
  const plan = order.installments as OrderInstallmentPlan | undefined;
  if (!plan) return null;
  // #203: effective total, same as every other read model (#212 F3).
  const totalCents = Math.max(0, orderTotalCents(order) + incidentsSaleAdjustmentCents(order.incidents));
  const receivedCents = docReceivedCents(order);
  // #189: the NET balance — saldo a favor applied from sister orders counts
  // as covered (the clienta's money already arrived, on another order). Cuota
  // coverage below stays pure REAL money: credit never fakes a cobro.
  const appliedCredit = typeof order.creditAppliedCents === "number" && Number.isSafeInteger(order.creditAppliedCents)
    ? Math.max(0, order.creditAppliedCents) : 0;
  const balanceCents = totalCents - receivedCents - appliedCredit;
  const amounts = splitInstallmentCents(totalCents, plan.count);
  const coverage = applyReceivedToSchedule(amounts, receivedCents);
  const cuotas: InstallmentCuota[] = amounts.map((amountCents, i) => {
    const coveredCents = coverage[i];
    const dueDate = installmentDueDate(plan.firstDueDate, plan.frequency, i);
    return {
      index: i + 1,
      dueDate,
      amountCents,
      coveredCents,
      status: coveredCents >= amountCents ? "covered" : coveredCents > 0 ? "partial" : "pending",
      late: coveredCents < amountCents && dueDate < today,
    };
  });
  return {
    plan,
    cuotas,
    coveredCount: cuotas.filter((c) => c.status === "covered").length,
    lateCount: cuotas.filter((c) => c.late).length,
    lastDueDate: cuotas[cuotas.length - 1]?.dueDate ?? plan.firstDueDate,
    totalCents,
    receivedCents,
    balanceCents,
    reserved: !!order.installmentsReservedAt,
    deliveryBlocked: balanceCents > 0,
  };
}

/**
 * #168: the doc-side money a delivery gate evaluates. `accumulatorCents` is
 * `paymentsReceivedCents` — cobros that actually landed; it TRIGGERS the gate
 * for plan-less orders. `receivedCents` is the accumulator plus the still
 * pending inherited deposit — the money that may cover the total (the same
 * single-count semantics paymentSummary always gave plan orders).
 */
export type DocMoney = {
  accumulatorCents: number;
  receivedCents: number;
};

/** #189: saldo a favor applied to this order (destination accumulator); the
 * clienta's money already received on a sister order — counts as covered. */
function creditAppliedCentsOf(order: Partial<Order> & Record<string, unknown>): number {
  const value = order.creditAppliedCents;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Net balance a delivery decision evaluates: EFFECTIVE total (historical +
 * incident adjustments, #203) − received − applied credit (#189) — the same
 * figure every read model shows as "Pendiente". */
export function uncoveredBalanceCents(order: Partial<Order> & Record<string, unknown>, money: DocMoney): number {
  return effectiveOrderTotalCents(order) - creditAppliedCentsOf(order) - money.receivedCents;
}

/** #165/#168 F1 delivery gate for the mutation path: an order with a plan OR
 * with registered cobros (the doc accumulator) may only be confirmed delivered
 * once its total is covered by received money. #189: saldo a favor applied
 * from sister orders counts as covered — it is the clienta's money, received
 * on another order. Removing the plan with a saldo cannot dodge the gate in
 * the same save; a deposit-only ordinary order keeps its legacy behavior (no
 * cobros → the gate never triggers).
 */
export function deliveryWithBalanceBlocked(order: Partial<Order> & Record<string, unknown>, money: DocMoney): boolean {
  return (!!order.installments || money.accumulatorCents > 0) && uncoveredBalanceCents(order, money) > 0;
}

/** Order total in exact cents — the same frozen-line math payments.ts uses. */
export function orderTotalCents(order: Partial<Order> & Record<string, unknown>): number {
  return orderItems(order).reduce(
    (sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity),
    0
  );
}

/** #203/#268: the EFFECTIVE total every read model uses (paymentSummary, the
 * card, the calendar): historical + incident adjustments, floored at zero. */
export function effectiveOrderTotalCents(order: Partial<Order> & Record<string, unknown>): number {
  return Math.max(0, orderTotalCents(order) + incidentsSaleAdjustmentCents(order.incidents));
}

/** Same agreement (count/frequency/first date)? Agreed-at/by are metadata. */
export function sameInstallmentPlan(
  a: OrderInstallmentPlan | undefined,
  b: OrderInstallmentPlan | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.count === b.count && a.frequency === b.frequency && a.firstDueDate === b.firstDueDate;
}
