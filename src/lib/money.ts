// Money helpers. All amounts flow through here so formatting stays in one place.
// Currency is Mexican Peso (MXN).

/** Format a number as MXN currency, e.g. 1250 -> "$1,250". */
export function formatMoney(amount: number | undefined | null): string {
  if (amount == null || Number.isNaN(amount)) return "$0";
  const rounded = Math.round(amount);
  return "$" + rounded.toLocaleString("es-MX");
}

/** Price a product shows to the public: single price (on-demand) or retail (tiered). */
export function publicPrice(p: {
  price?: number;
  prices?: { retail?: number; wholesale?: number; reseller?: number };
}): number | undefined {
  if (typeof p.price === "number") return p.price;
  return p.prices?.retail;
}

/** Best available cost for profit math. */
export function productCost(p: { cost?: number }): number | undefined {
  return p.cost;
}

/** Profit = (price - cost) * quantity. Undefined when cost unknown. */
export function profit(
  price: number,
  cost: number | undefined,
  quantity = 1
): number | undefined {
  if (cost == null) return undefined;
  return (price - cost) * quantity;
}

/** Coerce a form string into a number, or undefined when empty/invalid. */
export function parseAmount(input: string | number | undefined): number | undefined {
  if (input == null) return undefined;
  if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  const stripped = trimmed.replace(/[^0-9.\-]/g, "");
  if (stripped === "" || stripped === "-" || stripped === ".") return undefined;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : undefined;
}

/** Pending payment on an order: price*qty - deposit. Never negative. */
export function pending(total: number, deposit: number): number {
  return Math.max(0, total - deposit);
}
