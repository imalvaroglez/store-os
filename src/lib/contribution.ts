// #336 (2B): deterministic contribution and break-even algebra. Pure, exact
// cents, every assumption visible. It is a READ-ONLY simulation: nothing here
// forecasts demand, touches the catalog, or persists anything — the result
// lives in the view's state only. Hard restrictions (Fer's per-piece minimum,
// the commercial price ladder) NEVER relax: when they clash the scenario is
// "sin escenario factible" naming the blocker.

export type VolumeSource = "observado" | "estimado" | "ingresado";

/** One rung of the product's price ladder (cheapest → priciest tier). */
export type LadderRung = { label: string; priceCents: number };

export type ContributionInput = {
  priceCurrentCents: number;
  priceProposedCents: number;
  /** Base volume q0 — integer pieces for the chosen period. */
  basePieces: number;
  volumeSource: VolumeSource;
  /** Variable cost per piece (acquisition + per-piece packaging of the
   * level). null = unknown/incomplete: contributions stay uncomputed. */
  variableCostCents: number | null;
  /** Per-ORDER packaging, shown apart — never divided by pieces nor folded
   * into the unit cost. */
  perOrderPackagingCents: number | null;
  /** Fer's optional per-piece minimum — a hard restriction when present. */
  minContributionPerPieceCents: number | null;
  /** The product's full ladder in canonical order, when simulating a tier. */
  ladder?: LadderRung[] | null;
  /** Index of the simulated tier inside `ladder`. */
  simulatedTierIndex?: number;
  /** Volume changes Fer asks to compare, in percent of the base. */
  sensitivityPct: number[];
};

export type BreakEven = {
  /** q* as an exact reduced fraction (numerator/denominator, cents-safe). */
  exact: { numerator: number; denominator: number };
  /** Human reference: exact integer, or one/two-decimal exact value ("4.3"). */
  label: string;
  /** Whole pieces needed to match-or-beat the base contribution. */
  piecesToMatch: number;
  /** Whole pieces needed to STRICTLY beat it (q* integer → q* + 1). */
  piecesToExceed: number;
};

export type SensitivityPoint = { pct: number; pieces: number; totalCents: number | null };

export type ContributionResult = {
  status: "ok" | "limit" | "infeasible";
  unitCurrentCents: number | null;
  unitProposedCents: number | null;
  baseTotalCents: number | null;
  scenarioTotalCents: number | null;
  deltaCents: number | null;
  breakEven: BreakEven | null;
  perOrderPackagingCents: number | null;
  notes: string[];
  blockers: string[];
  sensitivity: SensitivityPoint[];
};

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function centsToLabel(cents: number): string {
  return `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Exact decimal label of a reduced fraction: integer stays integer ("20"),
 * otherwise up to two exact decimals ("4.3", "3.01"); non-terminating within
 * two decimals falls back to the fraction itself ("43/9"). */
function fractionLabel(numerator: number, denominator: number): string {
  if (numerator % denominator === 0) return String(numerator / denominator);
  for (const decimals of [1, 2]) {
    const factor = 10 ** decimals;
    if ((numerator * factor) % denominator === 0) {
      return (numerator * factor / denominator / factor).toFixed(decimals);
    }
  }
  return `${numerator}/${denominator}`;
}

/**
 * The scenario. Exact cents everywhere; no NaN/Infinity ever reaches a field
 * (guarded inputs → status "limit" with a Spanish note instead).
 */
export function simulateContribution(input: ContributionInput): ContributionResult {
  const notes: string[] = [];
  const blockers: string[] = [];
  const perOrderPackagingCents = input.perOrderPackagingCents;
  if (perOrderPackagingCents != null && perOrderPackagingCents > 0) {
    notes.push(`Empaque por pedido: ${centsToLabel(perOrderPackagingCents)} — aparte, por pedido; no se divide entre piezas ni entra al costo por pieza.`);
  }

  // ── Hard restrictions first: the ladder never relaxes. ──────────────────
  if (input.ladder && input.simulatedTierIndex != null) {
    const index = input.simulatedTierIndex;
    const rung = input.ladder[index];
    const below = index > 0 ? input.ladder[index - 1] : null;
    const above = index < input.ladder.length - 1 ? input.ladder[index + 1] : null;
    if (below && input.priceProposedCents <= below.priceCents) {
      blockers.push(`Escalera de precios: ${rung?.label ?? "este nivel"} debe costar más que ${below.label} (${centsToLabel(below.priceCents)}); propuesto ${centsToLabel(input.priceProposedCents)}.`);
    }
    if (above && input.priceProposedCents >= above.priceCents) {
      blockers.push(`Escalera de precios: ${rung?.label ?? "este nivel"} debe costar menos que ${above.label} (${centsToLabel(above.priceCents)}); propuesto ${centsToLabel(input.priceProposedCents)}.`);
    }
  }

  const cost = input.variableCostCents;
  if (cost == null) {
    return {
      status: blockers.length ? "infeasible" : "limit",
      unitCurrentCents: null, unitProposedCents: null,
      baseTotalCents: null, scenarioTotalCents: null, deltaCents: null,
      breakEven: null, perOrderPackagingCents, notes: [...notes, "Costo desconocido o incompleto: la contribución no se calcula (un costo ausente nunca se trata como cero). Captura el costo en Compras o complétalo para simular."], blockers,
      sensitivity: input.sensitivityPct.map((pct) => ({ pct, pieces: piecesAfter(input.basePieces, pct), totalCents: null })),
    };
  }

  const c0 = input.priceCurrentCents - cost;
  const c1 = input.priceProposedCents - cost;

  // Fer's per-piece minimum is a hard restriction — checked only when given.
  if (input.minContributionPerPieceCents != null && c1 < input.minContributionPerPieceCents) {
    blockers.push(`Mínimo de contribución por pieza: pediste ${centsToLabel(input.minContributionPerPieceCents)} y la propuesta deja ${centsToLabel(c1)}.`);
  }

  if (blockers.length) {
    return {
      status: "infeasible",
      unitCurrentCents: c0, unitProposedCents: c1,
      baseTotalCents: null, scenarioTotalCents: null, deltaCents: null,
      breakEven: null, perOrderPackagingCents, notes, blockers,
      sensitivity: input.sensitivityPct.map((pct) => ({ pct, pieces: piecesAfter(input.basePieces, pct), totalCents: null })),
    };
  }

  // ── Explained limits (no misleading figures). ───────────────────────────
  if (c1 <= 0) {
    return {
      status: "limit",
      unitCurrentCents: c0, unitProposedCents: c1,
      baseTotalCents: c0 * input.basePieces, scenarioTotalCents: null, deltaCents: null,
      breakEven: null, perOrderPackagingCents,
      notes: [...notes, c1 >= c0
        // #336 QA: when the CURRENT contribution is also non-positive, the
        // proposal (0 or a smaller loss) matches or beats it at ANY volume —
        // "ningún volumen alcanza" would be false.
        ? `La contribución por pieza propuesta no es positiva y la actual tampoco: cualquier volumen iguala o supera.`
        : c1 === 0
          ? "La contribución por pieza propuesta es $0.00: ningún volumen alcanza la contribución actual."
          : "La contribución por pieza propuesta es negativa: ningún volumen alcanza la contribución actual."],
      blockers, sensitivity: [],
    };
  }
  if (input.basePieces <= 0) {
    return {
      status: "limit",
      unitCurrentCents: c0, unitProposedCents: c1,
      baseTotalCents: 0, scenarioTotalCents: 0, deltaCents: 0,
      breakEven: null, perOrderPackagingCents,
      notes: [...notes, "El volumen base es cero: no hay referencia de equilibrio. Ingresa el volumen del periodo para comparar."],
      blockers, sensitivity: [],
    };
  }
  if (c0 <= 0) {
    notes.push("La contribución actual por pieza es cero o negativa: cualquier volumen con la propuesta iguala o supera la base.");
  }

  // ── Break-even: q* = q0 × c0 / c1, exact. ──────────────────────────────
  const rawNum = input.basePieces * c0;
  const divisor = gcd(rawNum, c1);
  const numerator = Math.max(0, Math.round(rawNum / divisor));
  const denominator = Math.round(c1 / divisor);
  const matchPieces = denominator === 0 ? 0 : Math.ceil(numerator / denominator);
  const isExactInteger = denominator !== 0 && numerator % denominator === 0;
  const breakEven: BreakEven = {
    exact: { numerator, denominator },
    label: c0 <= 0 ? "0" : fractionLabel(numerator, denominator),
    piecesToMatch: Math.max(0, matchPieces),
    piecesToExceed: c0 < 0 ? 0 : c0 === 0 ? 1 : isExactInteger ? numerator / denominator + 1 : Math.max(0, matchPieces),
  };

  const sensitivity = input.sensitivityPct.map((pct) => {
    const pieces = piecesAfter(input.basePieces, pct);
    return { pct, pieces, totalCents: c1 * pieces };
  });
  if (sensitivity.length) notes.push("Comparaciones de volumen: escenario, no pronóstico — ningún valor promete ventas.");

  return {
    status: "ok",
    unitCurrentCents: c0,
    unitProposedCents: c1,
    baseTotalCents: c0 * input.basePieces,
    scenarioTotalCents: c1 * input.basePieces,
    deltaCents: (c1 - c0) * input.basePieces,
    breakEven, perOrderPackagingCents, notes, blockers, sensitivity,
  };
}

/** Whole pieces after a percentage change, floored at zero. */
function piecesAfter(basePieces: number, pct: number): number {
  return Math.max(0, Math.round(basePieces * (1 + pct / 100)));
}
