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
