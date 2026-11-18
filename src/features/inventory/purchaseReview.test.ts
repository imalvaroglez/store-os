import { describe, expect, it } from "vitest";
import { purchaseReviewIssues } from "./purchaseReview";
import type { Purchase } from "../../types";

const now = "2026-01-01T00:00:00.000Z";
const purchase = (over: Partial<Purchase> = {}): Purchase => ({
  id: "p1", storeId: "s1", date: "2026-01-01", lines: [],
  subtotal: 0, tickets: [{ id: "t1", supplierId: "sup1", date: "2026-01-01", discount: 0, shipping: 0, tax: 0, totalConfirmed: 0, folio: "" }],
  createdAt: now, updatedAt: now, ...over,
} as unknown as Purchase);

const line = (unitCost: number) => ({
  lineId: "L1", ticketId: "t1", productId: "prod1", name: "Pieza", quantity: 1, unitCost, createdAt: now, updatedAt: now,
});

describe("#219 Compras — importes en centavos exactos (purchaseReviewIssues)", () => {
  it("rechaza un costo unitario con fracción menor al centavo, con mensaje y marca de input", () => {
    const issues = purchaseReviewIssues(purchase({ lines: [line(10.001)] as never }), {});
    const cost = issues.find((i) => i.target === "line:L1" && /centavos|decimales/.test(i.message));
    expect(cost).toBeTruthy();
    expect(cost!.input).toBe(true);
  });

  it("rechaza descuento/envío/impuestos/total con fracción menor al centavo", () => {
    const base = { lines: [line(10)] as never };
    for (const field of ["discount", "shipping", "tax", "totalConfirmed"] as const) {
      const issues = purchaseReviewIssues(purchase({ ...base, tickets: [{ id: "t1", supplierId: "sup1", date: "2026-01-01", discount: 0, shipping: 0, tax: 0, totalConfirmed: 0, folio: "", [field]: 0.001 }] as never }), {});
      expect(issues.some((i) => i.target === `ticket:t1:${field}` && /centavos|decimales/.test(i.message)), field).toBe(true);
    }
  });

  it("acepta importes grandes VÁLIDOS de dos decimales (regresión H1: 132000.02 / 131072.05)", () => {
    const issues = purchaseReviewIssues(purchase({
      lines: [line(132000.02)] as never,
      tickets: [{ id: "t1", supplierId: "sup1", date: "2026-01-01", discount: 0, shipping: 0, tax: 0, totalConfirmed: 132000.05, folio: "" }] as never,
    }), {});
    expect(issues.some((i) => /centavos|decimales/.test(i.message))).toBe(false);
  });

  it("un costo exacto en centavos no produce el issue nuevo", () => {
    const issues = purchaseReviewIssues(purchase({ lines: [line(10.5)] as never }), {});
    expect(issues.some((i) => i.target === "line:L1" && /centavos|decimales/.test(i.message))).toBe(false);
  });
});
