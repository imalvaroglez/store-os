import { describe, expect, it } from "vitest";
import {
  incidentState,
  incidentsRefundPendingCents,
  incidentsSaleAdjustmentCents,
} from "./incidents";
import type { OrderIncident } from "../../types";

const ev = (kind: OrderIncident["events"][number]["kind"], id: string, detail?: Record<string, string | number>) => ({
  id, kind, at: `2026-11-0${id.length}T10:00:00Z`, by: "fer", ...(detail ? { detail } : {}),
});

const base = (extra: Partial<OrderIncident> = {}): OrderIncident => ({
  id: "inc1", productId: "p1", productName: "Anillo", quantity: 1,
  reason: "Piedra fallada", originalUnitPriceCents: 12000,
  events: [ev("opened", "e1")], ...extra,
});

describe("incidentState (hechos, no trámite)", () => {
  it("recién abierta: pieza con la clienta, sin resolución", () => {
    const state = incidentState(base());
    expect(state.opened).toBe(true);
    expect(state.resolution).toBeUndefined();
    expect(state.pieceLocation).toBe("with_customer");
    expect(state.confirmed).toBe(false);
  });

  it("resolución acordada sin confirmar sigue dejando la pieza con la clienta", () => {
    const state = incidentState(base({
      resolution: { kind: "replacement_equivalent" },
      events: [ev("opened", "e1"), ev("resolution_agreed", "e2")],
    }));
    expect(state.resolution?.kind).toBe("replacement_equivalent");
    expect(state.pieceLocation).toBe("with_customer");
    expect(state.confirmed).toBe(false);
  });

  it("confirmada: pieza dañada en cuarentena no vendible", () => {
    const state = incidentState(base({
      resolution: { kind: "replacement_equivalent" },
      events: [ev("opened", "e1"), ev("resolution_agreed", "e2"), ev("confirmed", "e33", { quarantined: 1, replacementOut: 1 })],
    }));
    expect(state.confirmed).toBe(true);
    expect(state.pieceLocation).toBe("quarantined");
    expect(state.quarantinedQuantity).toBe(1);
  });

  it("acciones posteriores: reparar NO libera; autorizar venta sí (r2)", () => {
    const repaired = incidentState(base({
      resolution: { kind: "replacement_equivalent" },
      events: [ev("opened", "e1"), ev("resolution_agreed", "e2"), ev("confirmed", "e33"), ev("repaired", "e4")],
    }));
    expect(repaired.pieceLocation).toBe("repaired_held");
    expect(repaired.quarantinedQuantity).toBeGreaterThan(0); // sigue retenida
    const released = incidentState(base({
      resolution: { kind: "replacement_equivalent" },
      events: [ev("opened", "e1"), ev("resolution_agreed", "e2"), ev("confirmed", "e33"), ev("repaired", "e4"), ev("returned_to_sale", "e5")],
    }));
    expect(released.pieceLocation).toBe("back_in_stock");
    const off = incidentState(base({
      resolution: { kind: "replacement_equivalent" },
      events: [ev("opened", "e1"), ev("resolution_agreed", "e2"), ev("confirmed", "e33"), ev("written_off", "e4")],
    }));
    expect(off.pieceLocation).toBe("written_off");
  });

  it("reparar no libera si antes no se confirmó la recepción", () => {
    const state = incidentState(base({ events: [ev("opened", "e1"), ev("repaired", "e2")] }));
    expect(state.pieceLocation).toBe("with_customer"); // el hecho no procedió
  });
});

describe("efectos de dinero derivados (#203 sin segundo saldo)", () => {
  const cents = (n: number) => n;

  it("reemplazo equivalente: cero ajuste a la venta", () => {
    const inc = base({ resolution: { kind: "replacement_equivalent" }, replacement: { productId: "p1", productName: "Anillo", unitPriceCents: cents(12000), unitCostCents: cents(5000), chargeDifference: false } });
    expect(incidentsSaleAdjustmentCents([inc])).toBe(0);
  });

  it("mejora $120 → $160 cobrando la diferencia: +$40 al total efectivo", () => {
    const inc = base({ resolution: { kind: "replacement_with_difference" }, replacement: { productId: "p2", productName: "Aro", unitPriceCents: cents(16000), unitCostCents: cents(6000), chargeDifference: true } });
    expect(incidentsSaleAdjustmentCents([inc])).toBe(4000);
  });

  it("mejora absorbida por la tienda: la venta no cambia", () => {
    const inc = base({ resolution: { kind: "replacement_with_difference" }, replacement: { productId: "p2", productName: "Aro", unitPriceCents: cents(16000), unitCostCents: cents(6000), chargeDifference: false } });
    expect(incidentsSaleAdjustmentCents([inc])).toBe(0);
  });

  it("cambio a menor precio $120 → $90: −$30 al total efectivo (excedente para la clienta)", () => {
    const inc = base({ resolution: { kind: "replacement_with_difference" }, replacement: { productId: "p2", productName: "Aro", unitPriceCents: cents(9000), unitCostCents: cents(4000), chargeDifference: true } });
    expect(incidentsSaleAdjustmentCents([inc])).toBe(-3000);
  });

  it("reembolso: −precio histórico de la pieza devuelta; el reembolso pendiente no es crédito", () => {
    // Pedido $300 (línea de $120 devuelta), pagado $200 → total efectivo $180.
    const inc = base({
      quantity: 1,
      resolution: { kind: "refund", refundUnitPriceCents: cents(12000) },
      events: [ev("opened", "e1"), ev("resolution_agreed", "e2")],
    });
    // Ajuste de venta: la pieza sale de la venta a su precio histórico.
    expect(incidentsSaleAdjustmentCents([inc])).toBe(-12000);
    // El reembolso pendiente bloquea ese excedente como crédito disponible.
    expect(incidentsRefundPendingCents([inc])).toBe(12000);
  });

  it("el reembolso ejecutado libera el bloqueo una sola vez", () => {
    const inc = base({
      resolution: { kind: "refund", refundUnitPriceCents: cents(12000) },
      events: [ev("opened", "e1"), ev("resolution_agreed", "e2"), ev("confirmed", "e33", { refundExecutedCents: cents(12000) })],
    });
    expect(incidentsRefundPendingCents([inc])).toBe(0);
  });

  it("incidencias sin resolución no mueven dinero", () => {
    expect(incidentsSaleAdjustmentCents([base()])).toBe(0);
    expect(incidentsRefundPendingCents([base()])).toBe(0);
  });
});
