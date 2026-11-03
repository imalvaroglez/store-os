// Order payments (#123): the money rules behind per-order payment records.
// Received = Σ payment records (plus the still-unmaterialized legacy deposit);
// balance = total − received. Always recomputed from the records — there is no
// parallel accumulator. All numeric coercion flows through parseAmount and the
// exact-cents helpers; NaN never enters the state.
import type { Order, OrderPayment, OrderPaymentMethod } from "../../types";
import { parseAmount } from "../../lib/money";
import { orderAmountCents } from "../../lib/orderMoney";
import { orderItems } from "../../lib/orders";

/** Deterministic id of the one-time materialization of the legacy `deposit`. */
export const INHERITED_DEPOSIT_PAYMENT_ID = "inherited_deposit";

export const PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  unknown: "Desconocido",
};

/** Form input for a normal reception (positive amount, known method). */
export type PaymentFormInput = {
  kind: "payment";
  /** Stable per user intent — reused across retries (idempotency key). */
  id: string;
  method: "cash" | "transfer";
  /** YYYY-MM-DD; defaults to today (the real reception moment). */
  date?: string;
  /** Raw form text; coerced via parseAmount. */
  amountText: string;
  note?: string;
  /**
   * Legacy deposit materialization data (#123, PO decision 2026-11-03): the
   * operator supplies the date/method of the old anticipo (estimated when she
   * does not remember). Required with the first payment of an order that still
   * carries an unmaterialized deposit.
   */
  inherited?: { method: "cash" | "transfer"; date: string };
};

/** Form input for a correction/refund (signed amount, note = evidence). */
export type AdjustmentFormInput = {
  kind: "adjustment";
  id: string;
  amountText: string;
  note: string;
};

export type PaymentRecordInput = PaymentFormInput | AdjustmentFormInput;

/** Exact cents for a signed decimal amount (orderAmountCents rejects negatives). */
export function signedAmountCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new RangeError("Monto inválido");
  const sign = amount < 0 ? -1 : 1;
  return sign * orderAmountCents(Math.abs(amount));
}

function finiteCents(amount: number): number {
  return Number.isFinite(amount) ? signedAmountCents(amount) : 0;
}

function normalizeAmount(amountText: string): number {
  const amount = parseAmount(amountText);
  if (amount == null) throw new Error("Captura un monto válido.");
  return amount;
}

function normalizeDate(input: PaymentFormInput, now: string): string {
  const date = input.date?.trim();
  if (!date) return now.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("La fecha del cobro no es válida.");
  return date;
}

/** Validate and build a payment record from the form. Throws (es-MX) on bad input. */
export function buildPaymentRecord(
  order: Pick<Order, "id" | "storeId">,
  input: PaymentFormInput,
  by: string,
  now = new Date().toISOString()
): OrderPayment {
  if (input.method !== "cash" && input.method !== "transfer") {
    throw new Error("Selecciona un método de cobro.");
  }
  const amount = normalizeAmount(input.amountText);
  if (amount <= 0) throw new Error("El monto del cobro debe ser mayor a cero.");
  const note = input.note?.trim();
  return {
    id: input.id,
    orderId: order.id,
    storeId: order.storeId,
    date: normalizeDate(input, now),
    method: input.method,
    kind: "payment",
    amount,
    ...(note ? { note } : {}),
    createdAt: now,
    createdBy: by,
  };
}

/** Validate and build a signed adjustment. The note is the evidence — required. */
export function buildAdjustmentRecord(
  order: Pick<Order, "id" | "storeId">,
  input: AdjustmentFormInput,
  by: string,
  now = new Date().toISOString()
): OrderPayment {
  const amount = normalizeAmount(input.amountText);
  if (amount === 0) throw new Error("El monto del ajuste no puede ser cero.");
  const note = input.note.trim();
  if (!note) throw new Error("Escribe el motivo del ajuste.");
  return {
    id: input.id,
    orderId: order.id,
    storeId: order.storeId,
    date: now.slice(0, 10),
    method: "unknown",
    kind: "adjustment",
    amount,
    note,
    createdAt: now,
    createdBy: by,
  };
}

/**
 * The legacy `deposit` accumulated before per-record payments existed. Its
 * date and method are supplied by the operator when the first payment
 * materializes it — estimated when she does not remember, never "unknown"
 * (PO decision 2026-11-03, overriding the original decision i on #123).
 * Null when there is nothing to register.
 */
export function inheritedDepositRecord(
  orderId: string,
  storeId: string,
  deposit: number,
  by: string,
  input: { method: "cash" | "transfer"; date: string },
  now = new Date().toISOString()
): OrderPayment | null {
  if (!Number.isFinite(deposit) || deposit <= 0) return null;
  if (input.method !== "cash" && input.method !== "transfer") {
    throw new Error("Selecciona el método del anticipo previo.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) {
    throw new Error("Captura la fecha del anticipo previo (estímala si no la recuerdas).");
  }
  return {
    id: INHERITED_DEPOSIT_PAYMENT_ID,
    orderId,
    storeId,
    date: input.date,
    method: input.method,
    kind: "payment",
    amount: deposit,
    note: "Anticipo previo: fecha y método estimados por la operadora.",
    createdAt: now,
    createdBy: by,
  };
}

/** Σ signed cents over records; corrupt amounts contribute 0 (never NaN). */
export function paymentsCents(payments: OrderPayment[] | undefined | null): number {
  return (payments ?? []).reduce((sum, p) => sum + finiteCents(p.amount), 0);
}

/** Store isolation: a payment must match BOTH the order and the store. */
export function orderPaymentsFor(
  payments: OrderPayment[] | undefined | null,
  orderId: string,
  storeId: string
): OrderPayment[] {
  return (payments ?? []).filter((p) => p.orderId === orderId && p.storeId === storeId);
}

/** Merge loaded/saved records by id (replace, never duplicate). */
export function mergePayments(prev: OrderPayment[], incoming: OrderPayment[]): OrderPayment[] {
  const byId = new Map(prev.map((p) => [p.id, p]));
  for (const p of incoming) byId.set(p.id, p);
  return [...byId.values()];
}

export type PaymentSummary = {
  /** Order total in cents (Σ frozen line snapshots). */
  totalCents: number;
  /** Received = Σ records + the still-unmaterialized inherited deposit. */
  receivedCents: number;
  /** total − received, signed: negative means money in the customer's favor. */
  balanceCents: number;
  /** Deposit cents not yet materialized as a record (shown as unknown). */
  inheritedPendingCents: number;
  /** The order's records, chronological evidence (earliest first). */
  records: OrderPayment[];
};

/**
 * The single read model for the payments UI. Recomputed from the records every
 * time, so a total change recalculates the balance without touching a single
 * payment (decision iv) and refunds stay visible (decision iii).
 */
export function paymentSummary(
  order: Partial<Order> & Record<string, unknown>,
  payments: OrderPayment[]
): PaymentSummary {
  const totalCents = orderItems(order).reduce(
    (sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity),
    0
  );
  const records = orderPaymentsFor(payments, String(order.id ?? ""), String(order.storeId ?? "")).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
  const inheritedMaterialized = records.some((p) => p.id === INHERITED_DEPOSIT_PAYMENT_ID);
  const deposit = typeof order.deposit === "number" && Number.isFinite(order.deposit) ? order.deposit : 0;
  const inheritedPendingCents = inheritedMaterialized ? 0 : orderAmountCents(Math.max(0, deposit));
  const receivedCents = paymentsCents(records) + inheritedPendingCents;
  return {
    totalCents,
    receivedCents,
    balanceCents: totalCents - receivedCents,
    inheritedPendingCents,
    records,
  };
}
