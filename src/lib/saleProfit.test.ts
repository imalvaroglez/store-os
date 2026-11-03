import { describe, expect, it } from "vitest";
import { itemsProfitBreakdown, orderProfitBreakdown } from "./saleProfit";
import type { Order, OrderItem, Purchase } from "../types";

/** A received trip: 10 pieces of "ring" at $10, with the given sale-side cents
 * already persisted as reception evidence (FER-02). */
function receivedTrip(saleCents: number, at = "2026-11-01T00:00:00.000Z"): Purchase {
  return {
    id: `trip-${at}`, storeId: "store", date: "2026-10-30", status: "received", costingMethod: "latest_purchase",
    receivedAt: at, subtotal: 100, totalConfirmed: 100, createdAt: "", updatedAt: "",
    lines: [{ lineId: "line", productId: "ring", name: "Anillo", quantity: 10, unitCost: 10 }],
    costAllocations: [{ lineId: "line", merchandiseCents: 10000, supplierAdjustmentCents: 0, sourcingExpenseCents: 0, saleExpenseCents: saleCents, totalCents: 10000 }],
  };
}

const ring: OrderItem = { productId: "ring", productName: "Anillo", quantity: 3, unitPrice: 25, subtotal: 75, cost: 10 };
const order: Order = {
  id: "o1", storeId: "store", customerId: "c1", items: [ring], deposit: 0,
  orderStatus: "delivered", paymentStatus: "paid", createdAt: "", updatedAt: "",
};

describe("order profit with full sale cost", () => {
  it("subtracts acquisition cost and per-piece sale expenses from the sold price", () => {
    // 3 × $25 = $75.00; cost 3 × $10 = $30.00; delivery $3.00 over 10 pieces → 30¢/pieza → 90¢.
    const breakdown = orderProfitBreakdown(order, [receivedTrip(300)]);
    expect(breakdown).toEqual({ revenueCents: 7500, acquisitionCents: 3000, saleExpenseCents: 90, profitCents: 4410, linesWithoutCost: 0 });
  });

  it("counts the sale expense exactly once: never inside the acquisition cost", () => {
    // totalCents ($10/pieza) deliberately EXCLUDES saleExpenseCents (FER-02);
    // the breakdown must add the 30¢/pieza once, not twice, not zero times.
    const breakdown = orderProfitBreakdown({ ...order, items: [{ ...ring, quantity: 1 }] }, [receivedTrip(300)]);
    expect(breakdown.acquisitionCents).toBe(1000);
    expect(breakdown.saleExpenseCents).toBe(30);
    expect(breakdown.profitCents).toBe(2500 - 1000 - 30);
  });

  it("uses the negotiated unit price captured on the line, not the catalog", () => {
    const negotiated = orderProfitBreakdown({ ...order, items: [{ ...ring, unitPrice: 18, subtotal: 54 }] }, [receivedTrip(300)]);
    expect(negotiated.revenueCents).toBe(5400);
    expect(negotiated.profitCents).toBe(5400 - 3000 - 90);
  });

  it("reports no profit when no line has a known cost (honest 'sin costo')", () => {
    const unknown = orderProfitBreakdown({ ...order, items: [{ ...ring, cost: undefined }] }, [receivedTrip(300)]);
    expect(unknown.profitCents).toBeNull();
    expect(unknown.linesWithoutCost).toBe(1);
  });

  it("estimates only over lines with known cost and counts the rest as unknown", () => {
    const items: OrderItem[] = [
      ring,
      { productId: "bracelet", productName: "Pulsera", quantity: 2, unitPrice: 15, subtotal: 30 }, // sin costo
    ];
    const breakdown = orderProfitBreakdown({ ...order, items }, [receivedTrip(300)]);
    expect(breakdown.profitCents).toBe(4410);
    expect(breakdown.linesWithoutCost).toBe(1);
  });

  it("keeps sale expenses at zero when the product has no purchase history", () => {
    const breakdown = orderProfitBreakdown(order, []);
    expect(breakdown.saleExpenseCents).toBe(0);
    expect(breakdown.profitCents).toBe(7500 - 3000);
  });

  it("never reads purchases from another store", () => {
    const otherStore = { ...receivedTrip(300), storeId: "otra" };
    const breakdown = orderProfitBreakdown(order, [otherStore]);
    expect(breakdown.saleExpenseCents).toBe(0);
  });

  it("uses only the latest received trip that bought the product", () => {
    const older = receivedTrip(3000, "2026-10-01T00:00:00.000Z"); // 300¢/pieza
    const newer = receivedTrip(500, "2026-11-01T00:00:00.000Z"); // 50¢/pieza
    const draft = { ...receivedTrip(9900), status: "draft" as const, receivedAt: undefined };
    const breakdown = orderProfitBreakdown(order, [older, newer, draft]);
    expect(breakdown.saleExpenseCents).toBe(3 * 50);
  });

  it("treats a legacy purchase without status as received evidence", () => {
    const legacy = { ...receivedTrip(300), status: undefined, receivedAt: undefined };
    expect(orderProfitBreakdown(order, [legacy]).saleExpenseCents).toBe(90);
  });

  it("includes post-reception adjustments in the per-piece estimate", () => {
    const adjusted: Purchase = {
      ...receivedTrip(300),
      saleCostAdjustments: [{ id: "extra", at: "2026-11-02T00:00:00.000Z", category: "shared_packaging", amount: 2, allocations: [{ lineId: "line", saleExpenseCents: 200 }] }],
    };
    // (300¢ + 200¢) / 10 piezas = 50¢/pieza → $1.50 for 3 pieces.
    expect(orderProfitBreakdown(order, [adjusted]).saleExpenseCents).toBe(150);
  });

  it("rounds the per-piece estimate to the exact cent (2500¢ over 70 pieces)", () => {
    const trip = { ...receivedTrip(2500), lines: [{ ...receivedTrip(2500).lines[0], quantity: 70 }] };
    const twoPieces = orderProfitBreakdown({ ...order, items: [{ ...ring, quantity: 2 }] }, [trip]); // 2 × 2500/70 = 71.43¢ → 71¢
    expect(twoPieces.saleExpenseCents).toBe(71);
    const seven = orderProfitBreakdown({ ...order, items: [{ ...ring, quantity: 7 }] }, [trip]); // 7 × 2500/70 = 250¢ exactos
    expect(seven.saleExpenseCents).toBe(250);
  });

  it("folds repeated product lines within the winning trip (items view)", () => {
    const trip = receivedTrip(300);
    const items: OrderItem[] = [ring, { ...ring, quantity: 2, subtotal: 50 }];
    expect(itemsProfitBreakdown(items, "store", [trip]).saleExpenseCents).toBe(150);
  });
});
