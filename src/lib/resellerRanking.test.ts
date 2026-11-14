import { describe, expect, it } from "vitest";
import { monthRanking, rankingMonthKey, type RankingInputs } from "./resellerRanking";
import type { Customer, Order } from "../types";

// FER-17 (#132): top 3 mensual de EMPRENDEDORAS — importe neto de productos
// EFECTIVAMENTE ENTREGADOS en el mes (precio real, devoluciones descontadas),
// por mes calendario CDMX. Participantes: SOLO Customer.segment ===
// "entrepreneur". Desempate: más piezas entregadas; empate persistente queda
// EMPATADO para que Fer lo resuelva (nunca un orden técnico).

const NOW = "2026-11-14T10:00:00.000Z";

const customer = (id: string, segment?: "entrepreneur"): Customer =>
  ({ id, storeId: "s1", name: id, ...(segment ? { segment } : {}), createdAt: NOW, updatedAt: NOW }) as Customer;

const deliveredOrder = (
  id: string,
  customerId: string,
  deliveredAt: string,
  lines: Array<{ productId: string; variantId?: string; quantity: number; unitPrice: number }>,
  extra: Partial<Order> = {}
): Order =>
  ({
    id,
    storeId: "s1",
    customerId,
    items: lines.map((line, i) => ({ lineId: `${id}_L${i}`, productName: `P${line.productId}`, ...line, subtotal: line.unitPrice * line.quantity })),
    deposit: 0,
    orderStatus: "delivered",
    paymentStatus: "paid",
    createdAt: NOW,
    updatedAt: NOW,
    deliveries: [{
      id: `${id}_d1`, orderId: id, storeId: "s1",
      deliveredAt, recordedAt: NOW, by: "u1",
      lines: lines.map((line) => ({ productId: line.productId, ...(line.variantId ? { variantId: line.variantId } : {}), quantity: line.quantity })),
    }],
    ...extra,
  }) as Order;

const inputs = (overrides: Partial<RankingInputs> = {}): RankingInputs => ({
  storeId: "s1",
  month: { year: 2026, month: 11 },
  orders: [],
  customers: [],
  ...overrides,
});

describe("monthRanking (FER-17 #132)", () => {
  it("ordena por importe neto entregado en el mes; solo emprendedoras participan", () => {
    const orders = [
      deliveredOrder("o1", "emp1", "2026-11-10", [{ productId: "p1", quantity: 2, unitPrice: 500 }]), // $1,000
      deliveredOrder("o2", "emp2", "2026-11-12", [{ productId: "p1", quantity: 3, unitPrice: 300 }]), // $900
      deliveredOrder("o3", "reg1", "2026-11-12", [{ productId: "p1", quantity: 9, unitPrice: 300 }]), // $2,700 pero NO emprendedora
    ];
    const rank = monthRanking(inputs({
      orders,
      customers: [customer("emp1", "entrepreneur"), customer("emp2", "entrepreneur"), customer("reg1")],
    }));
    expect(rank.entries.map((e) => e.customerId)).toEqual(["emp1", "emp2"]);
    expect(rank.entries[0]).toMatchObject({ customerId: "emp1", netCents: 100000, pieces: 2 });
    expect(rank.entries[1]).toMatchObject({ customerId: "emp2", netCents: 90000, pieces: 3 });
  });

  it("las entregas de OTROS meses no cuentan (mes calendario CDMX)", () => {
    const orders = [
      deliveredOrder("o-oct", "emp1", "2026-10-31", [{ productId: "p1", quantity: 5, unitPrice: 500 }]),
      deliveredOrder("o-nov", "emp1", "2026-11-01", [{ productId: "p1", quantity: 1, unitPrice: 200 }]),
    ];
    const rank = monthRanking(inputs({ orders, customers: [customer("emp1", "entrepreneur")] }));
    expect(rank.entries[0]).toMatchObject({ netCents: 20000, pieces: 1 });
  });

  it("una devolución confirmada del periodo descuenta la pieza a su precio real", () => {
    const order = deliveredOrder("o1", "emp1", "2026-11-10", [{ productId: "p1", quantity: 2, unitPrice: 400 }]); // $800
    order.incidents = [{
      id: "inc1", productId: "p1", productName: "P1", quantity: 1, reason: "falla",
      originalUnitPriceCents: 40000,
      resolution: { kind: "refund", destination: "refund_pending", saleAdjustmentUnitCents: 40000, refundOwedCents: 40000 },
      events: [
        { id: "e1", kind: "opened", at: NOW, by: "u1" },
        { id: "e2", kind: "resolution_agreed", at: NOW, by: "u1" },
        { id: "e3", kind: "confirmed", at: NOW, by: "u1" },
      ],
    }];
    const rank = monthRanking(inputs({ orders: [order], customers: [customer("emp1", "entrepreneur")] }));
    expect(rank.entries[0]).toMatchObject({ netCents: 40000, pieces: 1 }); // una devuelta, una entregada
  });

  it("desempate por más piezas entregadas en el periodo", () => {
    const orders = [
      deliveredOrder("o1", "empA", "2026-11-05", [{ productId: "p1", quantity: 1, unitPrice: 900 }]),   // $900, 1 pieza
      deliveredOrder("o2", "empB", "2026-11-06", [{ productId: "p1", quantity: 3, unitPrice: 300 }]),   // $900, 3 piezas
    ];
    const rank = monthRanking(inputs({ orders, customers: [customer("empA", "entrepreneur"), customer("empB", "entrepreneur")] }));
    expect(rank.entries.map((e) => e.customerId)).toEqual(["empB", "empA"]); // mismas ventas, más piezas primero
    expect(rank.entries.every((e) => e.tie === false)).toBe(true);
  });

  it("empate persistente (importe Y piezas) queda EMPATADO, sin orden técnico", () => {
    const orders = [
      deliveredOrder("o1", "empA", "2026-11-05", [{ productId: "p1", quantity: 2, unitPrice: 300 }]),
      deliveredOrder("o2", "empB", "2026-11-06", [{ productId: "p1", quantity: 2, unitPrice: 300 }]),
    ];
    const rank = monthRanking(inputs({ orders, customers: [customer("empA", "entrepreneur"), customer("empB", "entrepreneur")] }));
    expect(rank.entries.every((e) => e.tie === true)).toBe(true);
    expect(rank.needsManualResolution).toBe(true); // Fer decide y registra el motivo
  });

  it("entrega parcial cuenta solo las piezas entregadas, sin duplicar eventos repetidos", () => {
    const order = deliveredOrder("o1", "emp1", "2026-11-30", [{ productId: "p1", quantity: 1, unitPrice: 250 }]);
    order.deliveries = [
      { id: "d1", orderId: "o1", storeId: "s1", deliveredAt: "2026-11-30", recordedAt: NOW, by: "u1", lines: [{ productId: "p1", quantity: 1 }] },
      { id: "d1", orderId: "o1", storeId: "s1", deliveredAt: "2026-11-30", recordedAt: NOW, by: "u1", lines: [{ productId: "p1", quantity: 1 }] }, // reintento idéntico
      { id: "d2", orderId: "o1", storeId: "s1", deliveredAt: "2026-12-02", recordedAt: NOW, by: "u1", lines: [{ productId: "p1", quantity: 1 }] }, // diciembre
    ];
    const nov = monthRanking(inputs({ orders: [order], customers: [customer("emp1", "entrepreneur")] }));
    const dic = monthRanking(inputs({ month: { year: 2026, month: 12 }, orders: [order], customers: [customer("emp1", "entrepreneur")] }));
    expect(nov.entries[0]).toMatchObject({ netCents: 25000, pieces: 1 });
    expect(dic.entries[0]).toMatchObject({ netCents: 25000, pieces: 1 });
  });

  it("rankingMonthKey clava el mes CDMX de una fecha sin hora (día 1 = su mes)", () => {
    expect(rankingMonthKey("2026-11-01")).toBe("2026-11");
    expect(rankingMonthKey("2026-12-01T05:00:00.000Z")).toBe("2026-11"); // 23:00 CDMX del 30-nov
  });
});
