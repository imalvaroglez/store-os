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

/** Stable reference tier for the canonical Regular price. */
export const REGULAR_TIER_ID = "t_retail";

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

export type CalculatedCartTier = {
  tier: PriceTierDef;
  subtotal: number;
  qualifies: boolean;
  /** Every line carries THIS tier's own price (no fallback) — the honest
   *  precondition for advertising the tier as active/unlocked. */
  hasOwnPrices: boolean;
  piecesRemaining: number;
  amountRemaining: number;
  savingsVsBase: number;
  savingsVsActive: number;
};

export type OrderPricing = {
  totalQuantity: number;
  tiers: CalculatedCartTier[];
  baseTier: CalculatedCartTier;
  activeTier: CalculatedCartTier;
  aspirationalTier: CalculatedCartTier;
  estimatedSubtotal: number;
  savingsVsBase: number;
};

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

/** Σ qty × (referencePrice − tierPrice): the savings hint. */
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
 * Canonical public-order calculation. A missing tier price falls back to the
 * deepest price the line DOES have — the estimate stays on screen instead of
 * vanishing; qualification (tierQualifies) stays strict on the tier's own
 * prices. The deepest qualifying tier wins independently of intermediate tiers.
 */
export function calculateOrderPricing(
  tiers: PriceTierDef[],
  lines: CartQtyLine[]
): OrderPricing | null {
  if (lines.length === 0) return null;

  const ordered = tiers.filter((t) => !t.hidden).sort((a, b) => a.order - b.order);
  const totalQuantity = lines.reduce((sum, line) => sum + line.qty, 0);
  // Estimation-only helper: a line's unit price at `tier` is the tier's own
  // price, else the deepest price that line carries.
  const deepestPrice = (line: CartQtyLine): number | undefined => {
    for (let i = ordered.length - 1; i >= 0; i--) {
      const value = line.unitPrices[ordered[i].id];
      if (Number.isFinite(value)) return value;
    }
    return undefined;
  };
  const estimated = (tier: PriceTierDef, line: CartQtyLine): number | undefined =>
    Number.isFinite(line.unitPrices[tier.id]) ? line.unitPrices[tier.id] : deepestPrice(line);

  const priced = ordered.flatMap((tier) => {
    if (!lines.every((line) => Number.isFinite(estimated(tier, line)))) return [];
    return [{
      tier,
      subtotal: lines.reduce((sum, line) => sum + (estimated(tier, line) as number) * line.qty, 0),
      qualifies: tierQualifies(tier, lines),
    }];
  });

  // Regular keeps its identity when tiers are reordered. Legacy/custom stores
  // without the canonical id use the first usable visible tier defensively.
  const base = priced.find((entry) => entry.tier.id === REGULAR_TIER_ID) ?? priced[0];
  // An entry backed by its OWN price on every line. Fallback prices may
  // ESTIMATE a tier, but only own-priced tiers can be advertised — a label
  // like "Precio Regular" over fallback numbers would mislead.
  const hasOwn = (entry: { tier: PriceTierDef }) =>
    lines.every((l) => Number.isFinite(l.unitPrices[entry.tier.id]));
  const active = [...priced].reverse().find((entry) => entry.qualifies && hasOwn(entry))
    // Nothing qualifies with own prices: fall to the shallowest own-priced
    // tier (its label is what the lines actually cost). Never a fallback-only
    // estimate — if no tier owns every line, there is no honest label at all.
    ?? priced.find(hasOwn);
  // The aspirational goal is the deepest VISIBLE tier — it must stay on screen
  // even when some lines only have a fallback estimate for it.
  const aspirational = priced.find((entry) => entry.tier.id === ordered[ordered.length - 1]?.id)
    ?? priced[priced.length - 1];
  if (!base || !active || !aspirational) return null;

  const withProgress: CalculatedCartTier[] = priced.map((entry) => ({
    ...entry,
    hasOwnPrices: hasOwn(entry),
    piecesRemaining: Math.max(0, (entry.tier.minPieces ?? 0) - totalQuantity),
    amountRemaining: Math.max(0, (entry.tier.minAmount ?? 0) - entry.subtotal),
    savingsVsBase: Math.max(0, base.subtotal - entry.subtotal),
    savingsVsActive: Math.max(0, active.subtotal - entry.subtotal),
  }));

  return {
    totalQuantity,
    tiers: withProgress,
    baseTier: withProgress.find((entry) => entry.tier.id === base.tier.id)!,
    activeTier: withProgress.find((entry) => entry.tier.id === active.tier.id)!,
    aspirationalTier: withProgress.find((entry) => entry.tier.id === aspirational.tier.id)!,
    estimatedSubtotal: active.subtotal,
    savingsVsBase: Math.max(0, base.subtotal - active.subtotal),
  };
}
