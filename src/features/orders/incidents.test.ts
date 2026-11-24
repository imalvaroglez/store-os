import { describe, expect, it } from "vitest";
import {
  agreedSolutionStuckReason,
  incidentEvidenceError,
  incidentState,
  incidentsRefundPendingCents,
  incidentsSaleAdjustmentCents,
} from "./incidents";
import type { OrderIncident, Product } from "../../types";

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

// ── #368: la línea que sostiene una incidencia es evidencia, no editable ────
describe("incidentEvidenceError (#368)", () => {
  const prevItems = [{ lineId: "l1", productId: "p1", productName: "Aro Sol", quantity: 2, unitPrice: 1000, subtotal: 2000 }];
  const withIncident = {
    items: prevItems,
    incidents: [base({ lineId: "l1", quantity: 1, originalUnitPriceCents: 100000 })],
  } as any;

  it("sin incidencias no restringe nada", () => {
    expect(incidentEvidenceError({ items: prevItems } as any, [])).toBeNull();
    expect(incidentEvidenceError(undefined, [])).toBeNull();
  });

  it("rechaza quitar la línea que sostiene la incidencia", () => {
    expect(incidentEvidenceError(withIncident, [])).toMatch(/incidencia.*no se puede quitar|no se puede quitar.*incidencia/is);
  });

  it("rechaza reducir la cantidad de esa línea (la pieza devuelta ya salió por la incidencia)", () => {
    const next = [{ ...prevItems[0], quantity: 1 }];
    expect(incidentEvidenceError(withIncident, next)).toMatch(/cantidad/);
  });

  it("rechaza cambiar el precio de esa línea", () => {
    const next = [{ ...prevItems[0], unitPrice: 900, subtotal: 1800 }];
    expect(incidentEvidenceError(withIncident, next)).toMatch(/precio/);
  });

  it("rechaza cambiar la pieza de esa línea (misma línea, otra ficha/color)", () => {
    const next = [{ ...prevItems[0], productId: "p2", productName: "Otra" }];
    expect(incidentEvidenceError(withIncident, next)).toMatch(/pieza|ficha|color/);
  });

  it("permite la edición cuando la línea queda intacta (nota, otras líneas)", () => {
    expect(incidentEvidenceError(withIncident, prevItems)).toBeNull();
    const withNote = [...prevItems, { lineId: "l2", productId: "p9", productName: "Otra pieza", quantity: 1, unitPrice: 10, subtotal: 10 }];
    expect(incidentEvidenceError(withIncident, withNote)).toBeNull();
  });

  it("legado sin lineId: empareja por ficha y color exactos", () => {
    const legacy = {
      items: [{ lineId: "old", productId: "p1", variantId: "v1", productName: "Aro Sol", quantity: 1, unitPrice: 1000, subtotal: 1000 }],
      incidents: [base({ quantity: 1, originalUnitPriceCents: 100000, variantId: "v1", variantColor: "Dorado" })],
    } as any;
    expect(incidentEvidenceError(legacy, [])).toMatch(/no se puede quitar/);
    const intact = [{ lineId: "old", productId: "p1", variantId: "v1", productName: "Aro Sol", quantity: 1, unitPrice: 1000, subtotal: 1000 }];
    expect(incidentEvidenceError(legacy, intact)).toBeNull();
    // otra variedad de la misma ficha NO sostiene la incidencia
    const otherColor = [{ lineId: "old", productId: "p1", variantId: "v2", productName: "Aro Sol", quantity: 1, unitPrice: 1000, subtotal: 1000 }];
    expect(incidentEvidenceError(legacy, otherColor)).toBeTruthy();
  });
});

// #461: la evidencia de una incidencia es la COMBINACIÓN exacta (ficha, color
// y talla) — cambiar la talla de esa línea también la desvirtúa.
describe("incidentEvidenceError por talla (#461)", () => {
  const prevItems = [{ lineId: "l1", productId: "p1", variantId: "v_gold", variantSizeId: "d6", productName: "Aro Sol", quantity: 2, unitPrice: 1000, subtotal: 2000 }];
  const withIncident = {
    items: prevItems,
    incidents: [base({ lineId: "l1", quantity: 1, originalUnitPriceCents: 100000, variantId: "v_gold", variantSizeId: "d6" })],
  } as any;

  it("rechaza cambiar la talla de la línea que sostiene la incidencia (mismo color, otra talla)", () => {
    expect(incidentEvidenceError(withIncident, [{ ...prevItems[0], variantSizeId: "d5" }])).toMatch(/pieza|ficha|color|talla/);
  });

  it("la línea intacta (misma talla) no restringe la edición", () => {
    expect(incidentEvidenceError(withIncident, prevItems)).toBeNull();
  });
});

// #461 (revisión de código 23-nov): la pieza que una solución ACORDADA iba a
// entregar puede volverse imposible si la ficha cambia después del acuerdo.
// El sistema debe decirlo y dejar acordar de nuevo, nunca confirmar a ciegas.
describe("agreedSolutionStuckReason (#461)", () => {
  const design = {
    id: "p-sol", storeId: "s1",
    variants: [{ id: "v_gold", color: "Dorado", createdAt: "", updatedAt: "", sizes: [{ id: "d6", size: "6", createdAt: "", updatedAt: "" }] }],
  } as never as Product;
  const agreedIncident = (resolution: OrderIncident["resolution"], replacement?: OrderIncident["replacement"]): OrderIncident =>
    base({ productId: "p-sol", variantId: "v_gold", variantColor: "Dorado", resolution, ...(replacement ? { replacement } : {}) }) as OrderIncident;
  const replacement = { productId: "p-sol", productName: "Anillo Sol", unitPriceCents: 40000, unitCostCents: 10000, chargeDifference: false, variantId: "v_gold", variantColor: "Dorado" };

  it("acordada sin talla y el color ahora se vende por talla: lo dice", () => {
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "replacement_equivalent" }, replacement), [design])).toBe(
      "La solución se acordó sin talla y el color Dorado ahora se vende por talla."
    );
    // Con la talla en la resolución sigue siendo entregable.
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "replacement_equivalent" }, { ...replacement, variantSizeId: "d6" }), [design])).toBeNull();
  });

  it("ficha, color o talla desaparecidos: lo dice; un reembolso no entrega pieza y nunca se atasca", () => {
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "replacement_equivalent" }, replacement), [])).toMatch(/ya no existe/);
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "replacement_equivalent" }, { ...replacement, variantId: "v_gone" }), [design])).toMatch(/El color Dorado ya no existe/);
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "replacement_equivalent" }, { ...replacement, variantSizeId: "d9" }), [design])).toMatch(/talla .* ya no existe/);
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "refund", destination: "refund_pending" }), [design])).toBeNull();
  });

  it("esperar reposición entrega la misma pieza: también se atasca si esa pieza ya no se puede nombrar", () => {
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "wait_restock" }), [design])).toMatch(/se acordó sin talla/);
  });

  // Misión UX #461 (bloqueo): se dejó acordar un reemplazo de una talla
  // agotada y sólo al confirmar falló, sin salida. Una talla SIN piezas no es
  // entregable: la solución acordada está atascada y se puede volver a acordar.
  const sized = (d6: number | undefined, d8 = 2) =>
    ({ ...design, variants: [{ ...design.variants![0], sizes: [
      { id: "d6", size: "6", createdAt: "", updatedAt: "", ...(d6 !== undefined ? { quantityOnHand: d6 } : {}) },
      { id: "d8", size: "8", createdAt: "", updatedAt: "", quantityOnHand: d8 },
    ] }] }) as never as Product;
  const plain = { id: "p-plain", storeId: "s1", quantityOnHand: 0 } as never as Product;

  it("reemplazo acordado sobre una talla con 0 piezas: atascado, con la talla y el color en el mensaje", () => {
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "replacement_equivalent" }, { ...replacement, variantSizeId: "d6" }), [sized(0)])).toBe(
      "La talla 6 del color Dorado está agotada: no hay piezas que entregar. Vuelve a acordar la solución."
    );
  });

  it("con piezas (o con la talla sin rastrear) no se atasca por existencia; esperar reposición nunca se atasca por agotarse", () => {
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "replacement_with_difference" }, { ...replacement, variantSizeId: "d6" }), [sized(4)])).toBeNull();
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "replacement_equivalent" }, { ...replacement, variantSizeId: "d6" }), [sized(undefined)])).toBeNull();
    const waiting = { ...agreedIncident({ kind: "wait_restock" }), variantSizeId: "d6" } as OrderIncident;
    expect(agreedSolutionStuckReason(waiting, [sized(0)])).toBeNull(); // agotarse es el motivo de la espera
  });

  it("reemplazo simple o por color con 0 piezas: también atascado; con piezas, no", () => {
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "replacement_equivalent" }, { ...replacement, productId: "p-plain", productName: "Liso", variantId: undefined, variantColor: undefined }), [plain])).toMatch(/agotada/);
    const colored = { id: "p-col", storeId: "s1", variants: [{ id: "v_s", color: "Plata", createdAt: "", updatedAt: "", quantityOnHand: 0 }] } as never as Product;
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "replacement_equivalent" }, { ...replacement, productId: "p-col", variantId: "v_s", variantColor: "Plata" }), [colored])).toMatch(/color Plata está agotado/);
    const coloredStocked = { ...colored, variants: [{ ...colored.variants![0], quantityOnHand: 3 }] } as never as Product;
    expect(agreedSolutionStuckReason(agreedIncident({ kind: "replacement_equivalent" }, { ...replacement, productId: "p-col", variantId: "v_s", variantColor: "Plata" }), [coloredStocked])).toBeNull();
  });
});
