import { describe, expect, it } from "vitest";
import {
  expenseAmountCents,
  assignedCents,
  pendingAssignmentCents,
  planAllocation,
  supplyUnitCostCents,
  supplyAvailableQuantity,
  supplyChargeCents,
} from "./expenses";
import type { LooseExpense } from "../types";

const expense = (extra: Partial<LooseExpense> = {}): LooseExpense => ({
  id: "e1", storeId: "s1", amount: 15, date: "2026-11-06", category: "operation",
  createdAt: "2026-11-06T10:00:00Z", updatedAt: "2026-11-06T10:00:00Z", ...extra,
});

const lines = [
  { lineId: "l1", quantity: 2, unitPriceCents: 10000 },
  { lineId: "l2", quantity: 3, unitPriceCents: 20000 },
];

describe("saldo pendiente de asignación (criterios 1 y 3)", () => {
  it("$15 sin asignar queda íntegro pendiente; el importe original se conserva", () => {
    const e = expense();
    expect(expenseAmountCents(e)).toBe(1500);
    expect(pendingAssignmentCents(e)).toBe(1500);
  });

  it("asignaciones + pendiente suman exactamente el importe; nunca se asigna por encima", () => {
    const e = expense({
      assignments: [
        { id: "a1", at: "", by: "fer", target: { kind: "purchase", purchaseId: "p1" }, mode: "units", amountCents: 1000 },
      ],
    });
    expect(assignedCents(e)).toBe(1000);
    expect(pendingAssignmentCents(e)).toBe(500);
    const over = expense({
      assignments: [
        { id: "a1", at: "", by: "fer", target: { kind: "purchase", purchaseId: "p1" }, mode: "units", amountCents: 2000 },
      ],
    });
    expect(assignedCents(over)).toBe(2000); // data integrity is validated on write
    expect(pendingAssignmentCents(over)).toBe(0); // derived, never negative
  });

  it("#214 F2: consumir un suministro DISTRIBUYE su importe — el pendiente baja y no se puede volver a asignar", () => {
    const bags = expense({
      amount: 15,
      category: "supplies",
      supply: { quantityInitial: 100, consumptions: [
        { id: "c1", at: "", by: "fer", quantity: 40 }, // 40 × $0.15 = $6.00 cargados
      ] },
    });
    expect(pendingAssignmentCents(bags)).toBe(900); // 1500 − 600 por consumos
    const all = expense({
      ...bags,
      supply: { quantityInitial: 100, consumptions: [
        { id: "c1", at: "", by: "fer", quantity: 40 },
        { id: "c2", at: "", by: "fer", quantity: 60 },
      ] },
    });
    expect(pendingAssignmentCents(all)).toBe(0); // consumido completo: nada pendiente
  });

  it("tratamiento simplificado (criterio 6): el importe completo queda reconocido, sin pendiente", () => {
    const e = expense({ category: "supplies", simplifiedOperation: true });
    expect(pendingAssignmentCents(e)).toBe(0);
  });
});

describe("plan de reparto (criterio 2: unidades por defecto, valor, manual)", () => {
  it("proporcional a unidades: 5 piezas → 2/5 y 3/5 exactos al centavo", () => {
    const plan = planAllocation(1500, lines, "units");
    expect(plan).toEqual([
      { lineId: "l1", amountCents: 600 },
      { lineId: "l2", amountCents: 900 },
    ]);
    expect(plan.reduce((sum, row) => sum + row.amountCents, 0)).toBe(1500);
  });

  it("proporcional al valor: $20k vs $60k de mercancía → 1/4 y 3/4", () => {
    const plan = planAllocation(1500, lines, "value");
    expect(plan).toEqual([
      { lineId: "l1", amountCents: 375 },
      { lineId: "l2", amountCents: 1125 },
    ]);
  });

  it("centavos indivisibles: el residuo va a la última línea y Σ es exacta", () => {
    const three = [
      { lineId: "a", quantity: 1, unitPriceCents: 100 },
      { lineId: "b", quantity: 1, unitPriceCents: 100 },
      { lineId: "c", quantity: 1, unitPriceCents: 100 },
    ];
    const plan = planAllocation(100, three, "units");
    expect(plan.reduce((sum, row) => sum + row.amountCents, 0)).toBe(100);
    expect(new Set(plan.map((row) => row.amountCents)).size).toBeLessThanOrEqual(2);
  });
});

describe("suministros (criterio 5: 100 bolsas por $15)", () => {
  const bags = expense({
    amount: 15,
    category: "supplies",
    supply: { quantityInitial: 100, consumptions: [] },
  });

  it("costo unitario exacto $0.15 y existencia disponible", () => {
    expect(supplyUnitCostCents(bags)).toBe(15);
    expect(supplyAvailableQuantity(bags)).toBe(100);
  });

  it("consumir una bolsa carga $0.15; el consumo baja la existencia", () => {
    const consumed = expense({
      ...bags,
      supply: { quantityInitial: 100, consumptions: [
        { id: "c1", at: "", by: "fer", quantity: 1, orderId: "o1" },
      ] },
    });
    expect(supplyChargeCents(consumed.supply!.consumptions[0], consumed)).toBe(15);
    expect(supplyAvailableQuantity(consumed)).toBe(99);
  });

  it("consumo nunca excede la existencia inicial", () => {
    const over = expense({
      ...bags,
      supply: { quantityInitial: 100, consumptions: [
        { id: "c1", at: "", by: "fer", quantity: 60 },
        { id: "c2", at: "", by: "fer", quantity: 60 },
      ] },
    });
    expect(supplyAvailableQuantity(over)).toBe(0);
  });

  it("100 bolsas por $15.50: unidad $0.15 y las primeras 50 unidades cargan un centavo más (conservación exacta)", () => {
    const odd = expense({ ...bags, amount: 15.5 });
    expect(supplyUnitCostCents(odd)).toBe(15); // piso; el residuo se reparte, no se redondea
    odd.supply!.consumptions = [{ id: "c1", at: "", by: "fer", quantity: 1, orderId: "o1" }];
    expect(supplyChargeCents(odd.supply!.consumptions[0], odd)).toBe(16); // primera unidad lleva el centavo extra
  });
});

describe("#214-corrección: conservación exacta del desembolso (residuo acumulativo)", () => {
  const bags = (amount: number): LooseExpense => expense({
    amount,
    category: "supplies",
    supply: { quantityInitial: 100, consumptions: [] },
  });
  const consumed = (base: LooseExpense, quantities: number[]): LooseExpense => ({
    ...base,
    supply: {
      quantityInitial: base.supply!.quantityInitial,
      consumptions: quantities.map((quantity, index) => ({ id: `c${index}`, at: "", by: "fer", quantity })),
    },
  });
  const totalCharged = (e: LooseExpense): number =>
    (e.supply?.consumptions ?? []).reduce((sum, consumption) => sum + supplyChargeCents(consumption, e), 0);

  it("100 bolsas por $15.50 consumidas TODAS JUNTAS cargan exactamente $15.50", () => {
    const e = consumed(bags(15.5), [100]);
    expect(totalCharged(e)).toBe(1550);
  });

  it("consumidas EN DOS TANDAS (60 + 40) suman exactamente $15.50", () => {
    const e = consumed(bags(15.5), [60, 40]);
    expect(totalCharged(e)).toBe(1550);
  });

  it("consumidas DE UNA EN UNA suman exactamente $15.50 (el residuo se reparte una sola vez)", () => {
    const e = consumed(bags(15.5), Array.from({ length: 100 }, () => 1));
    expect(totalCharged(e)).toBe(1550);
  });

  it("cantidad divisible (100 por $15) sigue exacta en cualquier patrón", () => {
    expect(totalCharged(consumed(bags(15), [100]))).toBe(1500);
    expect(totalCharged(consumed(bags(15), Array.from({ length: 100 }, () => 1)))).toBe(1500);
  });

  it("la primera unidad del caso no divisible carga el centavo extra y la última ya no", () => {
    const e = bags(15.5);
    expect(supplyChargeCents({ id: "x", at: "", by: "fer", quantity: 1 }, e)).toBe(16);
    const after50 = consumed(e, Array.from({ length: 50 }, () => 1));
    expect(supplyChargeCents({ id: "y", at: "", by: "fer", quantity: 1 }, after50)).toBe(15);
  });
});
