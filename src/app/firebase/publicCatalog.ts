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
  canInquire?: boolean;
  isFeatured?: boolean;
  isNew?: boolean;
  price?: number;
  categories: { id: string; name: string; slug: string }[];
};

/** Thrown when no public storefront exists for a slug. */
export class PublicCatalogNotFoundError extends Error {
  constructor(public slug: string) {
    super(`No hay catálogo público para "${slug}".`);
    this.name = "PublicCatalogNotFoundError";
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
 * published, or a plain Error if the storefront exists but its catalog
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
    throw new Error(`El catálogo de "${slug}" aún no está publicado.`);
  }

  return { store, catalog };
}

/**
 * Load a single product's public detail by store slug + product slug. Anonymous.
 * The detail doc id is {storeId}__{slug}; storeId is read from the (already
 * anonymous-readable) publicCatalogs doc rather than the auth-gated slug
 * reservation, so no rule change is needed. +2 reads (catalog for storeId,
 * detail) — the storefront visit already cached the catalog, so in practice this
 * is +1.
 */
export async function loadPublicProduct(
  storeSlug: string,
  productSlug: string,
  knownStore?: PublicStore
): Promise<{ product: PublicProductDetail; store: PublicStore }> {
  const { db } = getFirebase();

  let store = knownStore;
  if (!store) {
    const storeSnap = await getDoc(doc(db, "publicStores", storeSlug));
    if (!storeSnap.exists()) throw new PublicCatalogNotFoundError(storeSlug);
    store = { slug: storeSlug, ...(storeSnap.data() as Omit<PublicStore, "slug">) };
  }
  if (!store.storeId) throw new PublicCatalogNotFoundError(storeSlug);
  const productSnap = await getDoc(doc(db, "publicProducts", `${store.storeId}__${productSlug}`));

  if (!productSnap.exists()) throw new PublicProductNotFoundError(productSlug);
  const product = productSnap.data() as PublicProductDetail;

  return { product, store };
}
