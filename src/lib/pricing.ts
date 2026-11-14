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

export type OrderLinePricing = {
  unitPrice: number;
  subtotal: number;
};

export type OrderPricing = {
  totalQuantity: number;
  tiers: CalculatedCartTier[];
  baseTier: CalculatedCartTier;
  activeTier: CalculatedCartTier;
  aspirationalTier: CalculatedCartTier;
  estimatedSubtotal: number;
  savingsVsBase: number;
  lineBreakdown: OrderLinePricing[];
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
    lineBreakdown: lines.map((line) => {
      const unitPrice = estimated(active.tier, line)!;
      return { unitPrice, subtotal: unitPrice * line.qty };
    }),
  };
}

// Public cart estimate: habitual comparison until the Iconic minimum is met.

/**
 * Identify the store's money-based benefit by CONFIGURATION, not label text.
 * The public estimate can reach its configured minimum without granting or
 * renewing a customer's spend-window identity benefit (#130).
 */
export function isIdentityGatedTier(tier: PriceTierDef): boolean {
  return tier.minAmount != null && tier.minPieces == null;
}

export type CartRequestSummary = {
  totalQuantity: number;
  /** Own-priced habitual reference; the active tier when legacy prices leave
   * no habitual reference. The displayed estimate always uses activeTier. */
  habitualTier: PriceTierDef;
  habitualSubtotal: number;
  /** The estimate switches only when the cart reaches the tier's own minimum. */
  activeTier: PriceTierDef;
  estimatedSubtotal: number;
  /** The identity-gated tier, when the store configures one (else null). */
  identityTier: PriceTierDef | null;
  /** Σ qty × the identity tier's OWN price per line — undefined when ANY line
   * lacks it ("Por confirmar", never a fallback price, never $0). */
  identitySubtotal: number | undefined;
  identityQualifies: boolean;
  /** Missing prices cannot establish progress or qualification. */
  identityAmountRemaining: number | undefined;
  /** Keep the comparison until the identity-price subtotal reaches its minimum. */
  showIdentityHint: boolean;
  /** Per-line prices use the same active tier as the displayed estimate. */
  lineBreakdown: OrderLinePricing[];
};

export function cartRequestSummary(tiers: PriceTierDef[], lines: CartQtyLine[]): CartRequestSummary | null {
  if (lines.length === 0) return null;
  const ordered = [...tiers].filter((t) => !t.hidden).sort((a, b) => a.order - b.order);
  if (ordered.length === 0) return null;
  const totalQuantity = lines.reduce((sum, l) => sum + l.qty, 0);
  const hasOwn = (tier: PriceTierDef) => lines.every((l) => Number.isFinite(l.unitPrices[tier.id]));
  const ownSubtotal = (tier: PriceTierDef) =>
    lines.reduce((sum, l) => sum + (l.unitPrices[tier.id] as number) * l.qty, 0);

  // Habitual: deepest qualifying own-priced NON-identity tier; the shallowest
  // own-priced one when nothing qualifies (its label is what lines cost).
  const habitualCandidates = ordered.filter((t) => !isIdentityGatedTier(t));
  const pool = habitualCandidates.length > 0 ? habitualCandidates : ordered.slice(0, Math.max(1, ordered.length - 1));
  const habitual =
    [...pool].reverse().find((t) => hasOwn(t) && tierQualifies(t, lines)) ?? pool.find(hasOwn);
  const identityTier = [...ordered].reverse().find(isIdentityGatedTier) ?? null;
  const identitySubtotal = identityTier && hasOwn(identityTier)
    ? ownSubtotal(identityTier)
    : undefined;
  // Compare cents at the tier's OWN prices, not Regular/Girly. This remains
  // an estimate: it does not grant a customer's benefit or persist eligibility.
  const identityQualifies = identityTier != null && identitySubtotal != null
    && Math.round(identitySubtotal * 100) >= Math.round(identityTier.minAmount! * 100);
  const identityAmountRemaining = identityTier && identitySubtotal != null
    ? Math.max(0, Math.round(identityTier.minAmount! * 100) - Math.round(identitySubtotal * 100)) / 100
    : undefined;
  let activeTier = identityQualifies && identityTier
    && (!habitual || !tierQualifies(habitual, lines) || identityTier.order > habitual.order)
    ? identityTier : habitual;
  // #437: a piece with ONLY the identity price (Regular/Girly absent) left
  // habitual undefined — below the minimum the whole summary vanished and the
  // clienta lost the Iconic estimate plus the "te faltan" notice. When NO
  // habitual tier owns every line but the identity tier does, the estimate
  // STAYS on the identity tier (its own prices), below the minimum too — the
  // lines say what they cost and the notice keeps saying what's missing.
  if (!activeTier && identityTier && identitySubtotal != null) {
    activeTier = identityTier;
  }
  if (!activeTier) return null;
  // A qualified own-priced estimate stays usable even with incomplete legacy
  // reference prices. Never relabel fallback amounts as Regular/Girly.
  const referenceTier = habitual ?? activeTier;
  const habitualSubtotal = ownSubtotal(referenceTier);
  // Same reduction order as ownSubtotal, so Σ lines === headline to the cent.
  const lineBreakdown = lines.map((line) => {
    const unitPrice = line.unitPrices[activeTier.id] as number;
    return { unitPrice, subtotal: unitPrice * line.qty };
  });
  return {
    totalQuantity,
    habitualTier: referenceTier,
    habitualSubtotal,
    activeTier,
    estimatedSubtotal: ownSubtotal(activeTier),
    identityTier,
    identitySubtotal,
    identityQualifies,
    identityAmountRemaining,
    lineBreakdown,
    showIdentityHint: identityTier != null && !identityQualifies,
  };
}
