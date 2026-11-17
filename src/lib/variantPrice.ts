// #467: ONE source of truth for a color's sale prices and photos. The
// variant's own `prices` map (per level) wins when present; a variant WITHOUT
// the field shares the design's map — legacy fichas keep their effective
// prices EXACTLY as they were. A variant WITH own prices and a MISSING level
// is simply sin precio for that level: never silently the design's, another
// color's or another level's (PO decision 15-nov-2026). The variant's photo
// gallery is the single photo source since #124 — nothing else re-derives it.
import type { Product, ProductVariant } from "../types";

type Priceable = { prices?: Record<string, number> };

/** Does this variant own a per-level price map? (Legacy variants don't.) */
export function variantHasOwnPrices(variant: ProductVariant): boolean {
  return variant.prices !== undefined && variant.prices !== null && typeof variant.prices === "object";
}

/** The variant's effective price at one level — undefined means SIN precio. */
export function variantEffectivePrice(
  variant: ProductVariant,
  tierId: string,
  design: Pick<Product, "prices">
): number | undefined {
  const own = variantHasOwnPrices(variant) ? (variant.prices as Record<string, number>)[tierId] : undefined;
  if (own !== undefined) return own > 0 ? own : undefined;
  if (variantHasOwnPrices(variant)) return undefined; // own map: missing level stays missing
  const shared = (design as Priceable).prices?.[tierId];
  return shared !== undefined && shared > 0 ? shared : undefined;
}

/** The DESIGN price as fallback — only legitimate for sharing variants. */
export function designPriceFallback(
  variant: ProductVariant,
  tierId: string,
  design: Pick<Product, "prices">
): number | undefined {
  if (variantHasOwnPrices(variant)) return undefined;
  const shared = (design as Priceable).prices?.[tierId];
  return shared !== undefined && shared > 0 ? shared : undefined;
}
