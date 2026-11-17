import { describe, expect, it } from "vitest";
import { cdmxMonthKey, monthKeyOf, monthlyClose, type CloseInputs } from "./monthlyClose";
import type { LooseExpense, Order, OrderIncident, OrderPayment } from "../types";

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

describe("#456 — detalles trazables y conciliación", () => {
  const M = (y: number, m: number) => ({ year: y, month: m });

  // Fixture 1 (contrato): $500 entregado en diciembre con costo $200;
  // anticipo $150 en noviembre; liquidación $350 en enero.
  const fixtureOrder = (deliverMonth: string): Order => ({
    id: "order_nov", storeId: "s1", customerId: "c1",
    items: [{ lineId: "l1", productId: "p1", productName: "Collar", quantity: 1, unitPrice: 500, subtotal: 500, cost: 200 }],
    deposit: 0, orderStatus: "delivered", paymentStatus: "paid",
    createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-12-05T00:00:00.000Z",
    deliveries: [{ id: "d1", orderId: "order_nov", storeId: "s1", deliveredAt: `2026-${deliverMonth}-15`, recordedAt: "", by: "u1", lines: [{ productId: "p1", quantity: 1 }] }],
  } as unknown as Order);
  const pay = (id: string, date: string, amount: number): OrderPayment =>
    ({ id, orderId: "order_nov", storeId: "s1", date, method: "cash", kind: "payment", amount, createdAt: "", createdBy: "u1" });

  it("fixture 1: los detalles reparten las mismas cifras por mes — venta/costo en diciembre, cobro anticipado en noviembre", () => {
    const inputs = {
      storeId: "s1", month: M(2026, 12),
      orders: [fixtureOrder("12")],
      paymentsByOrder: { order_nov: [pay("a", "2026-11-20", 150), pay("b", "2027-01-10", 350)] },
      expenses: [],
    } as unknown as Parameters<typeof monthlyClose>[0];
    const dec = monthlyClose(inputs);
    expect(dec.salesCents).toBe(50000);
    expect(dec.costCents).toBe(20000);
    // Detalle de ventas: UNA fila con fecha efectiva, folio y producto.
    expect(dec.details.sales).toHaveLength(1);
    expect(dec.details.sales[0]).toMatchObject({ amountCents: 50000, date: "2026-12-15", productName: "Collar", reference: "#NOV" });
    expect(dec.details.costs[0]).toMatchObject({ amountCents: -20000, date: "2026-12-15" });
    // Noviembre: sin ventas NI costos; el anticipo SÍ es cobro del mes.
    const nov = monthlyClose({ ...inputs, month: M(2026, 11) });
    expect(nov.salesCents).toBe(0);
    expect(nov.costCents).toBe(0);
    expect(nov.collectionsCents).toBe(15000);
    expect(nov.details.sales).toHaveLength(0);
  });

  it("la suma del detalle == la cifra mostrada, por concepto (conciliación exacta en centavos)", () => {
    const inputs = {
      storeId: "s1", month: M(2026, 12),
      orders: [fixtureOrder("12")],
      paymentsByOrder: { order_nov: [pay("b", "2026-12-20", 350)] },
      expenses: [
        { id: "e1", storeId: "s1", amount: 100.5, date: "2026-12-02", category: "operation" },
        { id: "e2", storeId: "s1", amount: 50, date: "2026-12-03", category: "supplies" },
      ] as unknown as LooseExpense[],
    };
    const close = monthlyClose(inputs);
    expect(close.details.sales.reduce((s, d) => s + d.amountCents, 0)).toBe(close.salesCents);
    expect(close.details.costs.reduce((s, d) => s + d.amountCents, 0)).toBe(-close.costCents);
    expect(close.details.expenses.reduce((s, d) => s + d.amountCents, 0)).toBe(-close.expensesCents);
    expect(close.details.collections.reduce((s, d) => s + d.amountCents, 0)).toBe(close.collectionsCents);
    // Gastos: cada gasto UNA fila con concepto legible de su categoría.
    expect(close.details.expenses.map((e) => e.concept)).toEqual(["Operación", "Suministros"]);
  });

  it("cobros agrupados: anticipos / liquidaciones / pagos de ventas previas — los grupos reconcilian contra el total", () => {
    const inputs = {
      storeId: "s1", month: M(2026, 12),
      orders: [fixtureOrder("12")], // entrega 15-dic
      paymentsByOrder: {
        order_nov: [
          pay("ant", "2026-12-01", 150),  // antes de la entrega → anticipo
          pay("liq", "2026-12-20", 350),  // tras entrega del MISMO mes → liquidación
          pay("prev", "2027-01-10", 0),   // (fuera de este mes, no cuenta aquí)
        ],
      },
      expenses: [],
    } as unknown as Parameters<typeof monthlyClose>[0];
    const close = monthlyClose(inputs);
    const groups = Object.fromEntries(close.collectionGroups.map((g) => [g.group, g]));
    expect(groups.anticipos_del_mes.totalCents).toBe(15000);
    expect(groups.liquidaciones_del_mes.totalCents).toBe(35000);
    // Pago de venta previa: entrega en noviembre, cobro en diciembre.
    const prev = monthlyClose({
      ...inputs,
      orders: [fixtureOrder("11")],
      paymentsByOrder: { order_nov: [pay("prev", "2026-12-05", 300)] },
    });
    expect(prev.collectionGroups.find((g) => g.group === "pagos_de_ventas_previas")?.totalCents).toBe(30000);
    // Sin evidencia de entrega → origen pendiente de clasificar.
    const unlinked = monthlyClose({
      ...inputs, orders: [{
        id: "order_x", storeId: "s1", customerId: "c2", items: [], deposit: 0,
        orderStatus: "confirmed", paymentStatus: "partial", createdAt: "", updatedAt: "",
      } as unknown as Order],
      paymentsByOrder: { order_x: [pay("u", "2026-12-05", 100)] },
    });
    expect(unlinked.collectionGroups.find((g) => g.group === "sin_clasificar")?.totalCents).toBe(10000);
    // Conciliación de grupos en TODOS los casos.
    for (const c of [close, prev, unlinked]) {
      expect(c.collectionGroups.reduce((s, g) => s + g.totalCents, 0)).toBe(c.collectionsCents);
    }
  });

  it("cobro sin fecha queda FUERA del total y listado como excluido con causa explícita", () => {
    const close = monthlyClose({
      storeId: "s1", month: M(2026, 12),
      orders: [fixtureOrder("12")],
      paymentsByOrder: { order_nov: [pay("sfecha", "", 200)] },
      expenses: [],
    });
    expect(close.collectionsCents).toBe(0);
    expect(close.details.excludedCollections).toHaveLength(1);
    expect(close.details.excludedCollections[0]).toMatchObject({ amountCents: 20000, cause: "sin fecha verificable" });
  });

  it("fixture 4: una compra de inventario pagada con tarjeta no aparece como gasto NI resta dos veces", () => {
    // purchases NO son LooseExpense: jamás entran a gastos por construcción.
    // El pago con tarjeta del proveedor no es un cobro de clienta; el abono
    // posterior de la clienta SÍ es cobro — una sola vez.
    const close = monthlyClose({
      storeId: "s1", month: M(2026, 12),
      orders: [fixtureOrder("12")],
      paymentsByOrder: { order_nov: [pay("card", "2026-12-10", 300), pay("again", "2026-12-11", 0)] },
      expenses: [],
    });
    expect(close.expensesCents).toBe(0);
    expect(close.collectionsCents).toBe(30000); // solo el dinero real de clienta
  });

  it("fixture 5: suministro reconocido UNA vez (compra); el consumo no genera segunda fila", () => {
    const close = monthlyClose({
      storeId: "s1", month: M(2026, 12),
      orders: [fixtureOrder("12")],
      paymentsByOrder: {},
      expenses: [{
        id: "sup", storeId: "s1", amount: 15, date: "2026-12-01", category: "supplies",
        supply: { quantityInitial: 100, consumptions: [{ id: "c1", at: "2026-12-20", by: "u1", quantity: 3, orderId: "order_nov" }] },
      }] as unknown as LooseExpense[],
    });
    expect(close.expensesCents).toBe(1500); // $15 UNA vez
    expect(close.details.expenses).toHaveLength(1);
  });

  it("fixture 6: línea sin costo → la fila de costo NO existe (nunca $0 que infle margen) y el periodo queda marcado parcial", () => {
    const close = monthlyClose({
      storeId: "s1", month: M(2026, 12),
      orders: [{
        ...fixtureOrder("12"),
        items: [{ lineId: "l1", productId: "p1", productName: "Collar", quantity: 1, unitPrice: 500, subtotal: 500 }],
      }],
      paymentsByOrder: {}, expenses: [],
    });
    expect(close.salesCents).toBe(50000);
    expect(close.costCents).toBe(0);
    expect(close.details.costs).toHaveLength(0);
    expect(close.costCoverage.partialByMissingCost).toBe(true);
  });

  it("reintento del mismo evento de entrega aparece UNA sola vez en el detalle", () => {
    const order = fixtureOrder("12");
    order.deliveries = [...order.deliveries!, { ...order.deliveries![0] }]; // mismo id
    const close = monthlyClose({ storeId: "s1", month: M(2026, 12), orders: [order], paymentsByOrder: {}, expenses: [] });
    expect(close.details.sales).toHaveLength(1);
    expect(close.salesCents).toBe(50000);
  });

  it("aislamiento por tienda: los detalles de otra tienda no aparecen", () => {
    const foreign = { ...fixtureOrder("12"), storeId: "otra" };
    const close = monthlyClose({ storeId: "s1", month: M(2026, 12), orders: [foreign], paymentsByOrder: {}, expenses: [] });
    expect(close.details.sales).toHaveLength(0);
    expect(close.details.collections).toHaveLength(0);
  });
});

describe("#456 r2 — posventa confirmada ajusta el periodo", () => {
  const M = (y: number, m: number) => ({ year: y, month: m });
  const NOW2 = "2026-11-14T10:00:00.000Z";
  const baseOrder = (extra: Partial<Order> = {}): Order => ({
    id: "order_r", storeId: "s1", customerId: "c1",
    items: [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 300, subtotal: 300, cost: 100 }],
    deposit: 0, orderStatus: "delivered", paymentStatus: "paid",
    createdAt: NOW2, updatedAt: NOW2,
    deliveries: [{ id: "d1", orderId: "order_r", storeId: "s1", deliveredAt: "2026-11-10", recordedAt: NOW2, by: "u1", lines: [{ productId: "p1", quantity: 1 }] }],
    ...extra,
  } as unknown as Order);
  const refundIncident = (confirmedAt: string, unitCents = 30000): OrderIncident => ({
    id: "inc1", orderId: "order_r", storeId: "s1",
    productId: "p1", productName: "Aro", quantity: 1, reason: "defecto", originalUnitPriceCents: 30000,
    status: "resolved", createdAt: NOW2, createdBy: "u1",
    events: [{ id: "e1", kind: "confirmed", at: confirmedAt, by: "u1" }],
    resolution: { kind: "refund", saleAdjustmentUnitCents: unitCents, refundOwedCents: unitCents },
  } as unknown as OrderIncident);

  it("devolución confirmada en el mes: la venta revierte CON fila trazable y el costo se revierte si es conocido", () => {
    const close = monthlyClose({
      storeId: "s1", month: M(2026, 11),
      orders: [baseOrder({ incidents: [refundIncident("2026-11-20T12:00:00.000Z")] })],
      paymentsByOrder: {}, expenses: [],
    });
    expect(close.salesCents).toBe(0);   // 300 − 300 de devolución confirmada
    expect(close.costCents).toBe(0);    // la pieza vuelve al estante: costo reversible
    const refundRow = close.details.sales.find((row) => row.amountCents < 0);
    expect(refundRow).toMatchObject({ date: "2026-11-20", concept: /posventa|devoluci/i });
    const costRow = close.details.costs.find((row) => row.amountCents > 0);
    expect(costRow).toBeTruthy(); // reversión de costo trazable
  });

  it("devolución confirmada en OTRO mes: no toca este periodo", () => {
    const close = monthlyClose({
      storeId: "s1", month: M(2026, 11),
      orders: [baseOrder({ incidents: [refundIncident("2026-12-05T12:00:00.000Z")] })],
      paymentsByOrder: {}, expenses: [],
    });
    expect(close.salesCents).toBe(30000);
  });

  it("reembolso sin confirmar NO ajusta nada (comprometido ≠ confirmado)", () => {
    const pending = refundIncident("2026-11-20T12:00:00.000Z");
    delete (pending as { events?: unknown }).events;
    const close = monthlyClose({
      storeId: "s1", month: M(2026, 11),
      orders: [baseOrder({ incidents: [pending] })],
      paymentsByOrder: {}, expenses: [],
    });
    expect(close.salesCents).toBe(30000);
  });

  it("costo de la pieza devuelta desconocido: la venta revierte, el costo queda (conservador) y queda trazable", () => {
    const noCost = baseOrder({ incidents: [refundIncident("2026-11-20T12:00:00.000Z")] });
    noCost.items = [{ lineId: "l1", productId: "p1", productName: "Aro", quantity: 1, unitPrice: 300, subtotal: 300 }];
    const close = monthlyClose({
      storeId: "s1", month: M(2026, 11), orders: [noCost], paymentsByOrder: {}, expenses: [],
    });
    expect(close.salesCents).toBe(0);
    expect(close.costCents).toBe(0); // sin costo conocido originalmente, nada que revertir
    expect(close.details.sales.some((row) => row.amountCents < 0)).toBe(true);
  });
  it("el reembolso ejecutado resta del mes con fila y grupo propios", () => {
    const incident = refundIncident("2026-11-20T12:00:00.000Z", 18000);
    incident.events = [
      { id: "e1", kind: "resolution_agreed", at: "2026-11-19T12:00:00.000Z", by: "u1" },
      { id: "e2", kind: "confirmed", at: "2026-11-20T12:00:00.000Z", by: "u1", detail: { refundExecutedCents: 18000 } },
    ];
    const close = monthlyClose({ storeId: "s1", month: M(2026, 11), orders: [baseOrder({ incidents: [incident] })], paymentsByOrder: {}, expenses: [] });
    const outRow = close.details.collections.find((row) => row.concept === "Reembolso de posventa entregado");
    expect(outRow).toMatchObject({ amountCents: -18000, date: "2026-11-20" });
    const group = close.collectionGroups.find((g) => g.group === "reembolsos_posventa");
    expect(group).toMatchObject({ totalCents: -18000, count: 1 });
    expect(close.collectionsCents).toBe(-18000);
  });

  it("sin reembolso ejecutado no aparece la fila ni el grupo", () => {
    const incident = refundIncident("2026-11-20T12:00:00.000Z", 18000);
    // confirmada pero el dinero NO entregado (comprometido): sin salida.
    const close = monthlyClose({ storeId: "s1", month: M(2026, 11), orders: [baseOrder({ incidents: [incident] })], paymentsByOrder: {}, expenses: [] });
    expect(close.details.collections.find((row) => row.concept === "Reembolso de posventa entregado")).toBeUndefined();
    expect(close.collectionGroups.find((g) => g.group === "reembolsos_posventa")).toBeUndefined();
  });

  it("#458 r5: la ejecución TARDÍA resta del mes de ejecución, no del de confirmación", () => {
    // Confirmada 28-nov con la devolución pendiente; «Devolví el dinero» 3-dic.
    const incident = refundIncident("2026-11-28T12:00:00.000Z", 18000);
    incident.events = [
      { id: "e1", kind: "resolution_agreed", at: "2026-11-19T12:00:00.000Z", by: "u1" },
      { id: "e2", kind: "confirmed", at: "2026-11-28T12:00:00.000Z", by: "u1" },
      { id: "e3", kind: "refund_executed", at: "2026-12-03T12:00:00.000Z", by: "u1", detail: { refundExecutedCents: 18000 } },
    ];
    const nov = monthlyClose({ storeId: "s1", month: M(2026, 11), orders: [baseOrder({ incidents: [incident] })], paymentsByOrder: {}, expenses: [] });
    expect(nov.collectionsCents).toBe(0); // la salida NO pertenece a noviembre
    expect(nov.details.collections.find((row) => row.concept === "Reembolso de posventa entregado")).toBeUndefined();
    const dic = monthlyClose({ storeId: "s1", month: M(2026, 12), orders: [baseOrder({ incidents: [incident] })], paymentsByOrder: {}, expenses: [] });
    expect(dic.collectionsCents).toBe(-18000);
    expect(dic.details.collections.find((row) => row.concept === "Reembolso de posventa entregado")).toMatchObject({ amountCents: -18000, date: "2026-12-03" });
  });

  it("#458 r5: ejecuciones repartidas entre meses — cada salida en el suyo", () => {
    const incident = refundIncident("2026-11-20T12:00:00.000Z", 18000);
    incident.events = [
      { id: "e1", kind: "resolution_agreed", at: "2026-11-19T12:00:00.000Z", by: "u1" },
      { id: "e2", kind: "confirmed", at: "2026-11-20T12:00:00.000Z", by: "u1", detail: { refundExecutedCents: 10000 } },
      { id: "e3", kind: "refund_executed", at: "2026-12-05T12:00:00.000Z", by: "u1", detail: { refundExecutedCents: 8000 } },
    ];
    const nov = monthlyClose({ storeId: "s1", month: M(2026, 11), orders: [baseOrder({ incidents: [incident] })], paymentsByOrder: {}, expenses: [] });
    expect(nov.collectionsCents).toBe(-10000);
    const dic = monthlyClose({ storeId: "s1", month: M(2026, 12), orders: [baseOrder({ incidents: [incident] })], paymentsByOrder: {}, expenses: [] });
    expect(dic.collectionsCents).toBe(-8000);
  });

  it("#458 r5: borde CDMX — una ejecución tras la medianoche UTC pertenece al mes CDMX anterior", () => {
    // 2026-12-01T05:30Z = 2026-11-30 23:30 en CDMX: la salida es de NOVIEMBRE
    // y la fila muestra la fecha CDMX, no el corte UTC.
    const incident = refundIncident("2026-11-20T12:00:00.000Z", 18000);
    incident.events = [
      { id: "e1", kind: "resolution_agreed", at: "2026-11-19T12:00:00.000Z", by: "u1" },
      { id: "e2", kind: "confirmed", at: "2026-11-20T12:00:00.000Z", by: "u1" },
      { id: "e3", kind: "refund_executed", at: "2026-12-01T05:30:00.000Z", by: "u1", detail: { refundExecutedCents: 18000 } },
    ];
    const nov = monthlyClose({ storeId: "s1", month: M(2026, 11), orders: [baseOrder({ incidents: [incident] })], paymentsByOrder: {}, expenses: [] });
    const row = nov.details.collections.find((r) => r.concept === "Reembolso de posventa entregado");
    expect(row).toMatchObject({ amountCents: -18000, date: "2026-11-30" });
    const dic = monthlyClose({ storeId: "s1", month: M(2026, 12), orders: [baseOrder({ incidents: [incident] })], paymentsByOrder: {}, expenses: [] });
    expect(dic.details.collections.find((r) => r.concept === "Reembolso de posventa entregado")).toBeUndefined();
  });

});

describe("#458 r3 — cobros con ajustes correctivos", () => {
  const M = (y: number, m: number) => ({ year: y, month: m });
  const NOV = M(2026, 11);
  const baseOrder = (): Order => ({
    id: "order_adj", storeId: "s1", customerId: "c1",
    items: [], deposit: 0, orderStatus: "confirmed", paymentStatus: "partial",
    createdAt: "", updatedAt: "",
  } as unknown as Order);

  it("materialización + cobro + ajuste correctivo: el panel muestra el dinero REAL (caso de la operadora)", () => {
    // El caso reproducido por la revisión: cobro $1,500 + anticipo
    // materializado $1,500 (duplicado aparente) y su ajuste correctivo −$1,500.
    const close = monthlyClose({
      storeId: "s1", month: NOV,
      orders: [baseOrder()],
      paymentsByOrder: {
        order_adj: [
          { id: "p1", orderId: "order_adj", storeId: "s1", date: "2026-11-05", method: "cash", kind: "payment", amount: 1500, createdAt: "", createdBy: "u1" },
          { id: "inherited_deposit", orderId: "order_adj", storeId: "s1", date: "2026-11-05", method: "cash", kind: "payment", amount: 1500, createdAt: "", createdBy: "u1" },
          { id: "a1", orderId: "order_adj", storeId: "s1", date: "2026-11-06", method: "cash", kind: "adjustment", amount: -1500, createdAt: "", createdBy: "u1" },
        ],
      },
      expenses: [],
    });
    expect(close.collectionsCents).toBe(150000); // $1,500 reales, no $3,000
    const adjustmentRow = close.details.collections.find((row) => row.amountCents < 0);
    expect(adjustmentRow).toMatchObject({ concept: /Ajuste correctivo/ });
  });

  it("un ajuste de OTRO mes no toca este periodo", () => {
    const close = monthlyClose({
      storeId: "s1", month: NOV,
      orders: [baseOrder()],
      paymentsByOrder: {
        order_adj: [
          { id: "a2", orderId: "order_adj", storeId: "s1", date: "2026-12-02", method: "cash", kind: "adjustment", amount: -1500, createdAt: "", createdBy: "u1" },
        ],
      },
      expenses: [],
    });
    expect(close.collectionsCents).toBe(0);
  });
});
