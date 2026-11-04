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
