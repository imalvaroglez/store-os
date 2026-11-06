// Loose expenses (#184): the exact-money rules behind registration,
// classification, explicit assignment and gradual supply consumption.
// The issue is the contract (Decisión B ampliada, PO 2026-11-05): register a
// real outlay once, classify it, associate it later — the month never assigns
// destinations automatically. All arithmetic is exact cents; the pending
// balance and supply availability are DERIVED, never stored.
import type { LooseExpense, SupplyConsumption } from "../types";
import { orderAmountCents } from "./orderMoney";

/** The original amount in exact cents (never rewritten; evidence). */
export function expenseAmountCents(expense: LooseExpense): number {
  const cents = orderAmountCents(Math.max(0, expense.amount));
  return cents;
}

/** Σ assignment amounts in exact cents. */
export function assignedCents(expense: LooseExpense): number {
  return (expense.assignments ?? []).reduce((sum, assignment) => sum + (Number.isSafeInteger(assignment.amountCents) ? assignment.amountCents : 0), 0);
}

/**
 * Criterio 3: asignaciones + saldo pendiente suman exactamente el gasto;
 * never negative. A simplified-operation expense (criterio 6) is fully
 * recognized in its period — nothing pending.
 */
/** Σ consumption charges in exact cents — supplies distribute their amount
 * by being consumed, so consumptions ARE assignments for them (review F2). */
export function consumedCents(expense: LooseExpense): number {
  return (expense.supply?.consumptions ?? []).reduce((sum, consumption) => sum + supplyChargeCents(consumption, expense), 0);
}

export function pendingAssignmentCents(expense: LooseExpense): number {
  if (expense.simplifiedOperation) return 0;
  return Math.max(0, expenseAmountCents(expense) - assignedCents(expense) - consumedCents(expense));
}

/** A piece carrier for allocation planning (purchase lines or order items). */
export type AllocationLine = { lineId: string; quantity: number; unitPriceCents: number };

/**
 * Criterio 2: distribute `amountCents` across lines.
 * - "units" (default for homogeneous goods): proportional to piece counts.
 * - "value": proportional to merchandise value (Σ quantity × price).
 * Exact cents: remainders land on the LAST line so Σ is always exact.
 */
export function planAllocation(
  amountCents: number,
  lines: AllocationLine[],
  mode: "units" | "value"
): Array<{ lineId: string; amountCents: number }> {
  const total = Math.max(0, Math.round(amountCents));
  if (lines.length === 0 || total === 0) return [];
  const weights = lines.map((line) =>
    mode === "units"
      ? Math.max(1, Math.round(line.quantity))
      : Math.max(1, Math.round(line.quantity)) * Math.max(0, line.unitPriceCents)
  );
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return [{ lineId: lines[lines.length - 1].lineId, amountCents: total }];
  let distributed = 0;
  return lines.map((line, index) => {
    if (index === lines.length - 1) return { lineId: line.lineId, amountCents: total - distributed };
    const share = Math.floor((total * weights[index]) / weightTotal);
    distributed += share;
    return { lineId: line.lineId, amountCents: share };
  });
}

/** Supplies: conservative per-unit cost (rounds UP so a consumption never
 * undercharges); consuming the whole stash may slightly overcharge the last
 * units — the honest direction for money already spent. */
export function supplyUnitCostCents(expense: LooseExpense): number {
  const total = expenseAmountCents(expense);
  const quantity = Math.max(1, Math.round(expense.supply?.quantityInitial ?? 1));
  return Math.ceil(total / quantity);
}

/** Quantity still available (initial − Σ consumptions, floored at 0). */
export function supplyAvailableQuantity(expense: LooseExpense): number {
  const initial = Math.max(0, Math.round(expense.supply?.quantityInitial ?? 0));
  const consumed = (expense.supply?.consumptions ?? []).reduce((sum, consumption) => sum + Math.max(0, Math.round(consumption.quantity || 0)), 0);
  return Math.max(0, initial - consumed);
}

/** What one consumption charges (quantity × unit cost, exact cents). */
export function supplyChargeCents(consumption: SupplyConsumption, expense: LooseExpense): number {
  return supplyUnitCostCents(expense) * Math.max(0, Math.round(consumption.quantity || 0));
}
