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

  const storeIds = new Set(stores.map((s) => s.id));
  const inStores = <T extends { storeId: string }>(rows: T[]): T[] =>
    rows.filter((r) => storeIds.has(r.storeId));

  const [productsSnap, customersSnap, ordersSnap] = await Promise.all([
    getDocs(collection(db, "products")),
    getDocs(collection(db, "customers")),
    getDocs(collection(db, "orders")),
  ]);
  // super_admin can read all (rules allow); members' rules restrict to their
  // stores, but we also filter client-side for safety.
  const products = inStores(productsSnap.docs.map((d) => ({ ...(d.data() as Product), id: d.id })));
  const customers = inStores(customersSnap.docs.map((d) => ({ ...(d.data() as Customer), id: d.id })));
  const orders = inStores(ordersSnap.docs.map((d) => ({ ...(d.data() as Order), id: d.id })));

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
