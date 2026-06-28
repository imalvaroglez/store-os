import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  runTransaction,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebase } from "./config";
import type { AppUser } from "./auth";
import type { AppState, Store, Product, Customer, Order } from "../../types";
import { buildSeedState } from "../../lib/seed";

// Cloud data adapter. The cloud analog of lib/storage.ts: the StoreProvider talks
// to this when signed in. Reads are scoped to the user (super_admin sees all
// stores; a member sees only stores whose memberUids include them). Writes go to
// the entity's own doc; security rules enforce membership server-side.

export const COLLECTIONS = ["stores", "products", "customers", "orders"] as const;
type CollectionName = (typeof COLLECTIONS)[number];

/** Load all cloud data visible to the user. */
export async function loadCloudState(user: AppUser): Promise<AppState> {
  const { db } = getFirebase();

  // Stores: super_admin gets all; member gets only their member stores.
  let stores: Store[] = [];
  if (user.role === "super_admin") {
    const snap = await getDocs(collection(db, "stores"));
    stores = snap.docs.map((d) => ({ ...(d.data() as Store), id: d.id }));
  } else {
    const q = query(collection(db, "stores"), where("memberUids", "array-contains", user.uid));
    const snap = await getDocs(q);
    stores = snap.docs.map((d) => ({ ...(d.data() as Store), id: d.id }));
  }

  const storeIds = stores.map((s) => s.id);

  // Fetch each entity collection scoped to the accessible stores. For super_admin
  // that's effectively all; for members it stays within their stores (and avoids
  // permission-denied on other stores' docs).
  async function forStores<T extends { storeId: string }>(name: "products" | "customers" | "orders"): Promise<T[]> {
    if (storeIds.length === 0) return [];
    const q = query(collection(db, name), where("storeId", "in", storeIds));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
  }

  const [products, customers, orders] = await Promise.all([
    forStores<Product>("products"),
    forStores<Customer>("customers"),
    forStores<Order>("orders"),
  ]);

  return {
    stores,
    activeStoreId: stores[0]?.id ?? null,
    products,
    customers,
    orders,
  };
}

/** Subscribe to live cloud updates; returns an unsubscribe. */
export function subscribeCloudState(
  user: AppUser,
  onChange: (state: AppState) => void
): Unsubscribe {
  const { db } = getFirebase();
  const storesQ =
    user.role === "super_admin"
      ? collection(db, "stores")
      : query(collection(db, "stores"), where("memberUids", "array-contains", user.uid));

  // Re-load everything on any stores change (simplest correct approach; data is small).
  return onSnapshot(storesQ, async () => {
    try {
      onChange(await loadCloudState(user));
    } catch {
      /* ignore transient errors */
    }
  });
}

/** Upsert a single entity doc. */
export async function saveEntity(
  _user: AppUser,
  name: CollectionName,
  entity: { id: string } & Record<string, unknown>
): Promise<void> {
  const { db } = getFirebase();
  const { id, ...data } = entity;
  await setDoc(doc(db, name, id), data, { merge: true });
}

/** Delete a single entity doc. */
export async function deleteEntity(
  _user: AppUser,
  name: CollectionName,
  id: string
): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, name, id));
}

// --- Public catalog projection ---
//
// Anonymous visitors read `publicStores/{slug}` and `publicProducts/{id}`. These
// docs carry ONLY public-safe fields — private data (cost, profit, notes,
// inventory, membership) is never written here, so the security model is
// "leak-proof by construction", not by field-level rules.

/** Thrown when a slug is already claimed by another store. */
export class SlugTakenError extends Error {
  constructor(public slug: string) {
    super(`El identificador "${slug}" ya está en uso.`);
    this.name = "SlugTakenError";
  }
}

/**
 * Atomically claim a slug for a store. Uses create-only semantics inside a
 * transaction: if `slugs/{slug}` already exists for a DIFFERENT store, the
 * claim fails with SlugTakenError. Same store re-claiming its own slug is a
 * no-op (idempotent).
 */
export async function claimSlug(slug: string, storeId: string): Promise<void> {
  const { db } = getFirebase();
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "slugs", slug);
    const existing = await tx.get(ref);
    if (existing.exists()) {
      const owner = existing.data()?.storeId as string | undefined;
      if (owner && owner !== storeId) throw new SlugTakenError(slug);
      return; // same store already owns it
    }
    tx.set(ref, { storeId, claimedAt: Date.now() });
  });
}

/** Release a slug reservation (on rename/delete). */
export async function releaseSlug(slug: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, "slugs", slug)).catch(() => {});
}

/** Public storefront projection: only the fields a catalog visitor may see. */
export function projectPublicStore(store: Store) {
  return {
    name: store.name,
    slug: store.slug,
    type: store.type,
    whatsappPhone: store.whatsappPhone ?? null,
  };
}

/**
 * Public product projection. Mirrors `publicPrice` (src/lib/money.ts): on-demand
 * stores expose `price`; inventory stores expose only `prices.retail`. Cost,
 * wholesale/reseller prices, notes, and inventory are omitted entirely.
 */
export function projectPublicProduct(product: Product, storeSlug: string) {
  const base: Record<string, unknown> = {
    storeSlug,
    name: product.name,
    publicDescription: product.publicDescription ?? null,
    imageUrl: product.imageUrl ?? null,
  };
  if (typeof product.price === "number") base.price = product.price;
  if (product.prices && typeof product.prices.retail === "number") {
    base.prices = { retail: product.prices.retail };
  }
  return base;
}

/**
 * Rebuild the public projection for one store: upsert the public storefront and
 * every public product, and remove public-product docs for products that are no
 * longer public (or belong to deleted products). Idempotent.
 */
export async function projectPublicForStore(store: Store, products: Product[]): Promise<void> {
  const { db } = getFirebase();
  const writes: Promise<unknown>[] = [];

  // Storefront.
  writes.push(setDoc(doc(db, "publicStores", store.slug), projectPublicStore(store), { merge: true }));

  // Public products for this store.
  const publicProducts = products.filter((p) => p.storeId === store.id && p.isPublic);
  for (const p of publicProducts) {
    writes.push(setDoc(doc(db, "publicProducts", p.id), projectPublicProduct(p, store.slug), { merge: true }));
  }

  // Prune: any existing publicProducts with storeSlug === this slug whose id is
  // no longer in the public set. (Cheap at this scale.)
  const keepIds = new Set(publicProducts.map((p) => p.id));
  const snap = await getDocs(query(collection(db, "publicProducts"), where("storeSlug", "==", store.slug)));
  for (const d of snap.docs) {
    if (!keepIds.has(d.id)) writes.push(deleteDoc(d.ref));
  }

  await Promise.all(writes);
}

/** Remove a store's entire public projection (storefront + products + slug). */
export async function unprojectPublicForStore(store: Store): Promise<void> {
  const { db } = getFirebase();
  const writes: Promise<unknown>[] = [];
  writes.push(deleteDoc(doc(db, "publicStores", store.slug)));
  writes.push(releaseSlug(store.slug));
  const snap = await getDocs(query(collection(db, "publicProducts"), where("storeSlug", "==", store.slug)));
  for (const d of snap.docs) writes.push(deleteDoc(d.ref));
  await Promise.all(writes);
}

/** Upsert one product's public projection (only if public). */
export async function upsertPublicProduct(product: Product, storeSlug: string): Promise<void> {
  const { db } = getFirebase();
  if (!product.isPublic) {
    await deleteDoc(doc(db, "publicProducts", product.id)).catch(() => {});
    return;
  }
  await setDoc(doc(db, "publicProducts", product.id), projectPublicProduct(product, storeSlug), { merge: true });
}

/** Remove one product's public projection. */
export async function removePublicProduct(productId: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, "publicProducts", productId)).catch(() => {});
}

/**
 * Seed the demo stores (Santi + Joyería) into Firestore for the super-admin on a
 * brand-new (empty) cloud account. Members are NOT seeded — they see only stores
 * an admin has invited them to (empty until then). Idempotent.
 */
export async function seedCloudIfEmpty(user: AppUser): Promise<void> {
  if (user.role !== "super_admin") return; // members never auto-seed
  const existing = await loadCloudState(user);
  if (existing.stores.length > 0) return;

  const seed = buildSeedState();
  const writes: Promise<unknown>[] = [];
  for (const s of seed.stores) {
    writes.push(saveEntity(user, "stores", { ...s, ownerUid: user.uid, memberUids: [user.uid] }));
  }
  for (const p of seed.products) writes.push(saveEntity(user, "products", p));
  for (const c of seed.customers) writes.push(saveEntity(user, "customers", c));
  for (const o of seed.orders) writes.push(saveEntity(user, "orders", o));
  await Promise.all(writes);

  // Publish the public catalog projection for each seeded store so
  // /catalogo/santi and /catalogo/joyeria work immediately.
  for (const s of seed.stores) {
    await claimSlug(s.slug, s.id).catch(() => {});
    await projectPublicForStore(s, seed.products).catch(() => {});
  }
}
