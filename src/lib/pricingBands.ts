// #280 — the band-table PROPOSAL generator for the pricing-strategy screen.
// Deterministic and explainable: same input ⇒ same proposal, and every choice
// (number of bands, limits, prices) travels with its plain-Spanish reason.
//
// Grounding rules inherited from #254 and the PO's 2026-11-09 spec:
// - a piece's band is decided by its ACQUISITION cost alone (packaging never
//   jumps bands); packaging enters the commercial base cost used to judge
//   contribution, never the band limits.
// - current prices are EVIDENCE, not truth: medians anchor the proposal but
//   outliers are excluded and weak bands stay "pendiente" — nothing invented.
// - statistical support (how many SKUs back a band) is kept SEPARATE from the
//   commercial confidence of each tier's price (orders back Iconic; Regular is
//   a reference pending physical-point validation).
import { baseCostForTier } from "./pricingRules";
import type { Product, StorePackaging } from "../types";

// --- Tuning parameters (documented in the spec; deterministic, no randomness).
export const BANDS_PARAMS = {
  maxBands: 6,
  minBandSkus: 4, // a band with fewer SKUs invalidates the candidate
  minBandShare: 0.15, // ...or with <15% of the category
  cutSnapToleranceCents: 300, // snap a cut to a commercial edge within $3
  bigRangeCents: 20000, // ≥$200 range ⇒ limits snap to $10 instead of $5
  separationMin: 0.15, // adjacent medians must differ ≥15% for a cut to "separate"
  separationFull: 0.35, // relative gap that earns full separation score
  proposalPriceStep: 10, // prices propose on Fer's commercial $10 ladder
  strongPriceEvidence: 3, // band needs ≥3 current prices to call its median solid
} as const;

export type BandSupport = "high" | "medium" | "low";
export type PriceSupport = "strong" | "weak" | "pending";
export type TierEvidence = "orders" | "prices" | "reference";

export type BandMember = {
  id: string;
  name: string;
  cost: number;
  currentPrices: Record<string, number | undefined>;
};

export type BandProposal = {
  min: number; // pesos, [min, max) — the first band starts at 0
  max?: number; // undefined = open last band
  skuCount: number;
  members: BandMember[];
  prices: Record<string, number | null>; // pesos; null = pendiente (no evidence)
  priceSupport: Record<string, PriceSupport>;
  minContribution: Record<string, number | null>; // price − worst-case base cost
};

export type CategoryAnalysis = {
  skuCount: number;
  withCost: number;
  withoutCost: number;
  unitsOnHand: number;
  soldOut: number;
  costMin?: number;
  costMax?: number;
  costMedian?: number;
  distinctCosts: number;
  outliers: number;
  priceOutliersByTier: Record<string, number>;
};

export type KOption = { k: number; status: "chosen" | "valid" | "rejected"; reason: string };

export type CategoryProposal = {
  analysis: CategoryAnalysis;
  support: BandSupport;
  supportReason: string;
  bands: BandProposal[] | null;
  kSummary: KOption[];
  chosenReason: string;
  warnings: string[];
};

export type BandTier = { id: string; label: string };
export type BandProduct = Pick<Product, "id" | "name" | "categoryIds" | "cost"> & {
  prices?: Record<string, number>;
  quantityOnHand?: number;
};

/** Commercial confidence per tier: orders back Iconic (its channel dominates
 * history), prices alone back Girly, Regular is a reference until physical
 * points provide demand evidence. Non-canonical labels default to "prices". */
export function tierEvidence(label: string): TierEvidence {
  const normalized = label.toLowerCase();
  if (normalized.includes("iconic") || normalized.includes("emprendedora") || normalized.includes("reseller")) return "orders";
  if (normalized.includes("girly") || normalized.includes("mayoreo") || normalized.includes("wholesale")) return "prices";
  return "reference";
}

/** Per-piece packaging materials of a tier WITHOUT an estimated cost — a gap
 * that makes every base cost / contribution for that tier incomplete. The
 * engine's baseCostForTier prices them at 0; we surface the gap instead of
 * pretending the number is trustworthy. */
export function packagingGaps(packaging: StorePackaging | undefined, tierId: string): string[] {
  const materials = new Map((packaging?.materials ?? []).map((m) => [m.id, m]));
  return (packaging?.byTier?.[tierId]?.perPiece ?? [])
    .filter((line) => {
      const cost = materials.get(line.materialId)?.estimatedCost;
      return cost === undefined || cost === null;
    })
    .map((line) => materials.get(line.materialId)?.name ?? line.materialId);
}

function percentileCents(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + Math.round((sorted[hi] - sorted[lo]) * (pos - lo));
}

const toCents = (pesos: number) => Math.round(pesos * 100);
const toPesos = (cents: number) => Math.round(cents) / 100;

function medianCents(values: number[]): number {
  return percentileCents([...values].sort((a, b) => a - b), 0.5);
}

function iqrOutliersCents(sorted: number[]): number[] {
  if (sorted.length < 4) return [];
  const q1 = percentileCents(sorted, 0.25);
  const q3 = percentileCents(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return sorted.filter((c) => c < lo || c > hi);
}

function modeShare(values: number[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const best = Math.max(...counts.values());
  return best / values.length;
}

/** Descriptive stats for one category (shown even when no bands are proposed). */
export function analyzeCategory(products: BandProduct[], categoryId: string, tiers: BandTier[]): CategoryAnalysis {
  const inCategory = products.filter((p) => p.categoryIds?.[0] === categoryId);
  const withCost = inCategory.filter((p) => typeof p.cost === "number" && p.cost > 0) as Array<BandProduct & { cost: number }>;
  const costs = withCost.map((p) => toCents(p.cost)).sort((a, b) => a - b);
  const priceOutliersByTier: Record<string, number> = {};
  for (const tier of tiers) {
    const prices = withCost.map((p) => p.prices?.[tier.id]).filter((v): v is number => typeof v === "number" && v > 0);
    priceOutliersByTier[tier.id] = iqrOutliersCents(prices.map(toCents).sort((a, b) => a - b)).length;
  }
  return {
    skuCount: inCategory.length,
    withCost: withCost.length,
    withoutCost: inCategory.length - withCost.length,
    unitsOnHand: inCategory.reduce((acc, p) => acc + (typeof p.quantityOnHand === "number" ? p.quantityOnHand : 0), 0),
    soldOut: inCategory.filter((p) => (p.quantityOnHand ?? 0) === 0).length,
    costMin: costs.length > 0 ? toPesos(costs[0]) : undefined,
    costMax: costs.length > 0 ? toPesos(costs[costs.length - 1]) : undefined,
    costMedian: costs.length > 0 ? toPesos(percentileCents(costs, 0.5)) : undefined,
    distinctCosts: new Set(costs).size,
    outliers: iqrOutliersCents(costs).length,
    priceOutliersByTier,
  };
}

type Cut = number; // cents, strictly between the category's min and max cost

/** Snap a raw cut to a commercial limit: an OBSERVED cost edge within the
 * tolerance first (evidence Fer already uses), else a multiple of $5/$10.
 * Falls back to the raw cut when nothing commercial is close enough. When the
 * cut must stay inside a natural gap (lo, hi), a snap outside the gap is
 * discarded — the boundary keeps separating the two cost groups. */
function commercialCut(rawCents: Cut, observedCosts: number[], rangeCents: number, gap?: { lo: number; hi: number }): Cut {
  const tolerance = BANDS_PARAMS.cutSnapToleranceCents;
  const withinGap = (value: number) => (gap ? value > gap.lo && value < gap.hi : true);
  const observed = observedCosts.find((c) => Math.abs(c - rawCents) <= tolerance);
  if (observed !== undefined && withinGap(observed)) return observed;
  const step = rangeCents >= BANDS_PARAMS.bigRangeCents ? 1000 : 500;
  const snapped = Math.round(rawCents / step) * step;
  if (Math.abs(snapped - rawCents) <= tolerance && withinGap(snapped)) return snapped;
  return withinGap(rawCents) ? rawCents : gap ? Math.floor((gap.lo + gap.hi) / 2) : rawCents;
}

/** Natural gaps in the cost distribution: consecutive distinct costs whose
 * relative jump exceeds `naturalGapRatio`. Cut candidates land at each gap's
 * midpoint, so bands follow the category's real structure instead of blind
 * quantiles (a 60/40 split hides the boundary from the median). */
function naturalGaps(observedCosts: number[]): Array<{ lo: number; hi: number; weight: number }> {
  const gaps: Array<{ lo: number; hi: number; weight: number }> = [];
  for (let i = 1; i < observedCosts.length; i += 1) {
    const lo = observedCosts[i - 1];
    const hi = observedCosts[i];
    if (lo > 0 && (hi - lo) / lo >= 0.25) gaps.push({ lo, hi, weight: hi - lo });
  }
  return gaps.sort((a, b) => b.weight - a.weight || a.lo - b.lo);
}

type Candidate = { k: number; cuts: Cut[]; groups: number[][] }; // groups = cost cents per band
type CandidateScore = { candidate: Candidate; separation: number; cohesion: number; score: number };

function buildCandidate(k: number, costs: number[], observedCosts: number[]): Candidate | null {
  if (k === 1) return { k, cuts: [], groups: [costs] };
  const rangeCents = costs[costs.length - 1] - costs[0];
  // Cuts prefer the distribution's own structure: the k−1 largest natural
  // gaps, in weight order. Quantiles only top up when there are fewer gaps
  // than cuts — they never override a structural boundary.
  const cuts: Cut[] = [];
  for (const gap of naturalGaps(observedCosts)) {
    if (cuts.length >= k - 1) break;
    const midpoint = gap.lo + Math.floor((gap.hi - gap.lo) / 2);
    cuts.push(commercialCut(midpoint, observedCosts, rangeCents, gap));
  }
  for (let i = 1; i < k && cuts.length < k - 1; i += 1) {
    const raw = percentileCents(costs, i / k);
    const cut = commercialCut(raw, observedCosts, rangeCents);
    if (cut > costs[0] && cut < costs[costs.length - 1] && !cuts.some((c) => Math.abs(c - cut) < 1)) cuts.push(cut);
  }
  if (cuts.length < k - 1) return null; // not enough honest boundaries for k bands
  cuts.sort((a, b) => a - b);
  const groups: number[][] = [];
  let start = 0;
  for (const cut of [...cuts, Infinity]) {
    const index = cut === Infinity ? costs.length : costs.findIndex((c, i) => i >= start && c >= cut);
    if (index <= start) return null; // empty band after snapping
    groups.push(costs.slice(start, index));
    start = index;
  }
  return { k, cuts, groups };
}

function minAdjacentGap(groups: number[][]): number {
  let min = Infinity;
  for (let i = 1; i < groups.length; i += 1) {
    const prev = medianCents(groups[i - 1]);
    const next = medianCents(groups[i]);
    if (prev <= 0) return 0;
    min = Math.min(min, (next - prev) / prev);
  }
  return groups.length === 1 ? Infinity : min;
}

function fragments(groups: number[][], total: number): number {
  return groups.filter((g) => g.length < BANDS_PARAMS.minBandSkus || g.length / total < BANDS_PARAMS.minBandShare).length;
}

/**
 * Propose a band table for one category, or explain why it cannot. Pure:
 * same products ⇒ same proposal. All money arithmetic runs in integer cents;
 * limits and prices come back in pesos.
 */
export function proposeCategoryBands(input: {
  products: BandProduct[];
  categoryId: string;
  tiers: BandTier[];
  packaging?: StorePackaging;
}): CategoryProposal | null {
  const { products, categoryId, tiers, packaging } = input;
  const analysis = analyzeCategory(products, categoryId, tiers);
  const inCategory = products.filter((p) => p.categoryIds?.[0] === categoryId);
  const withCost = inCategory.filter((p): p is BandProduct & { cost: number } => typeof p.cost === "number" && p.cost > 0);

  // Statistical support of the STRUCTURE (band count/limits), separate from
  // each tier's price confidence.
  let support: BandSupport;
  let supportReason: string;
  if (analysis.withCost >= 20 && analysis.distinctCosts >= 5) {
    support = "high";
    supportReason = `${analysis.withCost} piezas con costo y ${analysis.distinctCosts} costos distintos: distribución con buen soporte.`;
  } else if (analysis.withCost >= 8 && analysis.distinctCosts >= 3) {
    support = "medium";
    supportReason = `${analysis.withCost} piezas con costo y ${analysis.distinctCosts} costos distintos: soporte medio.`;
  } else if (analysis.withCost >= 4) {
    support = "low";
    supportReason = `Solo ${analysis.withCost} piezas con costo (${analysis.distinctCosts} costos distintos): propuesta con confianza baja.`;
  } else {
    return {
      analysis,
      support: "low",
      supportReason: `Muestra insuficiente (${analysis.withCost} piezas con costo): no se propone tabla.`,
      bands: null,
      kSummary: [],
      chosenReason: "",
      warnings: analysis.withoutCost > 0 ? [`${analysis.withoutCost} piezas sin costo confiable no reciben precio sugerido.`] : [],
    };
  }

  const costs = withCost.map((p) => toCents(p.cost)).sort((a, b) => a - b);
  const observedCosts = [...new Set(costs)].sort((a, b) => a - b);

  // Compare k = 1..maxBands explicitly; k=1 only stays eligible when no k≥2
  // candidate both validates and separates costs by ≥ separationMin.
  // Category-level price outliers (IQR per tier) are excluded from every band
  // median so one stray price never drags a proposal.
  const outlierPricesByTier = new Map<string, Set<number>>();
  for (const tier of tiers) {
    const prices = withCost
      .map((p) => p.prices?.[tier.id])
      .filter((v): v is number => typeof v === "number" && v > 0)
      .map(toCents)
      .sort((a, b) => a - b);
    outlierPricesByTier.set(tier.id, new Set(iqrOutliersCents(prices)));
  }
  const scored: CandidateScore[] = [];
  const kSummary: KOption[] = [];
  for (let k = 1; k <= BANDS_PARAMS.maxBands; k += 1) {
    const candidate = buildCandidate(k, costs, observedCosts);
    if (!candidate) {
      kSummary.push({ k, status: "rejected", reason: "los cortes comerciales dejarían una banda vacía o desordenada" });
      continue;
    }
    const frag = fragments(candidate.groups, costs.length);
    if (frag > 0) {
      kSummary.push({
        k,
        status: "rejected",
        reason: `${frag} banda(s) quedarían con menos de ${BANDS_PARAMS.minBandSkus} piezas o del 15% de la categoría`,
      });
      continue;
    }
    const separation = minAdjacentGap(candidate.groups);
    const cohesion = candidate.groups.reduce((acc, _group, index) => {
      // Price cohesion: how uniformly Fer already prices each group, per tier.
      const members = membersOfGroups(withCost, candidate, index);
      const shares = tiers
        .map((t) => modeShare(members.map((m) => m.currentPrices[t.id]).filter((v): v is number => typeof v === "number" && v > 0).map(toCents)))
        .filter((s) => s > 0);
      return acc + (shares.length > 0 ? shares.reduce((a, b) => a + b, 0) / shares.length : 0.5);
    }, 0);
    const cohesionScore = cohesion / candidate.groups.length;
    const separationScore = Math.min(1, separation / BANDS_PARAMS.separationFull);
    const score = 0.5 * separationScore + 0.35 * cohesionScore + 0.15 * (1 / k);
    scored.push({ candidate, separation, cohesion: cohesionScore, score });
    kSummary.push({
      k,
      status: "valid",
      reason:
        k === 1
          ? "una sola banda"
          : `separación mínima entre bandas ${Math.round(separation * 100)}%, precios parejos dentro de banda ${Math.round(cohesionScore * 100)}%`,
    });
  }

  const separating = scored.filter((s) => s.candidate.k >= 2 && s.separation >= BANDS_PARAMS.separationMin);
  if (scored.length === 0) {
    return {
      analysis,
      support,
      supportReason,
      bands: null,
      kSummary,
      chosenReason: "",
      warnings: ["Ningún número de bandas produce una tabla válida para esta categoría."],
    };
  }
  // Anti-trivial rule: when some k≥2 genuinely separates costs, k=1 leaves the
  // table. Otherwise k=1 competes normally (tie → smaller k wins).
  const eligible = separating.length > 0 ? scored.filter((s) => s.candidate.k > 1) : scored;
  const best = eligible.reduce((acc, s) => (s.score > acc.score + 1e-9 ? s : acc), eligible[0]);
  for (const option of kSummary) {
    if (option.k === best.candidate.k) option.status = "chosen";
    else if (option.status === "valid" && option.k === 1 && separating.length > 0) {
      option.status = "rejected";
      option.reason = "hay cortes que sí separan los costos: una sola banda escondería la diferencia";
    }
  }
  const chosenReason =
    best.candidate.k === 1
      ? "Los costos de la categoría están tan juntos que una sola banda los representa bien."
      : `Elegidas ${best.candidate.k} bandas: mejor equilibrio entre separar grupos de costo, respetar los precios que ya cobras dentro de cada grupo y mantener la tabla fácil de administrar.`;

  // Limits in pesos: first band opens at 0, last band stays open.
  const limits = best.candidate.cuts.map(toPesos);
  const bands: BandProposal[] = best.candidate.groups.map((_, index) => {
    const min = index === 0 ? 0 : limits[index - 1];
    const max = index < best.candidate.groups.length - 1 ? limits[index] : undefined;
    const members = membersOfGroups(withCost, best.candidate, index).sort(
      (a, b) => a.cost - b.cost || a.name.localeCompare(b.name)
    );
    return buildBand(min, max, members, tiers, packaging, outlierPricesByTier);
  });

  const warnings: string[] = [];
  for (const tier of tiers) {
    const gaps = packagingGaps(packaging, tier.id);
    if (gaps.length > 0) {
      warnings.push(`Costo base de ${tier.label} incompleto: faltan costos de empaque (${gaps.join(", ")}). Contribuciones preliminares.`);
    }
  }
  const canonical = canonicalTiers(tiers);
  if (canonical) {
    for (const band of bands) {
      const r = band.prices[canonical.regular];
      const g = band.prices[canonical.girly];
      const i = band.prices[canonical.iconic];
      if (r != null && g != null && i != null && !(r > g && g > i)) {
        warnings.push(`En la banda ${bandLabel(band)} la mediana actual no respeta Regular > Girly > Iconic: decisión pendiente de Fer.`);
      }
    }
  }
  if (analysis.withoutCost > 0) {
    warnings.push(`${analysis.withoutCost} piezas sin costo confiable quedan fuera de la tabla (sin precio sugerido).`);
  }

  return { analysis, support, supportReason, bands, kSummary, chosenReason, warnings };
}

function membersOfGroups(withCost: Array<BandProduct & { cost: number }>, candidate: Candidate, groupIndex: number): BandMember[] {
  const cuts = [...candidate.cuts, Infinity];
  return withCost
    .filter((p) => {
      const cents = toCents(p.cost);
      const index = cuts.findIndex((cut) => cents < cut);
      return (index === -1 ? candidate.groups.length - 1 : index) === groupIndex;
    })
    .map((p) => ({ id: p.id, name: p.name, cost: p.cost, currentPrices: p.prices ?? {} }));
}

function buildBand(
  min: number,
  max: number | undefined,
  members: BandMember[],
  tiers: BandTier[],
  packaging: StorePackaging | undefined,
  outlierPricesByTier: Map<string, Set<number>>
): BandProposal {
  const prices: Record<string, number | null> = {};
  const priceSupport: Record<string, PriceSupport> = {};
  const minContribution: Record<string, number | null> = {};
  for (const tier of tiers) {
    const outliers = outlierPricesByTier.get(tier.id) ?? new Set<number>();
    const values = members
      .map((m) => m.currentPrices[tier.id])
      .filter((v): v is number => typeof v === "number" && v > 0)
      .map(toCents)
      .filter((cents) => !outliers.has(cents));
    if (values.length === 0) {
      prices[tier.id] = null;
      priceSupport[tier.id] = "pending";
      minContribution[tier.id] = null;
      continue;
    }
    const raw = medianCents(values);
    const step = BANDS_PARAMS.proposalPriceStep * 100;
    const proposed = Math.max(step, Math.round(raw / step) * step);
    prices[tier.id] = toPesos(proposed);
    priceSupport[tier.id] = values.length >= BANDS_PARAMS.strongPriceEvidence ? "strong" : "weak";
    // Worst case inside the band: the most expensive member's full base cost.
    const worstBase = Math.max(...members.map((m) => baseCostForTier({ cost: m.cost }, tier.id, packaging) ?? 0));
    minContribution[tier.id] = toPesos(proposed - toCents(worstBase));
  }
  return { min, max, skuCount: members.length, members, prices, priceSupport, minContribution };
}

export function canonicalTiers(tiers: BandTier[]): { regular: string; girly: string; iconic: string } | null {
  const find = (needle: string, ...more: string[]) =>
    tiers.find((t) => [needle, ...more].some((n) => t.label.toLowerCase().includes(n)))?.id ?? null;
  const regular = find("regular", "menudeo", "retail");
  const girly = find("girly", "mayoreo");
  const iconic = find("iconic", "emprendedora");
  return regular && girly && iconic ? { regular, girly, iconic } : null;
}

export function bandLabel(band: { min: number; max?: number }): string {
  return band.max === undefined ? `desde $${band.min}` : `$${band.min} a $${band.max}`;
}
