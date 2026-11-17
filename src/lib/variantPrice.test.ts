import { describe, it, expect } from "vitest";
import type { Product, ProductVariant } from "../types";
import { variantEffectivePrice, variantHasOwnPrices, designPriceFallback } from "./variantPrice";

// #467: ONE source of truth for a color's sale prices. A variant either
// shares the design's price map (legacy, absent field — its effective prices
// stay EXACTLY what they were) or owns a per-level map (then a missing level
// is simply SIN precio — never silently the design's, another color's or
// another level's). Photos already live on the variant (its gallery is the
// single source since #124); this module gives prices the same discipline.

const design = { id: "d1", prices: { t_retail: 300, t_girly: 260 } } as unknown as Pick<Product, "prices">;
const variantBase = { id: "v1", color: "Rojo", createdAt: "2026-01-01" } as unknown as ProductVariant;

describe("variantEffectivePrice (#467)", () => {
  it("variante SIN mapa propio comparte el precio del diseño (compatibilidad exacta de fichas existentes)", () => {
    expect(variantEffectivePrice(variantBase, "t_retail", design)).toBe(300);
    expect(variantEffectivePrice(variantBase, "t_girly", design)).toBe(260);
    expect(variantHasOwnPrices(variantBase)).toBe(false);
  });

  it("variante CON mapa propio: sus niveles valen lo propio", () => {
    const own = { ...variantBase, prices: { t_retail: 350 } } as unknown as ProductVariant;
    expect(variantEffectivePrice(own, "t_retail", design)).toBe(350);
    expect(variantHasOwnPrices(own)).toBe(true);
  });

  it("nivel ausente en variante con mapa propio queda SIN precio — nunca hereda del diseño ni de otro nivel", () => {
    const own = { ...variantBase, prices: { t_retail: 350 } } as unknown as ProductVariant;
    expect(variantEffectivePrice(own, "t_girly", design)).toBeUndefined();
  });

  it("nivel ausente en el diseño y sin mapa de variante: sin precio", () => {
    expect(variantEffectivePrice(variantBase, "t_iconic", design)).toBeUndefined();
  });

  it("0 o valores no positivos NO son precio (mismo criterio del catálogo)", () => {
    const own = { ...variantBase, prices: { t_retail: 0, t_girly: -5 } } as unknown as ProductVariant;
    expect(variantEffectivePrice(own, "t_retail", design)).toBeUndefined();
    expect(variantEffectivePrice(own, "t_girly", design)).toBeUndefined();
  });
});

describe("designPriceFallback (#467)", () => {
  it("el precio de diseño solo aplica cuando la variante comparte (sin mapa)", () => {
    expect(designPriceFallback(variantBase, "t_retail", design)).toBe(300);
    const own = { ...variantBase, prices: { t_retail: 350 } } as unknown as ProductVariant;
    expect(designPriceFallback(own, "t_girly", design)).toBeUndefined();
  });
});
