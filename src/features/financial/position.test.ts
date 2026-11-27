import { describe, it, expect } from "vitest";
import { financialPosition, centsOf, positionOfStore } from "./position";
import type { PurchasePaymentMethod, OrderPayment, Purchase } from "../../types";

// #279 frente 1: posición financiera desde la activación (T0). Derivación
// pura en centavos exactos: nada anterior a T0 cuenta, el método se captura
// una sola vez en cada documento, y el pago de tarjeta reduce caja y adeudo
// sin duplicar gasto (prueba de aceptación 2 del contrato).

const T0 = "2026-11-01T00:00:00.000Z";
const NOV = (day: number) => `2026-11-${String(day).padStart(2, "0")}T12:00:00.000Z`;

const base = {
  activatedAt: T0,
  payments: [] as Array<{ date: string; amountCents: number }>,
  purchases: [] as Array<{ date: string; total: number; paymentMethod?: PurchasePaymentMethod }>,
  expenses: [] as Array<{ date: string; amount: number; paymentMethod?: PurchasePaymentMethod }>,
  cardPayments: [] as Array<{ date: string; amountCents: number }>,
};

describe("financialPosition — corte de activación", () => {
  it("los registros ANTERIORES a la activación no cuentan (caja, adeudo, salidas)", () => {
    const result = financialPosition({
      ...base,
      payments: [{ date: "2026-10-20", amountCents: 50000 }],
      purchases: [{ date: "2026-10-15", total: 30000, paymentMethod: "credit_card" }],
      expenses: [{ date: "2026-10-28", amount: 200, paymentMethod: "cash" }],
      cardPayments: [{ date: "2026-10-30", amountCents: 10000 }],
    });
    expect(result.registeredCashCents).toBe(0);
    expect(result.cardDebtCents).toBe(0);
    expect(result.notes.join(" ")).toMatch(/desde la activación/i);
  });

  it("los registros del MISMO instante de T0 sí cuentan", () => {
    const result = financialPosition({
      ...base,
      payments: [{ date: "2026-11-01", amountCents: 50000 }],
    });
    expect(result.registeredCashCents).toBe(50000);
  });
});

describe("financialPosition — captura única y métodos", () => {
  it("una compra a tarjeta suma adeudo y NO toca caja; el método viaja en el documento", () => {
    const result = financialPosition({
      ...base,
      purchases: [{ date: NOV(3), total: 1000, paymentMethod: "credit_card" }],
    });
    expect(result.cardDebtCents).toBe(100000);
    expect(result.registeredCashCents).toBe(0);
  });

  it("una compra pagada con dinero propio (efectivo/cuenta) resta caja y no crea adeudo", () => {
    const result = financialPosition({
      ...base,
      payments: [{ date: NOV(5), amountCents: 200000 }],
      purchases: [{ date: NOV(6), total: 500, paymentMethod: "cash" }],
      expenses: [{ date: NOV(7), amount: 100, paymentMethod: "account" }],
    });
    expect(result.registeredCashCents).toBe(200000 - 50000 - 10000);
    expect(result.cardDebtCents).toBe(0);
  });

  it("salidas SIN método quedan visibles como sin clasificar — ni caja ni adeudo", () => {
    const result = financialPosition({
      ...base,
      purchases: [{ date: NOV(3), total: 800 }],
    });
    expect(result.unclassifiedOutflowsCents).toBe(80000);
    expect(result.registeredCashCents).toBe(0);
    expect(result.cardDebtCents).toBe(0);
    expect(result.notes.join(" ")).toMatch(/sin método de pago/i);
  });

  it("un adelanto de tercero queda como adeudo con tercero, separado de la tarjeta", () => {
    const result = financialPosition({
      ...base,
      purchases: [{ date: NOV(3), total: 400, paymentMethod: "third_party_advance" }],
    });
    expect(result.thirdPartyDebtCents).toBe(40000);
    expect(result.cardDebtCents).toBe(0);
    expect(result.registeredCashCents).toBe(0);
  });
});

describe("financialPosition — pago de tarjeta (prueba de aceptación 2)", () => {
  it("compra $1,000 tarjeta + cobro $2,000 + pago $1,000: deuda $0, caja $1,000, sin segundo gasto", () => {
    const result = financialPosition({
      ...base,
      payments: [{ date: NOV(10), amountCents: 200000 }],
      purchases: [{ date: NOV(3), total: 1000, paymentMethod: "credit_card" }],
      cardPayments: [{ date: NOV(20), amountCents: 100000 }],
    });
    expect(result.cardDebtCents).toBe(0);
    // Cobro entró $2,000; la compra a tarjeta jamás tocó caja; el pago salió $1,000.
    expect(result.registeredCashCents).toBe(200000 - 100000);
    // Sin duplicación del gasto: el pago NO vuelve a aparecer como salida
    // clasificada ni como gasto — sólo como movimiento de la deuda.
    expect(result.unclassifiedOutflowsCents).toBe(0);
  });

  it("pago parcial de tarjeta: la deuda baja exactamente lo pagado", () => {
    const result = financialPosition({
      ...base,
      expenses: [{ date: NOV(2), amount: 300, paymentMethod: "credit_card" }],
      purchases: [{ date: NOV(3), total: 1000, paymentMethod: "credit_card" }],
      cardPayments: [{ date: NOV(20), amountCents: 50000 }],
    });
    expect(result.cardDebtCents).toBe(130000 - 50000);
    expect(result.registeredCashCents).toBe(-50000); // el pago salió de caja
  });

  it("sobre-pago de tarjeta no crea deuda negativa silenciosa", () => {
    const result = financialPosition({
      ...base,
      purchases: [{ date: NOV(3), total: 200, paymentMethod: "credit_card" }],
      cardPayments: [{ date: NOV(20), amountCents: 50000 }],
    });
    expect(result.cardDebtCents).toBe(0);
    expect(result.notes.join(" ")).toMatch(/pagó más tarjeta.*de lo adeudado|revisa los pagos registrados/i);
  });
});

describe("financialPosition — exactitud", () => {
  it("centavos exactos con pesos decimales; nunca NaN", () => {
    const result = financialPosition({
      ...base,
      expenses: [{ date: NOV(2), amount: 123.45, paymentMethod: "cash" }],
      payments: [{ date: NOV(3), amountCents: 99999 }],
      purchases: [{ date: NOV(4), total: 0.5, paymentMethod: "credit_card" }],
    });
    expect(result.registeredCashCents).toBe(99999 - 12345);
    expect(result.cardDebtCents).toBe(50);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it("centsOf redondea pesos decimales a centavos", () => {
    expect(centsOf(123.45)).toBe(12345);
    expect(centsOf(0.005)).toBe(1);
    expect(centsOf(undefined)).toBe(0);
  });
});


describe("positionOfStore — aislamiento por tienda (#279 QA MAYOR-1)", () => {
  const payment = (storeId: string, amount: number): OrderPayment => ({
    id: `p-${storeId}-${amount}`, orderId: `o-${storeId}`, storeId,
    date: "2026-11-05", method: "cash", kind: "payment",
    amount, createdAt: NOV(5), createdBy: "u1",
  });
  const purchase = (storeId: string): Purchase => ({
    id: `buy-${storeId}`, storeId, supplierName: "S",
    items: [], status: "received", totalConfirmed: 0,
    createdAt: "", updatedAt: "",
  } as unknown as Purchase);

  it("los cobros de OTRAS tiendas en la caché compartida no contaminan la caja", () => {
    const result = positionOfStore({
      activatedAt: T0,
      storeId: "store-a",
      payments: [payment("store-a", 2000), payment("store-b", 5000)], // pesos → 200000¢ / 500000¢
      purchases: [purchase("store-a")],
      expenses: [],
      cardPayments: [],
    });
    expect(result.registeredCashCents).toBe(200000);
  });
});

describe("#524 M3 — la caja incluye los cobros de puntos", () => {
  it("un cobro de punto cobrado suma a la caja en su fecha real y respeta la activación", () => {
    const position = financialPosition({
      activatedAt: "2026-11-01T00:00:00.000Z",
      payments: [],
      pointPayments: [{ date: "2026-12-03", amountCents: 40000 }],
      purchases: [], expenses: [], cardPayments: [],
    });
    expect(position.registeredCashCents).toBe(40000);
  });

  it("un cobro de punto ANTERIOR a la activación no cuenta; uno sin fecha tampoco", () => {
    const position = financialPosition({
      activatedAt: "2026-11-01T00:00:00.000Z",
      payments: [],
      pointPayments: [{ date: "2026-10-20", amountCents: 40000 }, { amountCents: 10000 }],
      purchases: [], expenses: [], cardPayments: [],
    });
    expect(position.registeredCashCents).toBe(0);
  });
});

describe("#558 — forma de pago por ticket de surtido", () => {
  const ticket = (total: number, paymentMethod?: PurchasePaymentMethod) => ({ total, paymentMethod });

  it("la prueba de aceptación: 3 tickets en efectivo y 1 a tarjeta — $730 propio y $450 de tarjeta, una sola vez", () => {
    const result = financialPosition({
      ...base,
      payments: [{ date: NOV(10), amountCents: 500000 }],
      purchases: [{
        date: NOV(12),
        total: 1180,
        paymentMethod: "cash", // histórico a nivel compra: los tickets mandan
        tickets: [ticket(180, "cash"), ticket(240, "cash"), ticket(310, "cash"), ticket(450, "credit_card")],
      }],
      expenses: [],
      cardPayments: [],
    });
    expect(result.registeredCashCents).toBe(500000 - 73000); // cobros − $730 propio
    expect(result.cardDebtCents).toBe(45000); // $450 a tarjeta, una sola vez
    expect(result.thirdPartyDebtCents).toBe(0);
    expect(result.unclassifiedOutflowsCents).toBe(0);
  });

  it("un ticket sin forma de pago queda pendiente de clasificar: ni caja ni adeudo, visible", () => {
    const result = financialPosition({
      ...base,
      purchases: [{
        date: NOV(12),
        total: 490,
        tickets: [ticket(180, "cash"), ticket(310)],
      }],
    });
    expect(result.registeredCashCents).toBe(-18000); // sólo el ticket clasificado sale de caja
    expect(result.cardDebtCents).toBe(0);
    expect(result.unclassifiedOutflowsCents).toBe(31000);
    expect(result.notes.join(" ")).toMatch(/salidas sin método de pago/);
  });

  it("sin evidencia por ticket se conserva la clasificación histórica a nivel compra y se identifica", () => {
    const result = financialPosition({
      ...base,
      purchases: [{ date: NOV(12), total: 400, paymentMethod: "credit_card" }],
    });
    expect(result.cardDebtCents).toBe(40000);
    expect(result.notes.join(" ")).toMatch(/con la forma de pago capturada para toda la compra/);
  });

  it("nunca cuenta a la vez lo clasificado por ticket y por compra: el total no se duplica", () => {
    const result = financialPosition({
      ...base,
      purchases: [{
        date: NOV(12),
        total: 620,
        paymentMethod: "cash",
        tickets: [ticket(620, "credit_card")],
      }],
    });
    expect(result.cardDebtCents).toBe(62000);
    expect(result.registeredCashCents).toBe(0); // el método a nivel compra NO vuelve a descontar
  });

  it("positionOfStore mapea los tickets de cada compra con su importe confirmado", () => {
    const purchase = {
      id: "p1", storeId: "s1", date: NOV(12), lines: [], subtotal: 0, totalConfirmed: 730,
      tickets: [
        { id: "t1", totalConfirmed: 180, paymentMethod: "cash" as const },
        { id: "t2", totalConfirmed: 550 },
      ],
    } as unknown as Purchase;
    const result = positionOfStore({
      activatedAt: T0,
      storeId: "s1",
      payments: [],
      purchases: [purchase],
      expenses: [],
      cardPayments: [],
    });
    expect(result.registeredCashCents).toBe(-18000);
    expect(result.unclassifiedOutflowsCents).toBe(55000);
  });
});
