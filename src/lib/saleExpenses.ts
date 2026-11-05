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
 * pieces, so they are never added again here; an expense id is counted once
 * even if a legacy copy appears in both places. Expenses moved to inventory
 * cost are excluded — they stopped being sale expenses.
 */
export function saleExpensePeriodTotals(
  purchases: Purchase[],
  year: number,
  month: number
): SaleExpensePeriodTotals {
  const byCategoryCents: Partial<Record<PurchaseExpenseCategory, number>> = {};
  const lines: SaleExpenseLine[] = [];
  const seen = new Set<string>();
  let totalCents = 0;

  const add = (
    purchase: Purchase,
    date: string,
    category: PurchaseExpenseCategory,
    amountCents: number,
    id: string,
    description?: string
  ) => {
    if (seen.has(id)) return; // "sin duplicar": one peso, one count.
    seen.add(id);
    byCategoryCents[category] = (byCategoryCents[category] ?? 0) + amountCents;
    totalCents += amountCents;
    lines.push({ purchaseId: purchase.id, date, category, description, amountCents });
  };

  for (const purchase of purchases) {
    for (const expense of purchase.sourcingExpenses ?? []) {
      if (!isSaleExpense(expense)) continue;
      if (!inPeriod(purchase.date, year, month)) continue;
      add(purchase, purchase.date, expense.category, cents(expense.amount), expense.id, expense.description);
    }
    for (const adjustment of purchase.saleCostAdjustments ?? []) {
      if (!SALE_EXPENSE_CATEGORIES.includes(adjustment.category)) continue;
      const registered = dateCdmx(adjustment.at);
      if (!inPeriod(registered, year, month)) continue;
      add(purchase, registered, adjustment.category, cents(adjustment.amount), adjustment.id, adjustment.description);
    }
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
