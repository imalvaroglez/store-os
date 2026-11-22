import { describe, expect, it } from "vitest";
import type { OrderItem, Product, ProductVariant, VariantSize } from "../types";
import {
  applyCombinationDelta,
  combinationReservationDeltas,
  applyVariantDelta,
  combinationPublishError,
  combinationSaveError,
  combinationSku,
  findCombination,
  isVariantProduct,
  lineVariant,
  suggestSizeSkuSuffix,
  suggestSkuSuffix,
  totalStock,
  variantPublishError,
  variantReservationDeltas,
  variantSku,
  variantStock,
} from "./variants";

const photo = (id: string) => ({ id, url: `https://x.test/${id}.jpg`, storagePath: `p/${id}`, order: 0, isPrimary: true });

function variant(overrides: Partial<ProductVariant>): ProductVariant {
  return {
    id: "v1",
    color: "Dorado",
    skuSuffix: "D",
    photos: [photo("f1")],
    cost: 100,
    quantityOnHand: 2,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function design(overrides: Partial<Product>): Product {
  return {
    id: "p1",
    storeId: "s1",
    name: "Anillo Sol",
    sku: "MOV-014",
    category: "jewelry",
    isPublic: true,
    status: "published",
    cost: 100,
    prices: { t_retail: 300, t_girly: 250, t_iconic: 200 },
    variants: [variant({ id: "v_gold", color: "Dorado", skuSuffix: "D", quantityOnHand: 2 }), variant({ id: "v_silver", color: "Plateado", skuSuffix: "P", quantityOnHand: 1 })],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  } as Product;
}

describe("#124 claves", () => {
  it("sufijo sugerido por color, ASCII-safe y editable", () => {
    expect(suggestSkuSuffix("Dorado")).toBe("D");
    expect(suggestSkuSuffix("plateado")).toBe("P");
    expect(suggestSkuSuffix("Ámbar")).toBe("A");
    expect(suggestSkuSuffix("")).toBe("X");
  });
  it("clave completa = clave del diseño + sufijo", () => {
    expect(variantSku("MOV-014", { skuSuffix: "D" })).toBe("MOV-014-D");
    expect(variantSku(undefined, { skuSuffix: "D" })).toBeUndefined();
    expect(variantSku("MOV-014", {})).toBeUndefined();
  });
});

describe("#124 validación de publicación (decisiones 1–3)", () => {
  it("diseño válido publica", () => {
    expect(variantPublishError(design({}))).toBeNull();
  });
  it("sin foto en un color, no publica y dice cuál", () => {
    expect(variantPublishError(design({ variants: [variant({ photos: [] })] }))).toMatch(/Dorado necesita al menos una foto/);
  });
  it("sin clave en un color, no publica", () => {
    expect(variantPublishError(design({ variants: [variant({ skuSuffix: undefined })] }))).toMatch(/necesita su clave/);
  });
  it("colores duplicados, no publica", () => {
    expect(variantPublishError(design({ variants: [variant({ id: "a", color: "Dorado" }), variant({ id: "b", color: "dorado" })] }))).toMatch(/nombre distinto/);
  });
  it("sin diseño-sku pero con clave materializada por variante, publica", () => {
    expect(variantPublishError(design({ sku: undefined, variants: [variant({ sku: "CLAVE-1" })] }))).toBeNull();
  });
});

describe("#124 stock por color", () => {
  it("total = suma de variantes; producto sin variantes usa el campo propio", () => {
    expect(totalStock(design({}))).toBe(3);
    expect(totalStock({ quantityOnHand: 7 } as Product)).toBe(7);
    expect(totalStock({} as Pick<Product, "quantityOnHand">)).toBeNull();
  });
  it("el delta toca SOLO el color exacto (2 dorados y 1 plateado: vender dorado afecta dorado una vez)", () => {
    const after = applyVariantDelta(design({}), "v_gold", -1, "2026-11-10T00:00:00.000Z");
    expect(after).not.toBeNull();
    expect(after!.find((v) => v.id === "v_gold")!.quantityOnHand).toBe(1);
    expect(after!.find((v) => v.id === "v_silver")!.quantityOnHand).toBe(1); // intacto
  });
  it("delta sobre variante inexistente devuelve null (nunca cae al nivel diseño)", () => {
    expect(applyVariantDelta(design({}), "v_fantasma", -1)).toBeNull();
    expect(applyVariantDelta({} as Pick<Product, "variants">, "v1", -1)).toBeNull();
  });
});

describe("#124 reservas por color exacto", () => {
  const line = (over: Partial<OrderItem>): OrderItem => ({
    productId: "p1",
    productName: "Anillo Sol",
    quantity: 1,
    unitPrice: 300,
    subtotal: 300,
    ...over,
  });
  it("confirmar descuenta el color exacto; cancelar lo restituye", () => {
    const created = [line({ variantId: "v_gold", variantColor: "Dorado" })];
    const deltas = variantReservationDeltas([], created);
    expect(deltas.get("p1:v_gold")?.delta).toBe(-1);
    expect(deltas.size).toBe(1);
    const cancelled = variantReservationDeltas(created, []);
    expect(cancelled.get("p1:v_gold")?.delta).toBe(1);
  });
  it("cambiar de color en una edición mueve ambas existencias", () => {
    const before = [line({ variantId: "v_gold", quantity: 2 })];
    const after = [line({ variantId: "v_silver", quantity: 2 })];
    const deltas = variantReservationDeltas(before, after);
    expect(deltas.get("p1:v_gold")?.delta).toBe(2);
    expect(deltas.get("p1:v_silver")?.delta).toBe(-2);
  });
  it("líneas sin variante no son asunto de variantes", () => {
    expect(variantReservationDeltas([line({})], [line({})]).size).toBe(0);
  });
  it("resolver la variante de una línea", () => {
    expect(lineVariant(design({}), { variantId: "v_silver" })?.color).toBe("Plateado");
    expect(lineVariant(design({}), { variantId: "nope" })).toBeUndefined();
  });
});

describe("#124 isVariantProduct", () => {
  it("arreglo vacío o ausente = producto tradicional", () => {
    expect(isVariantProduct(design({}))).toBe(true);
    expect(isVariantProduct({ variants: [] })).toBe(false);
    expect(isVariantProduct({})).toBe(false);
  });
});

describe("#124 hallazgos de revisión", () => {
  it("M5: diseño sin ningún color con existencia = sin dato (null), no agotado (0)", () => {
    const untracked = design({ variants: [variant({ quantityOnHand: undefined }), variant({ id: "v2", color: "Plateado", quantityOnHand: undefined })] });
    expect(totalStock(untracked)).toBeNull();
    const mixed = design({ variants: [variant({ quantityOnHand: undefined }), variant({ id: "v2", color: "Plateado", quantityOnHand: 3 })] });
    expect(totalStock(mixed)).toBe(3);
  });

  it("dos líneas del mismo color acumulan un solo delta combinado", () => {
    const a = { productId: "p1", productName: "X", quantity: 2, unitPrice: 1, subtotal: 2, variantId: "v_gold", variantColor: "Dorado" } as const;
    const b = { ...a, quantity: 1, subtotal: 1 };
    const deltas = variantReservationDeltas([], [a, b] as never);
    expect(deltas.get("p1:v_gold")?.delta).toBe(-3);
    expect(deltas.size).toBe(1);
  });
});

// #461 (PO 22-nov): sizes under a color — stock PER COMBINATION, derived
// color/design totals, clave + confirmed cost per combination, and the
// "Plateado · 6 never exists" rule.
describe("#461 combinaciones color × talla", () => {
  function size(id: string, sizeLabel: string, overrides: Partial<VariantSize> = {}): VariantSize {
    return { id, size: sizeLabel, sku: `MOV-014-D-${sizeLabel}`, cost: 100, quantityOnHand: 1, createdAt: "", updatedAt: "", ...overrides };
  }
  function ring(): Product {
    return design({
      variants: [
        variant({
          id: "v_gold", color: "Dorado", skuSuffix: "D", quantityOnHand: undefined,
          sizes: [size("s4", "4", { quantityOnHand: 2 }), size("s5", "5", { quantityOnHand: 0 }), size("s6", "6", { quantityOnHand: 5 })],
        }),
        variant({
          id: "v_silver", color: "Plateado", skuSuffix: "P", quantityOnHand: 3,
          sizes: [size("s8", "8", { sku: "MOV-014-P-8", quantityOnHand: 4 }), size("s9", "9", { sku: "MOV-014-P-9", quantityOnHand: 1 })],
        }),
      ],
    });
  }

  it("sufijo sugerido de talla: el propio valor, ASCII-safe y sin espacios", () => {
    expect(suggestSizeSkuSuffix("6")).toBe("6");
    expect(suggestSizeSkuSuffix("chica")).toBe("CHICA");
    expect(suggestSizeSkuSuffix("Única")).toBe("UNICA");
    expect(suggestSizeSkuSuffix("media larga")).toBe("MEDIALARGA");
  });

  it("clave de la combinación = clave del color + talla; la clave explícita gana", () => {
    expect(combinationSku("MOV-014", { sku: "MOV-014-D" } as ProductVariant, { size: "6" } as VariantSize)).toBe("MOV-014-D-6");
    expect(combinationSku("MOV-014", { skuSuffix: "D" } as ProductVariant, { sku: "EXACTA" } as VariantSize)).toBe("EXACTA");
    expect(combinationSku(undefined, { skuSuffix: "D" } as ProductVariant, { size: "6" } as VariantSize)).toBeUndefined();
  });

  it("existencia por combinación y totales derivados: Dorado 2+0+5=7, Plateado 4+1=5, diseño 12", () => {
    const product = ring();
    expect(variantStock(product.variants![0])).toBe(7);
    expect(variantStock(product.variants![1])).toBe(5);
    expect(totalStock(product)).toBe(12);
  });

  it("tallas sin rastrear no se leen como cero: todas sin dato = null; mezcla suma sólo las rastreadas", () => {
    const allUntracked = ring();
    allUntracked.variants![0].sizes = [size("s4", "4", { quantityOnHand: undefined }), size("s5", "5", { quantityOnHand: undefined })];
    expect(variantStock(allUntracked.variants![0])).toBeNull();
    const mixed = ring();
    mixed.variants![0].sizes = [size("s4", "4", { quantityOnHand: undefined }), size("s6", "6", { quantityOnHand: 5 })];
    expect(variantStock(mixed.variants![0])).toBe(5);
  });

  it("«Plateado · 6» nunca existe: findCombination distingue la combinación exacta", () => {
    const product = ring();
    expect(findCombination(product, "v_gold", "s6")?.size).toBe("6");
    expect(findCombination(product, "v_silver", "s6")).toBeUndefined();
    expect(findCombination(product, "v_silver", "s8")?.size).toBe("8");
  });

  it("guardar exige clave y costo confirmado por combinación: cero confirmado es válido", () => {
    const noClave = {} as ProductVariant; // sin clave de color: la combinación no puede derivar la suya
    expect(combinationSaveError("Dorado", noClave, { size: "6" } as VariantSize)).toMatch(/necesita su clave/i);
    const v = { sku: "MOV-014-D" } as ProductVariant;
    expect(combinationSaveError("Dorado", v, { size: "6" } as VariantSize)).toMatch(/costo/i);
    expect(combinationSaveError("Dorado", v, { size: "6", sku: "MOV-014-D-6", cost: 0 } as VariantSize)).toBeNull();
    expect(combinationSaveError("Dorado", v, { size: "6", sku: "MOV-014-D-6", cost: 120 } as VariantSize)).toBeNull();
  });

  it("publicación: tallas duplicadas en un color bloquean; la misma talla en colores distintos sí se admite", () => {
    const dup = ring();
    dup.variants![0].sizes!.push(size("s6b", "6", { sku: "MOV-014-D-6B" }));
    expect(combinationPublishError(dup)).toMatch(/talla.*repetida|repetida.*talla|Dorado/i);
    expect(combinationPublishError(ring())).toBeNull();
  });

  it("publicación exige clave única por combinación", () => {
    const clash = ring();
    clash.variants![0].sizes = [size("s4", "4"), size("s5", "5", { sku: "MOV-014-D-4" })];
    expect(combinationPublishError(clash)).toMatch(/clave/i);
  });

  it("un delta mueve SOLO su combinación; el color hereda por derivación y una combinación inexistente no aterriza en otra parte", () => {
    const product = ring();
    const next = applyCombinationDelta(product, "v_gold", "s6", -1);
    expect(next).not.toBeNull();
    const gold = next!.find((v) => v.id === "v_gold")!;
    expect(gold.sizes!.find((s) => s.id === "s6")!.quantityOnHand).toBe(4);
    expect(gold.sizes!.find((s) => s.id === "s4")!.quantityOnHand).toBe(2);
    expect(gold.quantityOnHand).toBeUndefined(); // color stays derived, never double-written
    expect(variantStock(gold)).toBe(6);
    expect(applyCombinationDelta(product, "v_gold", "s9", -1)).toBeNull(); // s9 belongs to Plateado
    expect(applyCombinationDelta(product, "v_ghost", "s6", -1)).toBeNull();
  });

  it("una variante sin tallas conserva la modalidad actual (color directo)", () => {
    const legacy = ring();
    delete legacy.variants![1].sizes;
    expect(variantStock(legacy.variants![1])).toBe(3);
    expect(combinationPublishError(legacy)).toBeNull();
  });
});

describe("#461 corte 3 — líneas con talla y deltas por combinación", () => {
  const talla = (id: string, label: string, qty: number): VariantSize =>
    ({ id, size: label, sku: `SOL-D-${label}`, cost: 100, quantityOnHand: qty, createdAt: "", updatedAt: "" });
  const line = (sizeId: string | undefined, quantity: number, variantId = "v_gold"): OrderItem =>
    ({ productId: "p1", productName: "Anillo Sol", quantity, unitPrice: 100, subtotal: 100 * quantity, variantId, variantColor: "Dorado", ...(sizeId ? { variantSizeId: sizeId, variantSize: "6" } : {}) }) as OrderItem;

  it("dos líneas de la MISMA combinación acumulan un solo delta; tallas distintas son dimensiones distintas", () => {
    const deltas = combinationReservationDeltas([], [line("s6", 2), line("s6", 1), line("s5", 3)]);
    expect(deltas.get("p1:v_gold:s6")?.delta).toBe(-3);
    expect(deltas.get("p1:v_gold:s5")?.delta).toBe(-3);
    expect(deltas.size).toBe(2);
  });

  it("una línea con talla NO mueve el color: variantReservationDeltas la ignora", () => {
    const variantDeltas = variantReservationDeltas([], [line("s6", 2)]);
    expect(variantDeltas.size).toBe(0);
    // La misma línea SIN talla sí es asunto del color (modalidad actual).
    expect(variantReservationDeltas([], [line(undefined, 2)]).get("p1:v_gold")?.delta).toBe(-2);
  });

  it("la cancelación devuelve la pieza a SU combinación: delta positivo por combinación exacta", () => {
    const deltas = combinationReservationDeltas([line("s6", 2)], []);
    expect(deltas.get("p1:v_gold:s6")?.delta).toBe(2);
    expect(deltas.size).toBe(1);
  });

  it("applyCombinationDelta aterriza el delta de reserva SOLO en su talla", () => {
    const product = design({
      variants: [variant({ id: "v_gold", color: "Dorado", skuSuffix: "D", quantityOnHand: undefined, sizes: [talla("s5", "5", 2), talla("s6", "6", 5)] })],
    });
    const next = applyCombinationDelta(product, "v_gold", "s6", -1);
    const gold = next!.find((v) => v.id === "v_gold")!;
    expect(gold.sizes!.find((s) => s.id === "s6")!.quantityOnHand).toBe(4);
    expect(gold.sizes!.find((s) => s.id === "s5")!.quantityOnHand).toBe(2);
  });
});
