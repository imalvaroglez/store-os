import { doc, getDoc } from "firebase/firestore";
import { getFirebase } from "./config";
import type { StoreType, Storefront } from "../../types";

/** Public stock signal. Inventory stores also publish the exact max quantity. */
export type PublicStockSignal = "agotado" | "pocas" | "disponible";

/** Public tier as seen by visitors: label, order and informative minimums. */
export type PublicPriceTier = {
  id: string;
  label: string;
  order: number;
  minPieces?: number;
  minAmount?: number;
};

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
  /** Canonical private product id, exposed so public requests can be validated server-side. */
  productId?: string;
  storeId: string;
  productSlug: string;
  storeSlug: string;
  name: string;
  /** Public Clave; the cart line carries it into the WhatsApp order. */
  sku?: string | null;
  publicDescription?: string | null;
  imageUrl?: string | null;
  price?: number;
  /** Prices per visible tier (owner decision 2026-08-29). Absent on stale docs. */
  prices?: Record<string, number>;
  stockSignal?: PublicStockSignal;
  /** Exact available pieces for inventory stores; absent for on-demand stores. */
  availableQuantity?: number;
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
  /** Visible tiers with informative minimums; null on legacy/stale projections. */
  priceTiers?: PublicPriceTier[] | null;
  defaultTierId?: string | null;
};

export type PublicCatalog = {
  categories: PublicCategory[];
  products: PublicProductSummary[];
};

export type PublicProductDetail = {
  /** Canonical private product id, exposed so public requests can be validated server-side. */
  productId?: string;
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
  /** Prices per visible tier. Absent on stale docs. */
  prices?: Record<string, number>;
  stockSignal?: PublicStockSignal;
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
  let store: PublicStore = { slug, ...storeData };

  let catalog: PublicCatalog = { categories: [], products: [] };
  if (catalogSnap.exists()) {
    const data = catalogSnap.data() as {
      storeId?: string;
      categories?: PublicCategory[];
      products?: PublicProductSummary[];
    };
    if (!store.storeId && data.storeId) store = { ...store, storeId: data.storeId };
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
 * The detail doc id is {storeId}__{slug}. storeId comes from publicStores/{slug};
 * a storefront doc published before 390e76a carries no storeId, in which case the
 * loader falls back to publicCatalogs/{slug}. PublicCatalogNotFoundError fires
 * only when NEITHER doc has one (the store was never published). Both sources are
 * anonymous-readable, so no rule change is needed. +2 reads (store + detail); the
 * stale-doc fallback adds +1, and only in that case.
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
  if (!store.storeId) {
    // publicStores anterior a 390e76a no trae storeId; publicCatalogs siempre
    // lo trajo (+1 lectura sólo en el caso estancado).
    const catSnap = await getDoc(doc(db, "publicCatalogs", storeSlug));
    const catStoreId = catSnap.exists()
      ? (catSnap.data() as { storeId?: string }).storeId
      : undefined;
    if (!catStoreId) throw new PublicCatalogNotFoundError(storeSlug);
    store = { ...store, storeId: catStoreId };
  }
  const productSnap = await getDoc(doc(db, "publicProducts", `${store.storeId}__${productSlug}`));

  if (!productSnap.exists()) throw new PublicProductNotFoundError(productSlug);
  const product = productSnap.data() as PublicProductDetail;

  return { product, store };
}
