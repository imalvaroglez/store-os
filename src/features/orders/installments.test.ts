import { describe, expect, it } from "vitest";
import {
  INSTALLMENT_FREQUENCY_LABELS,
  installmentDueDate,
  installmentPlanView,
  sameInstallmentPlan,
  splitInstallmentCents,
  validateInstallmentPlanInput,
} from "./installments";
import type { Order, OrderPayment } from "../../types";

const order = (overrides: Partial<Order> = {}): Order => ({
  id: "o1",
  storeId: "s1",
  customerId: "c1",
  items: [{ lineId: "l1", productName: "Caja adviento", quantity: 1, unitPrice: 1800, subtotal: 1800 }],
  deposit: 0,
  orderStatus: "confirmed",
  paymentStatus: "unpaid",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

const plan = {
  count: 6,
  frequency: "monthly" as const,
  firstDueDate: "2026-11-15",
  agreedAt: "2026-11-01T00:00:00.000Z",
  agreedBy: "u1",
};

const payment = (id: string, amount: number, createdAt: string): OrderPayment => ({
  id,
  orderId: "o1",
  storeId: "s1",
  date: createdAt.slice(0, 10),
  method: "cash",
  kind: "payment",
  amount,
  createdAt,
  createdBy: "u1",
});

describe("exact-cents cuota split", () => {
  it("divides evenly with no remainder lost ($1,800 in 6 → six $300)", () => {
    expect(splitInstallmentCents(180000, 6)).toEqual([30000, 30000, 30000, 30000, 30000, 30000]);
  });

  it("assigns the division remainder explicitly to the earliest cuotas ($100 in 3)", () => {
    expect(splitInstallmentCents(10000, 3)).toEqual([3334, 3333, 3333]);
  });

  it("keeps a single cent exact even when cuotas outnumber cents", () => {
    expect(splitInstallmentCents(1, 3)).toEqual([1, 0, 0]);
  });

  it("always sums back to the total — no cent is lost to float math", () => {
    for (const totalCents of [7, 101, 999, 12345, 180001]) {
      for (const count of [1, 2, 3, 6, 7, 12]) {
        expect(splitInstallmentCents(totalCents, count).reduce((a, b) => a + b, 0)).toBe(totalCents);
      }
    }
  });

  it("rejects an invalid count without ever producing NaN", () => {
    for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => splitInstallmentCents(100, bad as number)).toThrow(RangeError);
    }
    expect(() => splitInstallmentCents(-1, 3)).toThrow(RangeError);
  });
});

describe("derived due dates", () => {
  it("weekly adds 7 days per cuota", () => {
    expect(installmentDueDate("2026-11-05", "weekly", 0)).toBe("2026-11-05");
    expect(installmentDueDate("2026-11-05", "weekly", 1)).toBe("2026-11-12");
    expect(installmentDueDate("2026-11-05", "weekly", 3)).toBe("2026-11-26");
  });

  it("biweekly (quincenal) adds 14 days per cuota", () => {
    expect(installmentDueDate("2026-11-05", "biweekly", 1)).toBe("2026-11-19");
    expect(installmentDueDate("2026-11-05", "biweekly", 2)).toBe("2026-12-03");
  });

  it("monthly keeps the day of month and clamps nonexistent dates to the month end", () => {
    expect(installmentDueDate("2027-01-31", "monthly", 1)).toBe("2027-02-28"); // 2027 not a leap year
    expect(installmentDueDate("2028-01-31", "monthly", 1)).toBe("2028-02-29"); // leap year
    expect(installmentDueDate("2026-12-31", "monthly", 1)).toBe("2027-01-31");
    expect(installmentDueDate("2026-10-31", "monthly", 2)).toBe("2026-12-31"); // nov 30 exists
    expect(installmentDueDate("2026-11-15", "monthly", 6)).toBe("2027-05-15");
  });
});

describe("plan input validation", () => {
  const valid = { countText: "6", frequency: "monthly", firstDueDate: "2026-11-15", totalCents: 180000 };

  it("accepts a valid agreement and normalizes the count", () => {
    expect(validateInstallmentPlanInput(valid)).toEqual({
      count: 6,
      frequency: "monthly",
      firstDueDate: "2026-11-15",
    });
  });

  it("rejects an invalid cuota count (no fixed default is invented)", () => {
    for (const bad of ["", "0", "-2", "2.5", "abc", "100"]) {
      expect(() => validateInstallmentPlanInput({ ...valid, countText: bad })).toThrow(/cuotas/i);
    }
  });

  it("rejects a missing frequency or date, and malformed dates", () => {
    expect(() => validateInstallmentPlanInput({ ...valid, frequency: "" })).toThrow(/frecuencia/i);
    expect(() => validateInstallmentPlanInput({ ...valid, firstDueDate: "" })).toThrow(/vencimiento/i);
    expect(() => validateInstallmentPlanInput({ ...valid, firstDueDate: "31-12-2026" })).toThrow(/vencimiento/i);
    expect(() => validateInstallmentPlanInput({ ...valid, firstDueDate: "2026-02-30" })).toThrow(/vencimiento/i);
  });

  it("rejects a plan over a zero-total order (nothing to divide)", () => {
    expect(() => validateInstallmentPlanInput({ ...valid, totalCents: 0 })).toThrow(/total/i);
  });
});

describe("installmentPlanView (schedule + coverage read model)", () => {
  it("derives the full schedule from the plan and the CURRENT total", () => {
    const view = installmentPlanView(order({ installments: plan }), [], "2026-11-01");
    expect(view?.cuotas).toHaveLength(6);
    expect(view?.cuotas[0]).toMatchObject({ dueDate: "2026-11-15", amountCents: 30000, coveredCents: 0 });
    expect(view?.lastDueDate).toBe("2027-04-15");
    expect(view?.totalCents).toBe(180000);
    expect(view?.coveredCount).toBe(0);
    expect(view?.reserved).toBe(false);
  });

  it("returns null for ordinary orders", () => {
    expect(installmentPlanView(order(), [])).toBeNull();
  });

  it("re-derives the amounts when the total changes post-agreement (evidence intact)", () => {
    const view = installmentPlanView(
      order({ installments: plan, items: [{ lineId: "l1", productName: "Caja", quantity: 1, unitPrice: 1200, subtotal: 1200 }] }),
      [],
      "2026-11-01"
    );
    expect(view?.totalCents).toBe(120000);
    expect(view?.cuotas.map((c) => c.amountCents)).toEqual([20000, 20000, 20000, 20000, 20000, 20000]);
  });

  it("covers the nearest-due cuota first and flows the leftover forward ($100 then $500)", () => {
    const first = installmentPlanView(order({ installments: plan }), [payment("p1", 100, "2026-11-02T12:00:00.000Z")], "2026-11-01");
    expect(first?.receivedCents).toBe(10000);
    expect(first?.balanceCents).toBe(170000); // $1,700
    expect(first?.coveredCount).toBe(0); // no cuota fully covered yet
    expect(first?.cuotas[0]).toMatchObject({ coveredCents: 10000, status: "partial" });

    const second = installmentPlanView(
      order({ installments: plan }),
      [payment("p1", 100, "2026-11-02T12:00:00.000Z"), payment("p2", 500, "2026-11-09T12:00:00.000Z")],
      "2026-11-01"
    );
    expect(second?.receivedCents).toBe(60000);
    expect(second?.balanceCents).toBe(120000); // $1,200
    expect(second?.coveredCount).toBe(2); // cuotas 1 y 2 cubiertas por el acumulado
    expect(second?.cuotas[0].status).toBe("covered");
    expect(second?.cuotas[1].status).toBe("covered");
    expect(second?.cuotas[2]).toMatchObject({ coveredCents: 0, status: "pending" });
  });

  it("two receipts never fake two covered cuotas when the money does not reach them", () => {
    // $100 + $150 = 2 recibos, pero ninguna cuota de $300 se cubre.
    const view = installmentPlanView(
      order({ installments: plan }),
      [payment("p1", 100, "2026-11-02T12:00:00.000Z"), payment("p2", 150, "2026-11-09T12:00:00.000Z")],
      "2026-11-01"
    );
    expect(view?.receivedCents).toBe(25000);
    expect(view?.coveredCount).toBe(0);
    expect(view?.cuotas[0].coveredCents).toBe(25000);
  });

  it("shows the illustrative case: 5 × $300 leaves $1,500 received / $300 owed", () => {
    const payments = [1, 2, 3, 4, 5].map((n) => payment(`p${n}`, 300, `2026-11-${String(n).padStart(2, "0")}T12:00:00.000Z`));
    const view = installmentPlanView(order({ installments: plan }), payments, "2026-11-01");
    expect(view?.receivedCents).toBe(150000);
    expect(view?.balanceCents).toBe(30000);
    expect(view?.coveredCount).toBe(5);
    expect(view?.deliveryBlocked).toBe(true);
  });

  it("marking the order reserved is reflected (the reservation itself lives on the order)", () => {
    const view = installmentPlanView(order({ installments: plan, installmentsReservedAt: "2026-11-02T10:00:00.000Z" }), [], "2026-11-01");
    expect(view?.reserved).toBe(true);
  });

  it("flags late cuotas informatively (no penalty fields exist)", () => {
    const view = installmentPlanView(
      order({ installments: { ...plan, firstDueDate: "2026-09-15", frequency: "monthly" } }),
      [],
      "2026-11-20"
    );
    expect(view?.lateCount).toBe(3); // sep 15, oct 15 y nov 15 vencidas y sin cubrir
    expect(view?.cuotas[0].late).toBe(true);
    expect(view?.cuotas[2].late).toBe(true);
    expect(view?.cuotas[3].late).toBe(false); // dic 15 aún no vence
  });

  it("a fully covered cuota is never late even if its date passed", () => {
    const payments = [1, 2, 3].map((n) => payment(`p${n}`, 300, `2026-09-${String(10 + n).padStart(2, "0")}T12:00:00.000Z`));
    const view = installmentPlanView(
      order({ installments: { ...plan, firstDueDate: "2026-09-15", frequency: "monthly" } }),
      payments,
      "2026-11-20"
    );
    expect(view?.lateCount).toBe(0); // 3 cuotas cubiertas, la 4ª vence dic 15
  });

  it("a refund (signed adjustment) reduces coverage without deleting evidence", () => {
    const payments = [
      payment("p1", 300, "2026-11-02T12:00:00.000Z"),
      { id: "a1", orderId: "o1", storeId: "s1", method: "unknown", kind: "adjustment", amount: -150, note: "Devolución", createdAt: "2026-11-03T12:00:00.000Z", createdBy: "u1" },
    ];
    const view = installmentPlanView(order({ installments: plan }), payments, "2026-11-01");
    expect(view?.receivedCents).toBe(15000);
    expect(view?.cuotas[0]).toMatchObject({ coveredCents: 15000, status: "partial" });
    expect(view?.coveredCount).toBe(0);
  });

  it("never counts another order's or store's payments", () => {
    const foreign: OrderPayment[] = [
      { ...payment("f1", 1800, "2026-11-02T12:00:00.000Z"), orderId: "o2" },
      { ...payment("f2", 1800, "2026-11-02T12:00:00.000Z"), storeId: "s2" },
    ];
    const view = installmentPlanView(order({ installments: plan }), foreign, "2026-11-01");
    expect(view?.receivedCents).toBe(0);
    expect(view?.deliveryBlocked).toBe(true);
  });
});

describe("delivery gate", () => {
  it("blocks the delivery confirmation while money is owed (issue case)", () => {
    const payments = [1, 2, 3, 4, 5].map((n) => payment(`p${n}`, 300, `2026-11-${String(n).padStart(2, "0")}T12:00:00.000Z`));
    const view = installmentPlanView(order({ installments: plan }), payments, "2026-11-01");
    expect(view?.deliveryBlocked).toBe(true);
  });

  it("liquidar habilita la entrega — but nothing auto-delivers", () => {
    const payments = [1, 2, 3, 4, 5, 6].map((n) => payment(`p${n}`, 300, `2026-11-${String(n).padStart(2, "0")}T12:00:00.000Z`));
    const owed = order({ installments: plan, orderStatus: "ready" });
    const view = installmentPlanView(owed, payments, "2026-11-01");
    expect(view?.balanceCents).toBe(0);
    expect(view?.deliveryBlocked).toBe(false);
    expect(owed.orderStatus).toBe("ready"); // liquidar alone changes no status
  });

  it("an ordinary order with balance keeps its current behavior (not blocked here)", () => {
    const view = installmentPlanView(order(), [payment("p1", 100, "2026-11-02T12:00:00.000Z")], "2026-11-01");
    expect(view).toBeNull(); // no plan → this gate does not apply
  });

  it("money in the customer's favor (negative balance) does not block", () => {
    const payments = [payment("p1", 1800, "2026-11-02T12:00:00.000Z"), payment("p2", 100, "2026-11-03T12:00:00.000Z")];
    const view = installmentPlanView(order({ installments: plan }), payments, "2026-11-01");
    expect(view?.balanceCents).toBe(-10000);
    expect(view?.deliveryBlocked).toBe(false);
  });
});

describe("plan equality (edit evidence)", () => {
  it("ignores who/when it was agreed, compares the agreement itself", () => {
    expect(sameInstallmentPlan(plan, { ...plan, agreedAt: "x", agreedBy: "other" })).toBe(true);
    expect(sameInstallmentPlan(plan, { ...plan, count: 5 })).toBe(false);
    expect(sameInstallmentPlan(plan, { ...plan, frequency: "weekly" })).toBe(false);
    expect(sameInstallmentPlan(plan, { ...plan, firstDueDate: "2026-11-16" })).toBe(false);
    expect(sameInstallmentPlan(undefined, undefined)).toBe(true);
    expect(sameInstallmentPlan(plan, undefined)).toBe(false);
  });
});

describe("frequency labels", () => {
  it("is fully in Spanish (Mexico)", () => {
    expect(INSTALLMENT_FREQUENCY_LABELS).toEqual({
      weekly: "Semanal",
      biweekly: "Quincenal",
      monthly: "Mensual",
    });
  });
});
