// #380 prototype: the credit math PORT used by the trusted applyCredit /
// releaseCredit callables. Kept in lockstep with the app's TypeScript source
// of truth (src/features/orders/customerCredit.ts + src/lib/orderMoney.ts)
// by an equivalence test in the app suite (creditMathPort.test.ts) — the
// port must produce identical cents for every fixture; if they diverge, the
// test fails and the function must not ship.
//
// All arithmetic is exact cents (BigInt rounding like orderAmountCents).

/** Round a non-negative decimal amount times an integer quantity to cents. */
export function orderAmountCents(amount, quantity = 1) {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError("Invalid order amount");
  }
  const [coefficient, exponentText] = amount.toString().toLowerCase().split("e");
  const exponent = Number(exponentText ?? 0);
  const [whole, fraction = ""] = coefficient.split(".");
  const value = BigInt(whole + fraction) * BigInt(quantity);
  const scale = fraction.length - exponent - 2;
  let cents;
  if (scale <= 0) {
    cents = value * 10n ** BigInt(-scale);
  } else {
    const divisor = 10n ** BigInt(scale);
    const quotient = value / divisor;
    cents = quotient + ((value % divisor) * 2n >= divisor ? 1n : 0n);
  }
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Order amount exceeds safe precision");
  return Number(cents);
}

/** orderItems: items array, else legacy flat fields. */
function orderItems(order) {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items.map((raw) => {
      const item = raw ?? {};
      const quantity = Math.max(1, Math.round(numberOr(item.quantity, 1)));
      const unitPrice = Math.max(0, numberOr(item.unitPrice ?? item.price, 0));
      return { productName: String(item.productName ?? item.name ?? "Producto"), quantity, unitPrice };
    });
  }
  const name = typeof order.productName === "string" ? order.productName.trim() : "";
  if (!name && typeof order.productId !== "string") return [];
  const quantity = Math.max(1, Math.round(numberOr(order.quantity, 1)));
  const unitPrice = Math.max(0, numberOr(order.price, 0));
  return [{ productName: name || "Producto", quantity, unitPrice }];
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Σ frozen line snapshots — the order's sales total in exact cents. */
export function orderTotalCents(order) {
  return orderItems(order).reduce((sum, item) => sum + orderAmountCents(item.unitPrice, item.quantity), 0);
}

function incidentCentsOf(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function incidentQuantity(incident) {
  return Math.max(1, Math.round(numberOr(incident.quantity, 1)));
}

/** One incident's sale adjustment (mirror of src/lib/orderMoney.ts). */
function incidentSaleAdjustmentCents(incident) {
  const resolution = incident.resolution;
  if (!resolution || resolution.kind === "wait_restock") return 0;
  const quantity = incidentQuantity(incident);
  if (typeof resolution.saleAdjustmentUnitCents === "number") {
    if (resolution.kind === "refund") {
      return -incidentCentsOf(resolution.saleAdjustmentUnitCents) * quantity;
    }
    const replacement = incident.replacement;
    if (!replacement || !replacement.chargeDifference) return 0;
    return (replacement.unitPriceCents - incidentCentsOf(resolution.saleAdjustmentUnitCents)) * quantity;
  }
  if (resolution.kind === "refund") {
    return -incidentCentsOf(resolution.refundUnitPriceCents) * quantity;
  }
  const replacement = incident.replacement;
  if (!replacement || !replacement.chargeDifference) return 0;
  return (replacement.unitPriceCents - incidentCentsOf(incident.originalUnitPriceCents)) * quantity;
}

export function incidentsSaleAdjustmentCents(incidents) {
  return (incidents ?? []).reduce((sum, incident) => sum + incidentSaleAdjustmentCents(incident), 0);
}

export function incidentsRefundCommittedCents(incidents) {
  return (incidents ?? []).reduce((sum, incident) => {
    const resolution = incident.resolution;
    if (!resolution) return sum;
    if (typeof resolution.refundOwedCents === "number") {
      return sum + Math.max(0, resolution.refundOwedCents);
    }
    if (resolution.kind !== "refund") return sum;
    return sum + incidentCentsOf(resolution.refundUnitPriceCents) * incidentQuantity(incident);
  }, 0);
}

/** #168: the money truth of the ORDER DOCUMENT. */
export function docReceivedCents(order) {
  const acc = numberOr(order.paymentsReceivedCents, 0);
  if (order.inheritedDepositMaterialized === true) return acc;
  const deposit = Math.max(0, numberOr(order.deposit, 0));
  try {
    return acc + orderAmountCents(deposit);
  } catch {
    return acc;
  }
}

function effectiveTotalCents(order) {
  return Math.max(0, orderTotalCents(order) + incidentsSaleAdjustmentCents(order.incidents));
}

/** This order's surplus still available to compensate sister orders. */
export function creditAvailableCents(order) {
  const surplus = docReceivedCents(order) - effectiveTotalCents(order);
  if (surplus <= 0) return 0;
  const consumedCents = Math.max(0, numberOr(order.creditConsumedCents, 0));
  return Math.max(0, surplus - consumedCents - incidentsRefundCommittedCents(order.incidents));
}

/** What the customer still owes, net of credit applied and posventa. */
export function pendingCents(order) {
  return Math.max(0, effectiveTotalCents(order) - docReceivedCents(order) - Math.max(0, numberOr(order.creditAppliedCents, 0)));
}

/** Per-origin outstanding net (applications − releases) from a ledger. */
export function netByOrigin(ledger) {
  const net = new Map();
  for (const saved of ledger ?? []) {
    if (saved.kind !== "application" && saved.kind !== "release") continue;
    if (!Number.isSafeInteger(saved.amountCents)) continue;
    const sign = saved.kind === "application" ? 1 : -1;
    net.set(saved.fromOrderId, (net.get(saved.fromOrderId) ?? 0) + sign * saved.amountCents);
  }
  return net;
}
