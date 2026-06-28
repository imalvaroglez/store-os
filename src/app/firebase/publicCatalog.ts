import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { getFirebase } from "./config";
import type { StoreType } from "../../types";

// Anonymous public-catalog loader. A visitor at /catalogo/:slug has NO session;
// they read the public projection collections (publicStores / publicProducts),
// which carry only public-safe fields. Errors propagate to the caller — this is
// a user-facing path and silent failures are wrong.

export type PublicStore = {
  slug: string;
  name: string;
  type: StoreType;
  whatsappPhone?: string | null;
};

export type PublicProduct = {
  id: string;
  storeSlug: string;
  name: string;
  publicDescription?: string | null;
  imageUrl?: string | null;
  price?: number;
  prices?: { retail?: number };
};

/** Thrown when no public storefront exists for a slug. */
export class PublicCatalogNotFoundError extends Error {
  constructor(public slug: string) {
    super(`No hay catálogo público para "${slug}".`);
    this.name = "PublicCatalogNotFoundError";
  }
}

/**
 * Load a store's public catalog by slug. Anonymous (no user). Throws
 * PublicCatalogNotFoundError when the slug has no published storefront.
 */
export async function loadPublicCatalog(slug: string): Promise<{
  store: PublicStore;
  products: PublicProduct[];
}> {
  const { db } = getFirebase();

  const storeSnap = await getDoc(doc(db, "publicStores", slug));
  if (!storeSnap.exists()) throw new PublicCatalogNotFoundError(slug);
  const storeData = storeSnap.data() as Omit<PublicStore, "slug">;
  const store: PublicStore = { slug, ...storeData };

  const snap = await getDocs(query(collection(db, "publicProducts"), where("storeSlug", "==", slug)));
  const products: PublicProduct[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PublicProduct, "id">) }));

  return { store, products };
}
