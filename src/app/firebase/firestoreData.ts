import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
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
}
