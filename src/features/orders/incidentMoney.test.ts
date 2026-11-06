// @vitest-environment node
import { describe, expect, it } from "vitest";
import { reconcileIncidentMoney } from "./incidentMoney";
import type { Order, OrderIncident } from "../../types";

const order = (extra: Partial<Order> = {}): Order => ({
  id: "o1", storeId: "s1", customerId: "c1",
  items: [{ lineId: "l0", productName: "Pieza", quantity: 1, unitPrice: 300, subtotal: 300 }],
  deposit: 0, orderStatus: "delivered", paymentStatus: "paid",
  createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", ...extra,
} as Order);

const draft = (extra: Partial<OrderIncident> = {}): OrderIncident => ({
  id: "inc1", productId: "p1", productName: "Pieza", quantity: 1,
  reason: "Defecto", originalUnitPriceCents: 12000,
  events: [{ id: "e1", kind: "opened", at: "2026-11-02T10:00:00Z", by: "fer" }],
  ...extra,
});

describe("reconcileIncidentMoney — ejemplos literales de #203 (r2-criterio 2)", () => {
  it("venta $300, pagado $200, devolución de pieza $120: ajuste −$120, reembolso $20", () => {
    // Pieza de $120 dentro de una venta de $300; pagados $200.
    const o = order({ paymentsReceivedCents: 20000, inheritedDepositMaterialized: true,
      items: [{ lineId: "l0", productName: "A", quantity: 1, unitPrice: 180, subtotal: 180 },
              { lineId: "l1", productName: "Pieza", quantity: 1, unitPrice: 120, subtotal: 120 }] });
    const d = draft({ originalUnitPriceCents: 12000, lineId: "l1", resolution: { kind: "refund" } });
    const r = reconcileIncidentMoney(o, d);
    expect(r.saleAdjustmentCents).toBe(-12000);
    expect(r.reconciledCents).toBe(2000); // 200 − 180 de venta ajustada
    expect(r.restitutionCents).toBe(0);
    expect(r.refundOwedCents("refund_pending")).toBe(2000);
  });

  it("totalmente pagada: devolución de pieza $120 → reembolso $120 completo", () => {
    const o = order({ paymentsReceivedCents: 30000, inheritedDepositMaterialized: true });
    const d0 = draft({ resolution: { kind: "refund" } });
    const r = reconcileIncidentMoney(o, d0);
    expect(r.reconciledCents).toBe(12000);
    expect(r.refundOwedCents("refund_pending")).toBe(12000);
  });

  it("pago parcial $100 de $300: la devolución sólo reduce deuda (reembolso $0)", () => {
    const o = order({ paymentsReceivedCents: 10000, inheritedDepositMaterialized: true });
    const d1 = draft({ resolution: { kind: "refund" } });
    const r = reconcileIncidentMoney(o, d1);
    expect(r.saleAdjustmentCents).toBe(-12000);
    expect(r.reconciledCents).toBe(0);
    expect(r.refundOwedCents("refund_pending")).toBe(0);
  });

  it("cambio a pieza más barata ($120 → $90, totalmente pagada): diferencia $30", () => {
    const o = order({ items: [{ lineId: "l0", productName: "Pieza", quantity: 1, unitPrice: 120, subtotal: 120 }],
      paymentsReceivedCents: 12000, inheritedDepositMaterialized: true });
    const d = draft({ resolution: { kind: "replacement_with_difference" },
      replacement: { productId: "p2", productName: "Aro", unitPriceCents: 9000, unitCostCents: 4000, chargeDifference: true } });
    const r = reconcileIncidentMoney(o, d);
    expect(r.saleAdjustmentCents).toBe(-3000); // −30, no −120 (r2-criterio 2)
    expect(r.reconciledCents).toBe(3000);
    expect(r.refundOwedCents("refund_pending")).toBe(3000);
    expect(r.refundOwedCents("credit_accepted")).toBe(0);
  });

  it("cambio a menor precio con pago parcial que sólo reduce deuda: diferencia $0", () => {
    const o = order({ items: [{ lineId: "l0", productName: "Pieza", quantity: 1, unitPrice: 120, subtotal: 120 }],
      paymentsReceivedCents: 6000, inheritedDepositMaterialized: true });
    const d = draft({ resolution: { kind: "replacement_with_difference" },
      replacement: { productId: "p2", productName: "Aro", unitPriceCents: 9000, unitCostCents: 4000, chargeDifference: true } });
    const r = reconcileIncidentMoney(o, d);
    expect(r.reconciledCents).toBe(0); // 60 pagados, venta efectiva 90 → sigue debiendo
    expect(r.refundOwedCents("refund_pending")).toBe(0);
  });
});

describe("reconcileIncidentMoney — crédito aplicado y compensado (r2-criterio 1)", () => {
  it("pedido de $120 cubierto INTEGRAMENTE con crédito; devolución completa: se restituye el crédito, sin efectivo", () => {
    const o = order({ items: [{ lineId: "l0", productName: "Pieza", quantity: 1, unitPrice: 120, subtotal: 120 }],
      paymentsReceivedCents: 0, inheritedDepositMaterialized: true,
      creditAppliedCents: 12000 });
    const dc = draft({ originalUnitPriceCents: 12000, lineId: "l0", resolution: { kind: "refund" } });
    const r = reconcileIncidentMoney(o, dc);
    expect(r.reconciledCents).toBe(12000);            // el valor vuelve a la clienta…
    expect(r.restitutionCents).toBe(12000);           // …vía restitución del crédito a su origen
    expect(r.refundOwedCents("refund_pending")).toBe(0);  // sin salida de caja inventada
    expect(r.refundOwedCents("credit_accepted")).toBe(0);
  });

  it("mixto: $50 efectivo + $70 crédito en pedido $120; devolución completa con reembolso", () => {
    const o = order({ items: [{ lineId: "l0", productName: "Pieza", quantity: 1, unitPrice: 120, subtotal: 120 }],
      paymentsReceivedCents: 5000, inheritedDepositMaterialized: true,
      creditAppliedCents: 7000 });
    const dm = draft({ originalUnitPriceCents: 12000, lineId: "l0", resolution: { kind: "refund" } });
    const r = reconcileIncidentMoney(o, dm);
    expect(r.restitutionCents).toBe(7000);            // el crédito regresa a su origen
    expect(r.refundOwedCents("refund_pending")).toBe(5000); // sólo el efectivo sale en caja
  });

  it("excedente ya compensado a pedidos hermanos reduce lo disponible, no el valor de la pieza", () => {
    // Pieza $120 totalmente pagada + sobreprecio de $30 del que $15 ya se usó
    // en otro pedido: la devolución debe los $120 de la pieza (los otros $15
    // ya le dieron valor); el consumo se refleja en el origen, no aquí.
    const o = order({ items: [{ lineId: "l0", productName: "Pieza", quantity: 1, unitPrice: 120, subtotal: 120 }],
      paymentsReceivedCents: 15000, inheritedDepositMaterialized: true });
    const de = draft({ lineId: "l0", originalUnitPriceCents: 12000, resolution: { kind: "refund" } });
    const r = reconcileIncidentMoney(o, de);
    expect(r.reconciledCents).toBe(12000);
    expect(r.refundOwedCents("refund_pending")).toBe(12000);
  });

  it("otra incidencia con reembolso ya comprometido no se compromete dos veces", () => {
    const other: OrderIncident = { ...draft({ id: "inc0", lineId: "l1" }),
      resolution: { kind: "refund", refundOwedCents: 12000, saleAdjustmentUnitCents: 12000 } };
    const o = order({ paymentsReceivedCents: 30000, inheritedDepositMaterialized: true,
      items: [{ lineId: "l0", productName: "A", quantity: 1, unitPrice: 180, subtotal: 180 },
              { lineId: "l1", productName: "B", quantity: 1, unitPrice: 120, subtotal: 120 }],
      incidents: [other] });
    const d = draft({ id: "inc1", lineId: "l0", originalUnitPriceCents: 18000, resolution: { kind: "refund" } });
    const r = reconcileIncidentMoney(o, d);
    // Recibidos $300, ambas piezas devueltas: esta puede comprometer hasta
    // $180 (la otra ya comprometió $120; total $300 exacto, sin doble uso).
    expect(r.reconciledCents).toBe(18000);
  });
});
