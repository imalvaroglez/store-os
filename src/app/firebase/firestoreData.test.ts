import { describe, it, expect } from "vitest";
import {
  projectPublicProductSummary,
  projectPublicProductDetail,
  projectPublicStore,
  projectAdminStore,
  publicProductId,
  SlugTakenError,
  stripUndefined,
} from "./firestoreData";
import {
  PUBLIC_STORE_FIELDS,
  PUBLIC_PRODUCT_FIELDS,
  ADMIN_STORE_FIELDS,
  ADMIN_STORE_EXCLUSIONS,
} from "./rules-allowlist";
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

  it("inventory-tiered: exposes ONE resolved price (default tier), never the tier map or private prices", () => {
    const projected = projectPublicProductSummary(
      baseProduct({
        prices: { t_retail: 2000, t_wholesale: 1500, t_reseller: 1700 },
        cost: 800,
      }),
      "joyeria",
      "t_wholesale"
    );
    expect(projected.price).toBe(1500);
    expect("prices" in projected).toBe(false);
    expect("cost" in projected).toBe(false);
    // Without a defaultTierId it falls back to the legacy retail key.
    const legacy = projectPublicProductSummary(
      baseProduct({ prices: { retail: 2000, wholesale: 1500 } }),
      "joyeria"
    );
    expect(legacy.price).toBe(2000);
    expect("prices" in legacy).toBe(false);
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

// G-P03 inverse test: a safe projection enumerates fields and MUST ignore unknown
// source keys. Adding a private field to the source cannot change the output. This
// would fail if a projector ever did `{ ...source }` or copied a forbidden field.
describe("public projection allow-list (G-P03)", () => {
  const STORE_ALLOWED = PUBLIC_STORE_FIELDS as readonly string[];
  const PRODUCT_ALLOWED = PUBLIC_PRODUCT_FIELDS as readonly string[];

  it("projectPublicStore emits only allow-listed keys", () => {
    // Source carries private/control fields a projection must never copy.
    const source = {
      id: "s1",
      name: "Olivia",
      slug: "olivia",
      type: "inventory_tiered",
      whatsappPhone: "+52",
      storefront: null,
      ownerUid: "u1",
      memberUids: ["u1"],
      pendingInvites: ["x@y.z"],
      skuPrefix: "OL",
      createdAt: "t0",
      updatedAt: "t1",
    } as unknown as Store;
    const out = projectPublicStore(source) as Record<string, unknown>;
    const keys = Object.keys(out);
    // (a) No forbidden key leaks.
    for (const f of ["ownerUid", "memberUids", "pendingInvites", "skuPrefix"] as const) {
      expect(keys, `leaked ${f}`).not.toContain(f);
    }
    // (b) Every emitted key is allow-listed.
    for (const k of keys) expect(STORE_ALLOWED, `unexpected key ${k}`).toContain(k);
  });

  it("projectPublicProductDetail strips cost/inventory/notes and wholesale/reseller prices", () => {
    const source = {
      id: "p1",
      storeId: "s1",
      name: "Collar",
      slug: "collar",
      sku: "COL-1",
      publicDescription: "descripcion",
      material: "plata",
      finish: "pulido",
      dimensions: "40cm",
      care: "evita agua",
      images: [],
      categoryIds: [],
      availability: "available",
      canInquire: false,
      isFeatured: false,
      isNew: false,
      // Private fields that must never appear in a public doc.
      cost: 800,
      privateNotes: "secreto",
      quantityOnHand: 12,
      lowStockAt: 3,
      // Full tiered pricing — only retail may survive.
      prices: { retail: 2000, wholesale: 1500, reseller: 1700 },
    } as unknown as Product;
    const out = projectPublicProductDetail(source, "olivia", []) as Record<string, unknown>;
    const keys = Object.keys(out);
    // (a) No private key leaks.
    for (const f of ["cost", "privateNotes", "quantityOnHand", "lowStockAt"] as const) {
      expect(keys, `leaked ${f}`).not.toContain(f);
    }
    // (b) prices, when present, is { retail } only.
    if (keys.includes("prices")) {
      const prices = out.prices as Record<string, unknown>;
      expect(prices).toEqual({ retail: 2000 });
      expect("wholesale" in prices).toBe(false);
      expect("reseller" in prices).toBe(false);
    }
    // (c) Every emitted key is allow-listed.
    for (const k of keys) expect(PRODUCT_ALLOWED, `unexpected key ${k}`).toContain(k);
  });

  it("adding a private field to the source does not change the public output", () => {
    const base = {
      id: "s1",
      name: "Olivia",
      slug: "olivia",
      type: "inventory_tiered",
      whatsappPhone: null,
      storefront: null,
    } as unknown as Store;
    // An unknown/private field on the source MUST be ignored — a safe projection
    // never spreads the source. This assertion fails the moment a projector does.
    expect(projectPublicStore({ ...base, secretNewField: "leak" } as unknown as Store)).toEqual(
      projectPublicStore(base)
    );
  });
});

// G-P02 control-plane projection: adminStores/{id} carries ONLY allow-listed
// control metadata, never business content or tenant PII. super_admin lists this
// collection for platform administration, so it must be leak-proof by
// construction (mirrors the public-projection inverse test above).
describe("projectAdminStore control-plane projection (G-P02)", () => {
  const ALLOWED = ADMIN_STORE_FIELDS as readonly string[];
  const EXCLUSIONS = ADMIN_STORE_EXCLUSIONS as readonly string[];

  it("emits only allow-listed control keys, never business content/PII", () => {
    const source = {
      id: "s1",
      name: "Olivia",
      slug: "olivia",
      type: "inventory_tiered",
      // Business content + client PII that must NEVER reach adminStores.
      whatsappPhone: "+5255",
      skuPrefix: "OL",
      storefront: { hero: { title: "x" } },
      // Control fields that DO belong on adminStores.
      ownerUid: "u1",
      memberUids: ["u1", "u2"],
      pendingInvites: ["x@y.z"],
      createdAt: "t0",
      updatedAt: "t1",
      retainedPrivacyRequestCount: 2,
    } as unknown as { id: string } & Record<string, unknown>;
    const out = projectAdminStore(source) as Record<string, unknown>;
    const keys = Object.keys(out);
    // (a) No excluded business/PII key leaks.
    for (const f of EXCLUSIONS) expect(keys, `leaked ${f}`).not.toContain(f);
    // (b) Every emitted key is control-allow-listed.
    for (const k of keys) expect(ALLOWED, `unexpected key ${k}`).toContain(k);
    // (c) storeId echoes the source id.
    expect(out.storeId).toBe("s1");
    expect(out.ownerUid).toBe("u1");
    expect(out.memberUids).toEqual(["u1", "u2"]);
  });

  it("defaults retainedPrivacyRequestCount to 0 and pendingInvites to []", () => {
    const out = projectAdminStore({
      id: "s1",
      name: "Olivia",
      slug: "olivia",
      type: "on_demand",
      ownerUid: "u1",
      memberUids: ["u1"],
      createdAt: "t0",
      updatedAt: "t1",
    }) as Record<string, unknown>;
    expect(out.retainedPrivacyRequestCount).toBe(0);
    expect(out.pendingInvites).toEqual([]);
  });

  it("adding a private field to the source does not change the control output", () => {
    const base = {
      id: "s1",
      name: "Olivia",
      slug: "olivia",
      type: "on_demand",
      ownerUid: "u1",
      memberUids: ["u1"],
      createdAt: "t0",
      updatedAt: "t1",
    } as unknown as { id: string } & Record<string, unknown>;
    // A safe projection never spreads the source — unknown keys cannot land here.
    expect(projectAdminStore({ ...base, secretNewField: "leak" })).toEqual(projectAdminStore(base));
  });
});

// Regression for the F3 purchase-persist bug: a purchase line carrying
// `price: undefined` (inventory_tiered) nested inside `lines[]` reached
// Firestore as a literal undefined and was rejected ("Unsupported field value").
// saveEntity must strip undefined RECURSIVELY (not just top-level).
describe("saveEntity stripUndefined (recursive)", () => {
  it("removes undefined at the top level", () => {
    const out = stripUndefined({ a: 1, b: undefined, c: "x" }) as Record<string, unknown>;
    expect(out).toEqual({ a: 1, c: "x" });
  });
  it("removes undefined nested inside objects (e.g. a purchase line)", () => {
    const line = { productId: "p1", name: "Ring", quantity: 2, unitCost: 100, price: undefined, prices: { retail: 800 } };
    const out = stripUndefined({ lines: [line] }) as { lines: Array<Record<string, unknown>> };
    expect(out.lines[0]).not.toHaveProperty("price");
    expect(out.lines[0].prices).toEqual({ retail: 800 });
  });
  it("removes undefined nested in arrays", () => {
    const out = stripUndefined([{ a: 1, b: undefined }, { c: undefined, d: 2 }]) as Array<Record<string, unknown>>;
    expect(out).toEqual([{ a: 1 }, { d: 2 }]);
  });
  it("leaves non-undefined nested objects intact (deep)", () => {
    const out = stripUndefined({ a: { b: { c: 1 } } }) as Record<string, unknown>;
    expect(out).toEqual({ a: { b: { c: 1 } } });
  });
});
