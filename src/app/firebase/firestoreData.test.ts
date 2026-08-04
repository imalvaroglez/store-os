import { describe, it, expect } from "vitest";
import {
  projectPublicProductSummary,
  projectPublicProductDetail,
  projectPublicStore,
  publicProductId,
  SlugTakenError,
} from "./firestoreData";
import type { Product, Store, Category } from "../../types";

// Unit tests for the public-projection builders. These guarantee that the docs
// anonymous visitors read physically carry NO private fields — the security
// model is "leak-proof by construction", and these tests lock that invariant.
// (The Firestore read path is covered by e2e/public-catalog.spec.ts.)

function baseProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    storeId: "s1",
    name: "Perfume",
    category: "perfume",
    isPublic: true,
    slug: "perfume",
    ...overrides,
  } as Product;
}

const store: Store = {
  id: "s1",
  name: "Santi",
  slug: "santi",
  type: "on_demand",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ownerUid: "uid-secret",
  memberUids: ["uid-secret"],
};

const category: Category = {
  id: "s1__perfume",
  storeId: "s1",
  name: "Perfumes",
  slug: "perfume",
  sortOrder: 0,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("projectPublicStore", () => {
  it("exposes identity + storefront, never membership fields", () => {
    const projected = projectPublicStore(store);
    expect(projected.name).toBe("Santi");
    expect(projected.slug).toBe("santi");
    expect(projected.type).toBe("on_demand");
    // Membership fields must be physically absent.
    expect("ownerUid" in projected).toBe(false);
    expect("memberUids" in projected).toBe(false);
    expect("pendingInvites" in projected).toBe(false);
  });
});

describe("projectPublicProductSummary", () => {
  it("on-demand: copies price, omits cost/notes/inventory", () => {
    const projected = projectPublicProductSummary(
      baseProduct({ price: 1500, cost: 900, privateNotes: "secreto", quantityOnHand: 5 }),
      "santi"
    );
    expect(projected.price).toBe(1500);
    expect("cost" in projected).toBe(false);
    expect("privateNotes" in projected).toBe(false);
    expect("quantityOnHand" in projected).toBe(false);
    expect(projected.storeSlug).toBe("santi");
    expect(projected.productSlug).toBe("perfume");
  });

  it("inventory-tiered: copies only prices.retail, never wholesale/reseller", () => {
    const projected = projectPublicProductSummary(
      baseProduct({
        prices: { retail: 2000, wholesale: 1500, reseller: 1700 },
        cost: 800,
      }),
      "joyeria"
    );
    const prices = projected.prices as Record<string, unknown> | undefined;
    expect(prices).toEqual({ retail: 2000 });
    expect(prices && "wholesale" in prices).toBe(false);
    expect(prices && "reseller" in prices).toBe(false);
    expect("cost" in projected).toBe(false);
  });

  it("picks the primary gallery image for the grid", () => {
    const projected = projectPublicProductSummary(
      baseProduct({
        images: [
          { id: "a", url: "http://x/2", storagePath: "p", order: 1, isPrimary: false },
          { id: "b", url: "http://x/1", storagePath: "p", order: 0, isPrimary: true },
        ],
      }),
      "santi"
    );
    expect(projected.imageUrl).toBe("http://x/1");
  });
});

describe("projectPublicProductDetail", () => {
  it("exposes gallery + material + categories, never cost/inventory/notes", () => {
    const projected = projectPublicProductDetail(
      baseProduct({
        publicDescription: "descripcion",
        material: "plata 925",
        finish: "dorado",
        dimensions: "50 cm",
        care: "evita agua",
        cost: 400,
        privateNotes: "secreto",
        quantityOnHand: 9,
        lowStockAt: 2,
        images: [{ id: "a", url: "http://x/1", storagePath: "p", alt: "foto", order: 0, isPrimary: true }],
        categoryIds: ["s1__perfume"],
      }),
      "santi",
      [category]
    );
    expect(projected.material).toBe("plata 925");
    expect((projected.images as unknown[]).length).toBe(1);
    const cats = projected.categories as { id: string; name: string; slug: string }[];
    expect(cats[0]).toEqual({ id: "s1__perfume", name: "Perfumes", slug: "perfume" });
    // Private fields must be absent.
    expect("cost" in projected).toBe(false);
    expect("privateNotes" in projected).toBe(false);
    expect("quantityOnHand" in projected).toBe(false);
    expect("lowStockAt" in projected).toBe(false);
  });
});

describe("publicProductId", () => {
  it("composes storeId + product slug", () => {
    expect(publicProductId("s1", "collar-de-oro")).toBe("s1__collar-de-oro");
  });
});

describe("SlugTakenError", () => {
  it("carries the colliding slug and a Spanish message", () => {
    const err = new SlugTakenError("santi");
    expect(err.slug).toBe("santi");
    expect(err.message).toContain("santi");
  });
});
