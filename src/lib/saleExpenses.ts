// Period aggregation for SALE-side expenses (#184, executable slice): what it
// costs to SELL (delivery to the client, per-piece and shared packaging),
// grouped by month and category. Pure function over already-loaded purchases —
// zero extra Firestore reads and no listeners. Registering standalone
// (trip-less) expenses is NOT here: it waits for the assignment rule the PO
// must approve (see issue #184).
import {
  PURCHASE_EXPENSE_CATEGORY_LABEL,
  SALE_EXPENSE_CATEGORIES,
  isSaleExpense,
  type Purchase,
  type PurchaseExpenseCategory,
} from "../types";

export type SaleExpenseLine = {
  purchaseId: string;
  /** When the money was registered: trip date, or the late expense's own date. */
  date: string;
  category: PurchaseExpenseCategory;
  description?: string;
  amountCents: number;
};

export type SaleExpensePeriodTotals = {
  year: number;
  /** 1-12. */
  month: number;
  byCategoryCents: Partial<Record<PurchaseExpenseCategory, number>>;
  totalCents: number;
  /** Traceable breakdown so the operator can audit every peso, oldest first. */
  lines: SaleExpenseLine[];
};

const cents = (pesos: number) => Math.round(pesos * 100);

/** "YYYY-MM-DD" of an ISO instant in the Mexico City calendar (business tz). */
function dateCdmx(iso: string): string {
  // en-CA yields ISO-like YYYY-MM-DD regardless of the runtime's locale.
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

function inPeriod(date: string, year: number, month: number): boolean {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return date.slice(0, 7) === prefix;
}

/**
 * Sale-side expenses of one month, by when the money was REGISTERED (review
 * #196 F4): expenses captured with the trip count in the purchase's month;
 * late adjustments count in their OWN month (`at`, converted to the Mexico
 * City calendar), because that is when the outlay actually happened for the
 * monthly close. The per-piece allocations are the SAME money spread over
 * pieces, so they are never added again here. Expenses moved to inventory
 * cost are excluded — they stopped being sale expenses.
 *
 * Identity is resolved BEFORE any period filter (review #196, round 2): each
 * expense id yields ONE canonical entry over all loaded records — the trip
 * registration wins over a legacy adjustment copy of the same id and keeps
 * the trip's date; a genuinely-new late adjustment keeps its own date. That
 * way a copy can never re-count in another month: October + its November
 * copy still total one $80, not $160.
 */
export function saleExpensePeriodTotals(
  purchases: Purchase[],
  year: number,
  month: number
): SaleExpensePeriodTotals {
  // Pass 1 — canonical identity per expense id, across ALL months.
  const canonical = new Map<string, SaleExpenseLine>();
  const record = (
    purchase: Purchase,
    date: string,
    category: PurchaseExpenseCategory,
    amountCents: number,
    id: string,
    description?: string
  ) => {
    if (canonical.has(id)) return; // "sin duplicar": one peso, one count, one month.
    canonical.set(id, { purchaseId: purchase.id, date, category, description, amountCents });
  };
  for (const purchase of purchases) {
    // Trip registrations first: an original wins over a same-id legacy copy.
    for (const expense of purchase.sourcingExpenses ?? []) {
      if (!isSaleExpense(expense)) continue;
      record(purchase, purchase.date, expense.category, cents(expense.amount), expense.id, expense.description);
    }
    for (const adjustment of purchase.saleCostAdjustments ?? []) {
      if (!SALE_EXPENSE_CATEGORIES.includes(adjustment.category)) continue;
      record(purchase, dateCdmx(adjustment.at), adjustment.category, cents(adjustment.amount), adjustment.id, adjustment.description);
    }
  }

  // Pass 2 — aggregate the CANONICAL set for the requested month.
  const byCategoryCents: Partial<Record<PurchaseExpenseCategory, number>> = {};
  const lines: SaleExpenseLine[] = [];
  let totalCents = 0;
  for (const line of canonical.values()) {
    if (!inPeriod(line.date, year, month)) continue;
    byCategoryCents[line.category] = (byCategoryCents[line.category] ?? 0) + line.amountCents;
    totalCents += line.amountCents;
    lines.push(line);
  }

  lines.sort((a, b) => a.date.localeCompare(b.date));
  return { year, month, byCategoryCents, totalCents, lines };
}

/** Ordered categories for display — always the three sale-side ones. */
export function saleExpenseCategoryRows(totals: SaleExpensePeriodTotals): {
  category: PurchaseExpenseCategory;
  label: string;
  amountCents: number;
}[] {
  return SALE_EXPENSE_CATEGORIES.map((category) => ({
    category,
    label: PURCHASE_EXPENSE_CATEGORY_LABEL[category],
    amountCents: totals.byCategoryCents[category] ?? 0,
  }));
}
