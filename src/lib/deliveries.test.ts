import { describe, expect, it } from "vitest";
import type { Order, OrderDelivery } from "../types";
import {
  deliveredByDimension,
  deliveryValidationError,
  effectiveDeliveryDate,
  orderFullyDelivered,
  pendingDeliveries,
  pendingDeliveryPieces,
} from "./deliveries";
import { reservationDeltasForOrderChange } from "./inventory";

// #333: delivery-evidence derivations — the monthly close's verifiable facts
// (which pieces reached the clienta, and WHEN) plus the partial-cancellation
// rule (delivered pieces never return to the shelf).

function orderOf(items: Order["items"], deliveries?: OrderDelivery[], orderStatus: Order["orderStatus"] = "asked"): Order {
  return {
    id: "o1",
    storeId: "s1",
    items,
    deposit: 0,
    orderStatus,
    ...(deliveries ? { deliveries } : {}),
    createdAt: "2026-11-01",
    updatedAt: "2026-11-01",
  } as Order;
}

function delivery(lines: OrderDelivery["lines"], deliveredAt: string, id = "dev1"): OrderDelivery {
  return {
    id,
    orderId: "o1",
    storeId: "s1",
    deliveredAt,
    recordedAt: `${deliveredAt}T20:00:00.000Z`,
    by: "fer",
    lines,
  };
}

const RING = { productId: "p1", productName: "Anillo", quantity: 5, unitPrice: 100, subtotal: 500 };

describe("pendingDeliveries / deliveredByDimension (#333)", () => {
  it("sin eventos, todo el pedido está pendiente; dimensiones por producto y variante", () => {
    const order = orderOf([
      { ...RING },
      { productId: "p2", variantId: "v_dorado", productName: "Sol dorado", quantity: 2, unitPrice: 50, subtotal: 100 },
    ]);
    const pending = pendingDeliveries(order);
    expect(pending).toEqual([
      { key: "p1", productId: "p1", quantity: 5 },
      { key: "p2:v_dorado", productId: "p2", variantId: "v_dorado", quantity: 2 },
    ]);
    expect(pendingDeliveryPieces(order)).toBe(7);
    expect(orderFullyDelivered(order)).toBe(false);
  });

  it("dos líneas del mismo producto suman su dimensión y comparten lo entregado", () => {
    const order = orderOf(
      [
        { ...RING, lineId: "l1" },
        { ...RING, lineId: "l2" },
      ],
      [delivery([{ productId: "p1", quantity: 3 }], "2026-11-10")]
    );
    expect(deliveredByDimension(order).get("p1")).toBe(3);
    expect(pendingDeliveries(order)).toEqual([{ key: "p1", productId: "p1", quantity: 7 }]);
  });

  it("líneas sin producto no rastrean entrega (siguen el avance simple)", () => {
    const order = orderOf([{ productName: "Envoltura", quantity: 1, unitPrice: 20, subtotal: 20 }]);
    expect(pendingDeliveries(order)).toEqual([]);
    expect(orderFullyDelivered(order)).toBe(false);
  });
});

describe("deliveryValidationError (#333)", () => {
  it("rechaza entregar de más, dimensiones ajenas y cantidades inválidas", () => {
    const order = orderOf([RING]);
    expect(deliveryValidationError(order, { lines: [{ productId: "p1", quantity: 6 }] })).toContain("pendientes");
    expect(deliveryValidationError(order, { lines: [{ productId: "p9", quantity: 1 }] })).toContain("no pertenece");
    expect(deliveryValidationError(order, { lines: [{ productId: "p1", quantity: 0 }] })).toContain("enteras");
    expect(deliveryValidationError(order, { lines: [] })).toContain("al menos");
  });

  it("acepta la parcial y la total exacta", () => {
    const order = orderOf([RING]);
    expect(deliveryValidationError(order, { lines: [{ productId: "p1", quantity: 2 }] })).toBeNull();
    expect(deliveryValidationError(order, { lines: [{ productId: "p1", quantity: 5 }] })).toBeNull();
  });
});

describe("effectiveDeliveryDate (#333)", () => {
  it("la fecha efectiva es la del evento que COMPLETA la entrega, no la primera", () => {
    // November handed 3 of 5; December completed — December is the date of record.
    const order = orderOf(
      [RING],
      [
        delivery([{ productId: "p1", quantity: 3 }], "2026-11-28", "dev1"),
        delivery([{ productId: "p1", quantity: 2 }], "2026-12-02", "dev2"),
      ]
    );
    expect(orderFullyDelivered(order)).toBe(true);
    expect(effectiveDeliveryDate(order)).toBe("2026-12-02");
  });

  it("captura tardía conserva la fecha real; sin eventos no hay fecha", () => {
    const lateCapture = orderOf(
      [RING],
      [delivery([{ productId: "p1", quantity: 5 }], "2026-11-20", "dev1")]
    );
    // recordedAt later, deliveredAt real — the REAL date is the one of record.
    lateCapture.deliveries![0].recordedAt = "2026-12-05T10:00:00.000Z";
    expect(effectiveDeliveryDate(lateCapture)).toBe("2026-11-20");
    expect(effectiveDeliveryDate(orderOf([RING]))).toBeUndefined();
  });
});

describe("cancelación tras entrega parcial (#333)", () => {
  it("cancelar devuelve al estante SOLO lo pendiente; lo entregado queda consumido", () => {
    const open = orderOf([RING], [delivery([{ productId: "p1", quantity: 2 }], "2026-11-10")]);
    const cancelled = { ...open, orderStatus: "cancelled" as const };
    // Before #333 the cancellation released all 5; now only the 3 pending.
    const deltas = reservationDeltasForOrderChange(open, cancelled);
    expect(deltas.get("p1")).toBe(3);
  });

  it("repartir entre líneas de la misma dimensión no libera de más", () => {
    const open = orderOf(
      [
        { ...RING, lineId: "l1" },
        { ...RING, lineId: "l2" },
      ],
      [delivery([{ productId: "p1", quantity: 4 }], "2026-11-10")]
    );
    const cancelled = { ...open, orderStatus: "cancelled" as const };
    expect(reservationDeltasForOrderChange(open, cancelled).get("p1")).toBe(6); // 10 − 4 entregadas
  });
});
