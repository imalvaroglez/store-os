import { describe, expect, it } from "vitest";
import { cartRequestSummary, isIdentityGatedTier, tierSubtotalRows, type CartQtyLine } from "./pricing";
import type { PriceTierDef } from "../types";

const TIERS: PriceTierDef[] = [
  { id: "regular", label: "Regular", order: 0 },
  { id: "girly", label: "Girly", order: 1, minPieces: 5 },
  { id: "iconic", label: "Iconic", order: 2, minAmount: 1000 },
];
const line = (qty: number, iconic = 90): CartQtyLine => ({
  qty, unitPrices: { regular: 140, girly: 120, iconic },
});
const summary = (qty: number) => cartRequestSummary(TIERS, [line(qty)])!;

describe("public cart estimate and Iconic progress", () => {
  it("recognizes the configured money tier without depending on its label", () => {
    expect(isIdentityGatedTier(TIERS[2])).toBe(true);
    expect(isIdentityGatedTier(TIERS[1])).toBe(false);
  });

  it("shows Regular and Iconic before the quantity discount", () => {
    const result = summary(4);
    expect(result.activeTier.id).toBe("regular");
    expect(result.estimatedSubtotal).toBe(560);
    expect(result.identitySubtotal).toBe(360);
    expect(result.identityAmountRemaining).toBe(640);
    expect(result.showIdentityHint).toBe(true);
  });

  it("keeps Girly and Iconic even when Girly exceeds $1,000", () => {
    const result = summary(10);
    expect(result.activeTier.id).toBe("girly");
    expect(result.estimatedSubtotal).toBe(1200);
    expect(result.identitySubtotal).toBe(900);
    expect(result.identityAmountRemaining).toBe(100);
    expect(result.showIdentityHint).toBe(true);
    expect(result.lineBreakdown).toEqual([{ unitPrice: 120, subtotal: 1200 }]);
  });

  it.each([999.99, 1000, 1000.01])("uses the own-price Iconic boundary at %s", (amount) => {
    const result = cartRequestSummary(TIERS, [{ qty: 1, unitPrices: { regular: 2000, girly: 1500, iconic: amount } }])!;
    const qualifies = amount >= 1000;
    expect(result.identityQualifies).toBe(qualifies);
    expect(result.showIdentityHint).toBe(!qualifies);
    expect(result.activeTier.id).toBe(qualifies ? "iconic" : "regular");
    expect(result.estimatedSubtotal).toBe(qualifies ? amount : 2000);
    expect(result.lineBreakdown[0].subtotal).toBe(result.estimatedSubtotal);
    expect(result.identityAmountRemaining).toBeCloseTo(qualifies ? 0 : 0.01, 6);
  });

  it("uses only Iconic for the estimate and lines after reaching its minimum", () => {
    const result = summary(12);
    expect(result.activeTier.id).toBe("iconic");
    expect(result.estimatedSubtotal).toBe(1080);
    expect(result.showIdentityHint).toBe(false);
    expect(result.lineBreakdown).toEqual([{ unitPrice: 90, subtotal: 1080 }]);
  });

  it("restores the habitual comparison when removing a piece drops below Iconic", () => {
    expect(summary(11).activeTier.id).toBe("girly");
    expect(summary(11).identityAmountRemaining).toBe(10);
    expect(summary(12).activeTier.id).toBe("iconic");
    expect(summary(11).showIdentityHint).toBe(true);
    expect(summary(11).estimatedSubtotal).toBe(1320);
  });

  it("honors the store's configured minimum and renamed tier", () => {
    const tiers = TIERS.map(t => t.id === "iconic" ? { ...t, label: "Preferente", minAmount: 1500 } : t);
    const below = cartRequestSummary(tiers, [line(12)])!;
    expect(below.showIdentityHint).toBe(true);
    expect(below.identityAmountRemaining).toBe(420);
    expect(cartRequestSummary(tiers, [line(17)])!.activeTier.label).toBe("Preferente");
  });

  it("never qualifies or invents an Iconic subtotal with missing own prices", () => {
    const result = cartRequestSummary(TIERS, [line(20), { qty: 1, unitPrices: { regular: 100, girly: 80 } }])!;
    expect(result.identitySubtotal).toBeUndefined();
    expect(result.identityAmountRemaining).toBeUndefined();
    expect(result.identityQualifies).toBe(false);
    expect(result.activeTier.id).toBe("girly");
    expect(result.showIdentityHint).toBe(true);
    expect(result.estimatedSubtotal).toBe(2480);
  });

  it("compares exact cents across mixed lines at the boundary", () => {
    const result = cartRequestSummary(TIERS, [
      { qty: 1, unitPrices: { regular: 200, girly: 150, iconic: 123.45 } },
      { qty: 1, unitPrices: { regular: 1200, girly: 1000, iconic: 876.55 } },
    ])!;
    expect(result.identityQualifies).toBe(true);
    expect(result.identityAmountRemaining).toBe(0);
    expect(result.lineBreakdown.reduce((sum, l) => sum + l.subtotal, 0)).toBe(result.estimatedSubtotal);
  });

  it("retains quantity pricing for stores without an Iconic tier", () => {
    const result = cartRequestSummary(TIERS.slice(0, 2), [line(6)])!;
    expect(result.activeTier.id).toBe("girly");
    expect(result.estimatedSubtotal).toBe(720);
    expect(result.identityTier).toBeNull();
    expect(result.showIdentityHint).toBe(false);
  });

  it("can quote qualified Iconic when legacy lines lack a common habitual price", () => {
    const result = cartRequestSummary(TIERS, [{ qty: 20, unitPrices: { iconic: 60 } }])!;
    expect(result.activeTier.id).toBe("iconic");
    expect(result.estimatedSubtotal).toBe(1200);
    expect(result.showIdentityHint).toBe(false);
    expect(result.lineBreakdown).toEqual([{ unitPrice: 60, subtotal: 1200 }]);
  });

  it("preserves a deeper qualifying tier in a custom store", () => {
    const tiers = [
      { id: "regular", label: "Regular", order: 0 },
      { id: "iconic", label: "Iconic", order: 1, minAmount: 1000 },
      { id: "bulk", label: "Mayorista", order: 2, minPieces: 20 },
    ];
    const result = cartRequestSummary(tiers, [{ qty: 20, unitPrices: { regular: 100, iconic: 60, bulk: 50 } }])!;
    expect(result.activeTier.id).toBe("bulk");
    expect(result.estimatedSubtotal).toBe(1000);
    expect(result.lineBreakdown).toEqual([{ unitPrice: 50, subtotal: 1000 }]);
  });

  it("does not let an unqualified deeper fallback override qualified Iconic", () => {
    const tiers = [
      { id: "regular", label: "Regular", order: 0 },
      { id: "iconic", label: "Iconic", order: 1, minAmount: 1000 },
      { id: "bulk", label: "Mayorista", order: 2, minPieces: 100 },
    ];
    const result = cartRequestSummary(tiers, [{ qty: 20, unitPrices: { iconic: 60, bulk: 50 } }])!;
    expect(result.activeTier.id).toBe("iconic");
    expect(result.estimatedSubtotal).toBe(1200);
    expect(result.lineBreakdown).toEqual([{ unitPrice: 60, subtotal: 1200 }]);
  });

  it("does not expose hidden tiers or an estimate for an empty cart", () => {
    expect(cartRequestSummary(TIERS, [])).toBeNull();
    expect(cartRequestSummary(TIERS.map(t => ({ ...t, hidden: t.id === "iconic" })), [line(12)])!.identityTier).toBeNull();
  });
});

// #420 — casos exactos del collar del PO: Regular $150, Girly $100 (desde 5
// piezas), Iconic $70, mínimo Iconic $1,000 a precios Iconic.
describe("collar del PO (#420) — casos exactos del contrato", () => {
  const COLLAR: PriceTierDef[] = TIERS; // same shape: Regular / Girly(5) / Iconic($1,000)
  const collar = (qty: number): CartQtyLine[] => [{ qty, unitPrices: { regular: 150, girly: 100, iconic: 70 } }];
  const summary = (qty: number) => cartRequestSummary(COLLAR, collar(qty))!;

  it("4 piezas: $600 a precio Regular principal, $280 Iconic en la segunda fila", () => {
    const r = summary(4);
    expect(r.activeTier.id).toBe("regular");
    expect(r.estimatedSubtotal).toBe(600);
    expect(r.showIdentityHint).toBe(true);
    expect(r.identitySubtotal).toBe(280);
    expect(r.identityAmountRemaining).toBe(720);
  });

  it("5 piezas: $500 a precio Girly principal, $350 Iconic en la segunda fila", () => {
    const r = summary(5);
    expect(r.activeTier.id).toBe("girly");
    expect(r.estimatedSubtotal).toBe(500);
    expect(r.showIdentityHint).toBe(true);
    expect(r.identitySubtotal).toBe(350);
    expect(r.identityAmountRemaining).toBe(650);
  });

  it("15 piezas: $1,050 a precio Iconic como principal; segunda fila oculta", () => {
    const r = summary(15);
    expect(r.activeTier.id).toBe("iconic");
    expect(r.estimatedSubtotal).toBe(1050);
    expect(r.identityQualifies).toBe(true);
    expect(r.showIdentityHint).toBe(false);
    expect(r.lineBreakdown).toEqual([{ unitPrice: 70, subtotal: 1050 }]);
  });

  it("14 piezas (quitando una): $1,400 a precio Girly principal, $980 Iconic en la segunda fila", () => {
    const r = summary(14);
    expect(r.activeTier.id).toBe("girly");
    expect(r.estimatedSubtotal).toBe(1400);
    expect(r.showIdentityHint).toBe(true);
    expect(r.identitySubtotal).toBe(980);
    expect(r.identityAmountRemaining).toBe(20);
  });

  it("10 piezas a $100 Girly: el estimado Iconic $700 sigue visible", () => {
    const r = summary(10);
    expect(r.activeTier.id).toBe("girly");
    expect(r.estimatedSubtotal).toBe(1000);
    expect(r.showIdentityHint).toBe(true);
    expect(r.identitySubtotal).toBe(700);
    expect(r.identityAmountRemaining).toBe(300);
  });
});

// #442 — tierSubtotalRows: the comparable per-tier rows behind Olivia's cart.
describe("tierSubtotalRows (#442) — Huggies Mezcal Gold", () => {
  const HUGGIES: PriceTierDef[] = [
    { id: "regular", label: "Regular", order: 0 },
    { id: "girly", label: "Girly", order: 1, minPieces: 5 },
    { id: "iconic", label: "Iconic", order: 2, minAmount: 1000 },
  ];
  const piece = (qty: number): CartQtyLine[] => [{ qty, unitPrices: { regular: 105, girly: 70, iconic: 45 } }];
  const rows = (qty: number) => tierSubtotalRows(HUGGIES, piece(qty));
  const byId = (list: ReturnType<typeof rows>, id: string) => list.find((r) => r.tier.id === id)!;

  it("1 pieza: Regular califica; Girly faltan 4 piezas; Iconic faltan $955", () => {
    const r = rows(1);
    expect(r.map((row) => row.tier.id)).toEqual(["regular", "girly", "iconic"]);
    expect(byId(r, "regular")).toMatchObject({ subtotal: 105, qualifies: true });
    expect(byId(r, "girly")).toMatchObject({ subtotal: 70, qualifies: false, piecesRemaining: 4 });
    expect(byId(r, "iconic")).toMatchObject({ subtotal: 45, qualifies: false, amountRemaining: 955 });
  });

  it("5 piezas: Girly califica; Iconic faltan $775", () => {
    const r = rows(5);
    expect(byId(r, "girly")).toMatchObject({ subtotal: 350, qualifies: true, piecesRemaining: 0 });
    expect(byId(r, "iconic")).toMatchObject({ subtotal: 225, qualifies: false, amountRemaining: 775 });
  });

  it("23 piezas: Iconic califica ($1,035 ≥ $1,000); 22 faltan $10", () => {
    const r23 = rows(23);
    expect(byId(r23, "regular").subtotal).toBe(2415);
    expect(byId(r23, "girly").subtotal).toBe(1610);
    expect(byId(r23, "iconic")).toMatchObject({ subtotal: 1035, qualifies: true });
    const r22 = rows(22);
    expect(byId(r22, "girly")).toMatchObject({ subtotal: 1540, qualifies: true });
    expect(byId(r22, "iconic")).toMatchObject({ subtotal: 990, qualifies: false, amountRemaining: 10 });
  });

  it("pieza sin precio de esa tarifa: subtotal «Por confirmar» sin faltante de monto; las demás filas calculan", () => {
    const r = tierSubtotalRows(HUGGIES, [
      { qty: 3, unitPrices: { regular: 105, girly: 70, iconic: 45 } },
      { qty: 2, unitPrices: { regular: 120, girly: 80 } },
    ]);
    expect(byId(r, "regular").subtotal).toBe(3 * 105 + 2 * 120);
    expect(byId(r, "girly").subtotal).toBe(3 * 70 + 2 * 80);
    expect(byId(r, "iconic").subtotal).toBeUndefined();
    expect(byId(r, "iconic").amountRemaining).toBeUndefined();
    expect(byId(r, "iconic").qualifies).toBe(false);
  });

  it("el faltante de PIEZAS no requiere precios: ayuda disponible aunque el subtotal esté «Por confirmar»", () => {
    const r = tierSubtotalRows(HUGGIES, [
      { qty: 1, unitPrices: { regular: 105, iconic: 45 } }, // sin girly
    ]);
    const girly = byId(r, "girly");
    expect(girly.subtotal).toBeUndefined();
    expect(girly.piecesRemaining).toBe(4);
    expect(girly.qualifies).toBe(false);
  });

  it("omite tarifas ocultas", () => {
    const tiers = HUGGIES.map((t) => (t.id === "iconic" ? { ...t, hidden: true } : t));
    expect(tierSubtotalRows(tiers, piece(23)).map((row) => row.tier.id)).toEqual(["regular", "girly"]);
  });

  it("varias líneas: faltante de piezas cuenta el total del carrito", () => {
    const r = tierSubtotalRows(HUGGIES, [
      { qty: 2, unitPrices: { regular: 105, girly: 70, iconic: 45 } },
      { qty: 2, unitPrices: { regular: 120, girly: 80, iconic: 50 } },
    ]);
    expect(byId(r, "girly").piecesRemaining).toBe(1);
    expect(byId(r, "iconic").subtotal).toBe(2 * 45 + 2 * 50);
  });

  it.each([999.99, 1000, 1000.01])("frontera de monto a %s con centavos exactos", (amount) => {
    const r = tierSubtotalRows(HUGGIES, [{ qty: 1, unitPrices: { regular: 2000, girly: 1500, iconic: amount } }]);
    const iconic = byId(r, "iconic");
    expect(iconic.qualifies).toBe(amount >= 1000);
    expect(iconic.amountRemaining).toBe(amount < 1000 ? 0.01 : 0);
  });
});
