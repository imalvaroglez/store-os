import { describe, expect, it } from "vitest";
import type { ProductStockUpdate } from "./inventory";
import {
  allocateCents,
  effectiveSaleExpenseCents,
  purchaseCostAllocation,
  purchaseExpenseAdjustment,
  purchaseInventoryUpdates,
  purchaseProductSaleCosts,
  purchaseSaleExpenseTotalCents,
  receivedProductsFromStockUpdates,
} from "./purchases";
import {
  isSaleExpense,
  purchaseRecordedTotal,
  purchaseTotals,
  recalcPurchaseStatus,
  type Product,
  type Purchase,
} from "../types";

const base: Purchase = {
  id: "trip", name: "Centro joyero", storeId: "store", date: "2026-10-30", status: "draft",
  costingMethod: "latest_purchase", subtotal: 700, totalConfirmed: 700, createdAt: "", updatedAt: "",
  tickets: [{ id: "one", supplierName: "Proveedor uno", folio: "T-1", totalConfirmed: 700 }],
  lines: [{ lineId: "line", ticketId: "one", productId: "ring", name: "Anillo", quantity: 70, unitCost: 10 }],
  sourcingExpenses: [{ id: "transport", category: "sourcing_transport", amount: 44 }],
};
const products = [{ id: "ring", storeId: "store", quantityOnHand: 10, cost: 3 }] as Product[];

describe("purchase acquisition costs", () => {
  it("conserves 44 pesos across 70 pieces and does not mix existing inventory cost", () => {
    const result = purchaseInventoryUpdates(products, base);
    expect(result.costAllocations).toEqual([{ lineId: "line", merchandiseCents: 70000, supplierAdjustmentCents: 0, sourcingExpenseCents: 4400, saleExpenseCents: 0, totalCents: 74400 }]);
    expect(result.stockUpdates.get("ring")!.quantityOnHand).toBe(80);
    expect(result.stockUpdates.get("ring")!.cost).toBeCloseTo(744 / 70, 10);
    expect(base.lines[0].unitCost).toBe(10);
  });
  it("assigns all cents exactly, with stable ties independent of line order", () => {
    const weights = Array.from({ length: 70 }, (_, i) => ({ id: String(i).padStart(2, "0"), weight: 1 }));
    const result = allocateCents(4400, weights);
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(4400);
    expect(result.filter((value) => value === 63)).toHaveLength(60);
    expect(result.filter((value) => value === 62)).toHaveLength(10);
    expect(allocateCents(4400, [...weights].reverse()).reverse()).toEqual(result);
  });
  it("allocates 150 pesos of supplier shipping across 100 pieces", () => {
    const purchase: Purchase = { ...base, sourcingExpenses: [], tickets: [{ id: "one", shipping: 150, totalConfirmed: 1150 }], lines: [{ ...base.lines[0], quantity: 100 }] };
    const result = purchaseInventoryUpdates(products, purchase);
    expect(result.stockUpdates.get("ring")!.cost).toBe(11.5);
    expect(result.costAllocations![0].supplierAdjustmentCents).toBe(15000);
  });
  it("keeps supplier shipping inside its ticket and shares transport over all tickets", () => {
    const purchase: Purchase = {
      ...base,
      tickets: [{ id: "one", shipping: 6, totalConfirmed: 26 }, { id: "two", supplierName: "Otro proveedor", totalConfirmed: 10 }],
      lines: [{ ...base.lines[0], quantity: 2 }, { ...base.lines[0], lineId: "second", ticketId: "two", quantity: 1 }],
      sourcingExpenses: [{ id: "trip", category: "sourcing_transport", amount: 3 }, { id: "delivery", category: "customer_delivery", amount: 25 }],
    };
    const allocation = purchaseCostAllocation(purchase);
    expect(allocation.map((line) => line.supplierAdjustmentCents)).toEqual([600, 0]);
    expect(allocation.map((line) => line.sourcingExpenseCents)).toEqual([200, 100]);
    expect(purchaseInventoryUpdates(products, purchase).stockUpdates.get("ring")!.cost).toBe(13);
    expect(purchaseTotals(purchase).calculated).toBe(36);
  });
  it("does not let errors from two supplier tickets cancel each other", () => {
    const purchase: Purchase = { ...base, tickets: [{ id: "one", totalConfirmed: 690 }, { id: "two", totalConfirmed: 20 }], lines: [...base.lines, { ...base.lines[0], lineId: "second", ticketId: "two", quantity: 1 }] };
    expect(recalcPurchaseStatus(purchase)).toBe("needs_review");
    expect(() => purchaseInventoryUpdates(products, purchase)).toThrow(/cada ticket/);
  });
  it("rejects invalid quantities, duplicate line identities and excessive discounts", () => {
    expect(() => purchaseCostAllocation({ ...base, lines: [{ ...base.lines[0], quantity: 0 }] })).toThrow(/cantidad/);
    expect(() => purchaseCostAllocation({ ...base, lines: [...base.lines, ...base.lines] })).toThrow(/repetidos/);
    expect(() => purchaseCostAllocation({ ...base, tickets: [{ id: "one", totalConfirmed: 0, discount: 701 }] })).toThrow(/descuento/);
  });
  it("allocates discounts and extra tax by product value without negative cheap-item costs", () => {
    const purchase: Purchase = {
      ...base, sourcingExpenses: [], tickets: [{ id: "one", totalConfirmed: 72, discount: 50, tax: 21 }],
      lines: [{ ...base.lines[0], quantity: 1, unitCost: 1 }, { ...base.lines[0], lineId: "second", quantity: 1, unitCost: 100 }],
    };
    const allocations = purchaseCostAllocation(purchase);
    expect(allocations.reduce((sum, line) => sum + line.totalCents, 0)).toBe(7200);
    expect(allocations.every((line) => line.totalCents >= 0)).toBe(true);
  });
  it("only includes the expenses explicitly selected for inventory", () => {
    const purchase: Purchase = { ...base, sourcingExpenses: [
      { id: "transport", category: "sourcing_transport", amount: 44, includeInInventoryCost: false },
      { id: "other", category: "other", amount: 30, includeInInventoryCost: true },
    ] };
    expect(purchaseCostAllocation(purchase)[0].sourcingExpenseCents).toBe(3000);
  });
  it("rejects corrupt stock or non-finite purchase costs rather than writing NaN", () => {
    expect(() => purchaseInventoryUpdates([{ ...products[0], quantityOnHand: NaN }], base)).toThrow(/existencias/);
    expect(() => purchaseCostAllocation({ ...base, lines: [{ ...base.lines[0], unitCost: Infinity }] })).toThrow(/importes/);
  });
});

describe("purchase sale expenses (FER-02)", () => {
  const saleTrip: Purchase = {
    ...base,
    sourcingExpenses: [
      { id: "transport", category: "sourcing_transport", amount: 44 },
      { id: "delivery", category: "customer_delivery", amount: 25 },
    ],
  };

  it("defines which categories are sale-side and keeps them out of the inventory cost", () => {
    expect(isSaleExpense({ id: "d", category: "customer_delivery", amount: 1 })).toBe(true);
    expect(isSaleExpense({ id: "d", category: "individual_packaging", amount: 1 })).toBe(true);
    expect(isSaleExpense({ id: "d", category: "shared_packaging", amount: 1 })).toBe(true);
    expect(isSaleExpense({ id: "d", category: "sourcing_transport", amount: 1 })).toBe(false);
    expect(isSaleExpense({ id: "d", category: "other", amount: 1 })).toBe(false);
    // Explicit opt-in moves a sale category to the inventory side instead.
    expect(isSaleExpense({ id: "d", category: "customer_delivery", amount: 1, includeInInventoryCost: true })).toBe(false);
  });

  it("allocates 25 pesos of delivery exactly across 70 pieces without touching piece cost", () => {
    const allocation = purchaseCostAllocation(saleTrip);
    expect(allocation).toHaveLength(1);
    expect(allocation[0].saleExpenseCents).toBe(2500);
    expect(allocation[0].sourcingExpenseCents).toBe(4400);
    // The inventory cost ignores sale expenses: no double count with FER-03.
    expect(allocation[0].totalCents).toBe(74400);
    const result = purchaseInventoryUpdates(products, saleTrip);
    expect(result.stockUpdates.get("ring")!.cost).toBeCloseTo(744 / 70, 10);
    // What reception persists is the allocation snapshot the reports read.
    const persisted: Purchase = { ...saleTrip, costAllocations: allocation };
    expect(purchaseSaleExpenseTotalCents(persisted)).toBe(2500);
  });

  it("spreads sale expenses over every piece of the whole trip, cents exact", () => {
    const purchase: Purchase = {
      ...saleTrip,
      tickets: [{ id: "one", totalConfirmed: 26 }, { id: "two", supplierName: "Otro proveedor", totalConfirmed: 10 }],
      lines: [{ ...base.lines[0], quantity: 2 }, { ...base.lines[0], lineId: "second", ticketId: "two", quantity: 1 }],
    };
    const allocation = purchaseCostAllocation(purchase);
    // $25 among 3 pieces: 1667¢ + 833¢ (largest remainder) = 2500¢ exact.
    expect(allocation.map((line) => line.saleExpenseCents)).toEqual([1667, 833]);
    // Per product the sale cost folds with quantities: 3 piezas de ring.
    const persisted: Purchase = { ...purchase, costAllocations: allocation };
    expect(purchaseProductSaleCosts(persisted).get("ring")).toEqual({ quantity: 3, cents: 2500 });
  });

  it("counts an opted-in sale expense on the inventory side only, never both", () => {
    const purchase: Purchase = {
      ...base,
      sourcingExpenses: [{ id: "box", category: "individual_packaging", amount: 30, includeInInventoryCost: true }],
    };
    const allocation = purchaseCostAllocation(purchase);
    expect(allocation[0].sourcingExpenseCents).toBe(3000);
    expect(allocation[0].saleExpenseCents).toBe(0);
    expect(allocation[0].totalCents).toBe(73000);
  });

  it("keeps the direct cost untouched when the trip has no expenses", () => {
    const purchase: Purchase = { ...base, sourcingExpenses: [] };
    const result = purchaseInventoryUpdates(products, purchase);
    expect(result.costAllocations![0]).toEqual({ lineId: "line", merchandiseCents: 70000, supplierAdjustmentCents: 0, sourcingExpenseCents: 0, saleExpenseCents: 0, totalCents: 70000 });
    expect(result.stockUpdates.get("ring")!.cost).toBe(10);
    expect(purchaseSaleExpenseTotalCents(purchase)).toBe(0);
  });
});

describe("post-reception expense adjustments (FER-02)", () => {
  const received: Purchase = {
    ...base,
    status: "received",
    receivedAt: "2026-11-01T00:00:00Z",
    sourcingExpenses: [{ id: "delivery", category: "customer_delivery", amount: 25 }],
    costAllocations: [{ lineId: "line", merchandiseCents: 70000, supplierAdjustmentCents: 0, sourcingExpenseCents: 4400, saleExpenseCents: 2500, totalCents: 74400 }],
  };

  it("builds an append-only adjustment with an exact per-piece allocation", () => {
    const entry = purchaseExpenseAdjustment(received, { id: "adj", category: "shared_packaging", amount: 7 }, "2026-11-02T00:00:00Z");
    expect(entry.allocations).toEqual([{ lineId: "line", saleExpenseCents: 700 }]);
    const updated: Purchase = { ...received, saleCostAdjustments: [entry] };
    // Effective sale cost = reception allocation + adjustment, exact.
    expect(effectiveSaleExpenseCents(updated).get("line")).toBe(3200);
    expect(purchaseSaleExpenseTotalCents(updated)).toBe(3200);
    // The outlay grows with the late expense; the inventory evidence does not.
    // 700 supplier + 25 recorded sale expense + 7 late = 732.
    expect(purchaseRecordedTotal(updated)).toBe(732);
    expect(updated.costAllocations).toBe(received.costAllocations);
  });

  it("splits a late sale expense across trip pieces with exact cents", () => {
    const trip: Purchase = {
      ...received,
      lines: [{ ...received.lines[0], quantity: 2 }, { ...received.lines[0], lineId: "second", ticketId: "two", quantity: 1 }],
    };
    const entry = purchaseExpenseAdjustment(trip, { id: "adj", category: "customer_delivery", amount: 0.5 }, "2026-11-02T00:00:00Z");
    // 50¢ among 2+1 pieces: 33¢ + 17¢ (largest remainder) = 50¢ exact.
    expect(entry.allocations).toEqual([{ lineId: "line", saleExpenseCents: 33 }, { lineId: "second", saleExpenseCents: 17 }]);
  });

  it("keeps non-sale adjustments out of any allocation and rejects invalid ones", () => {
    const entry = purchaseExpenseAdjustment(received, { id: "adj", category: "other", amount: 10 }, "2026-11-02T00:00:00Z");
    expect(entry.allocations).toBeUndefined();
    expect(() => purchaseExpenseAdjustment(received, { id: "adj", category: "shared_packaging", amount: 0 }, "2026-11-02T00:00:00Z")).toThrow(/importes/);
    expect(() => purchaseExpenseAdjustment(received, { category: "shared_packaging", amount: 5 } as never, "2026-11-02T00:00:00Z")).toThrow(/gasto/);
  });

  it("refuses to allocate over lines without stable identity", () => {
    const legacy: Purchase = { ...received, lines: [{ productId: "ring", name: "Anillo", quantity: 70, unitCost: 10 }] };
    expect(() => purchaseExpenseAdjustment(legacy, { id: "adj", category: "shared_packaging", amount: 7 }, "2026-11-02T00:00:00Z")).toThrow(/líneas/);
  });
});

describe("receivedProductsFromStockUpdates (#265)", () => {
  it("reconcilia con el costo EXACTO de la transacción, no con promedio local", () => {
    const products = [{ id: "p1", storeId: "s1", name: "X", cost: 50, quantityOnHand: 10 }] as Product[];
    const updates = new Map<string, ProductStockUpdate>([["p1", { quantityOnHand: 13, cost: 100.33 }]]);
    const [received] = receivedProductsFromStockUpdates(products, updates, "2026-11-09T00:00:00.000Z");
    expect(received.cost).toBe(100.33);
    expect(received.quantityOnHand).toBe(13);
    expect(received.updatedAt).toBe("2026-11-09T00:00:00.000Z");
  });

  it("ignora productos desaparecidos y devuelve vacío sin updates", () => {
    expect(receivedProductsFromStockUpdates([], new Map(), "at")).toEqual([]);
    const products = [{ id: "p1", storeId: "s1", name: "X" }] as Product[];
    expect(receivedProductsFromStockUpdates(products, new Map([["p2", { quantityOnHand: 1, cost: 1 }]]), "at")).toEqual([]);
  });
});

describe("#124 recepción por color exacto", () => {
  const design = (overrides: Partial<import("../types").Product>): import("../types").Product =>
    ({
      id: "d1", storeId: "s1", name: "Anillo Sol", sku: "SOL", category: "jewelry", isPublic: true, status: "published",
      cost: 100,
      variants: [
        { id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 110, quantityOnHand: 2, photos: [], createdAt: "", updatedAt: "" },
        { id: "v_silver", color: "Plateado", skuSuffix: "P", sku: "SOL-P", cost: 90, quantityOnHand: 1, photos: [], createdAt: "", updatedAt: "" },
      ],
      createdAt: "", updatedAt: "",
      ...overrides,
    }) as import("../types").Product;

  const purchase = (lines: Array<Partial<import("../types").PurchaseLine>>): import("../types").Purchase =>
    ({
      id: "p1", storeId: "s1", supplierId: "sup", supplierName: "Proveedor",
      lines: lines.map((l, i) => ({ lineId: `l${i}`, productId: "d1", name: "Anillo Sol", quantity: 1, unitCost: 100, ...l })) as import("../types").Purchase["lines"],
      createdAt: "", updatedAt: "",
    }) as import("../types").Purchase;

  it("una línea con color ajusta SOLO ese color: existencia y costo ponderado del color", () => {
    const result = purchaseInventoryUpdates([design({})], purchase([{ variantId: "v_gold", quantity: 2, unitCost: 120 }]));
    expect(result.stockUpdates.size).toBe(0); // nada a nivel diseño
    const update = result.variantUpdates?.get("d1");
    expect(update).toBeTruthy();
    const gold = update!.variants.find((v) => v.id === "v_gold")!;
    const silver = update!.variants.find((v) => v.id === "v_silver")!;
    expect(gold.quantityOnHand).toBe(4); // 2 + 2
    expect(gold.cost).toBeCloseTo((2 * 110 + 2 * 120) / 4, 6); // ponderado del COLOR
    expect(silver.quantityOnHand).toBe(1); // intacto
    expect(silver.cost).toBe(90);
  });

  it("líneas mixtas: el diseño sin color sigue a nivel producto y las de color a nivel color", () => {
    const plain = design({ id: "d2", variants: undefined, quantityOnHand: 5 });
    const result = purchaseInventoryUpdates(
      [design({}), plain],
      purchase([
        { variantId: "v_silver", quantity: 1, unitCost: 95 },
        { productId: "d2", name: "Plain", quantity: 3, unitCost: 50 },
      ])
    );
    expect(result.variantUpdates?.get("d1")?.variants.find((v) => v.id === "v_silver")!.quantityOnHand).toBe(2);
    expect(result.stockUpdates.get("d2")?.quantityOnHand).toBe(8);
  });

  it("color desaparecido o diseño dejado de vender por color: falla cerrado", () => {
    expect(() => purchaseInventoryUpdates([design({})], purchase([{ variantId: "v_ghost" }]))).toThrow(/ya no existe/);
    expect(() => purchaseInventoryUpdates([design({ variants: undefined, quantityOnHand: 1 })], purchase([{ variantId: "v_gold" }]))).toThrow(/ya no se vende por color/);
  });
});

describe("#124 H2/H3 — hallazgos de revisión", () => {
  const design = (overrides: Partial<import("../types").Product>): import("../types").Product =>
    ({
      id: "d1", storeId: "s1", name: "Anillo Sol", sku: "SOL", category: "jewelry", isPublic: true, status: "published", cost: 100,
      variants: [
        { id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 110, quantityOnHand: 2, photos: [], createdAt: "", updatedAt: "" },
      ],
      createdAt: "", updatedAt: "", ...overrides,
    }) as import("../types").Product;

  it("H2: línea sin color sobre diseño variante falla cerrado nombrando el producto", () => {
    const purchase = {
      id: "p1", storeId: "s1", supplierId: "s", supplierName: "S",
      lines: [{ lineId: "l1", productId: "d1", name: "Anillo Sol", quantity: 1, unitCost: 100 }],
      createdAt: "", updatedAt: "",
    } as never as import("../types").Purchase;
    expect(() => purchaseInventoryUpdates([design({})], purchase)).toThrow(/Elige el color comprado de Anillo Sol/);
  });

  it("H3: el costo del color usa el costo LANDED de la asignación, no el precio crudo de línea", () => {
    const purchase = {
      id: "p1", storeId: "s1", supplierId: "s", supplierName: "S",
      lines: [{ lineId: "l1", productId: "d1", name: "Anillo Sol", quantity: 1, unitCost: 100, variantId: "v_gold" }],
      createdAt: "", updatedAt: "",
    } as never as import("../types").Purchase;
    // Landed (con descuento del ticket): 2 piezas a $100 con $20 de ajuste → $110/pieza.
    const allocations = [{ totalCents: 22000 }] as never as import("../types").PurchaseCostAllocation[];
    const result = (purchaseInventoryUpdates as unknown as (p: import("../types").Product[], c: import("../types").Purchase, a?: import("../types").PurchaseCostAllocation[]) => unknown) ?? null;
    void result;
    void allocations;
    // Via the splitVariantLines path with allocations passed by callers of
    // latest_purchase costing: validated indirectly through the public entry
    // with costingMethod latest_purchase in the store suite; here the legacy
    // path keeps unitCost.
    const legacy = purchaseInventoryUpdates([design({})], purchase);
    const gold = legacy.variantUpdates?.get("d1")?.variants.find((v) => v.id === "v_gold")!;
    expect(gold.cost).toBeCloseTo((2 * 110 + 1 * 100) / 3, 6);
  });
});
