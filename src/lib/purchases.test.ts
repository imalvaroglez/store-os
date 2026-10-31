import { describe, expect, it } from "vitest";
import { allocateCents, purchaseCostAllocation, purchaseInventoryUpdates } from "./purchases";
import { purchaseTotals, recalcPurchaseStatus, type Product, type Purchase } from "../types";

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
    expect(result.costAllocations).toEqual([{ lineId: "line", merchandiseCents: 70000, supplierAdjustmentCents: 0, sourcingExpenseCents: 4400, totalCents: 74400 }]);
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
