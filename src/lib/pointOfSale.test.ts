import { describe, expect, it } from "vitest";
import type { Order, Product } from "../types";
import {
  buildFirstSurtidoFromOrder,
  consumeFromEntries,
  oldestRemainingDate,
  orderConversionImpediments,
  pointSummaries,
  pointValuation,
} from "./pointOfSale";

// #524 — primer corte verificable: modelo y reglas del primer surtido
// ("Usar como surtido inicial" desde un pedido confirmado). Dinero en centavos.

const NOW = "2026-11-21T12:00:00.000Z";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    storeId: "s1",
    name: "Perfume Chanel Chance 100 ml",
    category: "perfume",
    isPublic: true,
    quantityOnHand: 10,
    cost: 400,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function variantProduct(): Product {
  return product({
    id: "p2",
    name: "Cartera de piel",
    variants: [
      { id: "v-cafe", color: "Café", quantityOnHand: 4, createdAt: NOW, updatedAt: NOW },
      { id: "v-negra", color: "Negra", quantityOnHand: 2, createdAt: NOW, updatedAt: NOW },
    ],
  });
}

function confirmedOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "o1",
    storeId: "s1",
    customerId: "c1",
    items: [
      { productName: "Perfume Chanel Chance 100 ml", productId: "p1", quantity: 2, unitPrice: 950, subtotal: 1900, cost: 400 },
      {
        productName: "Cartera de piel",
        productId: "p2",
        variantId: "v-cafe",
        variantColor: "Café",
        quantity: 3,
        unitPrice: 680,
        subtotal: 2040,
        cost: 300,
      },
    ],
    deposit: 0,
    orderStatus: "confirmed",
    paymentStatus: "unpaid",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Order;
}

describe("orderConversionImpediments — «Usar como surtido inicial»", () => {
  it("acepta un pedido confirmado limpio con líneas identificables", () => {
    const check = orderConversionImpediments(confirmedOrder(), [product(), variantProduct()]);
    expect(check.canConvert).toBe(true);
    expect(check.reasons).toEqual([]);
    expect(check.lineIssues).toEqual([]);
  });

  it("rechaza pedidos que no están confirmados", () => {
    for (const orderStatus of ["preparing", "ready", "delivered", "asked", "quoted", "cancelled"] as const) {
      const check = orderConversionImpediments(confirmedOrder({ orderStatus }), [product(), variantProduct()]);
      expect(check.canConvert).toBe(false);
      expect(check.reasons.join(" ")).toContain("confirmado");
    }
  });

  it("rechaza pedidos con anticipo, cobros o crédito aplicado", () => {
    const withDeposit = orderConversionImpediments(confirmedOrder({ deposit: 200 }), [product(), variantProduct()]);
    expect(withDeposit.canConvert).toBe(false);
    expect(withDeposit.reasons.join(" ")).toContain("anticipo");

    const withPayment = orderConversionImpediments(confirmedOrder({ paymentsReceivedCents: 20000 }), [product(), variantProduct()]);
    expect(withPayment.canConvert).toBe(false);
    expect(withPayment.reasons.join(" ")).toContain("cobro");

    const withCredit = orderConversionImpediments(confirmedOrder({ creditAppliedCents: 5000 }), [product(), variantProduct()]);
    expect(withCredit.canConvert).toBe(false);
    expect(withCredit.reasons.join(" ")).toContain("crédito");
  });

  it("rechaza pedidos con entregas o incidencias registradas", () => {
    const withDelivery = orderConversionImpediments(
      confirmedOrder({
        deliveries: [
          {
            id: "d1",
            orderId: "o1",
            storeId: "s1",
            lines: [],
            recordedAt: NOW,
            by: "op",
          } as unknown as NonNullable<Order["deliveries"]>[number],
        ],
      }),
      [product(), variantProduct()]
    );
    expect(withDelivery.canConvert).toBe(false);
    expect(withDelivery.reasons.join(" ")).toContain("entrega");

    const withIncident = orderConversionImpediments(
      confirmedOrder({ incidents: [{ id: "i1", orderId: "o1", events: [] } as unknown as NonNullable<Order["incidents"]>[number]] }),
      [product(), variantProduct()]
    );
    expect(withIncident.canConvert).toBe(false);
    expect(withIncident.reasons.join(" ")).toContain("incidencia");
  });

  it("rechaza un pedido ya convertido (solo una vez)", () => {
    const check = orderConversionImpediments(confirmedOrder({ convertedToPointId: "pt1" }), [product(), variantProduct()]);
    expect(check.canConvert).toBe(false);
    expect(check.reasons.join(" ")).toContain("ya fue convertido");
  });

  it("identifica líneas sin producto o sin variante identificable", () => {
    const order = confirmedOrder({
      items: [
        { productName: "Regalo suelto", quantity: 1, unitPrice: 100, subtotal: 100 },
        { productName: "Cartera de piel", productId: "p2", quantity: 1, unitPrice: 680, subtotal: 680 },
        { productName: "Cartera de piel", productId: "p2", variantId: "v-fantasma", quantity: 1, unitPrice: 680, subtotal: 680 },
      ],
    });
    const check = orderConversionImpediments(order, [product(), variantProduct()]);
    expect(check.canConvert).toBe(false);
    expect(check.lineIssues).toHaveLength(3);
    expect(check.lineIssues[0].reason).toContain("producto");
    expect(check.lineIssues[1].reason).toContain("color");
    expect(check.lineIssues[2].reason).toContain("color");
  });

  it("detiene la conversión cuando la variante tiene existencias negativas", () => {
    const negative = variantProduct();
    negative.variants![0].quantityOnHand = -1;
    const check = orderConversionImpediments(confirmedOrder(), [product(), negative]);
    expect(check.canConvert).toBe(false);
    expect(check.lineIssues).toHaveLength(1);
    expect(check.lineIssues[0].reason).toContain("existencias");
    expect(check.lineIssues[0].productName).toBe("Cartera de piel");
  });

  it("detiene la conversión con una revisión desactualizada del pedido", () => {
    const check = orderConversionImpediments(confirmedOrder({ revision: 4 }), [product(), variantProduct()], {
      latestOrderRevision: 5,
    });
    expect(check.canConvert).toBe(false);
    expect(check.reasons.join(" ")).toContain("revisión");
  });
});

describe("buildFirstSurtidoFromOrder — entradas del primer surtido", () => {
  it("crea una entrada por producto, variante y precio con centavos exactos", () => {
    const entries = buildFirstSurtidoFromOrder(confirmedOrder(), [product(), variantProduct()], "2026-11-21");
    expect(entries).toHaveLength(2);

    const perfume = entries.find((e) => e.productId === "p1")!;
    expect(perfume.variantId).toBeUndefined();
    expect(perfume.quantity).toBe(2);
    expect(perfume.markedPriceCents).toBe(95000);
    expect(perfume.unitCostCents).toBe(40000);
    expect(perfume.entryDate).toBe("2026-11-21");
    expect(perfume.originOrderId).toBe("o1");
    expect(perfume.productName).toBe("Perfume Chanel Chance 100 ml");

    const cartera = entries.find((e) => e.productId === "p2")!;
    expect(cartera.variantId).toBe("v-cafe");
    expect(cartera.variantColor).toBe("Café");
    expect(cartera.quantity).toBe(3);
    expect(cartera.markedPriceCents).toBe(68000);
    expect(cartera.unitCostCents).toBe(30000);
  });

  it("fusiona líneas idénticas en precio y separa precios distintos", () => {
    const order = confirmedOrder({
      items: [
        { productName: "Perfume Chanel Chance 100 ml", productId: "p1", quantity: 2, unitPrice: 950, subtotal: 1900, cost: 400 },
        { productName: "Perfume Chanel Chance 100 ml", productId: "p1", quantity: 1, unitPrice: 950, subtotal: 950, cost: 400 },
        { productName: "Perfume Chanel Chance 100 ml", productId: "p1", quantity: 1, unitPrice: 900.5, subtotal: 900.5, cost: 400 },
      ],
    });
    const entries = buildFirstSurtidoFromOrder(order, [product()], "2026-11-21");
    expect(entries).toHaveLength(2);
    const same = entries.find((e) => e.markedPriceCents === 95000)!;
    expect(same.quantity).toBe(3);
    const other = entries.find((e) => e.markedPriceCents === 90050)!;
    expect(other.quantity).toBe(1);
  });

  it("deja el costo pendiente cuando la línea no trae evidencia de costo", () => {
    const order = confirmedOrder({
      items: [{ productName: "Perfume Chanel Chance 100 ml", productId: "p1", quantity: 1, unitPrice: 950, subtotal: 950 }],
    });
    const entries = buildFirstSurtidoFromOrder(order, [product()], "2026-11-21");
    expect(entries[0].unitCostCents).toBeUndefined();
  });
});

describe("consumeFromEntries — FIFO por entrada más antigua", () => {
  const base = [
    { id: "e1", entryDate: "2026-11-01", createdAt: "2026-11-01T10:00:00.000Z", quantity: 5, consumedQty: 0, markedPriceCents: 10000 },
    { id: "e2", entryDate: "2026-11-10", createdAt: "2026-11-10T10:00:00.000Z", quantity: 5, consumedQty: 0, markedPriceCents: 10000 },
    { id: "e3", entryDate: "2026-11-10", createdAt: "2026-11-10T09:00:00.000Z", quantity: 5, consumedQty: 0, markedPriceCents: 10000 },
  ];

  it("consume primero la entrada más antigua y reparte entre entradas", () => {
    const result = consumeFromEntries(base, 7);
    expect(result.allocations).toEqual([
      { entryId: "e1", quantity: 5 },
      { entryId: "e3", quantity: 2 },
    ]);
    expect(result.shortUnits).toBe(0);
  });

  it("desempata por createdAt cuando la fecha física coincide", () => {
    // e3 (09:00) ya quedó antes que e2 (10:00) en la prueba anterior.
    const result = consumeFromEntries(base, 11);
    expect(result.allocations).toEqual([
      { entryId: "e1", quantity: 5 },
      { entryId: "e3", quantity: 5 },
      { entryId: "e2", quantity: 1 },
    ]);
  });

  it("respeta las piezas ya consumidas", () => {
    const result = consumeFromEntries(
      [
        { ...base[0], consumedQty: 4 },
        base[1],
        base[2],
      ],
      3
    );
    expect(result.allocations).toEqual([
      { entryId: "e1", quantity: 1 },
      { entryId: "e3", quantity: 2 },
    ]);
  });

  it("cuando hay varios precios marcados, consume solo las del precio elegido", () => {
    const mixed = [
      { id: "old-100", entryDate: "2026-11-01", createdAt: "2026-11-01T10:00:00.000Z", quantity: 3, consumedQty: 0, markedPriceCents: 10000 },
      { id: "old-120", entryDate: "2026-11-02", createdAt: "2026-11-02T10:00:00.000Z", quantity: 4, consumedQty: 0, markedPriceCents: 12000 },
    ];
    const result = consumeFromEntries(mixed, 2, { priceCents: 12000 });
    expect(result.allocations).toEqual([{ entryId: "old-120", quantity: 2 }]);
  });

  it("reporta faltante cuando no alcanzan las piezas disponibles", () => {
    const result = consumeFromEntries(base.slice(0, 1), 8);
    expect(result.allocations).toEqual([{ entryId: "e1", quantity: 5 }]);
    expect(result.shortUnits).toBe(3);
  });
});

describe("pointValuation — valor marcado, costo y pendientes", () => {
  it("suma unidades, valor al precio marcado y valor al costo", () => {
    const entries = [
      { quantity: 5, consumedQty: 2, markedPriceCents: 10000, unitCostCents: 5000 },
      { quantity: 4, consumedQty: 0, markedPriceCents: 12000, unitCostCents: 6000 },
    ];
    expect(pointValuation(entries)).toEqual({
      units: 7,
      markedValueCents: 78000,
      costValueCents: 39000,
      pendingCostUnits: 0,
      costComplete: true,
    });
  });

  it("deja incompleta la valoración cuando falta el costo de una entrada", () => {
    const entries = [
      { quantity: 5, consumedQty: 0, markedPriceCents: 10000, unitCostCents: 5000 },
      { quantity: 3, consumedQty: 0, markedPriceCents: 12000 },
    ];
    const valuation = pointValuation(entries);
    expect(valuation.units).toBe(8);
    expect(valuation.costValueCents).toBe(25000);
    expect(valuation.pendingCostUnits).toBe(3);
    expect(valuation.costComplete).toBe(false);
  });
});

describe("oldestRemainingDate — antigüedad estimada", () => {
  it("devuelve la fecha física de la entrada restante más antigua", () => {
    const entries = [
      { entryDate: "2026-11-01", quantity: 2, consumedQty: 2 },
      { entryDate: "2026-11-05", quantity: 1, consumedQty: 0 },
      { entryDate: "2026-11-10", quantity: 4, consumedQty: 1 },
    ];
    expect(oldestRemainingDate(entries)).toBe("2026-11-05");
  });

  it("devuelve null cuando no queda mercancía", () => {
    expect(oldestRemainingDate([{ entryDate: "2026-11-01", quantity: 2, consumedQty: 2 }])).toBeNull();
  });
});

describe("pointSummaries (#524 corte UI): piezas y valoración por punto", () => {
  const entry = (pointId: string, over: Partial<Parameters<typeof pointSummaries>[0][number]> = {}) =>
    ({
      id: `e-${pointId}-${Math.random()}`,
      pointId,
      entryDate: "2026-11-01",
      quantity: 5,
      consumedQty: 2,
      markedPriceCents: 10000,
      unitCostCents: 5000,
      ...over,
    }) as Parameters<typeof pointSummaries>[0][number];

  it("agrupa por punto: unidades restantes, valor marcado, costo y antigüedad", () => {
    const summaries = pointSummaries([
      entry("pt1"),
      entry("pt1", { entryDate: "2026-11-10", quantity: 4, consumedQty: 0, markedPriceCents: 12000, unitCostCents: 6000 }),
      entry("pt2", { quantity: 3, consumedQty: 0, markedPriceCents: 8000, unitCostCents: undefined }),
    ]);
    expect(summaries.get("pt1")).toEqual({
      units: 7,
      markedValueCents: 78000,
      costValueCents: 39000,
      pendingCostUnits: 0,
      oldestEntryDate: "2026-11-01",
    });
    expect(summaries.get("pt2")?.units).toBe(3);
    expect(summaries.get("pt2")?.pendingCostUnits).toBe(3);
    expect(summaries.get("pt2")?.costValueCents).toBe(0);
  });

  it("un punto sin entradas no aparece (la ficha vacía se detecta aparte)", () => {
    expect(pointSummaries([]).size).toBe(0);
  });
});
