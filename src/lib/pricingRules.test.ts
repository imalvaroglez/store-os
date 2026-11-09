// @vitest-environment jsdom
// #254 — the suggested-price engine: precedence, bands, rounding, packaging base.
import { describe, it, expect } from "vitest";
import { applyRound, baseCostForTier, resolveRule, suggestedPriceFor, suggestionForTier, validateBands } from "./pricingRules";

const product = { id: "p1", categoryIds: ["cat_anillos"], cost: 100 };

describe("resolveRule — precedencia producto > categoría > general", () => {
  it("usa la excepción de producto cuando existe", () => {
    const resolved = resolveRule(
      {
        byTier: { t: { kind: "markup" as const, percent: 100 } },
        byCategory: { cat_anillos: { t: { kind: "fixed" as const, amount: 50 } } },
        byProduct: { p1: { t: { kind: "markup" as const, percent: 300 } } },
      },
      "t",
      product
    );
    expect(resolved?.origin).toBe("product");
    expect(resolved?.rule).toEqual({ kind: "markup" as const, percent: 300 });
  });

  it("cae a la categoría y luego a la general", () => {
    const config = {
      byTier: { t: { kind: "markup" as const, percent: 100 } },
      byCategory: { cat_anillos: { t: { kind: "fixed" as const, amount: 50 } } },
    };
    expect(resolveRule(config, "t", product)?.origin).toBe("category");
    expect(resolveRule({ byTier: config.byTier }, "t", product)?.origin).toBe("general");
    expect(resolveRule(undefined, "t", product)).toBeUndefined();
  });

  it("nivel sin regla no hereda la de otro nivel", () => {
    expect(resolveRule({ byTier: { t_retail: { kind: "markup" as const, percent: 100 } } }, "t_iconic", product)).toBeUndefined();
  });
});

describe("applyRound — redondeo hacia arriba", () => {
  it("sin redondeo y a $1 usan el entero más cercano; $5 y $10 suben al escalón", () => {
    expect(applyRound(156.4, "none")).toBe(156);
    expect(applyRound(156.6, "1")).toBe(157);
    expect(applyRound(156.1, "5")).toBe(160);
    expect(applyRound(151, "5")).toBe(155);
    expect(applyRound(151, "10")).toBe(160);
    expect(applyRound(160, "10")).toBe(160);
  });
});

describe("baseCostForTier — costo + empaque individual del nivel", () => {
  const packaging = {
    materials: [
      { id: "m_bolsa", name: "Bolsa", estimatedCost: 0.5 },
      { id: "m_carton", name: "Cartoncito", estimatedCost: 0.2 },
    ],
    byTier: {
      t_iconic: { perPiece: [{ materialId: "m_bolsa", units: 1 }], perOrder: [{ materialId: "m_rosa", units: 1 }] },
      t_retail: { perPiece: [{ materialId: "m_bolsa", units: 1 }, { materialId: "m_carton", units: 1 }], perOrder: [] },
    },
  };

  it("Iconic suma la bolsa; Regular suma bolsa+cartoncito; el empaque por pedido NUNCA entra", () => {
    expect(baseCostForTier({ cost: 100 }, "t_iconic", packaging)).toBe(100.5);
    expect(baseCostForTier({ cost: 100 }, "t_retail", packaging)).toBe(100.7);
  });

  it("sin costo de producto no hay base; sin empaques la base es el costo", () => {
    expect(baseCostForTier({ cost: undefined }, "t_iconic", packaging)).toBeUndefined();
    expect(baseCostForTier({ cost: 100 }, "t_iconic", undefined)).toBe(100);
  });
});

describe("suggestedPriceFor — tres métodos", () => {
  it("markup: +200% sobre base 100 → 300 (y la ganancia sobre venta es 66.7%, no 200%)", () => {
    expect(suggestedPriceFor({ kind: "markup", percent: 200 }, { baseCost: 100, acquisitionCost: 100 })).toBe(300);
  });

  it("fixed: +$150 sobre base 100 → 250", () => {
    expect(suggestedPriceFor({ kind: "fixed", amount: 150 }, { baseCost: 100, acquisitionCost: 100 })).toBe(250);
  });

  it("bands: el costo DE ADQUISICIÓN elige la banda — intervalos [a, b)", () => {
    const rule = { kind: "bands" as const, bands: [
      { min: 0, max: 90, price: 160 },
      { min: 90, max: 115, price: 170 },
      { min: 115, price: 185 },
    ] };
    expect(suggestedPriceFor(rule, { baseCost: 100.7, acquisitionCost: 89.99 })).toBe(160);
    expect(suggestedPriceFor(rule, { baseCost: 100.7, acquisitionCost: 90 })).toBe(170); // el límite exacto va a la SIGUIENTE
    expect(suggestedPriceFor(rule, { baseCost: 100.7, acquisitionCost: 114.99 })).toBe(170);
    expect(suggestedPriceFor(rule, { baseCost: 100.7, acquisitionCost: 115 })).toBe(185);
  });

  it("un costo fuera de toda banda es 'sin sugerencia', nunca un precio inventado", () => {
    expect(suggestedPriceFor({ kind: "bands", bands: [{ min: 90, max: 115, price: 170 }] }, { baseCost: 100, acquisitionCost: 50 })).toBeNull();
  });

  it("markup y fixed sin base (producto sin costo) no sugieren", () => {
    expect(suggestedPriceFor({ kind: "markup" as const, percent: 100 }, { baseCost: undefined, acquisitionCost: undefined })).toBeNull();
  });

  it("el redondeo se aplica al final (banda 156 → $160 con redondeo a 10)", () => {
    expect(suggestedPriceFor({ kind: "bands", bands: [{ min: 0, price: 156 }], rounding: "10" }, { baseCost: 1, acquisitionCost: 1 })).toBe(160);
  });
});

describe("validateBands — límites inequívocos", () => {
  it("bandas contiguas [a,b) válidas", () => {
    expect(validateBands([{ min: 0, max: 90, price: 160 }, { min: 90, max: 115, price: 170 }, { min: 115, price: 185 }])).toBeNull();
  });

  it("hueco, traslape, tope sin mínimo y solo-última-sin-tope", () => {
    expect(validateBands([{ min: 0, max: 80, price: 1 }, { min: 90, price: 2 }])).toMatch(/hueco/);
    expect(validateBands([{ min: 0, max: 100, price: 1 }, { min: 90, price: 2 }])).toMatch(/traslapan/);
    expect(validateBands([{ min: 0, max: 50, price: 1 }, { min: 50, price: 2 }, { min: 60, price: 3 }])).toMatch(/sin tope/);
    expect(validateBands([])).toMatch(/al menos una banda/);
    expect(validateBands([{ min: 0, max: 50, price: 0 }])).toMatch(/precio mayor que cero/);
  });
});

describe("suggestionForTier — integración", () => {
  const packaging = {
    materials: [{ id: "m_bolsa", name: "Bolsa", estimatedCost: 0.5 }],
    byTier: { t_iconic: { perPiece: [{ materialId: "m_bolsa", units: 1 }], perOrder: [] } },
  };

  it("markup Iconic +100% sobre costo 100 con bolsa → 201", () => {
    const s = suggestionForTier(product, "t_iconic", { byTier: { t_iconic: { kind: "markup" as const, percent: 100 } } }, packaging);
    expect(s.baseCost).toBe(100.5);
    expect(s.suggested).toBe(201);
    expect(s.origin).toBe("general");
  });
});
