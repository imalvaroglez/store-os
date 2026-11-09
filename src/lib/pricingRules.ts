// #254 — the suggested-price engine: resolve the rule that applies (product >
// category > general per level), compute each level's base cost (acquisition +
// per-piece packaging estimate), and derive the suggestion. Suggested prices
// are PROPOSALS: nothing applies without Fer's explicit action, and the band a
// piece belongs to is decided by its ACQUISITION cost alone — a packaging
// cent never jumps bands.
import type { PackagingMaterial, PriceRounding, PricingRule, StorePackaging, Product, TierPackaging } from "../types";

export type RuleOrigin = "product" | "category" | "general";

/** Canonical JSON (recursively key-sorted) of a rules value. Firestore returns
 * map keys lexicographically sorted while clients build them in tier order —
 * raw stringify comparisons would see the SAME rules as different. Shared by
 * the strategy screen (concurrency banner) and the transactional save
 * (optimistic conflict check, #280 P0-2). */
export function rulesSignature(value: unknown): string {
  return JSON.stringify(value, (_key, element) =>
    element && typeof element === "object" && !Array.isArray(element)
      ? Object.fromEntries(Object.entries(element).sort(([a], [b]) => a.localeCompare(b)))
      : element
  );
}

export function resolveRule(
  config: { byTier?: Record<string, PricingRule>; byCategory?: Record<string, Record<string, PricingRule>>; byProduct?: Record<string, Record<string, PricingRule>> } | undefined,
  tierId: string,
  product: Pick<Product, "id" | "categoryIds">
): { rule: PricingRule; origin: RuleOrigin } | undefined {
  const fromProduct = config?.byProduct?.[product.id]?.[tierId];
  if (fromProduct) return { rule: fromProduct, origin: "product" };
  for (const categoryId of product.categoryIds ?? []) {
    const fromCategory = config?.byCategory?.[categoryId]?.[tierId];
    if (fromCategory) return { rule: fromCategory, origin: "category" };
  }
  const general = config?.byTier?.[tierId];
  if (general) return { rule: general, origin: "general" };
  return undefined;
}

/** Rounding: "none" keeps the raw value (cents included); "1" rounds to the
 * nearest peso; $5/$10 always round UP to the step (Fer's Excel habit — never
 * round a price down). */
export function applyRound(value: number, rounding: PriceRounding | undefined): number {
  if (rounding === "none" || !rounding) return value;
  if (rounding === "1") return Math.round(value);
  const step = rounding === "5" ? 5 : 10;
  return Math.ceil(value / step) * step;
}

/** Base cost for one level: acquisition cost + that level's per-piece
 * packaging estimate (individual materials only — shared per-order packaging
 * NEVER enters a price; data-verified 2026-11-08). */
export function baseCostForTier(
  product: Pick<Product, "cost">,
  tierId: string,
  packaging: StorePackaging | undefined
): number | undefined {
  if (product.cost === undefined || product.cost === null) return undefined;
  const profile: TierPackaging | undefined = packaging?.byTier?.[tierId];
  const costById = new Map<string, number>((packaging?.materials ?? []).map((m: PackagingMaterial) => [m.id, m.estimatedCost ?? 0]));
  let extra = 0;
  for (const line of profile?.perPiece ?? []) {
    extra += Math.max(0, line.units) * (costById.get(line.materialId) ?? 0);
  }
  return product.cost + extra;
}

/** Validate a band table: ascending, contiguous [min, max) with no gaps or
 * overlaps (each max === next min), prices > 0. Returns error text or null. */
export function validateBands(bands: Array<{ min: number; max?: number; price: number }>): string | null {
  if (bands.length === 0) return "Agrega al menos una banda.";
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  for (let i = 0; i < sorted.length; i++) {
    const band = sorted[i];
    if (!(band.min >= 0)) return "El costo mínimo de una banda no puede ser negativo.";
    if (!(band.price > 0)) return "Cada banda necesita un precio mayor que cero.";
    if (band.max !== undefined && !(band.max > band.min)) return "El tope de una banda debe ser mayor que su mínimo.";
    const next = sorted[i + 1];
    if (next) {
      if (band.max === undefined) return "Solo la última banda puede quedar sin tope.";
      if (next.min !== band.max) {
        return band.max > next.min
          ? "Las bandas se traslapan: ajusta los límites."
          : "Hay un hueco entre bandas: el tope de una debe ser el mínimo de la siguiente.";
      }
    }
  }
  return null;
}

function bandPrice(bands: Array<{ min: number; max?: number; price: number }>, acquisitionCost: number): number | null {
  for (const band of [...bands].sort((a, b) => a.min - b.min)) {
    const withinMin = acquisitionCost >= band.min;
    const withinMax = band.max === undefined || acquisitionCost < band.max;
    if (withinMin && withinMax) return band.price;
  }
  return null;
}

/** The suggested price for one level, or null when nothing can be proposed
 * (no rule, no cost, or the piece's acquisition cost falls outside a band
 * table — an honest "sin sugerencia", never an invented price). */
export function suggestedPriceFor(
  rule: PricingRule,
  input: { baseCost: number | undefined; acquisitionCost: number | undefined }
): number | null {
  let raw: number | null = null;
  if (rule.kind === "markup") {
    if (input.baseCost === undefined) return null;
    raw = input.baseCost * (1 + rule.percent / 100);
  } else if (rule.kind === "fixed") {
    if (input.baseCost === undefined) return null;
    raw = input.baseCost + rule.amount;
  } else {
    if (input.acquisitionCost === undefined) return null;
    raw = bandPrice(rule.bands, input.acquisitionCost);
  }
  if (raw === null) return null;
  const rounded = applyRound(raw, rule.rounding);
  // Adversarial H1/H5: a non-positive suggestion (negative fixed increment,
  // sub-cent cost rounding to zero) is NEVER proposed — "sin sugerencia"
  // instead of a free or negative price.
  return rounded >= 0.01 ? rounded : null;
}

/** Full suggestion for one product × one level. */
export function suggestionForTier(
  product: Pick<Product, "id" | "categoryIds" | "cost">,
  tierId: string,
  config: Parameters<typeof resolveRule>[0],
  packaging: StorePackaging | undefined
): { suggested: number | null; baseCost: number | undefined; origin: RuleOrigin } {
  const resolved = resolveRule(config, tierId, product);
  const baseCost = baseCostForTier(product, tierId, packaging);
  if (!resolved) return { suggested: null, baseCost, origin: "general" };
  return {
    suggested: suggestedPriceFor(resolved.rule, { baseCost, acquisitionCost: product.cost ?? undefined }),
    baseCost,
    origin: resolved.origin,
  };
}

/** True when the config carries at least one rule — an empty saved config
 * must behave as absent so the legacy single-markup assistant keeps working
 * (review finding 2). */
export function hasRules(
  config: { byTier?: Record<string, unknown>; byCategory?: Record<string, unknown>; byProduct?: Record<string, unknown> } | undefined
): boolean {
  if (!config) return false;
  return (
    Object.keys(config.byTier ?? {}).length > 0 ||
    Object.keys(config.byCategory ?? {}).length > 0 ||
    Object.keys(config.byProduct ?? {}).length > 0
  );
}
