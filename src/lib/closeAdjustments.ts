// #202: corrections after a close — pure derivation of WHERE a correction
// applies, WHO may reopen, and the pending regularization of an already-paid
// distribution. Pure: callers persist; nothing here touches Firestore.

export type CloseMonth = { year: number; month: number };

export type CloseIdentity = {
  storeId: string;
  ownerUid: string;
  month: CloseMonth;
  version: number;
};

export type AdjustmentBreakdown = {
  /** Inventory-value difference (pieces still on the shelf), exact cents. */
  inventoryCents: number;
  /** Cost-of-sales difference (pieces already sold), exact cents. */
  costOfSalesCents: number;
};

export type AdjustmentPlan =
  | {
      kind: "apply";
      /** Period where the difference REALly lands. */
      period: CloseMonth;
      /** True when it differs from the origin period (origin closed). */
      linkedToOrigin: boolean;
      differenceCents: number;
      breakdown?: AdjustmentBreakdown;
      /** Explicit operator confirmation BEFORE applying — a proposal until true. */
      confirmed: boolean;
    }
  | {
      kind: "pending";
      differenceCents: number;
      breakdown?: AdjustmentBreakdown;
      /** A pending correction changes NO results, closes or distributions. */
      affectsResults: false;
    };

// Invariant (approved rules): for every applied plan,
// breakdown.inventoryCents + breakdown.costCents === differenceCents — the
// correction explains the WHOLE difference, in cents, and never more.
// Sign convention: differenceCents > 0 = the origin over-stated results
// (regularization returns); < 0 = under-stated (owed).

/**
 * The OLDEST open period — which may sit EARLIER than the origin period —
 * null when all are closed. Rules approved in #202: the differential lands
 * wherever accounting is still open, not necessarily after the origin.
 */
export function adjustmentTargetPeriod(openPeriods: CloseMonth[]): CloseMonth | null {
  if (openPeriods.length === 0) return null;
  return [...openPeriods].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))[0];
}

/**
 * WHERE a correction applies (approved rules):
 * - open origin → fix in its own period, with history;
 * - closed origin + an open period → the REAL difference lands in the open
 *   period, LINKED to the origin (never a second disbursement);
 * - everything closed → PENDING: it changes nothing until an explicit
 *   confirmation when a period opens. The plan is always shown BEFORE
 *   applying (`confirmed: false` until the operator confirms).
 */
export function planAdjustment(input: {
  originPeriod: CloseMonth;
  originClosed: boolean;
  openPeriods: CloseMonth[];
  differenceCents: number;
  breakdown?: AdjustmentBreakdown;
  confirmed?: boolean;
}): AdjustmentPlan {
  if (!input.originClosed) {
    return {
      kind: "apply",
      period: input.originPeriod,
      linkedToOrigin: false,
      differenceCents: input.differenceCents,
      ...(input.breakdown ? { breakdown: input.breakdown } : {}),
      confirmed: input.confirmed ?? false,
    };
  }
  const target = adjustmentTargetPeriod(input.openPeriods);
  if (!target) {
    return {
      kind: "pending",
      differenceCents: input.differenceCents,
      ...(input.breakdown ? { breakdown: input.breakdown } : {}),
      affectsResults: false,
    };
  }
  return {
    kind: "apply",
    period: target,
    linkedToOrigin: true,
    differenceCents: input.differenceCents,
    ...(input.breakdown ? { breakdown: input.breakdown } : {}),
    confirmed: input.confirmed ?? false,
  };
}

/**
 * Exceptional reopen authorization: ONLY the store's authenticated owner
 * (ownerUid). Super-admins, members, automations, the technical provider and
 * direct SDK calls (no session) can never substitute it. The two materiality
 * reasons are recorded by Fer at reopen time — no peso threshold exists.
 */
export function canAuthorizeReopen(
  close: Pick<CloseIdentity, "ownerUid">,
  actor: { uid: string; role?: string } | undefined
): boolean {
  return !!actor && actor.uid === close.ownerUid;
}

export type HistoricalDistribution = {
  ferCents: number;
  oliviaCents: number;
  investorCents: number;
  totalDistributedCents: number;
};

export type RecipientPending = { ferCents: number; oliviaCents: number; investorCents: number };

/**
 * Per-recipient PENDING regularization of an already-PAID distribution: the
 * differential uses the HISTORICAL shares stored in that period's
 * distribution — never the current percentages. Exact cents with
 * largest-remainder rounding (no cent is lost); stays a pending item until
 * Fer records her resolution — the app never moves money or discounts future
 * distributions automatically. Null when nothing was ever paid (no invented
 * accounts). Unknown data is never zero: absent input → null, not 0.
 */
export function pendingRegularizationByRecipient(
  historical: HistoricalDistribution | null,
  differenceCents: number
): RecipientPending | null {
  if (!historical || historical.totalDistributedCents <= 0) return null;
  // #202 r2: shares must account for the whole distributed total. An
  // inconsistent history (sum ≠ total) produces NO proposal — fail closed,
  // never a differential that silently loses cents (probe: fer 100 of 1000,
  // diff 10 → the naive split summed 4 and vanished 6).
  const sharesSum = historical.ferCents + historical.oliviaCents + historical.investorCents;
  if (sharesSum !== historical.totalDistributedCents) return null;
  const shares: Array<{ key: keyof RecipientPending; paidCents: number }> = [
    { key: "ferCents", paidCents: historical.ferCents },
    { key: "oliviaCents", paidCents: historical.oliviaCents },
    { key: "investorCents", paidCents: historical.investorCents },
  ];
  const result: RecipientPending = { ferCents: 0, oliviaCents: 0, investorCents: 0 };
  const floors = shares.map((share) => Math.floor((differenceCents * share.paidCents) / historical.totalDistributedCents));
  let left = differenceCents - floors.reduce((sum, v) => sum + v, 0);
  const order = shares
    .map((share, i) => ({ key: share.key, i, fraction: (differenceCents * share.paidCents) / historical.totalDistributedCents - floors[i] }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (const entry of order) {
    if (left <= 0) break;
    result[entry.key] += 1;
    left -= 1;
  }
  shares.forEach((share, i) => {
    result[share.key] += floors[i];
  });
  return result;
}
