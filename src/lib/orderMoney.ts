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
