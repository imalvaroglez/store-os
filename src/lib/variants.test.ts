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
  sizeShelfError,
  storeClaves,
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

// #461 (dictamen QA 23-nov, crítico 3): al activar tallas, las piezas
// contadas a nivel color se descartaban en silencio (5 → 3). Regla de
// conservación: toda pieza del color queda en una talla o a la vista «sin
// talla»; nada se deduce ni se pierde.
describe("sizeShelfError — conservación al activar, repartir y quitar tallas (#461)", () => {
  const size = (id: string, label: string, quantityOnHand?: number) => ({ id, size: label, cost: 10, ...(quantityOnHand !== undefined ? { quantityOnHand } : {}), createdAt: "", updatedAt: "" });
  const color = (overrides: Partial<ProductVariant>): ProductVariant => ({ id: "v_gold", color: "Dorado", cost: 10, createdAt: "", updatedAt: "", ...overrides }) as ProductVariant;
  const check = (before: Partial<ProductVariant> | undefined, after: Partial<ProductVariant>, held: string[] = []) =>
    sizeShelfError({ color: after.color ?? "Dorado", before: before ? color(before) : undefined, after: color(after), heldSizeIds: new Set(held) });
  const sum = (... quantities: Array<number | undefined>) => quantities.reduce<number>((total, quantity) => total + (quantity ?? 0), 0);

  it("activar tallas sobre un color con 5 piezas exige repartir exactamente 5 (con 2, no guarda y dice cuántas faltan)", () => {
    expect(check({ quantityOnHand: 5 }, { sizes: [size("d6", "6", 2)] })).toMatch(/5 piezas.*\(llevas 2 de 5\)/);
    expect(sum(2, 3)).toBe(5);
    expect(check({ quantityOnHand: 5 }, { sizes: [size("d6", "6", 2), size("d5", "5", 3)] })).toBeNull();
    // Repartir de más tampoco: las piezas no aparecen de la nada.
    expect(check({ quantityOnHand: 5 }, { sizes: [size("d6", "6", 2), size("d5", "5", 4)] })).toMatch(/llevas 6 de 5/);
    // Una talla sin capturar deja la repartición incompleta.
    expect(check({ quantityOnHand: 5 }, { sizes: [size("d6", "6", 5), size("d5", "5")] })).toMatch(/llevas 5 de 5.*talla sin capturar|Revisa las tallas sin cantidad/);
  });

  it("un color sin existencia rastreada activa tallas libremente (la primera cuenta por talla es suya)", () => {
    expect(check({ quantityOnHand: undefined }, { sizes: [size("d6", "6", 3), size("d5", "5")] })).toBeNull();
    expect(check({ quantityOnHand: 0 }, { sizes: [size("d6", "6", 3)] })).toBeNull();
  });

  it("existencia en negativo: primero se corrige el conteo del color", () => {
    expect(check({ quantityOnHand: -2 }, { sizes: [size("d6", "6", 0)] })).toMatch(/negativo.*faltan 2/i);
  });

  it("piezas «sin talla» devueltas por un pedido: hay que repartirlas antes de guardar cualquier otra cosa", () => {
    const before = { sizes: [size("d6", "6", 3), size("d5", "5", 1)], quantityOnHand: 2 };
    expect(check(before, { sizes: [size("d6", "6", 3), size("d5", "5", 1)], quantityOnHand: 2 })).toMatch(/2 piezas sin talla.*llevas 0 de 2/);
    expect(check(before, { sizes: [size("d6", "6", 4), size("d5", "5", 2)] })).toBeNull();
    // Repartirlas Y ajustar otra talla a la vez se detecta: sobran piezas (+3 para 2).
    expect(check(before, { sizes: [size("d6", "6", 5), size("d5", "5", 2)] })).toMatch(/llevas 3 de 2/);
  });

  it("una sola pieza se nombra en singular (hallado en el recorrido real: «1 piezas sin talla»)", () => {
    expect(check({ sizes: [size("d6", "6", 3), size("d5", "5", 1)], quantityOnHand: 1 }, { sizes: [size("d6", "6", 3), size("d5", "5", 1)], quantityOnHand: 1 })).toBe(
      "El color Dorado tiene 1 pieza sin talla (por ejemplo, devuelta por un pedido vendido sin talla). Repártela capturando su cantidad en una talla para guardar (llevas 0 de 1)."
    );
    expect(check({ quantityOnHand: 1 }, { sizes: [size("d6", "6", 0)] })).toMatch(/tenía 1 pieza contada sin talla\. Repártela entre sus tallas para guardar \(llevas 0 de 1\)/);
    expect(check({ quantityOnHand: -1 }, { sizes: [size("d6", "6", 0)] })).toMatch(/negativo \(falta 1\)/);
  });

  it("un color ya con tallas y sin piezas sueltas ajusta sus tallas libremente", () => {
    const before = { sizes: [size("d6", "6", 3), size("d5", "5", 1)], quantityOnHand: 0 };
    expect(check(before, { sizes: [size("d6", "6", 7), size("d5", "5")] })).toBeNull();
  });

  it("quitar una talla con piezas pide dejarla en 0; con piezas apartadas en pedidos pide resolver el pedido", () => {
    const before = { sizes: [size("d6", "6", 3), size("d5", "5", 1)] };
    expect(check(before, { sizes: [size("d6", "6", 3)] })).toMatch(/talla 5.*tiene 1 pieza/);
    expect(check({ sizes: [size("d6", "6", 0), size("d5", "5", 1)] }, { sizes: [size("d5", "5", 1)] }, ["d6"])).toMatch(/talla 6.*apartadas en pedidos/);
    expect(check({ sizes: [size("d6", "6", 0), size("d5", "5", 1)] }, { sizes: [size("d5", "5", 1)] })).toBeNull();
  });

  it("quitar la última talla (dejar de venderse por talla) devuelve las piezas al color; con piezas apartadas no se puede", () => {
    const before = { sizes: [size("d6", "6", 3), size("d5", "5", 1)] };
    expect(check(before, { quantityOnHand: 4 })).toBeNull();
    expect(check(before, { quantityOnHand: 4 }, ["d6"])).toMatch(/talla 6.*apartadas en pedidos/);
  });

  it("una ficha nueva: lo tecleado en «En existencia» antes de agregar tallas también se reparte", () => {
    expect(check(undefined, { quantityOnHand: 5, sizes: [size("d6", "6", 2)] })).toMatch(/5 piezas.*\(llevas 2 de 5\)/);
    expect(check(undefined, { quantityOnHand: 5, sizes: [size("d6", "6", 5)] })).toBeNull();
  });
});

// #461 (dictamen QA, menor): la clave de una combinación nueva sólo se
// comparaba con la clave de diseño de otras fichas; los colores y tallas de
// todo el catálogo también son claves en uso (viajan en compras y tickets).
describe("storeClaves — unicidad contra todo lo que ya existe (#461)", () => {
  it("reúne claves de diseños, colores y tallas de las demás fichas de la misma tienda, en mayúsculas", () => {
    const products = [
      {
        id: "a", storeId: "s1", sku: "sol",
        variants: [
          { id: "v", color: "Dorado", sku: "SOL-D", sizes: [{ id: "z", size: "7", sku: "SOL-X-7" }], createdAt: "", updatedAt: "" },
          { id: "p", color: "Plateado", createdAt: "", updatedAt: "" },
        ],
      },
      { id: "b", storeId: "s1", sku: "ARO-L" },
      { id: "c", storeId: "s2", sku: "OTRO" },
    ] as unknown as Product[];
    // «b» es la ficha que se edita: sus propias claves no cuentan como tomadas.
    expect([...storeClaves(products, "s1", "b")].sort()).toEqual(["SOL", "SOL-D", "SOL-X-7"]);
    expect([...storeClaves(products, "s1")].sort()).toEqual(["ARO-L", "SOL", "SOL-D", "SOL-X-7"]);
  });

  it("sin fichas ni claves devuelve un conjunto vacío", () => {
    expect(storeClaves([], "s1").size).toBe(0);
    expect(storeClaves([{ id: "x", storeId: "s1" } as unknown as Product], "s1").size).toBe(0);
  });
});
