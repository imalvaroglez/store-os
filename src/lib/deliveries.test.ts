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
import { combinationReservationDeltasForOrderChange, reservationDeltasForOrderChange, variantReservationDeltasForOrderChange } from "./inventory";

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

  it("la fecha efectiva es la del día en que llegó la ÚLTIMA pieza, no la de la captura completadora (P2 revisión)", () => {
    // Piece B physically reached the clienta on Oct 15 but was captured Dec 1;
    // piece A arrived Nov 30. The order was physically complete Nov 30.
    const order = orderOf(
      [RING],
      [
        delivery([{ productId: "p1", quantity: 3 }], "2026-11-30", "devA"),
        delivery([{ productId: "p1", quantity: 2 }], "2026-10-15", "devB"),
      ]
    );
    order.deliveries![1].recordedAt = "2026-12-01T09:00:00.000Z";
    expect(effectiveDeliveryDate(order)).toBe("2026-11-30");
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

  it("con VARIANTE, cancelar tras entrega parcial también devuelve solo lo pendiente (P1 revisión)", async () => {
    const { variantReservationDeltasForOrderChange } = await import("./inventory");
    const open = orderOf(
      [{ productId: "p1", variantId: "v_dorado", productName: "Sol dorado", quantity: 4, unitPrice: 50, subtotal: 200 }],
      [delivery([{ productId: "p1", variantId: "v_dorado", quantity: 3 }], "2026-11-10")]
    );
    const cancelled = { ...open, orderStatus: "cancelled" as const };
    const deltas = variantReservationDeltasForOrderChange(open, cancelled);
    expect(deltas.get("p1:v_dorado")?.delta).toBe(1); // solo la pieza pendiente
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

// #461 (dictamen QA 23-nov, crítico 2): la entrega razona por COMBINACIÓN
// exacta. Dos tallas del mismo color son dimensiones distintas; cada entrega
// lleva su talla, y cancelar tras una entrega parcial devuelve solo lo
// pendiente de cada combinación — nunca piezas ya entregadas.
describe("entregas por combinación color × talla (#461)", () => {
  const sized = (sizeId: string, size: string, quantity: number, lineId: string) => ({
    productId: "p2",
    variantId: "v_dorado",
    variantColor: "Dorado",
    variantSizeId: sizeId,
    variantSize: size,
    lineId,
    productName: "Anillo Sol",
    quantity,
    unitPrice: 400,
    subtotal: quantity * 400,
  });

  it("dos tallas del mismo color son pendientes distintos, no una fila por color", () => {
    const order = orderOf([sized("d6", "6", 2, "l1"), sized("d5", "5", 1, "l2")]);
    expect(pendingDeliveries(order)).toEqual([
      { key: "p2:v_dorado:d6", productId: "p2", variantId: "v_dorado", variantSizeId: "d6", quantity: 2 },
      { key: "p2:v_dorado:d5", productId: "p2", variantId: "v_dorado", variantSizeId: "d5", quantity: 1 },
    ]);
  });

  it("entregar de la talla 6 no descuenta la talla 5; sobrantes y tallas ajenas se rechazan", () => {
    const order = orderOf([sized("d6", "6", 2, "l1"), sized("d5", "5", 1, "l2")]);
    expect(
      deliveryValidationError(order, { lines: [{ productId: "p2", variantId: "v_dorado", variantSizeId: "d6", quantity: 3 }] })
    ).toBe("No puedes entregar más piezas de las que siguen pendientes.");
    expect(
      deliveryValidationError(order, { lines: [{ productId: "p2", variantId: "v_dorado", variantSizeId: "d7", quantity: 1 }] })
    ).toBe("Esa pieza ya está entregada por completo o no pertenece al pedido.");
    // Sin talla ya no nombra una talla del pedido: el color alone no es una dimensión vendible aquí.
    expect(
      deliveryValidationError(order, { lines: [{ productId: "p2", variantId: "v_dorado", quantity: 1 }] })
    ).toBe("Esa pieza ya está entregada por completo o no pertenece al pedido.");
    expect(deliveryValidationError(order, { lines: [{ productId: "p2", variantId: "v_dorado", variantSizeId: "d6", quantity: 1 }] })).toBeNull();
  });

  it("cancelar tras entrega parcial devuelve SOLO lo pendiente de su combinación (dictamen: vs_d6 4→6, vs_d5 3→4)", () => {
    const delivered = orderOf([sized("d6", "6", 2, "l1"), sized("d5", "5", 1, "l2")], [
      delivery([{ productId: "p2", variantId: "v_dorado", variantSizeId: "d6", quantity: 1 }], "2026-11-20"),
    ]);
    expect(pendingDeliveries(delivered)).toEqual([
      { key: "p2:v_dorado:d6", productId: "p2", variantId: "v_dorado", variantSizeId: "d6", quantity: 1 },
      { key: "p2:v_dorado:d5", productId: "p2", variantId: "v_dorado", variantSizeId: "d5", quantity: 1 },
    ]);
    const cancelled: Order = { ...delivered, orderStatus: "cancelled" };
    const released = combinationReservationDeltasForOrderChange(delivered, cancelled);
    expect([...released.values()]).toEqual([
      { productId: "p2", variantId: "v_dorado", sizeId: "d6", delta: 1 },
      { productId: "p2", variantId: "v_dorado", sizeId: "d5", delta: 1 },
    ]);
    // La talla 6 entregada queda consumida: nada vuelve al color ni al diseño.
    expect([...variantReservationDeltasForOrderChange(delivered, cancelled).values()]).toEqual([]);
    expect([...reservationDeltasForOrderChange(delivered, cancelled).values()]).toEqual([]);
  });
});
