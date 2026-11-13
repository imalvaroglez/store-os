// Public cart summary: habitual line prices and the separate identity estimate.
import { describe, expect, it } from "vitest";
import {
  cartRequestSummary,
  isIdentityGatedTier,
  type CartQtyLine,
} from "./pricing";
import type { PriceTierDef } from "../types";

// Olivia-like config: Regular (t_retail), Girly (t_wholesale, 5 pieces),
// Iconic (t_reseller, $1,000 at own prices — the identity-gated one).
const OLIVIA_TIERS: PriceTierDef[] = [
  { id: "t_retail", label: "Regular", order: 0 },
  { id: "t_wholesale", label: "Girly", order: 1, minPieces: 5 },
  { id: "t_reseller", label: "Iconic", order: 2, minAmount: 1000 },
];

const line = (prices: Record<string, number>, qty = 1): CartQtyLine => ({ qty, unitPrices: prices });

describe("isIdentityGatedTier — configuración, no texto", () => {
  it("umbral puro de dinero = identidad; umbral de piezas = demostrable en carrito", () => {
    expect(isIdentityGatedTier(OLIVIA_TIERS[2])).toBe(true); // minAmount only
    expect(isIdentityGatedTier(OLIVIA_TIERS[1])).toBe(false); // minPieces
    expect(isIdentityGatedTier(OLIVIA_TIERS[0])).toBe(false);
  });
});

describe("habitual headline", () => {
  it("1 pieza: Regular; 5+ piezas: Girly (demostrable por cantidad), nunca Iconic", () => {
    const lines = [
      line({ t_retail: 100, t_wholesale: 80, t_reseller: 35 }),
      line({ t_retail: 100, t_wholesale: 80, t_reseller: 35 }, 4),
    ];
    const summary = cartRequestSummary(OLIVIA_TIERS, lines)!;
    expect(summary.habitualTier.id).toBe("t_wholesale"); // 5 piezas → Girly
    expect(summary.habitualSubtotal).toBe(5 * 80);
    expect(summary.identityTier?.id).toBe("t_reseller");
    expect(summary.identitySubtotal).toBe(5 * 35);
  });

  it("aunque el carrito 'califique' Iconic por monto, el titular nunca es Iconic", () => {
    // 12 piezas a $100 Regular / $80 Girly / $90 Iconic: Iconic ≥ $1,000 propio.
    const lines = [line({ t_retail: 100, t_wholesale: 80, t_reseller: 90 }, 12)];
    const summary = cartRequestSummary(OLIVIA_TIERS, lines)!;
    expect(summary.habitualTier.id).toBe("t_wholesale");
    expect(summary.habitualSubtotal).toBe(960);
  });
});

describe("sin precio propio Iconic — Por confirmar, jamás fallback", () => {
  it("línea sin precio Iconic conserva la tarifa pero no inventa un subtotal", () => {
    const lines = [line({ t_retail: 100, t_wholesale: 80 })]; // sin t_reseller
    const summary = cartRequestSummary(OLIVIA_TIERS, lines)!;
    expect(summary.habitualSubtotal).toBe(100);
    expect(summary.identityTier?.id).toBe("t_reseller");
    expect(summary.identitySubtotal).toBeUndefined();
  });
  it("una sola línea sin precio Iconic contamina el total completo (sin mezclar)", () => {
    const lines = [
      line({ t_retail: 100, t_wholesale: 80, t_reseller: 35 }, 2),
      line({ t_retail: 100, t_wholesale: 80 }), // sin Iconic
    ];
    const summary = cartRequestSummary(OLIVIA_TIERS, lines)!;
    expect(summary.identitySubtotal).toBeUndefined();
  });
});

describe("tiendas sin nivel de identidad", () => {
  it("dos niveles por cantidad: el habitual sigue las reglas, sin estimado de identidad", () => {
    const tiers: PriceTierDef[] = [
      { id: "t_retail", label: "Regular", order: 0 },
      { id: "t_wholesale", label: "Girly", order: 1, minPieces: 5 },
    ];
    const summary = cartRequestSummary(tiers, [line({ t_retail: 100, t_wholesale: 80 }, 6)])!;
    expect(summary.habitualTier.id).toBe("t_wholesale");
    expect(summary.identityTier).toBeNull();
    expect(summary.identitySubtotal).toBeUndefined();
  });
});

// 1.13.1 — the cart lines share the headline's derivation. The reproduced
// defect: 19 pieces at $140/$105/$55 showed Iconic lines ($55/$1,045) next to
// a Girly headline ($1,995). Lines must always carry the habitual tier.
describe("lineBreakdown — una sola derivación con el titular", () => {
  it("caso reproducido: 19 piezas $140/$105/$55 → línea Girly $105/$1,995, no Iconic", () => {
    const summary = cartRequestSummary(OLIVIA_TIERS, [
      line({ t_retail: 140, t_wholesale: 105, t_reseller: 55 }, 19),
    ])!;
    expect(summary.habitualTier.id).toBe("t_wholesale");
    expect(summary.habitualSubtotal).toBe(1995);
    expect(summary.lineBreakdown).toEqual([{ unitPrice: 105, subtotal: 1995 }]);
    expect(summary.identitySubtotal).toBe(1045);
  });

  it("las líneas siguen al titular al cruzar $1,000 en ambos sentidos (centavos reales)", () => {
    const at = (qty: number) => cartRequestSummary(OLIVIA_TIERS, [
      line({ t_retail: 70, t_wholesale: 52.63, t_reseller: 25 }, qty),
    ])!;
    const below = at(19); // 19 × $52.63 = $999.97
    expect(below.habitualSubtotal).toBeCloseTo(999.97, 6);
    expect(below.lineBreakdown[0].unitPrice).toBe(52.63);
    expect(below.lineBreakdown[0].subtotal).toBeCloseTo(999.97, 6);
    const above = at(20); // 20 × $52.63 = $1,052.60
    expect(above.habitualSubtotal).toBeCloseTo(1052.6, 6);
    expect(above.lineBreakdown[0].unitPrice).toBe(52.63);
    expect(above.lineBreakdown[0].subtotal).toBeCloseTo(1052.6, 6);
  });

  it("Σ lineBreakdown === habitualSubtotal, multi-línea con precios mixtos", () => {
    const lines = [
      line({ t_retail: 140, t_wholesale: 105, t_reseller: 55 }, 7),
      line({ t_retail: 90.5, t_wholesale: 70.25, t_reseller: 40 }, 3),
    ];
    const summary = cartRequestSummary(OLIVIA_TIERS, lines)!; // 10 piezas → Girly
    expect(summary.lineBreakdown).toEqual([
      { unitPrice: 105, subtotal: 735 },
      { unitPrice: 70.25, subtotal: 210.75 },
    ]);
    expect(summary.lineBreakdown.reduce((sum, l) => sum + l.subtotal, 0))
      .toBeCloseTo(summary.habitualSubtotal, 6);
  });

  it("una línea sin precio Iconic no contamina las líneas habituales", () => {
    const lines = [
      line({ t_retail: 100, t_wholesale: 80, t_reseller: 35 }, 4),
      line({ t_retail: 100, t_wholesale: 80 }), // sin Iconic
    ];
    const summary = cartRequestSummary(OLIVIA_TIERS, lines)!; // 5 piezas → Girly
    expect(summary.lineBreakdown).toEqual([
      { unitPrice: 80, subtotal: 320 },
      { unitPrice: 80, subtotal: 80 },
    ]);
    expect(summary.habitualSubtotal).toBe(400);
    expect(summary.identitySubtotal).toBeUndefined(); // «Por confirmar», sin cifra
  });
});
