// Catalog helpers: slugs, category ids, migration. Pure functions, unit-tested.
import type {
  AppState,
  Category,
  Product,
  ProductCategory,
} from "../types";
import { CURRENT_PRODUCT_SCHEMA_VERSION } from "../types";
import { CANONICAL_TIERS, LEGACY_TIER_IDS } from "./pricing";
import { migrateOrders } from "./orders";

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

/**
 * Live SKU base (every keystroke, no collision work). Joins an uppercase prefix
 * with the slugified+uppercased name. Empty name → just the prefix. Empty/invalid
 * prefix → the name alone (so unconfigured stores still get a suggestion).
 */
export function suggestSkuBase(name: string, prefix?: string): string {
  const cleanPrefix = normalizeSkuPrefixToken(prefix);
  const namePart = slugify(name).toUpperCase();
  if (!cleanPrefix && !namePart) return "";
  if (!cleanPrefix) return namePart;
  if (!namePart) return cleanPrefix;
  return `${cleanPrefix}-${namePart}`;
}

/**
 * Resolve a unique SKU within a store. Mirrors uniqueProductSlug's stability
 * (currentSku returned as-is if still free) but uses TWO-DIGIT suffixes (-02,
 * -03, …) per the spec and a 40-char total cap that reserves room for the suffix.
 */
export function uniqueProductSku(
  products: Product[],
  storeId: string,
  productId: string,
  base: string,
  currentSku?: string
): string {
  const taken = new Set(
    products
      .filter((p) => p.storeId === storeId && p.id !== productId)
      .map((p) => (p.sku ?? "").toUpperCase())
      .filter(Boolean)
  );
  const free = (s: string) => s && !taken.has(s.toUpperCase());

  // Stability: an existing SKU that's still free is kept verbatim.
  if (currentSku && free(currentSku)) return currentSku;

  const root = base || "PIEZA";
  // Cap the base so the whole string (with a future suffix) stays ≤ 40 chars.
  const cap = (s: string) => trimTrailingHyphen(s.slice(0, 40));
  let candidate = cap(root);
  if (free(candidate)) return candidate;
  // Collisions: -02, -03, … The taken set is finite so the loop always ends;
  // the base is re-truncated per suffix length so the SKU stays ≤ 40 chars.
  // No artificial cap: a 499-line batch plus existing products can exceed -99.
  for (let n = 2; ; n++) {
    // Two-digit padding up to -99 keeps the historical format; beyond that
    // the bare number keeps the SKU within 40 chars.
    const suffix = `-${n < 100 ? String(n).padStart(2, "0") : n}`;
    const suffixed = trimTrailingHyphen(root.slice(0, Math.max(1, 40 - suffix.length))) + suffix;
    if (free(suffixed)) return suffixed;
  }
}

/** Uppercase, no accents, alphanumerics only — for the store's skuPrefix field. */
export function normalizeSkuPrefixToken(raw?: string): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

// ponytail: trim a trailing hyphen left by truncation; inline one-liner.
function trimTrailingHyphen(s: string): string {
  return s.replace(/-+$/g, "");
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
  let next = state;

  // ── scalable-pricing step (schema v2) ─────────────────────────────────
  // Stores without priceTiers get the 3 canonical tiers + t_retail default;
  // products re-key prices by tier id; orders remap legacy priceTier values.
  // Unchanged entities keep their REFERENCE so callers can persist only what
  // actually changed (identity comparison).
  const storesChanged = next.stores.some((s) => !s.priceTiers);
  if (storesChanged) {
    next = {
      ...next,
      stores: next.stores.map((s) =>
        s.priceTiers
          ? s
          : { ...s, priceTiers: CANONICAL_TIERS.map((t) => ({ ...t })), defaultTierId: "t_retail" }
      ),
    };
  }
  const products = next.products;
  const needsMigration = products.some(
    (p) => p.schemaVersion !== CURRENT_PRODUCT_SCHEMA_VERSION
  );
  const migratedOrders = migrateOrders(next.orders);
  const ordersChanged = migratedOrders.some((order, index) => order !== next.orders[index]);
  if (ordersChanged) next = { ...next, orders: migratedOrders };
  if (!needsMigration) return next;

  const now = new Date().toISOString();
  const categoriesById = new Map<string, Category>();
  // Seed from existing categories so we don't drop admin-created ones.
  for (const c of state.categories ?? []) categoriesById.set(c.id, c);

  // Map storeId → skuPrefix so migrated products backfill real SKUs when possible.
  const prefixByStore = new Map<string, string>();
  for (const s of state.stores ?? []) {
    if (s.skuPrefix) prefixByStore.set(s.id, normalizeSkuPrefixToken(s.skuPrefix));
  }

  const slugsByStore = new Map<string, Set<string>>();
  for (const p of products) {
    if (!p.slug) continue;
    const taken = slugsByStore.get(p.storeId) ?? new Set<string>();
    taken.add(p.slug);
    slugsByStore.set(p.storeId, taken);
  }

  const migratedProducts = products.map((p) => {
    if (p.schemaVersion === CURRENT_PRODUCT_SCHEMA_VERSION) return p;

    // Only synthesize a legacy category when the product has none of its own.
    // A product that already carries categoryIds (e.g. Olivia's seeded pieces)
    // keeps those and does not spawn a generic "Joyería" category.
    const hasOwnCategories = p.categoryIds && p.categoryIds.length > 0;
    const cat = !hasOwnCategories ? categoryFromLegacy(p.storeId, p.category, now) : null;
    if (cat && !categoriesById.has(cat.id)) categoriesById.set(cat.id, cat);

    const categoryIds = hasOwnCategories ? p.categoryIds! : cat ? [cat.id] : [];

    // Mirror a legacy single image into a one-item primary gallery.
    const images = p.images
      ? p.images
      : p.imageUrl
        ? [{
            id: "img_legacy",
            url: p.imageUrl,
            storagePath: `products/${p.storeId}/${p.id}.jpg`,
            order: 0,
            isPrimary: true,
          }]
        : [];

    const status = p.status ?? (p.isPublic ? "published" : "draft");

    const taken = slugsByStore.get(p.storeId) ?? new Set<string>();
    let slug = p.slug ?? (slugify(p.name) || "pieza");
    if (!p.slug) {
      let suffix = 2;
      const root = slug;
      while (taken.has(slug)) slug = `${root}-${suffix++}`;
      taken.add(slug);
      slugsByStore.set(p.storeId, taken);
    }

    // v2: re-key tiered prices by canonical tier id (undefined keys dropped).
    const prices =
      p.prices &&
      Object.fromEntries(
        Object.entries(p.prices)
          .map(([k, v]) => [LEGACY_TIER_IDS[k] ?? k, v] as const)
          .filter(([, v]) => v !== undefined)
      );
    const pricesChanged =
      !!p.prices && Object.keys(p.prices).some((k) => k in LEGACY_TIER_IDS);

    return {
      ...p,
      categoryIds,
      images,
      slug,
      sku: p.sku?.trim() || suggestSkuBase(p.name, prefixByStore.get(p.storeId)) || p.id,
      status,
      availability: p.availability ?? "available",
      ...(pricesChanged ? { prices } : {}),
      schemaVersion: CURRENT_PRODUCT_SCHEMA_VERSION,
    } as Product;
  });

  return {
    ...next,
    categories: Array.from(categoriesById.values()),
    products: migratedProducts,
  };
}
