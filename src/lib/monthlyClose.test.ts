import { describe, expect, it } from "vitest";
import { cdmxMonthKey, monthKeyOf, monthlyClose, type CloseInputs } from "./monthlyClose";
import type { LooseExpense, Order, OrderPayment } from "../types";

// #129 (etapa lista): vista previa de cierre mensual — solo lectura.
// Ventas/costos reconocidos por ENTREGAS verificables (#333), cobros por su
// fecha real, gastos una sola vez; todo por mes calendario CDMX en centavos.

const order = (overrides: Partial<Order> & { id: string }): Order => ({
  storeId: "s1",
  customerId: "c1",
  items: [],
  deposit: 0,
  orderStatus: "asked",
  paymentStatus: "unpaid",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const payment = (id: string, amount: number, date?: string): OrderPayment => ({
  id,
  orderId: "o1",
  storeId: "s1",
  method: "cash",
  kind: "payment",
  amount,
  ...(date ? { date } : {}),
  createdAt: `${date ?? "2026-11-01"}T10:00:00.000Z`,
  createdBy: "u1",
});

const inputs = (overrides: Partial<CloseInputs> = {}): CloseInputs => ({
  storeId: "s1",
  month: { year: 2026, month: 12 },
  orders: [],
  paymentsByOrder: {},
  expenses: [],
  ...overrides,
});

describe("cdmxMonthKey / monthKeyOf (#129)", () => {
  it("un timestamp cerca del cambio de mes se resuelve en la zona CDMX", () => {
    // 2026-12-01 05:00 UTC = 2026-11-30 23:00 en CDMX (UTC-6): mes de NOVIEMBRE.
    expect(cdmxMonthKey("2026-12-01T05:00:00.000Z")).toBe("2026-11");
    // 2026-12-01 07:00 UTC = 2026-12-01 01:00 CDMX: DICIEMBRE.
    expect(cdmxMonthKey("2026-12-01T07:00:00.000Z")).toBe("2026-12");
  });

  it("monthKeyOf formatea el mes consultado", () => {
    expect(monthKeyOf({ year: 2026, month: 12 })).toBe("2026-12");
    expect(monthKeyOf({ year: 2027, month: 1 })).toBe("2027-01");
  });
});

describe("monthlyClose (#129 etapa lista)", () => {
  it("el caso del contrato: $500 entregados en diciembre con costo $200; cobros en sus meses reales", () => {
    const o = order({
      id: "o1",
      orderStatus: "delivered",
      items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 500, subtotal: 500, cost: 200 }],
      deliveries: [{
        id: "d1", orderId: "o1", storeId: "s1",
        deliveredAt: "2026-12-10", recordedAt: "2026-12-10T12:00:00.000Z", by: "u1",
        lines: [{ productId: "p1", quantity: 1 }],
      }],
    });
    const dic = monthlyClose(inputs({ orders: [o], paymentsByOrder: { o1: [payment("pay_dic", 350, "2026-12-20")] } }));
    expect(dic.salesCents).toBe(50000);
    expect(dic.costCents).toBe(20000);
    expect(dic.grossMarginCents).toBe(30000);
    expect(dic.collectionsCents).toBe(35000);
    expect(dic.coverage.complete).toBe(true);

    // Noviembre: el anticipo de $150 es el único cobro; SIN ventas.
    const nov = monthlyClose(inputs({ month: { year: 2026, month: 11 }, orders: [o], paymentsByOrder: { o1: [payment("pay_nov", 150, "2026-11-15"), payment("pay_dic", 350, "2026-12-20")] } }));
    expect(nov.salesCents).toBe(0);
    expect(nov.collectionsCents).toBe(15000);

    // Enero: sin ventas ni cobros de este pedido.
    const ene = monthlyClose(inputs({ month: { year: 2027, month: 1 }, orders: [o], paymentsByOrder: { o1: [payment("pay_dic", 350, "2026-12-20")] } }));
    expect(ene.salesCents).toBe(0);
    expect(ene.collectionsCents).toBe(0);
  });

  it("el caso EXACTO del contrato: anticipo noviembre, entrega diciembre, cobro final enero", () => {
    const o = order({
      id: "o1",
      orderStatus: "delivered",
      items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 500, subtotal: 500, cost: 200 }],
      deliveries: [{
        id: "d1", orderId: "o1", storeId: "s1",
        deliveredAt: "2026-12-15", recordedAt: "2026-12-15T18:00:00.000Z", by: "u1",
        lines: [{ productId: "p1", quantity: 1 }],
      }],
    });
    const payments = {
      o1: [
        payment("pay_anticipo", 150, "2026-11-20"),
        payment("pay_final", 350, "2027-01-10"),
      ],
    };
    const nov = monthlyClose(inputs({ month: { year: 2026, month: 11 }, orders: [o], paymentsByOrder: payments }));
    const dic = monthlyClose(inputs({ month: { year: 2026, month: 12 }, orders: [o], paymentsByOrder: payments }));
    const ene = monthlyClose(inputs({ month: { year: 2027, month: 1 }, orders: [o], paymentsByOrder: payments }));
    // Noviembre: SOLO el anticipo como cobro; sin venta.
    expect(nov.salesCents).toBe(0);
    expect(nov.collectionsCents).toBe(15000);
    // Diciembre: la venta y su costo; sin cobros.
    expect(dic.salesCents).toBe(50000);
    expect(dic.costCents).toBe(20000);
    expect(dic.grossMarginCents).toBe(30000);
    expect(dic.collectionsCents).toBe(0);
    // Enero: el cobro final; sin venta nueva.
    expect(ene.salesCents).toBe(0);
    expect(ene.collectionsCents).toBe(35000);
    expect([nov.coverage.complete, dic.coverage.complete, ene.coverage.complete]).toEqual([true, true, true]);
  });

  it("entrega del día 1 con su fecha local: pertenece a ESE mes, no al anterior", () => {
    const o = order({
      id: "o_d1",
      orderStatus: "delivered",
      items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 100, subtotal: 100, cost: 40 }],
      deliveries: [{
        id: "d1", orderId: "o_d1", storeId: "s1",
        deliveredAt: "2026-12-01", recordedAt: "2026-12-02T04:30:00.000Z", by: "u1", // capturada después, fecha efectiva día 1
        lines: [{ productId: "p1", quantity: 1 }],
      }],
    });
    const dic = monthlyClose(inputs({ orders: [o] }));
    const nov = monthlyClose(inputs({ month: { year: 2026, month: 11 }, orders: [o] }));
    expect(dic.salesCents).toBe(10000);
    expect(nov.salesCents).toBe(0);
  });

  it("un abono registrado ANTES de la entrega es cobro de su mes; la venta espera a la entrega", () => {
    const o = order({
      id: "o_abono",
      orderStatus: "delivered",
      items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 400, subtotal: 400, cost: 100 }],
      deliveries: [{
        id: "d1", orderId: "o_abono", storeId: "s1",
        deliveredAt: "2026-12-20", recordedAt: "2026-12-20T18:00:00.000Z", by: "u1",
        lines: [{ productId: "p1", quantity: 1 }],
      }],
    });
    const payments = { o_abono: [payment("pay_abono", 200, "2026-11-05")] };
    const nov = monthlyClose(inputs({ month: { year: 2026, month: 11 }, orders: [o], paymentsByOrder: payments }));
    const dic = monthlyClose(inputs({ month: { year: 2026, month: 12 }, orders: [o], paymentsByOrder: payments }));
    expect(nov.collectionsCents).toBe(20000); // el abono, en su mes real
    expect(nov.salesCents).toBe(0);           // sin entrega aún
    expect(dic.salesCents).toBe(40000);       // la venta al entregar
    expect(dic.collectionsCents).toBe(0);     // el cobro no se repite
  });

  it("un anticipo SIN recibo queda «Fecha por confirmar», fuera de todos los totales", () => {
    const o = order({
      id: "o_dep",
      orderStatus: "asked",
      deposit: 150, // anticipo capturado en la ficha, sin registro de cobro
      items: [{ productId: "p1", productName: "Aro", quantity: 1, unitPrice: 500, subtotal: 500, cost: 200 }],
    });
    const res = monthlyClose(inputs({ month: { year: 2026, month: 11 }, orders: [o], paymentsByOrder: { o_dep: [] } }));
    expect(res.collectionsCents).toBe(0);
    expect(res.coverage.unconfirmedCollections).toHaveLength(1);
    expect(res.coverage.unconfirmedCollections[0]).toMatchObject({ amountCents: 15000, paymentId: "anticipo_sin_recibo" });
    expect(res.coverage.complete).toBe(false);
  });

  it("entrega parcial a fin de mes y el resto al siguiente: cada pieza UNA vez, evento repetido idempotente", () => {
    const o = order({
      id: "o2",
      orderStatus: "delivered",
      items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 2, unitPrice: 100, subtotal: 200, cost: 40 }],
      deliveries: [
        { id: "d1", orderId: "o2", storeId: "s1", deliveredAt: "2026-11-30", recordedAt: "2026-11-30T23:50:00.000Z", by: "u1", lines: [{ productId: "p1", quantity: 1 }] },
        { id: "d1", orderId: "o2", storeId: "s1", deliveredAt: "2026-11-30", recordedAt: "2026-11-30T23:50:00.000Z", by: "u1", lines: [{ productId: "p1", quantity: 1 }] }, // reintento: MISMO id
        { id: "d2", orderId: "o2", storeId: "s1", deliveredAt: "2026-12-02", recordedAt: "2026-12-02T12:00:00.000Z", by: "u1", lines: [{ productId: "p1", quantity: 1 }] },
      ],
    });
    const nov = monthlyClose(inputs({ month: { year: 2026, month: 11 }, orders: [o] }));
    const dic = monthlyClose(inputs({ month: { year: 2026, month: 12 }, orders: [o] }));
    expect(nov.salesCents).toBe(10000); // una sola pieza (el reintento no duplica)
    expect(dic.salesCents).toBe(10000); // la segunda pieza en diciembre
    expect(nov.costCents).toBe(4000);
    expect(dic.costCents).toBe(4000);
  });

  it("entregado SIN fecha verificable (legado) queda fuera de las ventas y visible en cobertura", () => {
    const legacy = order({ id: "o3", orderStatus: "delivered", items: [{ productName: "Aro", quantity: 1, unitPrice: 100, subtotal: 100 }] });
    const res = monthlyClose(inputs({ orders: [legacy] }));
    expect(res.salesCents).toBe(0);
    expect(res.coverage.deliveredWithoutDate).toHaveLength(1);
    expect(res.coverage.complete).toBe(false);
  });

  it("línea sin costo: la venta cuenta, el costo 0 y queda visible", () => {
    const o = order({
      id: "o4",
      orderStatus: "delivered",
      items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 300, subtotal: 300 }],
      deliveries: [{ id: "d1", orderId: "o4", storeId: "s1", deliveredAt: "2026-12-05", recordedAt: "2026-12-05T12:00:00.000Z", by: "u1", lines: [{ productId: "p1", quantity: 1 }] }],
    });
    const res = monthlyClose(inputs({ orders: [o] }));
    expect(res.salesCents).toBe(30000);
    expect(res.costCents).toBe(0);
    expect(res.coverage.linesWithoutCost).toHaveLength(1);
    expect(res.coverage.complete).toBe(false);
  });

  it("un gasto cuenta UNA vez por su fecha — su asignación a un pedido no lo duplica", () => {
    const expense = {
      id: "e1", storeId: "s1", amount: 33, date: "2026-12-03", category: "sale_delivery" as const,
      assignments: [{ id: "a1", at: "2026-12-03T10:00:00.000Z", by: "u1", amountCents: 3300, target: { kind: "order" as const, orderId: "o1" } }],
      createdAt: "2026-12-03T10:00:00.000Z", updatedAt: "2026-12-03T10:00:00.000Z",
    } as unknown as LooseExpense;
    const res = monthlyClose(inputs({ expenses: [expense] }));
    expect(res.expensesCents).toBe(3300); // una sola vez
    expect(res.operatingResultCents).toBe(-3300);
  });

  it("cobro heredado SIN fecha queda «Fecha por confirmar», fuera del total mensual", () => {
    const o = order({ id: "o5", orderStatus: "delivered", deposit: 150, paymentsReceivedCents: 15000, inheritedDepositMaterialized: true, items: [] });
    const res = monthlyClose(inputs({
      orders: [o],
      paymentsByOrder: { o5: [payment("inherited_deposit", 150)] }, // sin date
    }));
    expect(res.collectionsCents).toBe(0);
    expect(res.coverage.unconfirmedCollections).toHaveLength(1);
    expect(res.coverage.unconfirmedCollections[0].amountCents).toBe(15000);
    expect(res.coverage.complete).toBe(false);
  });

  it("solo la tienda consultada entra al cierre", () => {
    const ajena = order({
      id: "x1", storeId: "OTRA",
      orderStatus: "delivered",
      items: [{ productId: "p9", productName: "Ajena", quantity: 1, unitPrice: 999, subtotal: 999, cost: 1 }],
      deliveries: [{ id: "dx", orderId: "x1", storeId: "OTRA", deliveredAt: "2026-12-05", recordedAt: "2026-12-05T12:00:00.000Z", by: "u1", lines: [{ productId: "p9", quantity: 1 }] }],
    });
    const res = monthlyClose(inputs({ orders: [ajena] }));
    expect(res.salesCents).toBe(0);
    expect(res.coverage.complete).toBe(true);
  });

  it("resultado operativo del mes: ventas − costo − gastos", () => {
    const o = order({
      id: "o6",
      orderStatus: "delivered",
      items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 500, subtotal: 500, cost: 200 }],
      deliveries: [{ id: "d1", orderId: "o6", storeId: "s1", deliveredAt: "2026-12-10", recordedAt: "2026-12-10T12:00:00.000Z", by: "u1", lines: [{ productId: "p1", quantity: 1 }] }],
    });
    const expense = { id: "e1", storeId: "s1", amount: 50, date: "2026-12-11", category: "operation" as const, createdAt: "", updatedAt: "" } as unknown as LooseExpense;
    const res = monthlyClose(inputs({ orders: [o], expenses: [expense] }));
    expect(res.salesCents).toBe(50000);
    expect(res.costCents).toBe(20000);
    expect(res.expensesCents).toBe(5000);
    expect(res.grossMarginCents).toBe(30000);
    expect(res.operatingResultCents).toBe(25000);
  });
});
