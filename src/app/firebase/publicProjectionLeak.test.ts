// #176 — Publications: the anonymous-readable projections must carry ONLY
// public fields. This projects a fully-loaded product (cost, private notes,
// stock counts, membership-ish fields) and asserts none of the private data
// survives into publicStores/publicProducts documents. Projections are the
// real anonymous surface — types/allowlists upstream do not count.
import { describe, expect, it } from "vitest";
import { projectPublicProductDetail, projectPublicProductSummary } from "./firestoreData";
import type { Product } from "../../types";

const loaded: Product = {
  id: "p_loaded",
  storeId: "store_secret",
  name: "Anillo Auditado",
  sku: "AUD-1",
  category: "jewelry",
  categoryIds: ["c1"],
  isPublic: true,
  status: "published",
  cost: 123.45,
  price: 300,
  prices: { t_retail: 300 },
  quantityOnHand: 7,
  quantityQuarantined: 2,
  lowStockAt: 3,
  privateNotes: "NOTA-PRIVADA-MARCADOR",
  publicDescription: "desc pública",
  imageUrl: "https://x.test/cover.jpg",
  images: [{ id: "i1", url: "https://x.test/1.jpg", storagePath: "products/secret/p/1.jpg", order: 0, isPrimary: true }],
  material: "plata",
  finish: "dorado",
  dimensions: "1cm",
  care: "pulir",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  variants: [
    {
      id: "v1", color: "Dorado", skuSuffix: "D", sku: "AUD-1-D", cost: 125.5, quantityOnHand: 4,
      photos: [{ id: "iv1", url: "https://x.test/v1.jpg", storagePath: "products/secret/p/v1.jpg", order: 0, isPrimary: true }],
      createdAt: "", updatedAt: "",
    },
  ],
} as Product;

const PRIVATE_MARKERS = [
  "NOTA-PRIVADA-MARCADOR",
  "123.45", // cost
  "125.5", // variant cost
  "quantityOnHand",
  "quantityQuarantined",
  "lowStockAt",
  "privateNotes",
  "cost",
  "storagePath",
];

function assertNoPrivateLeak(doc: Record<string, unknown>, label: string) {
  const serialized = JSON.stringify(doc);
  for (const marker of PRIVATE_MARKERS) {
    expect(serialized.includes(marker), `${label} filtró "${marker}" en: ${serialized}`).toBe(false);
  }
}

describe("#176 publications — proyecciones públicas sin campos privados", () => {
  it("summary no lleva costo, notas, conteos ni rutas de storage", () => {
    const summary = projectPublicProductSummary(loaded, "olivia-audit", { defaultTierId: "t_retail" }) as Record<string, unknown>;
    assertNoPrivateLeak(summary, "summary");
    // The public variant list carries color/photo/signal ONLY — no counts.
    const variant = (summary.variants as Array<Record<string, unknown>>)[0];
    expect(Object.keys(variant).sort()).toEqual(["color", "id", "imageUrl", "stockSignal"].sort());
  });

  it("detail no lleva costo, notas, conteos ni rutas de storage", () => {
    const detail = projectPublicProductDetail(loaded, "olivia-audit", [], { defaultTierId: "t_retail" }) as Record<string, unknown>;
    assertNoPrivateLeak(detail, "detail");
    expect(detail.name).toBe("Anillo Auditado"); // lo público sí viaja
    expect(detail.images).toBeTruthy();
  });
});

const STORE_ID = "store_secret";

describe("#176 publications — publicStores sin datos de membresía (H3 de revisión)", () => {
  it("la proyección de tienda no lleva memberUids/ownerUid/pendingInvites ni teléfonos", async () => {
    const { projectPublicStore } = await import("./firestoreData");
    const store = {
      id: STORE_ID, name: "Tienda Auditada", slug: "olivia-audit", type: "inventory_tiered",
      ownerUid: "uid-secreto-dueno", memberUids: ["uid-secreto-dueno", "uid-secreto-miembro"],
      pendingInvites: ["maria@clienta.test"], whatsappPhone: "55 0000 0000",
      priceTiers: [{ id: "t_retail", label: "Regular", order: 1, minimum: 0 }],
      defaultTierId: "t_retail", storefront: { hero: { title: "Hola" } },
      createdAt: "", updatedAt: "",
    } as never;
    const projected = projectPublicStore(store) as Record<string, unknown>;
    const serialized = JSON.stringify(projected);
    for (const marker of ["uid-secreto-dueno", "uid-secreto-miembro", "memberUids", "ownerUid", "pendingInvites", "maria@clienta.test"]) {
      expect(serialized.includes(marker), `publicStores filtró "${marker}"`).toBe(false);
    }
  });
});

describe("#461 — tallas públicas por color (señal gruesa, sin conteos)", () => {
  const goldSizes = [
    { id: "s4", size: "4", sku: "AUD-D-4", cost: 100, quantityOnHand: 2, createdAt: "", updatedAt: "" },
    { id: "s6", size: "6", sku: "AUD-D-6", cost: 100, quantityOnHand: 0, createdAt: "", updatedAt: "" },
    { id: "s7", size: "7", sku: "AUD-D-7", cost: 100, createdAt: "", updatedAt: "" }, // sin rastrear ≠ cero
  ];
  const sized: Product = {
    ...loaded,
    id: "p_sized",
    lowStockAt: undefined, // el umbral del diseño heredado haría «pocas»; aquí se prueba la derivación por combinación
    variants: [
      { id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "AUD-D", photos: [], createdAt: "", updatedAt: "", sizes: goldSizes },
      { id: "v_silver", color: "Plateado", skuSuffix: "P", sku: "AUD-P", quantityOnHand: 0, photos: [], createdAt: "", updatedAt: "" },
    ],
  } as Product;

  it("la proyección expone las tallas del color con señal propia y sin datos privados", () => {
    const summary = projectPublicProductSummary(sized, "x", { defaultTierId: "t_retail" }) as Record<string, unknown>;
    const variants = summary.variants as Array<Record<string, unknown>>;
    const gold = variants.find((v) => v.id === "v_gold")!;
    const sizes = gold.sizes as Array<Record<string, unknown>>;
    expect(sizes.map((s) => [s.id, s.size, s.stockSignal])).toEqual([
      ["s4", "4", "disponible"],
      ["s6", "6", "agotado"],
      ["s7", "7", "disponible"], // sin rastrear nunca lee como cero
    ]);
    expect(sizes.map((s) => Object.keys(s).sort())).toEqual([["id", "size", "stockSignal"], ["id", "size", "stockSignal"], ["id", "size", "stockSignal"]]);
    assertNoPrivateLeak(summary, "summary con tallas");
    const detail = projectPublicProductDetail(sized, "x", [], { defaultTierId: "t_retail" }) as Record<string, unknown>;
    assertNoPrivateLeak(detail, "detail con tallas");
    expect(((detail.variants as Array<Record<string, unknown>>).find((v) => v.id === "v_gold")!.sizes as unknown[]).length).toBe(3);
  });

  it("la señal del color con tallas deriva de SUS combinaciones; el diseño agotado sólo si todo está agotado", async () => {
    const { publicStockSignal } = await import("./firestoreData");
    // gold tiene s4 disponible → color disponible aunque s6 agotada y s7 sin rastrear
    const summary = projectPublicProductSummary(sized, "x") as Record<string, unknown>;
    const variants = summary.variants as Array<Record<string, unknown>>;
    expect(variants.find((v) => v.id === "v_gold")!.stockSignal).toBe("disponible");
    expect(variants.find((v) => v.id === "v_silver")!.stockSignal).toBe("agotado");
    // diseño: silver agotado pero gold disponible → disponible
    expect(publicStockSignal(sized)).toBe("disponible");
    // todas las combinaciones agotadas → color y diseño agotados
    const allOut: Product = {
      ...sized,
      variants: [
        { id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "AUD-D", photos: [], createdAt: "", updatedAt: "", sizes: goldSizes.map((s) => ({ ...s, quantityOnHand: 0 })) },
        { id: "v_silver", color: "Plateado", skuSuffix: "P", sku: "AUD-P", quantityOnHand: 0, photos: [], createdAt: "", updatedAt: "" },
      ],
    } as Product;
    expect(publicStockSignal(allOut)).toBe("agotado");
  });
});
