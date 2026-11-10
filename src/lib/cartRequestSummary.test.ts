// #305 — contract tests for the public cart request summary: the habitual
// (non-identity) headline, the conditional identity row, and the $1,000
// visibility threshold with its mandatory boundary cases.
import { describe, expect, it } from "vitest";
import {
  IDENTITY_HINT_MAX_SUBTOTAL,
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

function habitualAt(subtotal: number): CartQtyLine[] {
  // Regular price chosen so qty × price == subtotal exactly.
  return [line({ t_retail: subtotal, t_wholesale: subtotal * 0.8, t_reseller: subtotal * 0.35 })];
}

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

describe("umbral de visibilidad — fronteras obligatorias", () => {
  it("$999.99 muestra ambas filas", () => {
    const summary = cartRequestSummary(OLIVIA_TIERS, habitualAt(999.99))!;
    expect(summary.habitualSubtotal).toBeCloseTo(999.99, 6);
    expect(summary.showIdentityHint).toBe(true);
  });
  it("$1,000.00 y $1,000.01 solo la habitual", () => {
    expect(cartRequestSummary(OLIVIA_TIERS, habitualAt(1000))!.showIdentityHint).toBe(false);
    expect(cartRequestSummary(OLIVIA_TIERS, habitualAt(1000.01))!.showIdentityHint).toBe(false);
  });
  it("el umbral se evalúa sobre el habitual, jamás sobre el hipotético Iconic", () => {
    // Habitual $1,200 (≥ umbral) aunque el Iconic sea $420: sin fila Iconic.
    const summary = cartRequestSummary(OLIVIA_TIERS, habitualAt(1200))!;
    expect(summary.showIdentityHint).toBe(false);
    expect(summary.identitySubtotal).toBeCloseTo(420, 6); // calculado pero no mostrado
  });
  it("IDENTITY_HINT_MAX_SUBTOTAL es exactamente 1000", () => {
    expect(IDENTITY_HINT_MAX_SUBTOTAL).toBe(1000);
  });
});

describe("sin precio propio Iconic — Por confirmar, jamás fallback", () => {
  it("línea sin precio Iconic: identitySubtotal undefined (no $0, no precio ajeno)", () => {
    const lines = [line({ t_retail: 100, t_wholesale: 80 })]; // sin t_reseller
    const summary = cartRequestSummary(OLIVIA_TIERS, lines)!;
    expect(summary.habitualSubtotal).toBe(100);
    expect(summary.identitySubtotal).toBeUndefined();
    expect(summary.showIdentityHint).toBe(false); // sin cifra que mostrar
  });
  it("una sola línea sin precio Iconic contamina el total completo (sin mezclar)", () => {
    const lines = [
      line({ t_retail: 100, t_wholesale: 80, t_reseller: 35 }, 2),
      line({ t_retail: 100, t_wholesale: 80 }), // sin Iconic
    ];
    expect(cartRequestSummary(OLIVIA_TIERS, lines)!.identitySubtotal).toBeUndefined();
  });
});

describe("tiendas sin nivel de identidad", () => {
  it("dos niveles por cantidad: el habitual sigue las reglas, sin fila condicional", () => {
    const tiers: PriceTierDef[] = [
      { id: "t_retail", label: "Regular", order: 0 },
      { id: "t_wholesale", label: "Girly", order: 1, minPieces: 5 },
    ];
    const summary = cartRequestSummary(tiers, [line({ t_retail: 100, t_wholesale: 80 }, 6)])!;
    expect(summary.habitualTier.id).toBe("t_wholesale");
    expect(summary.identityTier).toBeNull();
    expect(summary.showIdentityHint).toBe(false);
  });
});

describe("cruce del umbral en tiempo real (mismo carrito, cantidades)", () => {
  it("agregar la pieza que cruza $1,000 apaga la fila; quitarla la enciende", () => {
    const at = (qty: number) => cartRequestSummary(OLIVIA_TIERS, [
      line({ t_retail: 250, t_wholesale: 200, t_reseller: 90 }, qty),
    ])!;
    expect(at(3).showIdentityHint).toBe(true);  // $750 girly? no: 3 piezas → Regular $750 < 1000
    expect(at(3).habitualSubtotal).toBe(750);
    expect(at(4).showIdentityHint).toBe(false); // $1,000 exacto → solo habitual
    expect(at(4).habitualSubtotal).toBe(1000);
    expect(at(3).showIdentityHint).toBe(true);  // volver a bajar la reenciende
  });
});
