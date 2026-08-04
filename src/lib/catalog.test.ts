import { describe, it, expect } from "vitest";
import {
  slugify,
  categoryIdFor,
  uniqueProductSlug,
  categoryFromLegacy,
  migrateCatalog,
  suggestSkuBase,
  uniqueProductSku,
  normalizeSkuPrefixToken,
  defaultSkuPrefix,
} from "./catalog";
import type { AppState, Product } from "../types";
import { CURRENT_PRODUCT_SCHEMA_VERSION, MAX_PRODUCT_IMAGES, MAX_PRODUCT_CATEGORIES } from "../types";

function legacyProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    storeId: "s1",
    name: "Anillo de plata",
    category: "jewelry",
    isPublic: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function emptyState(products: Product[]): AppState {
  return {
    stores: [{ id: "s1", name: "Olivia", slug: "olivia", type: "on_demand", createdAt: "", updatedAt: "" }],
    activeStoreId: "s1",
    products,
    categories: [],
    customers: [],
    orders: [],
  };
}

describe("slugify", () => {
  it("strips accents, lowercases, hyphenates", () => {
    expect(slugify("Joyería Fina")).toBe("joyeria-fina");
    expect(slugify("  Aretes ¡especiales!  ")).toBe("aretes-especiales");
    expect(slugify("A/B C")).toBe("a-b-c");
  });
  it("falls back when empty", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("categoryIdFor", () => {
  it("composes store + slug, store-scoped uniqueness", () => {
    expect(categoryIdFor("s1", "anillos")).toBe("s1__anillos");
    expect(categoryIdFor("s2", "anillos")).toBe("s2__anillos");
  });
});

describe("uniqueProductSlug", () => {
  const base = [legacyProduct({ id: "other", slug: "anillo" })];
  it("keeps an existing slug stable (no change on rename)", () => {
    expect(uniqueProductSlug(base, "s1", "p1", "nuevo-nombre", "anillo-viejo")).toBe("anillo-viejo");
  });
  it("uses base slug when free", () => {
    expect(uniqueProductSlug(base, "s1", "p1", "collar")).toBe("collar");
  });
  it("appends -2, -3 on collision within the same store", () => {
    const taken = [
      legacyProduct({ id: "a", slug: "anillo" }),
      legacyProduct({ id: "b", slug: "anillo-2" }),
    ];
    expect(uniqueProductSlug(taken, "s1", "new", "anillo")).toBe("anillo-3");
  });
  it("ignores the product's own slug when checking collisions", () => {
    const me = [legacyProduct({ id: "me", slug: "anillo" })];
    expect(uniqueProductSlug(me, "s1", "me", "anillo")).toBe("anillo");
  });
});

describe("categoryFromLegacy", () => {
  it("maps enum to a labeled, store-scoped category", () => {
    const c = categoryFromLegacy("s1", "jewelry", "now");
    expect(c.id).toBe("s1__jewelry");
    expect(c.name).toBe("Joyería");
    expect(c.active).toBe(true);
  });
});

describe("migrateCatalog", () => {
  it("is idempotent: running twice equals running once", () => {
    const s1 = migrateCatalog(emptyState([legacyProduct()]));
    const s2 = migrateCatalog(s1);
    expect(s2).toEqual(s1);
  });
  it("synthesizes a category from legacy category enum and links it", () => {
    const out = migrateCatalog(emptyState([legacyProduct()]));
    expect(out.categories).toHaveLength(1);
    expect(out.categories[0].id).toBe("s1__jewelry");
    expect(out.products[0].categoryIds).toEqual(["s1__jewelry"]);
  });
  it("mirrors a legacy imageUrl into a single primary gallery image", () => {
    const out = migrateCatalog(emptyState([legacyProduct({ imageUrl: "http://x/y.jpg" })]));
    expect(out.products[0].images).toHaveLength(1);
    expect(out.products[0].images![0].isPrimary).toBe(true);
    expect(out.products[0].images![0].url).toBe("http://x/y.jpg");
  });
  it("maps isPublic false -> draft, true -> published", () => {
    const out = migrateCatalog(emptyState([
      legacyProduct({ id: "pub", isPublic: true }),
      legacyProduct({ id: "priv", isPublic: false }),
    ]));
    const byId = Object.fromEntries(out.products.map((p) => [p.id, p]));
    expect(byId.pub.status).toBe("published");
    expect(byId.priv.status).toBe("draft");
  });
  it("marks schemaVersion and assigns a slug", () => {
    const out = migrateCatalog(emptyState([legacyProduct({ name: "Collar de oro" })]));
    expect(out.products[0].schemaVersion).toBe(CURRENT_PRODUCT_SCHEMA_VERSION);
    expect(out.products[0].slug).toBe("collar-de-oro");
  });
  it("does not duplicate categories when re-migrated with admin additions", () => {
    let out = migrateCatalog(emptyState([legacyProduct()]));
    // Simulate an admin-added category surviving into a second migration.
    out = migrateCatalog(out);
    const jewelry = out.categories.filter((c) => c.slug === "jewelry");
    expect(jewelry).toHaveLength(1);
  });
});

describe("catalog constants", () => {
  it("enforces the documented ceilings", () => {
    expect(MAX_PRODUCT_IMAGES).toBe(5);
    expect(MAX_PRODUCT_CATEGORIES).toBe(3);
  });
});

// --- SKU suggestion ---

describe("suggestSkuBase", () => {
  it("joins uppercase prefix + slugified name (spec example 1)", () => {
    expect(suggestSkuBase("Anillo de plata 925", "OLIV")).toBe("OLIV-ANILLO-DE-PLATA-925");
  });
  it("strips accents and uppercases (spec example 2)", () => {
    expect(suggestSkuBase("Aretes corazón dorados", "OLIV")).toBe("OLIV-ARETES-CORAZON-DORADOS");
  });
  it("returns just the prefix when the name is empty", () => {
    expect(suggestSkuBase("", "OLIV")).toBe("OLIV");
  });
  it("returns just the name when the prefix is empty/invalid", () => {
    expect(suggestSkuBase("Collar Luna", "")).toBe("COLLAR-LUNA");
    expect(suggestSkuBase("Collar Luna", undefined)).toBe("COLLAR-LUNA");
  });
  it("returns empty when both name and prefix are empty", () => {
    expect(suggestSkuBase("", "")).toBe("");
  });
  it("collapses repeated separators and trims hyphens", () => {
    expect(suggestSkuBase("  Pulsera///de  -- plata  ", "OLIV")).toBe("OLIV-PULSERA-DE-PLATA");
  });
});

describe("uniqueProductSku", () => {
  const other = (sku: string): Product =>
    ({ id: "other", storeId: "s1", sku } as Product);

  it("returns the base when free", () => {
    expect(uniqueProductSku([], "s1", "p1", "OLIV-ANILLO-DE-PLATA-925")).toBe("OLIV-ANILLO-DE-PLATA-925");
  });

  it("appends two-digit suffixes -02, -03 on collision (vs slug's -2/-3)", () => {
    const taken = [other("OLIV-ANILLO-DE-PLATA-925"), other("OLIV-ANILLO-DE-PLATA-925-02")];
    expect(uniqueProductSku(taken, "s1", "p1", "OLIV-ANILLO-DE-PLATA-925")).toBe("OLIV-ANILLO-DE-PLATA-925-03");
  });

  it("is store-scoped: another store's SKU doesn't count as a collision", () => {
    const taken = [{ id: "x", storeId: "s2", sku: "OLIV-ANILLO" } as Product];
    expect(uniqueProductSku(taken, "s1", "p1", "OLIV-ANILLO")).toBe("OLIV-ANILLO");
  });

  it("excludes the current product's own SKU from the collision set", () => {
    const me = ({ id: "me", storeId: "s1", sku: "OLIV-ANILLO" } as Product);
    expect(uniqueProductSku([me], "s1", "me", "OLIV-ANILLO")).toBe("OLIV-ANILLO");
  });

  it("keeps a free currentSku verbatim (stability across name edits)", () => {
    expect(uniqueProductSku([], "s1", "p1", "ignored-base", "OLIV-OLD-NAME")).toBe("OLIV-OLD-NAME");
  });

  it("truncates to 40 chars without leaving a trailing hyphen", () => {
    const long = "OLIV-PULSERA-ACERO-INOLVIDABLE-CORAZON-PERLA-FINA";
    const out = uniqueProductSku([], "s1", "p1", long);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).not.toMatch(/-$/);
  });

  it("fits a two-digit suffix within 40 chars when the base collides", () => {
    const long = "OLIV-PULSERA-ACERO-INOLVIDABLE-CORAZON-PERLA";
    const taken = [other(long.slice(0, 40))];
    const out = uniqueProductSku(taken, "s1", "p1", long);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).toMatch(/-02$/);
    expect(out).not.toMatch(/-$/);
  });
});

describe("normalizeSkuPrefixToken", () => {
  it("uppercases, strips accents, alphanumerics only, cap 8", () => {
    expect(normalizeSkuPrefixToken("oliv")).toBe("OLIV");
    expect(normalizeSkuPrefixToken("La Tiéndita 9!")).toBe("LATIENDITA".slice(0, 8));
    expect(normalizeSkuPrefixToken("  ol-iv ")).toBe("OLIV");
  });
  it("empty/undefined → empty string", () => {
    expect(normalizeSkuPrefixToken("")).toBe("");
    expect(normalizeSkuPrefixToken(undefined)).toBe("");
  });
});

describe("defaultSkuPrefix", () => {
  it("derives from slug, uppercased, clean alphanumerics, capped at 4", () => {
    expect(defaultSkuPrefix("olivia")).toBe("OLIV");
    expect(defaultSkuPrefix("la-tiendita-de-fer")).toBe("LATI");
  });
  it("empty slug → empty", () => {
    expect(defaultSkuPrefix("")).toBe("");
  });
});
