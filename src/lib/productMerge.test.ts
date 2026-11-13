import { describe, expect, it } from "vitest";
import { mergeProductOperational } from "./productMerge";
import type { Product, ProductVariant } from "../types";

// #373 (corte Productos): the product editor saves a full document built
// from the clone it OPENED with. These tests pin the merge contract that
// keeps concurrent canonical writes (receptions, orders) alive while the
// operator's intentional edits still land — as deltas on the FRESH doc.

const NOW = "2026-11-13T10:00:00.000Z";

const variant = (id: string, color: string, quantityOnHand?: number): ProductVariant => ({
  id,
  color,
  ...(quantityOnHand !== undefined ? { quantityOnHand } : {}),
  createdAt: NOW,
  updatedAt: NOW,
});

const product = (overrides: Partial<Product> & { id: string }): Product =>
  ({ storeId: "s1", name: "Aro", category: "other", isPublic: true, createdAt: NOW, updatedAt: NOW, ...overrides }) as Product;

describe("mergeProductOperational (#373 productos)", () => {
  it("campo sin tocar conserva el valor fresco (la recepción concurrente sobrevive)", () => {
    const baseline = product({ id: "p1", quantityOnHand: 5, cost: 100 });
    const next = product({ id: "p1", name: "Aro Luna", quantityOnHand: 5, cost: 100 });
    const fresh = product({ id: "p1", quantityOnHand: 8, cost: 116 }); // recepción +3, costo promediado
    const merged = mergeProductOperational(baseline, next, fresh);
    expect(merged.quantityOnHand).toBe(8);
    expect(merged.cost).toBe(116);
    expect(merged.name).toBe("Aro Luna"); // the form's own edit lands
  });

  it("ajuste manual aterriza como delta sobre el valor fresco", () => {
    const baseline = product({ id: "p1", quantityOnHand: 5 });
    const next = product({ id: "p1", quantityOnHand: 7 }); // operator +2
    const fresh = product({ id: "p1", quantityOnHand: 8 }); // meanwhile reception +3
    expect(mergeProductOperational(baseline, next, fresh).quantityOnHand).toBe(10);
  });

  it("ajuste manual hacia abajo no cae bajo cero por los cambios frescos", () => {
    const baseline = product({ id: "p1", quantityOnHand: 5 });
    const next = product({ id: "p1", quantityOnHand: 3 }); // operator −2
    const fresh = product({ id: "p1", quantityOnHand: 1 }); // meanwhile an order took 4
    expect(mergeProductOperational(baseline, next, fresh).quantityOnHand).toBe(0);
  });

  it("sin baseline (crear) todo es intencional: se respetan los valores del formulario", () => {
    const next = product({ id: "new", quantityOnHand: 4, cost: 50 });
    const merged = mergeProductOperational(undefined, next, undefined);
    expect(merged.quantityOnHand).toBe(4);
    expect(merged.cost).toBe(50);
  });

  it("costo editado a mano es explícito: aterriza tal cual (el operador es dueña del costo)", () => {
    const baseline = product({ id: "p1", cost: 100 });
    const next = product({ id: "p1", cost: 130 });
    const fresh = product({ id: "p1", cost: 116 }); // recepción promedió mientras tanto
    expect(mergeProductOperational(baseline, next, fresh).cost).toBe(130);
  });

  it("campo ausente en el formulario (on_demand) no toca el estante fresco", () => {
    const baseline = product({ id: "p1", quantityOnHand: 5 });
    const next = product({ id: "p1", name: "Perfume" });
    delete (next as Partial<Product>).quantityOnHand;
    const fresh = product({ id: "p1", quantityOnHand: 9 });
    const merged = mergeProductOperational(baseline, next, fresh);
    expect(merged.quantityOnHand).toBe(9);
  });

  it("variantes: estante de color sin tocar conserva el fresco; editado aterriza como delta", () => {
    const base = [variant("v1", "Dorado", 5), variant("v2", "Plata", 2)];
    const baseline = product({ id: "p1", variants: base });
    // Operator edits Dorado 5→6 (manual +1) and leaves Plata untouched.
    const next = product({ id: "p1", variants: [variant("v1", "Dorado", 6), variant("v2", "Plata", 2)] });
    // Meanwhile a reception stocked Dorado +3 (8) and an order took Plata −1 (1).
    const fresh = product({ id: "p1", variants: [variant("v1", "Dorado", 8), variant("v2", "Plata", 1)] });
    const merged = mergeProductOperational(baseline, next, fresh);
    const byColor = new Map(merged.variants!.map((v) => [v.color, v.quantityOnHand]));
    expect(byColor.get("Dorado")).toBe(9); // fresh 8 + intentional 1
    expect(byColor.get("Plata")).toBe(1); // untouched → fresh
  });

  it("variantes: color nuevo llega con su estante tal cual; color quitado desaparece (intención explícita)", () => {
    const baseline = product({ id: "p1", variants: [variant("v1", "Dorado", 5)] });
    const next = product({ id: "p1", variants: [variant("v2", "Verde", 3)] });
    const fresh = product({ id: "p1", variants: [variant("v1", "Dorado", 7)] });
    const merged = mergeProductOperational(baseline, next, fresh);
    expect(merged.variants).toHaveLength(1);
    expect(merged.variants![0]).toMatchObject({ color: "Verde", quantityOnHand: 3 });
  });

  it("borrado explícito (prop presente en undefined, transición #355) se conserva como intención", () => {
    const baseline = product({ id: "p1", quantityOnHand: 5, variants: [variant("v1", "Dorado", 5)] });
    const next = product({ id: "p1" }) as Product & { quantityOnHand?: number; variants?: ProductVariant[] };
    next.quantityOnHand = undefined; // explicit delete intent (see saveEntity tombstones)
    next.variants = undefined;
    const fresh = product({ id: "p1", quantityOnHand: 9, variants: [variant("v1", "Dorado", 9)] });
    const merged = mergeProductOperational(baseline, next, fresh) as Record<string, unknown>;
    expect(merged).toHaveProperty("quantityOnHand", undefined);
    expect(merged).toHaveProperty("variants", undefined);
  });
});
