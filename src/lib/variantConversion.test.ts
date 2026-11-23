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
  it("muestra antes/después por origen con clave y costo; convertible sin pendientes ni diferencias", () => {
    const o1 = origin("o1", { quantityOnHand: 3, prices: { t_retail: 1400 } });
    const preview = buildConversionPreview(main(), [o1], [{ productId: "o1", color: "Dorado", size: "7" }], noPending);
    expect(preview.canConvert).toBe(true);
    expect(preview.blockers).toEqual([]);
    expect(preview.pending).toEqual([]);
    const row = preview.rows[0];
    expect(row).toMatchObject({
      productId: "o1", color: "Dorado", size: "7", sku: "SOL-X-o1", cost: 105,
      availableBefore: 3, committedBefore: 0, physicalBefore: 3, combinationAfter: 3,
    });
    expect(row.priceDifferences).toEqual([]);
  });

  // ── Dictamen QA 23-nov ──
  it("mayor: precio distinto al unificar con un color EXISTENTE detiene la conversión y nombra ambas cifras", () => {
    const o1 = origin("o1", { quantityOnHand: 3 }); // $1,350 contra $1,400 del color Dorado
    const preview = buildConversionPreview(main(), [o1], [{ productId: "o1", color: "Dorado", size: "7" }], noPending);
    expect(preview.canConvert).toBe(false);
    expect(preview.blockers.join(" ")).toMatch(/Anillo Sol o1 tiene precios distintos.*origen \$1,350 · color Dorado \$1,400/);
    expect(preview.blockers.join(" ")).toMatch(/Fer decide cu[aá]l conservar/i);
    expect(preview.rows[0].priceDifferences).toEqual([{ level: "t_retail", origin: 1350, main: 1400 }]);
  });

  it("un nivel que sólo tiene el origen (o sólo el color) también detiene: no se cambia qué es vendible por inferencia", () => {
    const o1 = origin("o1", { prices: { t_retail: 1400, t_mayoreo: 900 } });
    const preview = buildConversionPreview(main(), [o1], [{ productId: "o1", color: "Dorado", size: "7" }], noPending);
    expect(preview.canConvert).toBe(false);
    expect(preview.blockers.join(" ")).toMatch(/t_mayoreo/);
    expect(preview.rows[0].priceDifferences).toContainEqual({ level: "t_mayoreo", origin: 900, main: undefined });
  });

  it("la comparación es contra los precios PROPIOS del color existente (#467), no contra el diseño", () => {
    const mainWithOwnPrices = main();
    mainWithOwnPrices.variants![0].prices = { t_retail: 1350 };
    const o1 = origin("o1", { prices: { t_retail: 1350 } }); // igual al color, distinto al diseño (1400)
    const preview = buildConversionPreview(mainWithOwnPrices, [o1], [{ productId: "o1", color: "Dorado", size: "7" }], noPending);
    expect(preview.canConvert).toBe(true);
    expect(preview.rows[0].priceDifferences).toEqual([]);
  });

  it("un color NUEVO conserva los precios del origen (#467): la misma diferencia no detiene", () => {
    const o1 = origin("o1", { prices: { t_retail: 1350 } });
    const preview = buildConversionPreview(main(), [o1], [{ productId: "o1", color: "Rosa", size: "6" }], noPending);
    expect(preview.canConvert).toBe(true);
    expect(preview.blockers).toEqual([]);
  });

  it("tienda de precio único: precio distinto detiene siempre (no hay precios por color que conservar)", () => {
    const simpleMain = main({ prices: undefined, price: 400, variants: main().variants!.map((v) => ({ ...v, prices: undefined })) });
    const o1 = origin("o1", { prices: undefined, price: 450 });
    expect(buildConversionPreview(simpleMain, [o1], [{ productId: "o1", color: "Dorado", size: "7" }], noPending).canConvert).toBe(false);
    expect(buildConversionPreview(simpleMain, [o1], [{ productId: "o1", color: "Rosa", size: "6" }], noPending).blockers.join(" ")).toMatch(/450.*400/);
    const same = origin("o1", { prices: undefined, price: 400 });
    expect(buildConversionPreview(simpleMain, [same], [{ productId: "o1", color: "Rosa", size: "6" }], noPending).canConvert).toBe(true);
  });

  it("crítico 3: el color existente tiene piezas contadas sin talla (5) — detener y explicar, en vez de volverlas 3", () => {
    const colorOnly = main({ variants: [{ id: "v_dorado", color: "Dorado", skuSuffix: "D", sku: "SOL-D", photos: [], quantityOnHand: 5, createdAt: "", updatedAt: "" }] });
    const o1 = origin("o1", { quantityOnHand: 3, prices: { t_retail: 1400 } });
    const preview = buildConversionPreview(colorOnly, [o1], [{ productId: "o1", color: "Dorado", size: "7" }], noPending);
    expect(preview.canConvert).toBe(false);
    expect(preview.blockers.join(" ")).toMatch(/color Dorado de la ficha principal tiene 5 piezas contadas sin talla/);
    expect(preview.blockers.join(" ")).toMatch(/reparte esas piezas/);
    // Un color sin existencia rastreada sí puede recibir su primera talla.
    const untracked = main({ variants: [{ ...colorOnly.variants![0], quantityOnHand: undefined }] });
    expect(buildConversionPreview(untracked, [o1], [{ productId: "o1", color: "Dorado", size: "7" }], noPending).canConvert).toBe(true);
  });

  it("la vista previa muestra el Físico del diseño antes y después: nunca baja", () => {
    const o1 = origin("o1", { quantityOnHand: 3, prices: { t_retail: 1400 } });
    const o2 = origin("o2", { quantityOnHand: 4, prices: { t_retail: 1400 } });
    const preview = buildConversionPreview(main(), [o1, o2], [
      { productId: "o1", color: "Dorado", size: "7" },
      { productId: "o2", color: "Plateado", size: "9" },
    ], noPending);
    expect(preview.mainPhysical).toEqual({ before: 9, after: 9 }); // 2 del diseño + 3 + 4
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
    expect(preview.blockers.some((reason) => /misma combinación/.test(reason))).toBe(true);
  });

  it("un origen con colores propios bloquea (una ficha origen = una combinación); cuarentena bloquea", () => {
    const variantOrigin = origin("ov", { variants: [{ id: "v", color: "Dorado", photos: [], createdAt: "", updatedAt: "" }], quantityOnHand: undefined });
    const quarantined = origin("oq", { quantityQuarantined: 1 });
    const p1 = buildConversionPreview(main(), [variantOrigin], [{ productId: "ov", color: "Dorado", size: "7" }], noPending);
    expect(p1.canConvert).toBe(false);
    expect(p1.blockers.some((reason) => /se vende por color/.test(reason))).toBe(true);
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
    expect(preview.blockers.some((reason) => /ya fue fusionada/.test(reason))).toBe(true);
  });
});
