import { describe, expect, it } from "vitest";
import type { OrderItem, Product, ProductVariant } from "../types";
import {
  applyVariantDelta,
  isVariantProduct,
  lineVariant,
  suggestSkuSuffix,
  totalStock,
  variantPublishError,
  variantReservationDeltas,
  variantSku,
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
