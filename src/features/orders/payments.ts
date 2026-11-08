// Order payments (#123): the money rules behind per-order payment records.
// Received = Σ payment records (plus the still-unmaterialized legacy deposit);
// balance = total − received. The read model recomputes from the records; the
// order DOCUMENT additionally carries `paymentsReceivedCents` (#168) — the same
// Σ maintained transactionally by registerOrderPaymentTx, not a second source
// of truth — so gates and the order card survive a fresh session with no
// records loaded. All numeric coercion flows through parseAmount and the
// exact-cents helpers; NaN never enters the state.
import type { Order, OrderPayment, OrderPaymentMethod } from "../../types";
import { parseAmount } from "../../lib/money";
import { docReceivedCents, incidentsSaleAdjustmentCents, orderAmountCents } from "../../lib/orderMoney";
export { docReceivedCents } from "../../lib/orderMoney";
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

/** Form input for a correction/refund (positive magnitude, explicit direction). */
export type AdjustmentFormInput = {
  kind: "adjustment";
  direction: "subtract" | "add";
  id: string;
  amountText: string;
  note: string;
};

export type PaymentRecordInput = PaymentFormInput | AdjustmentFormInput;

/** Exact cents for a signed decimal amount (orderAmountCents rejects negatives). */
export function signedAmountCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new RangeError("Monto inválido");
  const sign = amount < 0 ? -1 : 1;
  const cents = orderAmountCents(Math.abs(amount));
  return cents === 0 ? 0 : sign * cents;
}

function finiteCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  try {
    return signedAmountCents(amount);
  } catch (error) {
    // #168 F5: a stored amount beyond safe cents precision is corrupt data —
    // excluded (contributes 0) with a warning instead of a RangeError that
    // would crash the render. Money never guesses, but it never explodes either.
    if (error instanceof RangeError) {
      console.warn("[payments] Monto de cobro fuera de precisión segura, excluido del acumulado:", amount);
      return 0;
    }
    throw error;
  }
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
  if (/[+-]/.test(input.amountText)) throw new Error("Captura un monto positivo sin signo y elige la dirección.");
  const magnitude = normalizeAmount(input.amountText);
  if (magnitude <= 0) throw new Error("El monto del ajuste debe ser mayor que cero.");
  const amount = input.direction === "subtract" ? -magnitude : magnitude;
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

/** The doc-money fields a successful payment registration writes (#168). */
export type OrderMoneyFields = { paymentsReceivedCents: number; inheritedDepositMaterialized?: true };

/**
 * Fold one registration's saved cents into the order's doc money. Used by the
 * Firestore transaction itself and mirrored into the in-memory order so the
 * card reflects an abono without waiting for the listener round-trip.
 * `materializesInherited` flips the marker exactly once (the pending deposit
 * joins the accumulator, so it must never be counted again on top of it).
 */
export function orderMoneyAfterPayments(
  order: Partial<Order> & Record<string, unknown>,
  savedCents: number,
  materializesInherited: boolean
): OrderMoneyFields {
  const acc = order.paymentsReceivedCents ?? 0;
  const total = acc + savedCents;
  if (!Number.isSafeInteger(acc) || !Number.isSafeInteger(savedCents) || !Number.isSafeInteger(total)) {
    throw new RangeError("El total de cobros excede la precisión admitida o contiene centavos inválidos.");
  }
  return {
    paymentsReceivedCents: total,
    ...(order.inheritedDepositMaterialized === true || materializesInherited
      ? { inheritedDepositMaterialized: true as const }
      : {}),
  };
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
  /** total − received − creditApplied, signed: negative means money in the
   * customer's favor. #189: saldo a favor applied from sister orders reduces
   * what she owes here (never counted as received money). */
  balanceCents: number;
  /** #189: saldo a favor applied TO this order (destination accumulator). */
  creditAppliedCents: number;
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
  // #203: the EFFECTIVE total (historical + incident adjustments) — the same
  // figure every other read model shows, so Cobros and the card never
  // contradict each other (review #212 F3).
  const totalCents = Math.max(0, orderItems(order).reduce(
    (sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity),
    0
  ) + incidentsSaleAdjustmentCents(order.incidents));
  const records = orderPaymentsFor(payments, String(order.id ?? ""), String(order.storeId ?? "")).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
  const inheritedMaterialized = order.inheritedDepositMaterialized === true || records.some((p) => p.id === INHERITED_DEPOSIT_PAYMENT_ID);
  const deposit = typeof order.deposit === "number" && Number.isFinite(order.deposit) ? order.deposit : 0;
  const inheritedPendingCents = inheritedMaterialized ? 0 : orderAmountCents(Math.max(0, deposit));
  const receivedCents = typeof order.paymentsReceivedCents === "number" && Number.isFinite(order.paymentsReceivedCents)
    ? docReceivedCents(order)
    : paymentsCents(records) + inheritedPendingCents;
  const creditAppliedCents = typeof order.creditAppliedCents === "number" && Number.isSafeInteger(order.creditAppliedCents)
    ? Math.max(0, order.creditAppliedCents) : 0;
  return {
    totalCents,
    receivedCents,
    balanceCents: totalCents - receivedCents - creditAppliedCents,
    creditAppliedCents,
    inheritedPendingCents,
    records,
  };
}


/** Reconcile independent business and receipt revisions without undoing either. */
export function reconcileOrderPayments(current: Order, canonical: Order): Order {
  if (current.id !== canonical.id || current.storeId !== canonical.storeId) return current;
  const business = (canonical.revision ?? 0) > (current.revision ?? 0) ? canonical : current;
  const money = (canonical.paymentsRevision ?? 0) > (current.paymentsRevision ?? 0) ? canonical : current;
  if (business === current && money === current) return current;
  return {
    ...business,
    paymentsReceivedCents: money.paymentsReceivedCents,
    paymentsRevision: money.paymentsRevision,
    lastPaymentId: money.lastPaymentId,
    inheritedDepositMaterialized: money.inheritedDepositMaterialized,
    installmentsReservedAt: business.installmentsReservedAt ?? money.installmentsReservedAt,
  };
}
