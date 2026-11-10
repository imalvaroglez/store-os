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
