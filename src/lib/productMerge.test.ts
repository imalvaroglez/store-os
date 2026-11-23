import { describe, expect, it } from "vitest";
import { mergeProductOperational, StaleProductError } from "./productMerge";
import { variantStock } from "./variants";
import type { Product, ProductVariant, VariantSize } from "../types";

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

  it("el costo por color actualizado en paralelo se conserva cuando solo se ajustan existencias (#373 r2)", () => {
    const withCost = (v: ProductVariant, cost: number) => Object.assign(v, { cost });
    const baseline = product({ id: "p1", variants: [withCost(variant("v1", "Dorado", 4), 10), withCost(variant("v2", "Plata", 2), 10)] });
    // La operadora solo ajusta el estante de Dorado (4→5); los costos viajan del clon (10).
    const next = product({ id: "p1", variants: [withCost(variant("v1", "Dorado", 5), 10), withCost(variant("v2", "Plata", 2), 10)] });
    // Una recepción concurrente movió estantes y PROMEDIÓ los costos por color.
    const fresh = product({ id: "p1", variants: [withCost(variant("v1", "Dorado", 7), 10.63), withCost(variant("v2", "Plata", 2), 10.5)] });
    const merged = mergeProductOperational(baseline, next, fresh);
    const byColor = new Map(merged.variants!.map((v) => [v.color, v]));
    expect(byColor.get("Dorado")).toMatchObject({ quantityOnHand: 8, cost: 10.63 }); // delta del estante, costo FRESCO
    expect(byColor.get("Plata")).toMatchObject({ quantityOnHand: 2, cost: 10.5 }); // intacta → fresco completo
  });

  it("un costo por color editado a mano es explícito y aterriza tal cual", () => {
    const withCost = (v: ProductVariant, cost: number) => Object.assign(v, { cost });
    const baseline = product({ id: "p1", variants: [withCost(variant("v1", "Dorado", 4), 10)] });
    const next = product({ id: "p1", variants: [withCost(variant("v1", "Dorado", 4), 12)] });
    const fresh = product({ id: "p1", variants: [withCost(variant("v1", "Dorado", 7), 10.63)] });
    const merged = mergeProductOperational(baseline, next, fresh);
    expect(merged.variants![0]).toMatchObject({ quantityOnHand: 7, cost: 12 }); // costo explícito, estante fresco
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

// #461 (dictamen QA 23-nov, crítico 3): las tallas se fusionan con el mismo
// contrato que los colores — lo no tocado conserva lo fresco, lo editado
// aterriza como delta — y activar tallas sobre un color con piezas conserva
// cada pieza: o se reparte, o el guardado se detiene.
describe("mergeProductOperational con tallas (#461)", () => {
  const size = (id: string, label: string, quantityOnHand: number | undefined, cost = 10): VariantSize =>
    ({ id, size: label, cost, ...(quantityOnHand !== undefined ? { quantityOnHand } : {}), createdAt: NOW, updatedAt: NOW });
  const sized = (color: string, overrides: Partial<ProductVariant>) => ({ ...variant("v_gold", color), ...overrides });

  it("activar tallas sobre un color con 5 piezas repartidas 3/2: las 5 se conservan y el campo del color queda vacío", () => {
    const baseline = product({ id: "p1", variants: [variant("v_gold", "Dorado", 5)] });
    const next = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: undefined, sizes: [size("d6", "6", 3), size("d5", "5", 2)] })] });
    const merged = mergeProductOperational(baseline, next, baseline);
    const gold = merged.variants![0];
    expect(gold.sizes!.map((s) => s.quantityOnHand)).toEqual([3, 2]);
    expect(gold.quantityOnHand).toBeUndefined();
    expect(variantStock(gold)).toBe(5);
  });

  it("si la existencia del color cambió en otro dispositivo mientras se repartía, el guardado se detiene (nunca inventa piezas)", () => {
    const baseline = product({ id: "p1", variants: [variant("v_gold", "Dorado", 5)] });
    const fresh = product({ id: "p1", variants: [variant("v_gold", "Dorado", 4)] }); // una venta concurrente
    const next = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: undefined, sizes: [size("d6", "6", 3), size("d5", "5", 2)] })] });
    expect(() => mergeProductOperational(baseline, next, fresh)).toThrow(StaleProductError);
    expect(() => mergeProductOperational(baseline, next, fresh)).toThrow(/existencia del color Dorado cambió/);
  });

  it("talla sin tocar conserva el estante fresco (la venta concurrente sobrevive); la editada aterriza como delta", () => {
    const baseline = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 0, sizes: [size("d6", "6", 4), size("d5", "5", 2)] })] });
    const fresh = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 0, sizes: [size("d6", "6", 1), size("d5", "5", 2, 12)] })] }); // venta −3, compra re-promedió la 5
    const next = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 0, sizes: [size("d6", "6", 4), size("d5", "5", 5)] })] }); // Fer sube la 5 de 2 a 5 (+3)
    const gold = mergeProductOperational(baseline, next, fresh).variants![0];
    expect(gold.sizes!.find((s) => s.id === "d6")!.quantityOnHand).toBe(1); // intacta → fresca
    expect(gold.sizes!.find((s) => s.id === "d5")!.quantityOnHand).toBe(5); // 2 frescas + 3 de Fer
    expect(gold.sizes!.find((s) => s.id === "d6")!.cost).toBe(10);
    expect(gold.sizes!.find((s) => s.id === "d5")!.cost).toBe(12); // el costo sin tocar conserva la recepción
  });

  it("repartir 2 piezas «sin talla»: la talla sube 2 y el residual queda limpio; lo que llegó en paralelo se conserva", () => {
    const baseline = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 2, sizes: [size("d6", "6", 3), size("d5", "5", 1)] })] });
    const next = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: undefined, sizes: [size("d6", "6", 5), size("d5", "5", 1)] })] });
    expect(mergeProductOperational(baseline, next, baseline).variants![0].quantityOnHand).toBeUndefined();
    // Mientras editaba, otro pedido devolvió 1 pieza más sin talla (residual fresco 3).
    const fresh = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 3, sizes: [size("d6", "6", 3), size("d5", "5", 1)] })] });
    const merged = mergeProductOperational(baseline, next, fresh).variants![0];
    expect(merged.sizes!.find((s) => s.id === "d6")!.quantityOnHand).toBe(5);
    expect(merged.quantityOnHand).toBe(1); // la pieza que llegó después sigue a la vista
  });

  it("quitar la última talla devuelve sus piezas al color (suma de las tallas FRESCAS)", () => {
    const baseline = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 0, sizes: [size("d6", "6", 4), size("d5", "5", 2)] })] });
    const fresh = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 0, sizes: [size("d6", "6", 3), size("d5", "5", 2)] })] });
    const next = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 0 })] });
    expect(mergeProductOperational(baseline, next, fresh).variants![0].quantityOnHand).toBe(5);
  });

  it("tallas todas sin rastrear: al dejar de venderse por talla el color sigue sin rastrear (nunca 0)", () => {
    const baseline = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: undefined, sizes: [size("d6", "6", undefined), size("d5", "5", undefined)] })] });
    const next = product({ id: "p1", variants: [sized("Dorado", {})] });
    expect(mergeProductOperational(baseline, next, baseline).variants![0].quantityOnHand).toBeUndefined();
  });

  it("talla quitada que recibió piezas en paralelo: se detiene el guardado", () => {
    const baseline = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 0, sizes: [size("d6", "6", 4), size("d5", "5", 0)] })] });
    const fresh = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 0, sizes: [size("d6", "6", 4), size("d5", "5", 3)] })] }); // llegó una compra de la 5
    const next = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 0, sizes: [size("d6", "6", 4)] })] });
    expect(() => mergeProductOperational(baseline, next, fresh)).toThrow(/talla 5/);
  });

  // ── Revisión independiente 23-nov: huecos de conservación del propio arreglo ──
  it("repartir 2 piezas «sin talla» en una talla NUEVA las mueve, no las duplica: total 6 y residual limpio", () => {
    const baseline = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 2, sizes: [size("d6", "6", 3), size("d5", "5", 1)] })] });
    const next = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 2, sizes: [size("d6", "6", 3), size("d5", "5", 1), size("d7", "7", 2)] })] });
    const gold = mergeProductOperational(baseline, next, baseline).variants![0];
    expect(gold.sizes!.map((s) => s.quantityOnHand)).toEqual([3, 1, 2]);
    expect(gold.quantityOnHand).toBeUndefined();
    expect(gold.sizes!.reduce((total, s) => total + (s.quantityOnHand ?? 0), 0)).toBe(6);
  });

  it("una talla nueva sobre un color SIN piezas sueltas sigue siendo una primera cuenta (no se toca el residual)", () => {
    const baseline = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 0, sizes: [size("d6", "6", 3)] })] });
    const next = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 0, sizes: [size("d6", "6", 3), size("d7", "7", 4)] })] });
    const gold = mergeProductOperational(baseline, next, baseline).variants![0];
    expect(gold.sizes!.map((s) => s.quantityOnHand)).toEqual([3, 4]);
    expect(gold.quantityOnHand).toBe(0);
  });

  it("quitar la última talla con 2 piezas «sin talla» las devuelve al color junto con la talla (3 + 2 = 5)", () => {
    const baseline = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 2, sizes: [size("d6", "6", 3)] })] });
    const next = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: 2 })] });
    expect(mergeProductOperational(baseline, next, baseline).variants![0].quantityOnHand).toBe(5);
  });

  it("un editor abierto ANTES de que otra sesión active tallas no las borra al guardar: se detiene", () => {
    const baseline = product({ id: "p1", variants: [variant("v_gold", "Dorado", 5)] }); // lo que A abrió
    const fresh = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: undefined, sizes: [size("d6", "6", 3), size("d5", "5", 2)] })] }); // B activó tallas
    const next = product({ id: "p1", variants: [sized("Dorado", { cost: 999, quantityOnHand: 5 })] }); // A sólo corrigió el costo del color
    expect(() => mergeProductOperational(baseline, next, fresh)).toThrow(StaleProductError);
    expect(() => mergeProductOperational(baseline, next, fresh)).toThrow(/ahora se vende por talla/);
    // Si A no tocó nada del color, la ficha fresca (con tallas) se conserva sin más.
    const untouched = mergeProductOperational(baseline, baseline, fresh);
    expect(untouched.variants![0].sizes!.map((s) => s.quantityOnHand)).toEqual([3, 2]);
  });

  it("talla nueva llega tal cual; sin baseline (crear) se respeta el formulario", () => {
    const next = product({ id: "p1", variants: [sized("Dorado", { quantityOnHand: undefined, sizes: [size("d6", "6", 2)] })] });
    expect(mergeProductOperational(undefined, next, undefined)).toBe(next);
  });
});
