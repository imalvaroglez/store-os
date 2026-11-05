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
  /** Purchase date (ISO) — the trip is the accounting unit of the expense. */
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

function inPeriod(date: string, year: number, month: number): boolean {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return date.slice(0, 7) === prefix;
}

/**
 * Sale-side expenses of one month: the amounts REGISTERED with each purchase
 * (plus late ones recorded after reception — immutable, real money out). The
 * per-piece allocations are the SAME money spread over pieces, so they are
 * never added again here; an expense id is counted once even if a legacy copy
 * appears in both places. Expenses moved to inventory cost are excluded — they
 * stopped being sale expenses.
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
    category: PurchaseExpenseCategory,
    amountCents: number,
    id: string,
    description?: string
  ) => {
    if (seen.has(id)) return; // "sin duplicar": one peso, one count.
    seen.add(id);
    byCategoryCents[category] = (byCategoryCents[category] ?? 0) + amountCents;
    totalCents += amountCents;
    lines.push({
      purchaseId: purchase.id,
      date: purchase.date,
      category,
      description,
      amountCents,
    });
  };

  for (const purchase of purchases) {
    if (!inPeriod(purchase.date, year, month)) continue;
    for (const expense of purchase.sourcingExpenses ?? []) {
      if (!isSaleExpense(expense)) continue;
      add(purchase, expense.category, cents(expense.amount), expense.id, expense.description);
    }
    for (const adjustment of purchase.saleCostAdjustments ?? []) {
      if (!SALE_EXPENSE_CATEGORIES.includes(adjustment.category)) continue;
      add(purchase, adjustment.category, cents(adjustment.amount), adjustment.id, adjustment.description);
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
