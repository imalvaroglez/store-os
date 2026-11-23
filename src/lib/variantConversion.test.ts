import { describe, expect, it } from "vitest";
import type { Order, OrderIncident, Product, Purchase } from "../types";
import { applyConversion, buildConversionPreview, pendingMovementsForSources } from "./variantConversion";

const now = "2026-11-22T12:00:00.000Z";

const main = (overrides: Partial<Product> = {}): Product => ({
  id: "p_main", storeId: "s1", name: "Anillo Sol", sku: "SOL", category: "jewelry", isPublic: true, status: "published",
  prices: { t_retail: 1400 },
  variants: [
    { id: "v_dorado", color: "Dorado", skuSuffix: "D", sku: "SOL-D", photos: [], createdAt: "", updatedAt: "",
      sizes: [{ id: "s_d6", size: "6", skuSuffix: "6", sku: "SOL-D-6", cost: 110, quantityOnHand: 2, createdAt: "", updatedAt: "" }] },
    { id: "v_plateado", color: "Plateado", skuSuffix: "P", sku: "SOL-P", photos: [], createdAt: "", updatedAt: "" },
  ],
  createdAt: "", updatedAt: "",
  ...overrides,
} as Product);

const origin = (id: string, overrides: Partial<Product> = {}): Product => ({
  id, storeId: "s1", name: `Anillo Sol ${id}`, sku: `SOL-X-${id}`, category: "jewelry", isPublic: true, status: "published",
  cost: 105, prices: { t_retail: 1350 }, quantityOnHand: 3,
  images: [{ id: `i_${id}`, url: `https://x.test/${id}.jpg`, order: 0, isPrimary: true }],
  createdAt: "", updatedAt: "",
  ...overrides,
} as Product);

const noPending = { orders: [] as Order[], purchases: [] as Purchase[], incidents: [] as OrderIncident[] };

describe("#461 conversión asistida — movimientos pendientes por origen", () => {
  const o1 = origin("o1");
  const sources = [o1];

  it("pedido con piezas por entregar bloquea su origen; entregado o cancelado sin piezas no", () => {
    const holding = { id: "ord1", storeId: "s1", status: "confirmed", items: [{ productId: "o1", productName: "X", quantity: 2, unitPrice: 100, subtotal: 200 }] } as never as Order;
    const delivered = { id: "ord2", storeId: "s1", status: "delivered", items: [{ productId: "o1", productName: "X", quantity: 2, unitPrice: 100, subtotal: 200 }] } as never as Order;
    expect(pendingMovementsForSources(sources, [holding], [], []).map((p) => [p.kind, p.productId])).toEqual([["order", "o1"]]);
    expect(pendingMovementsForSources(sources, [delivered], [], [])).toEqual([]);
  });

  it("compra sin recibir bloquea; recibida no", () => {
    const pendingPurchase = { id: "pur1", storeId: "s1", status: "ready", lines: [{ productId: "o1", name: "X", quantity: 5, unitCost: 10 }] } as never as Purchase;
    const received = { ...pendingPurchase, id: "pur2", status: "received" } as never as Purchase;
    expect(pendingMovementsForSources(sources, [], [pendingPurchase], []).map((p) => p.kind)).toEqual(["purchase"]);
    expect(pendingMovementsForSources(sources, [], [received], [])).toEqual([]);
  });

  it("incidencia abierta o acordada-sin-confirmar bloquea (propia o de reemplazo); confirmada no", () => {
    const opened = { id: "inc1", productId: "o1", productName: "X", quantity: 1, events: [{ id: "e1", at: now, by: "u", kind: "opened" }] } as never as OrderIncident;
    const agreed = { ...opened, id: "inc2", events: [...opened.events, { id: "e2", at: now, by: "u", kind: "resolution_agreed" }] } as never as OrderIncident;
    const confirmed = { ...agreed, id: "inc3", events: [...agreed.events, { id: "e3", at: now, by: "u", kind: "confirmed" }] } as never as OrderIncident;
    const replacement = { ...opened, id: "inc4", productId: "otro", replacement: { productId: "o1", productName: "X", unitPriceCents: 100, unitCostCents: 50, chargeDifference: false } } as never as OrderIncident;
    expect(pendingMovementsForSources(sources, [], [], [opened]).map((p) => p.kind)).toEqual(["return"]);
    expect(pendingMovementsForSources(sources, [], [], [agreed]).map((p) => p.kind)).toEqual(["return"]);
    expect(pendingMovementsForSources(sources, [], [], [confirmed])).toEqual([]);
    expect(pendingMovementsForSources(sources, [], [], [replacement]).map((p) => p.kind)).toEqual(["return"]);
  });
});

describe("#461 conversión asistida — vista previa", () => {
  it("muestra antes/después por origen con clave, costo y diferencia de precio; convertible sin pendientes", () => {
    const o1 = origin("o1", { quantityOnHand: 3 });
    const preview = buildConversionPreview(main(), [o1], [{ productId: "o1", color: "Dorado", size: "7" }], noPending);
    expect(preview.canConvert).toBe(true);
    expect(preview.pending).toEqual([]);
    const row = preview.rows[0];
    expect(row).toMatchObject({
      productId: "o1", color: "Dorado", size: "7", sku: "SOL-X-o1", cost: 105,
      availableBefore: 3, committedBefore: 0, physicalBefore: 3, combinationAfter: 3,
    });
    expect(row.priceDifferences).toEqual([{ level: "t_retail", origin: 1350, main: 1400 }]);
  });

  it("el comprometido vivo se muestra Y bloquea (con su referencia)", () => {
    const o1 = origin("o1", { quantityOnHand: 3 });
    const holding = { id: "ord9", storeId: "s1", status: "confirmed", items: [{ productId: "o1", productName: "X", quantity: 2, unitPrice: 100, subtotal: 200 }] } as never as Order;
    const preview = buildConversionPreview(main(), [o1], [{ productId: "o1", color: "Dorado", size: "7" }], { ...noPending, orders: [holding] });
    expect(preview.canConvert).toBe(false);
    expect(preview.rows[0].committedBefore).toBe(2);
    expect(preview.rows[0].availableBefore).toBe(1);
    expect(preview.pending.length).toBe(1);
    expect(preview.pending[0].id).toBe("ord9");
  });

  it("correspondencia inequívoca: dos orígenes a la MISMA combinación bloquean", () => {
    const sources = [origin("o1"), origin("o2")];
    const preview = buildConversionPreview(main(), sources, [
      { productId: "o1", color: "Dorado", size: "7" },
      { productId: "o2", color: "Dorado", size: "7" },
    ], noPending);
    expect(preview.canConvert).toBe(false);
    expect(preview.blockers[0]).toMatch(/misma combinación/);
  });

  it("un origen con colores propios bloquea (una ficha origen = una combinación); cuarentena bloquea", () => {
    const variantOrigin = origin("ov", { variants: [{ id: "v", color: "Dorado", photos: [], createdAt: "", updatedAt: "" }], quantityOnHand: undefined });
    const quarantined = origin("oq", { quantityQuarantined: 1 });
    const p1 = buildConversionPreview(main(), [variantOrigin], [{ productId: "ov", color: "Dorado", size: "7" }], noPending);
    expect(p1.canConvert).toBe(false);
    expect(p1.blockers[0]).toMatch(/se vende por color/);
    const p2 = buildConversionPreview(main(), [quarantined], [{ productId: "oq", color: "Dorado", size: "7" }], noPending);
    expect(p2.canConvert).toBe(false);
    expect(p2.blockers.join(" ")).toMatch(/cuarentena/);
  });

  it("existencia sin rastrear se conserva como tal (nunca cero) y costo desconocido sigue desconocido", () => {
    const o1 = origin("o1", { quantityOnHand: undefined, cost: undefined });
    const preview = buildConversionPreview(main(), [o1], [{ productId: "o1", color: "Plateado", size: "9" }], noPending);
    expect(preview.rows[0]).toMatchObject({ physicalBefore: undefined, combinationAfter: undefined, cost: undefined });
    const applied = applyConversion(main(), [o1], [{ productId: "o1", color: "Plateado", size: "9" }], now);
    const plateado = applied.main.variants!.find((v) => v.color === "Plateado")!;
    const talla = plateado.sizes!.find((s) => s.size === "9")!;
    expect(talla.quantityOnHand).toBeUndefined();
    expect(talla.cost).toBeUndefined();
  });
});

describe("#461 conversión asistida — aplicación pura", () => {
  it("mueve el estante SOLO a la combinación, archiva el origen con nota de fusión y conserva la identidad", () => {
    const o1 = origin("o1", { quantityOnHand: 3 });
    const applied = applyConversion(main(), [o1], [{ productId: "o1", color: "Dorado", size: "7" }], now);
    const dorado = applied.main.variants!.find((v) => v.id === "v_dorado")!;
    expect(dorado.sizes!.find((s) => s.size === "6")!.quantityOnHand).toBe(2); // intacta
    const nueva = dorado.sizes!.find((s) => s.size === "7")!;
    expect(nueva).toMatchObject({ sku: "SOL-X-o1", cost: 105, quantityOnHand: 3 });
    expect(dorado.quantityOnHand).toBeUndefined(); // nivel color sigue derivado
    // origen archivado, fuera de venta, con enlace interno
    const archived = applied.sources[0];
    expect(archived.status).toBe("archived");
    expect(archived.isPublic).toBe(false);
    expect(archived.mergedInto).toMatchObject({ productId: "p_main" });
    expect(archived.mergedInto!.variantId).toBe("v_dorado");
    expect(archived.mergedInto!.sizeId).toBe(nueva.id);
    expect(archived.sku).toBe("SOL-X-o1"); // identidad conservada
    expect(archived.quantityOnHand).toBe(0); // el estante se fue a la combinación
  });

  it("color nuevo se crea DESDE los datos del origen (galería y precios) sin recaptura", () => {
    const o1 = origin("o1");
    const applied = applyConversion(main(), [o1], [{ productId: "o1", color: "Rosa", size: "6" }], now);
    const rosa = applied.main.variants!.find((v) => v.color === "Rosa")!;
    expect(rosa.photos?.[0]?.url).toBe("https://x.test/o1.jpg");
    expect(rosa.sizes![0]).toMatchObject({ size: "6", sku: "SOL-X-o1", quantityOnHand: 3 });
  });

  it("segunda ronda sobre el mismo diseño suma a sus combinaciones existentes", () => {
    const first = applyConversion(main(), [origin("o1", { quantityOnHand: 3 })], [{ productId: "o1", color: "Dorado", size: "7" }], now);
    const second = applyConversion(first.main, [origin("o2", { sku: "SOL-X-o2", quantityOnHand: 4 })], [{ productId: "o2", color: "Dorado", size: "7" }], now);
    const talla7 = second.main.variants!.find((v) => v.id === "v_dorado")!.sizes!.find((s) => s.size === "7")!;
    expect(talla7.quantityOnHand).toBe(7);
  });

  it("un origen ya fusionado se rechaza (no se mueve inventario dos veces)", () => {
    const merged = origin("om", { mergedInto: { productId: "p_main", variantId: "v_dorado", sizeId: "x", at: now }, status: "archived" } as Partial<Product>);
    const preview = buildConversionPreview(main(), [merged], [{ productId: "om", color: "Dorado", size: "7" }], noPending);
    expect(preview.canConvert).toBe(false);
    expect(preview.blockers[0]).toMatch(/ya fue fusionada/);
  });
});
