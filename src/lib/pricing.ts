import type { PriceTierDef, Store } from "../types";

// Scalable pricing helpers. Tiers are store-defined; ids are stable forever.

/** The 3 canonical tiers every pre-migration store implicitly had. */
export const CANONICAL_TIERS: PriceTierDef[] = [
  { id: "t_retail", label: "Menudeo", order: 0 },
  { id: "t_wholesale", label: "Mayoreo", order: 1 },
  { id: "t_reseller", label: "Emprendedora", order: 2 },
];

/** Legacy tier key → canonical tier id (the migration map). */
export const LEGACY_TIER_IDS: Record<string, string> = {
  retail: "t_retail",
  wholesale: "t_wholesale",
  reseller: "t_reseller",
};

/** Visible tiers of a store, ordered. Falls back to the canonical 3. */
export function tiersForStore(store: Pick<Store, "priceTiers"> | null | undefined): PriceTierDef[] {
  const tiers = (store?.priceTiers?.length ? store.priceTiers : CANONICAL_TIERS)
    .filter((t) => !t.hidden)
    .sort((a, b) => a.order - b.order);
  return tiers;
}

/**
 * The tier whose price is the public one. Never returns a hidden or missing
 * tier: falls back to the first visible tier (defensive against bad edits).
 */
export function defaultTier(store: Pick<Store, "priceTiers" | "defaultTierId"> | null | undefined): PriceTierDef | undefined {
  const tiers = tiersForStore(store);
  if (!tiers.length) return undefined;
  return tiers.find((t) => t.id === store?.defaultTierId) ?? tiers[0];
}

/** Suggested public price: markup % over cost, rounded to whole MXN. */
export function suggestedPrice(cost: number | undefined, rule: Store["pricingRule"]): number | undefined {
  if (typeof cost !== "number" || !rule || rule.percent < 0) return undefined;
  return Math.round(cost * (1 + rule.percent / 100));
}

// --- Public cart tier qualification (owner's rule, 2026-08-29). Informative
// only: the client never enforces a minimum — the owner confirms in the chat.

/** A cart line reduced to what qualification needs: pieces + per-tier unit prices. */
export type CartQtyLine = { qty: number; unitPrices: Record<string, number> };

/**
 * Does the cart qualify for the tier? `minPieces` counts total pieces;
 * `minAmount` is evaluated at THE TIER'S OWN prices — never at the default
 * tier (10 × $140 menudeo = $1,400 do NOT qualify for a $1,000 minimum at
 * $95/piece; 11 × $95 = $1,045 do).
 */
export function tierQualifies(tier: PriceTierDef, lines: CartQtyLine[]): boolean {
  if (tier.minPieces != null && lines.reduce((sum, l) => sum + l.qty, 0) < tier.minPieces) {
    return false;
  }
  if (tier.minAmount != null) {
    // A line missing this tier's price can't prove the minimum → strict.
    if (!lines.every((l) => typeof l.unitPrices[tier.id] === "number")) return false;
    const amount = lines.reduce((sum, l) => sum + l.unitPrices[tier.id] * l.qty, 0);
    if (amount < tier.minAmount) return false;
  }
  return true;
}

/** The deepest tier (highest order = best price) whose minimums the cart meets. */
export function bestTierForCart(tiers: PriceTierDef[], lines: CartQtyLine[]): PriceTierDef | undefined {
  return [...tiers]
    .sort((a, b) => b.order - a.order)
    .find((t) => tierQualifies(t, lines));
}

/** Σ qty × (basePrice − tierPrice): the "ahorras $N frente a menudeo" hint. */
export function cartSavings(tier: PriceTierDef, baseTierId: string, lines: CartQtyLine[]): number {
  return lines.reduce((sum, l) => {
    const base = l.unitPrices[baseTierId];
    const tierPrice = l.unitPrices[tier.id];
    return typeof base === "number" && typeof tierPrice === "number"
      ? sum + (base - tierPrice) * l.qty
      : sum;
  }, 0);
}

/**
 * How far the cart is from qualifying for `next`: whole extra pieces needed,
 * the extra spend at the next tier's price, and that spend's value at the
 * base tier ("por $95 más te llevas $140 de producto"). Null when the tier
 * has no minimums or the cart already qualifies.
 */
export function nextTierGap(
  next: PriceTierDef,
  baseTierId: string,
  lines: CartQtyLine[]
): { piecesMore: number; extraSpend: number; extraValueAtBase: number } | null {
  if (next.minPieces == null && next.minAmount == null) return null;
  if (tierQualifies(next, lines)) return null;

  const pieces = lines.reduce((sum, l) => sum + l.qty, 0);
  const piecesForPieces = next.minPieces != null ? Math.max(0, next.minPieces - pieces) : 0;

  let piecesForAmount = 0;
  if (next.minAmount != null) {
    const unitAtNext = lines.find((l) => typeof l.unitPrices[next.id] === "number")?.unitPrices[next.id];
    if (typeof unitAtNext === "number" && unitAtNext > 0) {
      // ponytail: single-unit price stands in for the whole extra purchase —
      // exact for single-line carts (the common case), close enough for mixed ones.
      const amount = lines.reduce((sum, l) => sum + (l.unitPrices[next.id] ?? 0) * l.qty, 0);
      piecesForAmount = Math.ceil(Math.max(0, next.minAmount - amount) / unitAtNext);
    } else if (next.minPieces == null) {
      return null; // no way to express an amount gap without the tier's price
    }
  }

  const piecesMore = Math.max(piecesForPieces, piecesForAmount);
  if (piecesMore <= 0) return null;
  const unitAtNext = lines.find((l) => typeof l.unitPrices[next.id] === "number")?.unitPrices[next.id] ?? 0;
  const unitAtBase = lines.find((l) => typeof l.unitPrices[baseTierId] === "number")?.unitPrices[baseTierId] ?? 0;
  return { piecesMore, extraSpend: unitAtNext * piecesMore, extraValueAtBase: unitAtBase * piecesMore };
}
