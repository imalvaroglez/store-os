// Catalog helpers: slugs, category ids, migration. Pure functions, unit-tested.
import type {
  AppState,
  Category,
  Product,
  ProductCategory,
} from "../types";
import { CURRENT_PRODUCT_SCHEMA_VERSION } from "../types";

// ponytail: accents/case folding via normalize+regex; no slug lib needed.
// Strips diacritics, lowercases, keeps a-z0-9 and hyphens, collapses runs.
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Composite category id: unique per store, slug reusable across stores. */
export function categoryIdFor(storeId: string, slug: string): string {
  return `${storeId}__${slug}`;
}

/**
 * Resolve a unique product slug within a store. If the base slug collides with
 * another product (by id), append -2, -3, ... Never changes an existing slug on
 * rename — call sites pass the product's current slug (if any) to keep it stable.
 */
export function uniqueProductSlug(
  products: Product[],
  storeId: string,
  productId: string,
  base: string,
  currentSlug?: string
): string {
  // Stable: once a product has a slug, keep it regardless of name changes.
  if (currentSlug) return currentSlug;
  const root = base || "pieza";
  const taken = new Set(
    products.filter((p) => p.storeId === storeId && p.id !== productId).map((p) => p.slug)
  );
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n++;
  return `${root}-${n}`;
}

/** Build a deterministic Category from a legacy ProductCategory enum value. */
export function categoryFromLegacy(
  storeId: string,
  legacy: ProductCategory,
  now: string
): Category {
  const labels: Record<ProductCategory, string> = {
    perfume: "Perfumes",
    sneakers: "Tenis",
    cap: "Gorras",
    jewelry: "Joyería",
    other: "Otros",
  };
  const slug = slugify(legacy);
  return {
    id: categoryIdFor(storeId, slug),
    storeId,
    name: labels[legacy],
    slug,
    sortOrder: 0,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Idempotent migration of products + categories to the new catalog schema.
 *
 * For each store's legacy products (schemaVersion absent):
 *  - ensure a Category exists per legacy `category` value (deterministic id),
 *  - set categoryIds = [that category's id],
 *  - mirror imageUrl into a single primary gallery image,
 *  - map isPublic → status (published/draft),
 *  - leave availability defaulting to "available",
 *  - assign a stable slug if missing,
 *  - mark schemaVersion = CURRENT so re-running is a no-op.
 *
 * Returns a new AppState; does not mutate the input. Safe to call repeatedly.
 */
export function migrateCatalog(state: AppState): AppState {
  const products = state.products;
  const needsMigration = products.some(
    (p) => p.schemaVersion !== CURRENT_PRODUCT_SCHEMA_VERSION
  );
  if (!needsMigration) return state;

  const now = new Date().toISOString();
  const categoriesById = new Map<string, Category>();
  // Seed from existing categories so we don't drop admin-created ones.
  for (const c of state.categories ?? []) categoriesById.set(c.id, c);

  const migratedProducts = products.map((p) => {
    if (p.schemaVersion === CURRENT_PRODUCT_SCHEMA_VERSION) return p;

    // Ensure the legacy category has a Category row.
    const cat = categoryFromLegacy(p.storeId, p.category, now);
    if (!categoriesById.has(cat.id)) categoriesById.set(cat.id, cat);

    const categoryIds = p.categoryIds && p.categoryIds.length > 0
      ? p.categoryIds
      : [cat.id];

    // Mirror a legacy single image into a one-item primary gallery.
    const images = p.images
      ? p.images
      : p.imageUrl
        ? [{
            id: "img_legacy",
            url: p.imageUrl,
            storagePath: `products/${p.storeId}/${p.id}/img_legacy.jpg`,
            order: 0,
            isPrimary: true,
          }]
        : [];

    const status = p.status ?? (p.isPublic ? "published" : "draft");

    const slug = uniqueProductSlug(
      products,
      p.storeId,
      p.id,
      slugify(p.name),
      p.slug
    );

    return {
      ...p,
      categoryIds,
      images,
      slug,
      status,
      availability: p.availability ?? "available",
      schemaVersion: CURRENT_PRODUCT_SCHEMA_VERSION,
    } as Product;
  });

  return {
    ...state,
    categories: Array.from(categoriesById.values()),
    products: migratedProducts,
  };
}
