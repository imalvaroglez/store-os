import type { Order } from "../types";

/** Round a non-negative decimal amount times an integer quantity to cents. */
export function orderAmountCents(amount: number, quantity = 1): number {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError("Invalid order amount");
  const [coefficient, exponentText] = amount.toString().toLowerCase().split("e");
  const exponent = Number(exponentText ?? 0);
  const [whole, fraction = ""] = coefficient.split(".");
  const value = BigInt(whole + fraction) * BigInt(quantity);
  const scale = fraction.length - exponent - 2;
  const cents = scale <= 0 ? value * 10n ** BigInt(-scale) : (() => {
    const divisor = 10n ** BigInt(scale);
    const quotient = value / divisor;
    return quotient + ((value % divisor) * 2n >= divisor ? 1n : 0n);
  })();
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Order amount exceeds safe precision");
  return Number(cents);
}

/** Show unit prices with their stored precision, including legacy fractions. */
export function formatOrderUnitPrice(amount: number): string {
  const [coefficient, exponentText] = amount.toString().toLowerCase().split("e");
  const decimals = Math.max(2, Math.min(20, (coefficient.split(".")[1]?.length ?? 0) - Number(exponentText ?? 0)));
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: decimals }).format(amount);
}

/**
 * #168: the money truth of the ORDER DOCUMENT — the transactional accumulator
 * (`paymentsReceivedCents`, Σ signed cents of the payment records, maintained
 * by registerOrderPaymentTx in the same transaction as each record) plus the
 * legacy `deposit` while it is still pending materialization. Gates and the
 * order card read THIS, never the session's records: a fresh session can no
 * longer undercount received money. Corrupt fields read as zero, never NaN.
 */
export function docReceivedCents(order: Partial<Order> & Record<string, unknown>): number {
  const acc =
    typeof order.paymentsReceivedCents === "number" && Number.isFinite(order.paymentsReceivedCents)
      ? order.paymentsReceivedCents
      : 0;
  if (order.inheritedDepositMaterialized === true) return acc;
  const deposit = typeof order.deposit === "number" && Number.isFinite(order.deposit) ? Math.max(0, order.deposit) : 0;
  try {
    return acc + orderAmountCents(deposit);
  } catch {
    return acc; // a deposit beyond safe precision is corrupt, not money
  }
}

// ── #203: incident money effects over the ORDER DOCUMENT ─────────────────
import type { OrderIncident } from "../types";

function incidentCentsOf(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function incidentQuantity(incident: OrderIncident): number {
  return Math.max(1, Math.round(incident.quantity || 1));
}

/**
 * #203: how the incidents change the order's EFFECTIVE total (exact cents).
 * Charged upgrades add the price difference vs the historical price frozen at
 * open; a refund removes the piece at its historical price; equivalent
 * replacements and absorbed upgrades change nothing. Historical sales are
 * never rewritten — this is the documented adjustment, the basis of what the
 * clienta actually owes after posventa.
 */
export function incidentsSaleAdjustmentCents(incidents: OrderIncident[] | undefined | null): number {
  return (incidents ?? []).reduce((sum, incident) => {
    const resolution = incident.resolution;
    if (!resolution || resolution.kind === "wait_restock") return sum;
    if (resolution.kind === "refund") {
      return sum - incidentCentsOf(resolution.refundUnitPriceCents) * incidentQuantity(incident);
    }
    const replacement = incident.replacement;
    if (!replacement || !replacement.chargeDifference) return sum;
    return sum + (replacement.unitPriceCents - incidentCentsOf(incident.originalUnitPriceCents)) * incidentQuantity(incident);
  }, 0);
}

/**
 * #203: refund money agreed but not yet handed back (exact cents). Blocked —
 * never available credit: "un importe comprometido a reembolso queda
 * separado y no se usa para otra compra sin aceptación de la clienta".
 */
export function incidentsRefundPendingCents(incidents: OrderIncident[] | undefined | null): number {
  return (incidents ?? []).reduce((sum, incident) => {
    const resolution = incident.resolution;
    if (!resolution || resolution.kind !== "refund") return sum;
    const agreed = incidentCentsOf(resolution.refundUnitPriceCents) * incidentQuantity(incident);
    const executed = (incident.events ?? [])
      .filter((event) => event.kind === "confirmed")
      .reduce((partial, event) => partial + incidentCentsOf(event.detail?.refundExecutedCents), 0);
    return sum + Math.max(0, agreed - executed);
  }, 0);
}
