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
