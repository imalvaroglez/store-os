// #280 — band-proposal generator tests: determinism, explainable k choice,
// support thresholds, evidence-based prices (nothing invented), packaging
// treatment (contribution, never limits; gaps flagged, never $0) and validity
// of the emitted tables.
import { describe, expect, it } from "vitest";
import {
  canonicalTiers,
  packagingGaps,
  proposeCategoryBands,
  tierEvidence,
  type BandProduct,
  type BandTier,
} from "./pricingBands";
import { validateBands } from "./pricingRules";
import type { StorePackaging } from "../types";

const TIERS: BandTier[] = [
  { id: "t_regular", label: "Regular" },
  { id: "t_girly", label: "Girly" },
  { id: "t_iconic", label: "Iconic" },
];

let counter = 0;
function product(cost: number, prices?: Partial<Record<string, number>>, quantityOnHand = 1): BandProduct {
  counter += 1;
  return {
    id: `p${counter}`,
    name: `Pieza ${counter}`,
    categoryIds: ["cat"],
    cost,
    prices: prices as Record<string, number> | undefined,
    quantityOnHand,
  };
}

const cheap = (extra: Partial<Record<string, number>> = {}) => ({ t_regular: 100, t_girly: 80, t_iconic: 50, ...extra });
const pricey = (extra: Partial<Record<string, number>> = {}) => ({ t_regular: 290, t_girly: 250, t_iconic: 165, ...extra });

function multimodalCategory(): BandProduct[] {
  return [
    ...Array.from({ length: 8 }, () => product(20, cheap())),
    ...Array.from({ length: 4 }, () => product(22, cheap())),
    ...Array.from({ length: 8 }, () => product(95, pricey())),
  ];
}

describe("proposeCategoryBands", () => {
  it("is deterministic: same input, same proposal", () => {
    const products = multimodalCategory();
    const a = proposeCategoryBands({ products, categoryId: "cat", tiers: TIERS });
    const b = proposeCategoryBands({ products, categoryId: "cat", tiers: TIERS });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("splits a clearly separated cost distribution instead of collapsing to one band", () => {
    const proposal = proposeCategoryBands({ products: multimodalCategory(), categoryId: "cat", tiers: TIERS });
    expect(proposal?.bands).not.toBeNull();
    expect((proposal?.bands?.length ?? 1)).toBeGreaterThan(1);
    const chosen = proposal?.kSummary.find((o) => o.status === "chosen");
    expect(chosen?.k).toBeGreaterThan(1);
    // Every alternative leaves its plain-Spanish reason behind.
    expect(proposal?.kSummary.length).toBeGreaterThan(1);
    for (const option of proposal?.kSummary ?? []) expect(option.reason.length).toBeGreaterThan(5);
  });

  it("keeps one band for a tight distribution (k=1 wins only when nothing separates)", () => {
    const tight = Array.from({ length: 12 }, (_, i) => product(20 + (i % 2), cheap()));
    const proposal = proposeCategoryBands({ products: tight, categoryId: "cat", tiers: TIERS });
    expect(proposal?.bands?.length).toBe(1);
    expect(proposal?.bands?.[0].min).toBe(0);
    expect(proposal?.bands?.[0].max).toBeUndefined();
    // 2 distinct costs ⇒ statistical support is low, and it says so.
    expect(proposal?.support).toBe("low");
  });

  it("refuses to propose anything presentable for a tiny sample", () => {
    const tiny = [product(20, cheap()), product(21, cheap()), product(22, cheap())];
    const proposal = proposeCategoryBands({ products: tiny, categoryId: "cat", tiers: TIERS });
    expect(proposal?.bands).toBeNull();
    expect(proposal?.supportReason).toContain("Muestra insuficiente");
  });

  it("emits contiguous [min, max) tables that pass validateBands for every tier", () => {
    const proposal = proposeCategoryBands({ products: multimodalCategory(), categoryId: "cat", tiers: TIERS });
    const bands = proposal?.bands ?? [];
    for (let i = 0; i < bands.length - 1; i += 1) expect(bands[i].max).toBe(bands[i + 1].min);
    expect(bands[bands.length - 1].max).toBeUndefined();
    for (const tier of TIERS) {
      const table = bands.map((b) => ({ min: b.min, max: b.max, price: b.prices[tier.id] ?? 0 }));
      expect(validateBands(table)).toBeNull();
    }
  });

  it("anchors prices on the in-band median, rounded to the $10 ladder", () => {
    const proposal = proposeCategoryBands({ products: multimodalCategory(), categoryId: "cat", tiers: TIERS });
    const bands = proposal?.bands ?? [];
    expect(bands[0].prices.t_regular).toBe(100);
    expect(bands[0].prices.t_iconic).toBe(50);
    expect(bands[bands.length - 1].prices.t_regular).toBe(290);
    expect(bands[bands.length - 1].prices.t_girly).toBe(250);
  });

  it("leaves a tier pendiente when a band has zero price evidence — never invents", () => {
    const noIconic = [
      ...Array.from({ length: 8 }, () => product(20, { t_regular: 100, t_girly: 80 })),
      ...Array.from({ length: 8 }, () => product(95, { t_regular: 290, t_girly: 250 })),
    ];
    const proposal = proposeCategoryBands({ products: noIconic, categoryId: "cat", tiers: TIERS });
    for (const band of proposal?.bands ?? []) {
      expect(band.prices.t_iconic).toBeNull();
      expect(band.priceSupport.t_iconic).toBe("pending");
    }
  });

  it("marks weak a price backed by fewer than 3 current prices", () => {
    const sparse = Array.from({ length: 9 }, (_, i) =>
      product(20 + i, i < 2 ? { t_regular: 100, t_girly: 80, t_iconic: 50 } : { t_regular: 100, t_girly: 80 })
    );
    const proposal = proposeCategoryBands({ products: sparse, categoryId: "cat", tiers: TIERS });
    const band = proposal?.bands?.[0];
    expect(band?.priceSupport.t_iconic).toBe("weak");
    expect(band?.prices.t_iconic).toBe(50);
  });

  it("keeps band limits on acquisition cost; packaging only moves contribution", () => {
    const packaging: StorePackaging = {
      materials: [{ id: "m1", name: "Bolsita", estimatedCost: 0.5 }],
      byTier: { t_girly: { perPiece: [{ materialId: "m1", units: 1 }], perOrder: [] } },
    };
    const withPack = proposeCategoryBands({ products: multimodalCategory(), categoryId: "cat", tiers: TIERS, packaging });
    const bare = proposeCategoryBands({ products: multimodalCategory(), categoryId: "cat", tiers: TIERS });
    expect(JSON.stringify(withPack?.bands?.map((b) => [b.min, b.max]))).toBe(
      JSON.stringify(bare?.bands?.map((b) => [b.min, b.max]))
    );
    // Worst-case base cost inside band 1 for Girly = 22 + 0.50 bolsa ⇒ 80 − 22.50 = 57.50.
    expect(withPack?.bands?.[0].minContribution.t_girly).toBe(57.5);
    expect(bare?.bands?.[0].minContribution.t_girly).toBe(58);
  });

  it("flags packaging materials without a cost as incomplete, not $0", () => {
    const packaging: StorePackaging = {
      materials: [{ id: "m2", name: "Cartoncito" }],
      byTier: { t_regular: { perPiece: [{ materialId: "m2", units: 1 }], perOrder: [] } },
    };
    expect(packagingGaps(packaging, "t_regular")).toEqual(["Cartoncito"]);
    const proposal = proposeCategoryBands({ products: multimodalCategory(), categoryId: "cat", tiers: TIERS, packaging });
    expect(proposal?.warnings.some((w) => w.includes("incompleto") && w.includes("Cartoncito"))).toBe(true);
  });

  it("excludes products without a reliable cost and warns about them", () => {
    const products = [...multimodalCategory(), product(0, cheap()), { ...product(30, cheap()), cost: undefined }];
    const proposal = proposeCategoryBands({ products, categoryId: "cat", tiers: TIERS });
    expect(proposal?.analysis.withCost).toBe(20);
    expect(proposal?.analysis.withoutCost).toBe(2);
    expect(proposal?.warnings.some((w) => w.includes("sin costo confiable"))).toBe(true);
  });

  it("warns when the current-price medians violate Regular > Girly > Iconic", () => {
    const inverted = [
      ...Array.from({ length: 8 }, () => product(20, { t_regular: 100, t_girly: 120, t_iconic: 50 })),
      ...Array.from({ length: 8 }, () => product(95, { t_regular: 290, t_girly: 310, t_iconic: 165 })),
    ];
    const proposal = proposeCategoryBands({ products: inverted, categoryId: "cat", tiers: TIERS });
    expect(proposal?.warnings.some((w) => w.includes("Regular > Girly > Iconic"))).toBe(true);
  });

  it("ignores products whose primary category is different", () => {
    const foreign = { ...product(500, pricey()), categoryIds: ["otra"] };
    const proposal = proposeCategoryBands({ products: [...multimodalCategory(), foreign], categoryId: "cat", tiers: TIERS });
    expect(proposal?.analysis.skuCount).toBe(20);
    expect(proposal?.analysis.costMax).toBe(95);
  });
});

describe("tier metadata helpers", () => {
  it("maps canonical labels to their evidence level", () => {
    expect(tierEvidence("Iconic")).toBe("orders");
    expect(tierEvidence("Emprendedora")).toBe("orders");
    expect(tierEvidence("Girly")).toBe("prices");
    expect(tierEvidence("Regular")).toBe("reference");
    expect(tierEvidence("Menudeo")).toBe("reference");
  });

  it("finds canonical tiers by label and returns null when one is missing", () => {
    expect(canonicalTiers(TIERS)).toEqual({ regular: "t_regular", girly: "t_girly", iconic: "t_iconic" });
    expect(canonicalTiers([{ id: "a", label: "Regular" }, { id: "b", label: "Girly" }])).toBeNull();
  });
});

describe("P0/P1 fixes (#280)", () => {
  it("P0-1: detecta las piezas cuyo precio propuesto queda bajo su costo, con su estado de existencia, y NO sube la banda", () => {
    // Two clusters with consistent prices + ONE expensive outlier inside the
    // upper cluster whose cost exceeds every proposed price.
    const outlier = product(222, pricey(), 0); // agotada
    const inStockOutlier = product(190, pricey(), 3);
    const products = [...multimodalCategory(), outlier, inStockOutlier];
    const proposal = proposeCategoryBands({ products, categoryId: "cat", tiers: TIERS });
    const topBand = proposal?.bands?.[(proposal?.bands?.length ?? 1) - 1];
    expect(topBand).toBeDefined();
    const below = topBand!.belowCost.map((b) => b.member.id);
    expect(below).toContain(outlier.id);
    expect(below).toContain(inStockOutlier.id);
    const flags = Object.fromEntries(topBand!.belowCost.map((b) => [b.member.id, b.member.inStock]));
    expect(flags[outlier.id]).toBe(false);
    expect(flags[inStockOutlier.id]).toBe(true);
    // The offending tiers are listed with price vs base cost (Iconic 165 < 190).
    const entry = topBand!.belowCost.find((b) => b.member.id === inStockOutlier.id)!;
    expect(entry.tiers.length).toBe(1);
    expect(entry.tiers[0]).toMatchObject({ tierId: "t_iconic", price: 165 });
    // The band's prices are NOT raised to cover the outliers.
    expect(topBand!.prices.t_regular).toBe(290);
    expect(proposal?.warnings.some((w) => w.includes("bajo su costo base") && w.includes("1 con existencia"))).toBe(true);
  });

  it("P1: respeta los precios que Fer ya usa con terminación $5 (no los arrastra a la escalera de $10)", () => {
    const piercing = Array.from({ length: 9 }, () => product(15.85, { t_regular: 90, t_girly: 65, t_iconic: 35 }));
    const proposal = proposeCategoryBands({ products: piercing, categoryId: "cat", tiers: TIERS });
    expect(proposal?.bands?.[0].prices).toEqual({ t_regular: 90, t_girly: 65, t_iconic: 35 });
  });

  it("P1: bandas que cobrarían lo mismo en todos los niveles se consolidan en una", () => {
    const flat = [
      ...Array.from({ length: 10 }, () => product(20, cheap())),
      ...Array.from({ length: 10 }, () => product(95, cheap())), // mismos precios en el clúster caro
    ];
    const proposal = proposeCategoryBands({ products: flat, categoryId: "cat", tiers: TIERS });
    expect(proposal?.bands?.length).toBe(1);
    expect(proposal?.bands?.[0].max).toBeUndefined();
    expect(proposal?.chosenReason).toContain("consolidó");
    expect(proposal?.bands?.[0].skuCount).toBe(20);
  });

  it("P1: el soporte distingue catálogo histórico de inventario disponible", () => {
    const products = multimodalCategory().map((p, i) => ({ ...p, quantityOnHand: i < 3 ? 1 : 0 }));
    const proposal = proposeCategoryBands({ products, categoryId: "cat", tiers: TIERS });
    expect(proposal?.analysis.withCost).toBe(20);
    expect(proposal?.analysis.withCostInStock).toBe(3);
    expect(proposal?.supportReason).toContain("3 de ellas con existencia");
  });
});

describe("empaques no configurados (regla PO 2026-11-09)", () => {
  it("advierte que el costo base es solo adquisición cuando el nivel no tiene perfil de empaque", () => {
    const packaging = {
      materials: [{ id: "m1", name: "Bolsita", estimatedCost: 0.5 }],
      byTier: { t_girly: { perPiece: [{ materialId: "m1", units: 1 }], perOrder: [] } }, // solo Girly configurado
    };
    const proposal = proposeCategoryBands({ products: multimodalCategory(), categoryId: "cat", tiers: TIERS, packaging });
    expect(proposal?.warnings).toContain(
      "Empaque individual de Regular sin configurar: el costo base es SOLO adquisición. Configúralo en Productos → Empaques para ver contribuciones completas."
    );
    expect(proposal?.warnings).toContain(
      "Empaque individual de Iconic sin configurar: el costo base es SOLO adquisición. Configúralo en Productos → Empaques para ver contribuciones completas."
    );
    // Girly sí está configurado: sin esa advertencia, pero su contribución la mueve el empaque.
    expect(proposal?.warnings.some((w) => w.includes("Girly sin configurar"))).toBe(false);
    expect(proposal?.bands?.[0].minContribution.t_girly).toBe(57.5);
  });

  it("sin empaques en absoluto, todos los niveles quedan marcados como preliminares", () => {
    const proposal = proposeCategoryBands({ products: multimodalCategory(), categoryId: "cat", tiers: TIERS });
    expect(proposal?.warnings.filter((w) => w.includes("sin configurar")).length).toBe(3);
  });
});
