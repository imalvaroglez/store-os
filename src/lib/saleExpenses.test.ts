import { describe, it, expect } from "vitest";
import { saleExpensePeriodTotals, saleExpenseCategoryRows } from "./saleExpenses";
import type { Purchase } from "../types";

const purchase = (over: Partial<Purchase>): Purchase =>
  ({
    id: "p1",
    storeId: "store_olivia",
    date: "2026-11-04",
    lines: [],
    subtotal: 0,
    totalConfirmed: 0,
    createdAt: "2026-11-04T00:00:00.000Z",
    updatedAt: "2026-11-04T00:00:00.000Z",
    ...over,
  }) as Purchase;

describe("saleExpensePeriodTotals (#184)", () => {
  it("suma por categoría con centavos exactos y desglose rastreable", () => {
    const totals = saleExpensePeriodTotals(
      [
        purchase({
          sourcingExpenses: [
            { id: "e1", category: "customer_delivery", amount: 150.55, description: "Entrega Linda" },
            { id: "e2", category: "individual_packaging", amount: 49.45 },
          ],
        }),
      ],
      2026,
      11
    );
    expect(totals.byCategoryCents.customer_delivery).toBe(15055);
    expect(totals.byCategoryCents.individual_packaging).toBe(4945);
    expect(totals.totalCents).toBe(20000); // exacto al centavo, sin redondeo de pesos
    expect(totals.lines.map((l) => l.description ?? l.category)).toEqual(["Entrega Linda", "individual_packaging"]);
  });

  it("solo cuenta el periodo pedido (aislamiento por mes)", () => {
    const totals = saleExpensePeriodTotals(
      [
        purchase({ date: "2026-10-28", sourcingExpenses: [{ id: "e1", category: "customer_delivery", amount: 100 }] }),
        purchase({ date: "2026-11-04", sourcingExpenses: [{ id: "e2", category: "customer_delivery", amount: 50 }] }),
      ],
      2026,
      11
    );
    expect(totals.totalCents).toBe(5000);
    expect(totals.lines).toHaveLength(1);
  });

  it("incluye el gasto tardío una sola vez y nunca repite un id (sin duplicar)", () => {
    const totals = saleExpensePeriodTotals(
      [
        purchase({
          sourcingExpenses: [{ id: "e1", category: "shared_packaging", amount: 80 }],
          // Legacy copy of the same id plus a genuine late expense.
          saleCostAdjustments: [
            { id: "e1", at: "2026-11-05T00:00:00.000Z", category: "shared_packaging", amount: 80 },
            { id: "e9", at: "2026-11-05T00:00:00.000Z", category: "customer_delivery", amount: 20 },
          ],
        }),
      ],
      2026,
      11
    );
    expect(totals.totalCents).toBe(10000); // 80 + 20, el 80 duplicado no cuenta
    expect(totals.byCategoryCents.shared_packaging).toBe(8000);
    expect(totals.byCategoryCents.customer_delivery).toBe(2000);
  });

  it("excluye gastos de surtido y los movidos al costo de inventario", () => {
    const totals = saleExpensePeriodTotals(
      [
        purchase({
          sourcingExpenses: [
            { id: "e1", category: "sourcing_transport", amount: 300 },
            { id: "e2", category: "customer_delivery", amount: 40, includeInInventoryCost: true },
            { id: "e3", category: "individual_packaging", amount: 10 },
          ],
          saleCostAdjustments: [
            { id: "e4", at: "2026-11-05T00:00:00.000Z", category: "other", amount: 5 },
          ],
        }),
      ],
      2026,
      11
    );
    expect(totals.totalCents).toBe(1000);
    expect(totals.lines.map((l) => l.category)).toEqual(["individual_packaging"]);
  });

  it("un gasto tardío cuenta en el mes de su registro, no en el del viaje (review #196 F4)", () => {
    const trip = purchase({
      id: "p_oct",
      date: "2026-10-28",
      saleCostAdjustments: [
        // Registrado el 4 de noviembre al mediodía CDMX.
        { id: "late1", at: "2026-11-04T18:00:00.000Z", category: "customer_delivery", amount: 80 },
      ],
    });
    const november = saleExpensePeriodTotals([trip], 2026, 11);
    expect(november.totalCents).toBe(8000);
    expect(november.lines[0].date).toBe("2026-11-04");
    const october = saleExpensePeriodTotals([trip], 2026, 10);
    expect(october.totalCents).toBe(0); // el viaje de octubre no absorbe el desembolso de noviembre
  });

  it("convierte el instante al calendario de CDMX antes de agrupar", () => {
    // 2026-11-01T02:30Z son las 20:30 del 31 de octubre en CDMX.
    const trip = purchase({
      date: "2026-11-05",
      saleCostAdjustments: [
        { id: "tz1", at: "2026-11-01T02:30:00.000Z", category: "shared_packaging", amount: 40 },
      ],
    });
    expect(saleExpensePeriodTotals([trip], 2026, 10).totalCents).toBe(4000);
    expect(saleExpensePeriodTotals([trip], 2026, 11).totalCents).toBe(0);
  });

  it("una copia heredada del mismo id no vuelve a contar en otro mes (review ronda 2)", () => {
    // Reproducción del review: original de $80 en la compra de octubre y una
    // copia heredada del mismo id como ajuste de noviembre. Sin la identidad
    // canónica, octubre sumaba $80 y noviembre otros $80 ($160 por un solo gasto).
    const withCopy = purchase({
      id: "p_oct",
      date: "2026-10-28",
      sourcingExpenses: [{ id: "e1", category: "customer_delivery", amount: 80 }],
      saleCostAdjustments: [
        { id: "e1", at: "2026-11-04T18:00:00.000Z", category: "customer_delivery", amount: 80 },
      ],
    });
    expect(saleExpensePeriodTotals([withCopy], 2026, 10).totalCents).toBe(8000);
    expect(saleExpensePeriodTotals([withCopy], 2026, 11).totalCents).toBe(0);

    // Misma forma con la copia en OTRA compra: el resultado canónico no cambia,
    // en AMBAS permutaciones de carga (review ronda 3: si la compra de la copia
    // cargaba primero, ocupaba el id y movía los $80 a noviembre).
    const octoberTrip = purchase({ id: "p_oct2", date: "2026-10-20", sourcingExpenses: [{ id: "e1", category: "customer_delivery", amount: 80 }] });
    const novemberTrip = purchase({
      id: "p_nov2",
      date: "2026-11-04",
      saleCostAdjustments: [{ id: "e1", at: "2026-11-10T18:00:00.000Z", category: "customer_delivery", amount: 80 }],
    });
    for (const [label, order] of [["original→copia", [octoberTrip, novemberTrip]], ["copia→original", [novemberTrip, octoberTrip]]] as const) {
      expect(saleExpensePeriodTotals([...order], 2026, 10).totalCents, `${label}: octubre`).toBe(8000);
      expect(saleExpensePeriodTotals([...order], 2026, 11).totalCents, `${label}: noviembre`).toBe(0);
    }
  });

  it("un gasto tardío genuino (sin original) conserva su propio mes", () => {
    const trip = purchase({
      id: "p_late",
      date: "2026-10-28",
      saleCostAdjustments: [{ id: "e9", at: "2026-11-04T18:00:00.000Z", category: "customer_delivery", amount: 80 }],
    });
    expect(saleExpensePeriodTotals([trip], 2026, 11).totalCents).toBe(8000);
    expect(saleExpensePeriodTotals([trip], 2026, 10).totalCents).toBe(0);
  });

  it("mes sin gastos devuelve ceros y filas completas para la vista", () => {
    const totals = saleExpensePeriodTotals([], 2026, 11);
    expect(totals.totalCents).toBe(0);
    expect(totals.lines).toEqual([]);
    const rows = saleExpenseCategoryRows(totals);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.amountCents === 0)).toBe(true);
    expect(rows[0].label).toBe("Entrega a clienta");
  });
});
