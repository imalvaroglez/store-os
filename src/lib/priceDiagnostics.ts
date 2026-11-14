import type { Product } from "../types";
import { orderAmountCents } from "./orderMoney";

// #335 (pricing-intelligence 2a): descriptive price/cost diagnosis —
// explains every figure, never recommends. Append-only change events with
// per-intent idempotency; a rule change that moved no price is NEVER shown
// as a price change. No fixed contribution threshold, no "bad/underpriced"
// labels; every stat carries method + sample. Analysis by delivery period
// stays UNAVAILABLE until #333's effective dates are integrated.

export type PriceChangeOrigin = "manual" | "rule_application" | "bulk_application";

export type PriceChangeEvent = {
  id: string;
  /** Store scope — rules isolation and per-store history depend on it. */
  storeId: string;
  productId: string;
  tierId: string;
  previousCents: number;
  nextCents: number;
  changedBy: string;
  /** ISO date the new price takes effect (user-confirmed, never invented). */
  effectiveAt: string;
  /** When the system recorded the event (append-only trail). */
  recordedAt: string;
  origin: PriceChangeOrigin;
};

export type RuleChangeEvent = {
  id: string;
  kind: "rule_change";
  /** Store scope — rules isolation and per-store history depend on it. */
  storeId: string;
  /** Category the table belongs to — null for store-wide tier tables. */
  categoryId: string | null;
  changedBy: string;
  summary: string;
  recordedAt: string;
};

/** Stable doc id per (product, intent): a retry of the SAME intent lands on
 * the SAME doc — writes are idempotent, never duplicated. */
export function eventDocId(productId: string, intentId: string): string {
  return `${productId}__${intentId}`;
}

export function priceChangeEvent(input: {
  intentId: string;
  storeId: string;
  productId: string;
  tierId: string;
  previous: number;
  next: number;
  uid: string;
  effectiveAt: string;
  origin: PriceChangeOrigin;
}): PriceChangeEvent {
  return {
    id: eventDocId(input.productId, input.intentId),
    storeId: input.storeId,
    productId: input.productId,
    tierId: input.tierId,
    previousCents: orderAmountCents(input.previous),
    nextCents: orderAmountCents(input.next),
    changedBy: input.uid,
    effectiveAt: input.effectiveAt,
    recordedAt: new Date().toISOString(),
    origin: input.origin,
  };
}

/** A rule CONFIG change — distinct kind, no product, no effective price: it
 * must never be presented as if it had changed a product's price. */
export function ruleChangeEvent(input: {
  intentId: string;
  storeId: string;
  categoryId: string | null;
  uid: string;
  summary: string;
}): RuleChangeEvent {
  return {
    id: `rule_${input.intentId}`,
    kind: "rule_change",
    storeId: input.storeId,
    categoryId: input.categoryId,
    changedBy: input.uid,
    summary: input.summary,
    recordedAt: new Date().toISOString(),
  };
}

export type TierDiagnosis = {
  tierId: string;
  /** Number of products in the sample (method transparency). */
  sample: number;
  method: string;
  values: number[];
  median: number;
  iqr: number;
  /** "iqr" | "mad" when a second signal was usable, "none" when both are 0. */
  dispersion: "iqr" | "mad" | "none";
  madSignal: boolean;
  /** "insufficient" with too few data points; "ok" otherwise. */
  evidence: "ok" | "insufficient";
  /** Products without a known cost (fact, not advice). */
  withoutCost: number;
  /** Products whose level order breaks Regular > Girly > Iconic. */
  tierOrderIssues: string[];
  /** Delivery-period analysis waits for #333 — never inferred from nothing. */
  periodAnalysis: "unavailable";
  periodNote: string;
  /** Deliberately absent: no good/bad/underpriced judgement (spec). */
  judgement?: never;
};

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quartile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** MAD (median absolute deviation) — robust second signal, reported ONLY when
 * non-zero, per the spec. */
function mad(values: number[], med: number): number {
  const abs = values.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  return median(abs);
}

/** Robust descriptive diagnosis for ONE (category, level) pair — categories
 * and levels are never mixed. Products' tier prices feed the sample; costs
 * and level-order coherence are reported as facts. */
export function categoryDiagnosis(
  products: Product[],
  tierId: string,
  /** The STORE's canonical tier order (cheapest→priciest) for the coherence
   * check — tier ids are store-defined, so callers pass their own list. */
  orderTiers: string[] = ["t_retail", "t_girly", "t_iconic"]
): TierDiagnosis {
  const values = products
    .map((p) => p.prices?.[tierId])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  const sample = values.length;
  const sorted = [...values];
  const med = sample > 0 ? median(sorted) : 0;
  // Spec: evidence is sufficient from 3 samples — the interpolated quartiles
  // carry real dispersion at n=3 ([100,200,300] → IQR 100, not a false 0).
  const iqr = sample >= 3 ? quartile(sorted, 0.75) - quartile(sorted, 0.25) : 0;
  const madValue = sample >= 3 ? mad(values, med) : 0;
  // Level-order coherence checks the STORE's canonical level order among the
  // products that carry those tiers (fact, not advice).
  const tierOrderIssues = products
    .filter((p) => {
      const chain = orderTiers.map((t) => p.prices?.[t]).filter((v): v is number => typeof v === "number");
      return chain.length >= 2 && chain.some((v, i) => i > 0 && v >= chain[i - 1]);
    })
    .map((p) => p.id);
  return {
    tierId,
    sample,
    method: "mediana · IQR",
    values,
    median: med,
    iqr,
    dispersion: iqr > 0 ? "iqr" : madValue > 0 ? "mad" : "none",
    madSignal: madValue > 0,
    evidence: sample >= 3 ? "ok" : "insufficient",
    withoutCost: products.filter((p) => typeof p.cost !== "number").length,
    tierOrderIssues,
    periodAnalysis: "unavailable",
    periodNote: "Análisis por periodo de entrega disponible tras integrar #333 (fecha efectiva); no se infieren meses.",
  };
}

/**
 * #335 r2: the price-change events for a MANUAL product save — one per tier
 * whose price EFFECTIVELY changed (finite number → different finite number).
 * Additions/removals of a tier price are not priced transitions and stay
 * unrecorded in this stage (nothing is invented as "previous 0").
 */
export function buildManualPriceEvents(params: {
  storeId: string;
  productId: string;
  updatedAt: string;
  uid: string;
  previous?: { prices?: Record<string, number> };
  next: { prices?: Record<string, number> };
}): PriceChangeEvent[] {
  const events: PriceChangeEvent[] = [];
  for (const [tierId, next] of Object.entries(params.next.prices ?? {})) {
    const previous = params.previous?.prices?.[tierId];
    if (typeof previous !== "number" || !Number.isFinite(previous)) continue;
    if (typeof next !== "number" || !Number.isFinite(next)) continue;
    if (previous === next) continue;
    events.push(
      priceChangeEvent({
        intentId: `${tierId}:${previous}:${next}:${params.updatedAt}`,
        storeId: params.storeId,
        productId: params.productId,
        tierId,
        previous,
        next,
        uid: params.uid,
        effectiveAt: params.updatedAt,
        origin: "manual",
      })
    );
  }
  return events;
}
