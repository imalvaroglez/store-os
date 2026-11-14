import { describe, expect, it } from "vitest";
import {
  categoryDiagnosis,
  eventDocId,
  priceChangeEvent,
  ruleChangeEvent,
  type PriceChangeOrigin,
} from "./priceDiagnostics";
import type { Product } from "../types";

// #335 (2a): diagnóstico descriptivo de precios/costos — explicativo, nunca
// recomendador. Estadística robusta (mediana/IQR; MAD como segunda señal solo
// si ≠ 0), categorías y niveles NUNCA mezclados, todo dato con método/muestra,
// sin etiquetas de «malo/subvaluado/oportunidad» ni umbrales fijos. Los
// eventos de cambio son append-only con idempotencia por intento; la regla
// que no cambió precios NO se presenta como cambio de precio.

const NOW = "2026-11-14T10:00:00.000Z";

const design = (
  id: string,
  name: string,
  cost: number | undefined,
  prices: Record<string, number>,
  quantityOnHand = 3
): Product =>
  ({
    id, storeId: "s1", name, category: "other", categoryIds: ["cat1"], isPublic: true, status: "published",
    ...(cost != null ? { cost } : {}),
    prices, quantityOnHand, createdAt: NOW, updatedAt: NOW,
  }) as unknown as Product;

describe("priceChangeEvent (#335)", () => {
  it("evento manual idempotente por intento: producto, nivel, anterior/nuevo, UID y fechas", () => {
    const event = priceChangeEvent({
      intentId: "intent-1",
      productId: "p1",
      tierId: "t_retail",
      previous: 300,
      next: 350,
      uid: "fer",
      effectiveAt: "2026-11-14",
      origin: "manual",
    });
    expect(event).toMatchObject({
      id: eventDocId("p1", "intent-1"),
      productId: "p1",
      tierId: "t_retail",
      previousCents: 30000,
      nextCents: 35000,
      changedBy: "fer",
      effectiveAt: "2026-11-14",
      origin: "manual",
      recordedAt: event.recordedAt,
    });
    // Reintento con el MISMO intento → mismo doc id (idempotente por diseño).
    const retry = priceChangeEvent({
      intentId: "intent-1", productId: "p1", tierId: "t_retail", previous: 300, next: 350,
      uid: "fer", effectiveAt: "2026-11-14", origin: "manual",
    });
    expect(retry.id).toBe(event.id);
  });

  it("eventDocId liga producto+intento — eventos duplicados chocan en el mismo doc", () => {
    expect(eventDocId("p1", "i1")).toBe(eventDocId("p1", "i1"));
    expect(eventDocId("p1", "i1")).not.toBe(eventDocId("p1", "i2"));
    expect(eventDocId("p1", "i1")).not.toBe(eventDocId("p2", "i1"));
  });

  it("el cambio de REGLA es un evento distinto: sin producto ni precio efectivo", () => {
    const rule = ruleChangeEvent({ intentId: "r1", categoryId: "cat1", uid: "fer", summary: "Banda 1: 20% → 25%" });
    expect(rule).toMatchObject({ id: "rule_r1", kind: "rule_change", categoryId: "cat1", changedBy: "fer", summary: "Banda 1: 20% → 25%" });
    // Un evento de regla JAMÁS se presenta como cambio de precio.
    expect((rule as { productId?: string }).productId).toBeUndefined();
  });

  it("distintos orígenes quedan explícitos (manual / regla / masivo)", () => {
    for (const origin of ["manual", "rule_application", "bulk_application"] as PriceChangeOrigin[]) {
      const event = priceChangeEvent({ intentId: `i-${origin}`, productId: "p1", tierId: "t", previous: 1, next: 2, uid: "fer", effectiveAt: "2026-11-14", origin });
      expect(event.origin).toBe(origin);
    }
  });
});

describe("categoryDiagnosis (#335)", () => {
  it("mediana e IQR robustos por nivel; muestra y método visibles; niveles nunca mezclados", () => {
    const products = Array.from({ length: 9 }, (_, i) =>
      design(`p${i}`, `Pieza ${i}`, 20, { t_retail: 90 + i * 10, t_girly: 70 + i * 10 })
    );
    const d = categoryDiagnosis(products, "t_retail");
    expect(d.tierId).toBe("t_retail");
    expect(d.sample).toBe(9);
    expect(d.method).toBe("mediana · IQR");
    // 9 valores 90..170: mediana 130; Q1 interpolado=110, Q3=150 → IQR=40.
    expect(d.median).toBe(130);
    expect(d.iqr).toBe(40);
    // El nivel Girly NO aparece mezclado en el mismo diagnóstico.
    expect(d.values.every((v) => v >= 90 && v <= 170)).toBe(true);
  });

  it("«sin dispersión estimable» cuando IQR=0 y MAD=0; MAD segunda señal solo si ≠ 0", () => {
    const flat = Array.from({ length: 4 }, (_, i) => design(`f${i}`, `Flat ${i}`, 20, { t_retail: 100 }));
    const d = categoryDiagnosis(flat, "t_retail");
    expect(d.dispersion).toBe("none"); // IQR 0 y MAD 0 → sin dispersión estimable
    const equalPair = [design("a", "A", 20, { t_retail: 100 }), design("b", "B", 20, { t_retail: 100 }), design("c", "C", 20, { t_retail: 120 }), design("d", "D", 20, { t_retail: 140 })];
    const d2 = categoryDiagnosis(equalPair, "t_retail");
    expect(d2.dispersion).toBe("iqr"); // IQR > 0 manda
    // MAD ≠ 0 solo se reporta como segunda señal.
    expect(d2.madSignal).toBe(true);
  });

  it("«evidencia insuficiente» con pocos datos; outliers robustos etiquetados sin juicios", () => {
    const few = [design("x1", "X1", 20, { t_retail: 100 }), design("x2", "X2", 20, { t_retail: 110 })];
    expect(categoryDiagnosis(few, "t_retail").evidence).toBe("insufficient");
    // Sin juicios: nunca «malo», «subvaluado» ni «oportunidad».
    const d = categoryDiagnosis(few, "t_retail");
    expect(d.judgement).toBeUndefined();
  });

  it("costos incompletos y coherencia Regular > Girly > Iconic como hechos, no consejos", () => {
    const products = [
      design("ok", "Ok", 50, { t_retail: 300, t_girly: 250, t_iconic: 200 }),
      design("gap", "Gap", undefined, { t_retail: 300, t_girly: 250, t_iconic: 200 }), // sin costo
      design("inverted", "Inv", 40, { t_retail: 250, t_girly: 260 }), // Girly > Regular
    ];
    const d = categoryDiagnosis(products, "t_retail");
    expect(d.withoutCost).toBe(1);
    expect(d.tierOrderIssues).toContain("inverted");
    expect(d.judgement).toBeUndefined();
  });

  it("análisis por periodo de entrega NO disponible hasta #333 (nunca infiere meses)", () => {
    const products = [design("a", "A", 20, { t_retail: 100 })];
    const d = categoryDiagnosis(products, "t_retail");
    expect(d.periodAnalysis).toBe("unavailable");
    expect(d.periodNote).toMatch(/#333/);
  });
});
