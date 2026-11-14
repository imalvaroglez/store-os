// #128 — etapa lista: propuesta de reparto de ganancia, SOLO LECTURA.
// Entradas EXPLÍCITAS (resultado operativo del periodo, pérdida acumulada,
// monto propuesto): esta lib NO recalcula el cierre (#129 es la fuente
// canónica) ni consulta caja; la etapa operativa (autorización, reservas,
// pagos reales) queda fuera. Todo en centavos exactos.

export type DistributionInput = {
  /** Period operating result, exact cents (from the monthly close). */
  operatingResultCents: number;
  /** Accumulated operating losses BEFORE this period, exact cents. */
  accumulatedLossCents: number;
  /** How much Fer proposes to distribute now, exact cents. */
  proposedAmountCents: number;
  /** Verified cash available for the period (#279); undefined = unknown. */
  liquidityVerifiedCents?: number;
};

export type DistributionSplit = {
  ferCents: number;
  oliviaCents: number;
  investorCents: number;
};

export type LiquidityStatus = "verified" | "insufficient" | "unknown";

export type DistributionProposal = {
  /** Distributable base AFTER compensating accumulated losses (never < 0). */
  baseCents: number;
  /** Loss absorbed by this period's result (0 when the result is negative). */
  lossCompensatedCents: number;
  /** Accumulated loss AFTER this period (grows with an operating loss). */
  accumulatedLossAfterCents: number;
  split: DistributionSplit;
  distributedCents: number;
  /** What stays undistributed in its period of origin. */
  remainderCents: number;
  liquidityStatus: LiquidityStatus;
};

const SHARES = [
  { key: "ferCents" as const, share: 0.5 },
  { key: "oliviaCents" as const, share: 0.3 },
  { key: "investorCents" as const, share: 0.2 },
];

/**
 * 50/30/20 at exact cents. Largest-remainder rounding keeps Σ = total; ties
 * resolve Fer → Olivia → investor (the documented tie-break), so a single
 * leftover cent always lands on the earliest share.
 */
function splitByLargestRemainder(totalCents: number): DistributionSplit {
  const floors = SHARES.map((s) => Math.floor(totalCents * s.share));
  let left = totalCents - floors.reduce((sum, v) => sum + v, 0);
  const order = SHARES.map((s, i) => ({
    key: s.key,
    index: i,
    fraction: totalCents * s.share - floors[i],
  })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const result: DistributionSplit = { ferCents: 0, oliviaCents: 0, investorCents: 0 };
  for (const entry of order) {
    if (left <= 0) break;
    result[entry.key] += 1;
    left -= 1;
  }
  SHARES.forEach((s, i) => {
    result[s.key] += floors[i];
  });
  return result;
}

/**
 * Pure, idempotent. Unknown liquidity is NEVER treated as zero — the proposal
 * carries `liquidityStatus: "unknown"` and the view must say the liquidity
 * review is missing before any real authorization (#279 provides the source).
 */
export function proposeDistribution(input: DistributionInput): DistributionProposal {
  const result = Math.round(input.operatingResultCents);
  const previousLoss = Math.max(0, Math.round(input.accumulatedLossCents));
  // A real operating loss is kept as accumulated loss to compensate future
  // results BEFORE computing the maximum distributable (#128 contract).
  const lossCompensated = result > 0 ? Math.min(previousLoss, result) : 0;
  const base = Math.max(0, result - lossCompensated);
  const accumulatedAfter = result < 0 ? previousLoss + Math.abs(result) : previousLoss - lossCompensated;

  const distributed = Math.max(0, Math.min(Math.round(input.proposedAmountCents), base));
  const liquidityStatus: LiquidityStatus =
    input.liquidityVerifiedCents === undefined
      ? "unknown"
      : input.liquidityVerifiedCents >= distributed
        ? "verified"
        : "insufficient";

  return {
    baseCents: base,
    lossCompensatedCents: lossCompensated,
    accumulatedLossAfterCents: accumulatedAfter,
    split: splitByLargestRemainder(distributed),
    distributedCents: distributed,
    remainderCents: base - distributed,
    liquidityStatus,
  };
}
