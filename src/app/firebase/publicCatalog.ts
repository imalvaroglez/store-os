import type { StoreType, Storefront } from "../../types";

/** Coarse stock signal — never an exact count. */
export type PublicStockSignal = "agotado" | "pocas" | "disponible";

/** Public tier as seen by visitors: label, order and informative minimums. */
export type PublicPriceTier = {
  id: string;
  label: string;
  order: number;
  minPieces?: number;
  minAmount?: number;
};

// Anonymous public-catalog loader over the Firestore REST API — the public
// storefront entry must not ship the Firebase SDK (the admin entry keeps it).
// A visitor at /catalogo/:slug has NO session; they read the three public
// projection collections, which carry only public-safe fields. Errors
// propagate to the caller — this is a user-facing path and silent failures
// are wrong.
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
  /** Public Clave; the cart line carries it into the WhatsApp order. */
  sku?: string | null;
  publicDescription?: string | null;
  imageUrl?: string | null;
  images?: Pick<PublicProductImage, "url" | "alt" | "width" | "height">[];
  price?: number;
  /** Prices per visible tier (owner decision 2026-08-29). Absent on stale docs. */
  prices?: Record<string, number>;
  stockSignal?: PublicStockSignal;
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
  /** Prices per visible tier. Absent on stale projections. */
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

// Mirror of src/app/firebase/config.ts's environment detection: emulator mode
// is opt-in and DEV/TEST-only, and it always targets the store-os-demo
// namespace so emulator tests stay isolated from the real projects.
const EMULATOR =
  import.meta.env.MODE !== "production" &&
  import.meta.env.VITE_FIREBASE_EMULATOR === "true";

const PROJECT_ID = EMULATOR
  ? "store-os-demo"
  : (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined);

const DOCS_BASE = EMULATOR
  ? `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`
  : `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

type RestValue = { [key: string]: unknown };

/** One anonymous REST document read. Mirrors getDoc's contract: an exists
 *  flag, decoded data, and thrown errors for anything that is not a clean 404
 *  (rules denial, network failure, etc.). */
async function getDocRest(path: string): Promise<{ exists: boolean; data?: Record<string, unknown> }> {
  const key = EMULATOR ? "" : `?key=${import.meta.env.VITE_FIREBASE_API_KEY as string}`;
  const res = await fetch(`${DOCS_BASE}/${path}${key}`, { headers: { accept: "application/json" } });
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`Firestore REST ${res.status} al leer "${path}"`);
  const json = (await res.json()) as { fields?: Record<string, RestValue> };
  return { exists: true, data: decodeFields(json.fields ?? {}) };
}

// REST wire format → client values. Gotchas pinned by tests: integerValue
// arrives as a JSON STRING (prices!), timestamps as ISO strings (the public
// types carry no dates, so they pass through). Unknown shapes throw loudly
// instead of silently dropping fields.
function decodeValue(value: RestValue): unknown {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    const values = (value.arrayValue as { values?: RestValue[] }).values ?? [];
    return values.map((item) => decodeValue(item));
  }
  if ("mapValue" in value) {
    return decodeFields((value.mapValue as { fields?: Record<string, RestValue> }).fields ?? {});
  }
  throw new Error(`Valor REST de Firestore no soportado: ${Object.keys(value).join(", ")}`);
}

function decodeFields(fields: Record<string, RestValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[key] = decodeValue(value);
  return out;
}

/**
 * Load just the store's public storefront identity (1 read, a tiny doc). The
 * hero paints from this alone while the (much larger) catalog doc is still in
 * flight — progressive rendering for the public critical path.
 */
export async function loadPublicStore(slug: string): Promise<PublicStore> {
  const storeSnap = await getDocRest(`publicStores/${slug}`);
  if (!storeSnap.exists) throw new PublicCatalogNotFoundError(slug);
  return { slug, ...(storeSnap.data as Omit<PublicStore, "slug">) };
}

/** Load the catalog projection alone (categories + product summaries). 1 read.
 *  Pair with loadPublicStore for progressive rendering. */
export async function loadPublicCatalogSummary(slug: string): Promise<PublicCatalog> {
  return (await loadPublicCatalogDoc(slug)).catalog;
}

async function loadPublicCatalogDoc(slug: string): Promise<{ catalog: PublicCatalog; storeId?: string }> {
  const catalogSnap = await getDocRest(`publicCatalogs/${slug}`);
  if (!catalogSnap.exists) throw new Error(`El catálogo de "${slug}" aún no está publicado.`);
  const data = catalogSnap.data as {
    storeId?: string;
    categories?: PublicCategory[];
    products?: PublicProductSummary[];
  };
  return {
    catalog: { categories: data.categories ?? [], products: data.products ?? [] },
    storeId: data.storeId,
  };
}

/**
 * Load a store's public storefront + catalog (categories + product summaries).
 * Anonymous. 2 reads. Throws PublicCatalogNotFoundError if the store isn't
 * published, or a plain Error if the storefront exists but its catalog
 * projection hasn't been written yet. Screens that want progressive rendering
 * (hero from the small store doc, grid from the big catalog doc) call
 * loadPublicStore + their own catalog read instead.
 */
export async function loadPublicCatalog(slug: string): Promise<{
  store: PublicStore;
  catalog: PublicCatalog;
}> {
  const [store, doc] = await Promise.all([loadPublicStore(slug), loadPublicCatalogDoc(slug)]);
  if (!store.storeId && doc.storeId) {
    return { store: { ...store, storeId: doc.storeId }, catalog: doc.catalog };
  }
  return { store, catalog: doc.catalog };
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
  let store = knownStore;
  if (!store) {
    const storeSnap = await getDocRest(`publicStores/${storeSlug}`);
    if (!storeSnap.exists) throw new PublicCatalogNotFoundError(storeSlug);
    store = { slug: storeSlug, ...(storeSnap.data as Omit<PublicStore, "slug">) };
  }
  if (!store.storeId) {
    // publicStores anterior a 390e76a no trae storeId; publicCatalogs siempre
    // lo trajo (+1 lectura sólo en el caso estancado).
    const catSnap = await getDocRest(`publicCatalogs/${storeSlug}`);
    const catStoreId = catSnap.exists
      ? (catSnap.data as { storeId?: string }).storeId
      : undefined;
    if (!catStoreId) throw new PublicCatalogNotFoundError(storeSlug);
    store = { ...store, storeId: catStoreId };
  }
  const productSnap = await getDocRest(`publicProducts/${store.storeId}__${productSlug}`);

  if (!productSnap.exists) throw new PublicProductNotFoundError(productSlug);
  const product = productSnap.data as PublicProductDetail;

  return { product, store };
}
