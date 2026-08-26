import { doc, getDoc } from "firebase/firestore";
import { getFirebase } from "./config";
import type { StoreType, Storefront } from "../../types";

// Anonymous public-catalog loader. A visitor at /catalogo/:slug has NO session;
// they read the three public projection collections, which carry only public-safe
// fields. Errors propagate to the caller — this is a user-facing path and silent
// failures are wrong.
//
// Read budget per visit: storefront + catalog = 2 reads. Opening a product = +1.

export type PublicCategory = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  imageUrl?: string | null;
  sortOrder: number;
};

export type PublicProductSummary = {
  storeId: string;
  productSlug: string;
  storeSlug: string;
  name: string;
  publicDescription?: string | null;
  imageUrl?: string | null;
  price?: number;
  availability?: string;
  availableQuantity?: number; // inventory stores; stale until re-projection, server re-checks
  isFeatured?: boolean;
  isNew?: boolean;
  canInquire?: boolean;
  categoryIds?: string[];
  sortOrder?: number;
};

export type PublicProductImage = {
  url: string;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  isPrimary: boolean;
};

export type PublicStore = {
  storeId: string;
  slug: string;
  name: string;
  type: StoreType;
  whatsappPhone?: string | null;
  storefront?: Storefront | null;
};

export type PublicCatalog = {
  categories: PublicCategory[];
  products: PublicProductSummary[];
};

export type PublicProductDetail = {
  storeId: string;
  storeSlug: string;
  productSlug: string;
  name: string;
  sku: string;
  publicDescription?: string | null;
  images: PublicProductImage[];
  material?: string | null;
  finish?: string | null;
  dimensions?: string | null;
  care?: string | null;
  availability?: string;
  availableQuantity?: number; // inventory stores; stale until re-projection, server re-checks
  canInquire?: boolean;
  isFeatured?: boolean;
  isNew?: boolean;
  price?: number;
  productId?: string; // the private product id, used by submitPublicOrder server-side
  categories: { id: string; name: string; slug: string }[];
};

/** Thrown when no public storefront exists for a slug. */
export class PublicCatalogNotFoundError extends Error {
  constructor(public slug: string) {
    super(`No hay catálogo público para "${slug}".`);
    this.name = "PublicCatalogNotFoundError";
  }
}

/** Thrown when a store exists but no public catalog has been projected yet. */
export class PublicCatalogEmptyError extends Error {
  constructor(public slug: string) {
    super(`El catálogo de "${slug}" aún no está publicado.`);
    this.name = "PublicCatalogEmptyError";
  }
}

/** Thrown when a product slug has no public detail doc. */
export class PublicProductNotFoundError extends Error {
  constructor(public productSlug: string) {
    super(`No hay producto público para "${productSlug}".`);
    this.name = "PublicProductNotFoundError";
  }
}

/**
 * Load a store's public storefront + catalog (categories + product summaries).
 * Anonymous. 2 reads. Throws PublicCatalogNotFoundError if the store isn't
 * published, PublicCatalogEmptyError if the storefront exists but its catalog
 * projection hasn't been written yet.
 */
export async function loadPublicCatalog(slug: string): Promise<{
  store: PublicStore;
  catalog: PublicCatalog;
}> {
  const { db } = getFirebase();

  const [storeSnap, catalogSnap] = await Promise.all([
    getDoc(doc(db, "publicStores", slug)),
    getDoc(doc(db, "publicCatalogs", slug)),
  ]);

  if (!storeSnap.exists()) throw new PublicCatalogNotFoundError(slug);
  const storeData = storeSnap.data() as Omit<PublicStore, "slug">;
  const store: PublicStore = { slug, ...storeData };

  let catalog: PublicCatalog = { categories: [], products: [] };
  if (catalogSnap.exists()) {
    const data = catalogSnap.data() as { categories?: PublicCategory[]; products?: PublicProductSummary[] };
    catalog = {
      categories: data.categories ?? [],
      products: data.products ?? [],
    };
  } else {
    throw new PublicCatalogEmptyError(slug);
  }

  return { store, catalog };
}

/**
 * Resolve the storeId for a public product lookup. publicStores is canonical,
 * but some deployed docs predate its storeId field (prod 2026-08-25 broke every
 * product-detail page this way) — publicCatalogs always carries it.
 */
export function resolveStoreId(
  store: PublicStore | undefined,
  catalogStoreId: string | undefined
): string | undefined {
  return store?.storeId ?? catalogStoreId;
}

/**
 * Load a single product's public detail by store slug + product slug. Anonymous.
 * The detail doc id is {storeId}__{slug}; storeId is resolved from the (already
 * anonymous-readable) projections — publicStores first, falling back to
 * publicCatalogs, because some deployed publicStores docs predate the storeId
 * field (seen in prod 2026-08-25). +2 reads worst case; the storefront visit
 * already cached both, so in practice this is +1.
 */
export async function loadPublicProduct(
  storeSlug: string,
  productSlug: string,
  knownStore?: PublicStore
): Promise<{ product: PublicProductDetail; store: PublicStore }> {
  const { db } = getFirebase();

  let store: PublicStore;
  if (knownStore) {
    store = knownStore;
  } else {
    const storeSnap = await getDoc(doc(db, "publicStores", storeSlug));
    if (!storeSnap.exists()) throw new PublicCatalogNotFoundError(storeSlug);
    store = { slug: storeSlug, ...(storeSnap.data() as Omit<PublicStore, "slug">) };
  }
  if (!store.storeId) {
    // Stale publicStores doc without storeId: publicCatalogs always carries it.
    const catalogSnap = await getDoc(doc(db, "publicCatalogs", storeSlug));
    const fallback = resolveStoreId(store, catalogSnap.get("storeId") as string | undefined);
    if (!fallback) throw new PublicCatalogNotFoundError(storeSlug);
    store = { ...store, storeId: fallback };
  }
  const productSnap = await getDoc(doc(db, "publicProducts", `${store.storeId}__${productSlug}`));

  if (!productSnap.exists()) throw new PublicProductNotFoundError(productSlug);
  const product = productSnap.data() as PublicProductDetail;

  return { product, store };
}
