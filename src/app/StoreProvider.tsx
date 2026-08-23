import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { effectivePurchaseStatus } from "../types";
import type {
  AppState,
  Store,
  Product,
  Customer,
  Order,
  Category,
  Supplier,
  Purchase,
} from "../types";
import { loadState, saveState, emptyState } from "../lib/storage";
import { migrateCatalog } from "../lib/catalog";
import { uid } from "../lib/ids";
import { nowIso } from "../lib/dates";
import { reservationDelta, applyPurchaseLines } from "../lib/inventory";
import { useAuth } from "./firebase/AuthProvider";
import type { AppUser } from "./firebase/auth";
import { findUidByEmail, normalizeEmail, sendInviteLink } from "./firebase/auth";
import {
  loadCloudState,
  subscribeCloudState,
  saveEntity,
  deleteEntity,
  seedCloudIfEmpty,
  claimSlug,
  projectPublicForStore,
  unprojectPublicForStore,
  upsertPublicProduct,
  removePublicProductDoc,
  rebuildPublicCatalog,
  receivePurchaseTx,
  createDraftProductsForPurchaseTx,
  PurchaseAlreadyReceived,
} from "./firebase/firestoreData";
import { deleteProductImage, deletePurchasePdf } from "./firebase/storage";
import { isFirebaseConfigured } from "./firebase/config";

// Actions: every mutation flows through here. storeId is carried on entity-level
// actions and selectors enforce isolation, so a screen can't touch another store.
type Action =
  | { type: "ADD_STORE"; store: Store }
  | { type: "UPDATE_STORE"; store: Store }
  | { type: "DELETE_STORE"; storeId: string }
  | { type: "SET_ACTIVE_STORE"; storeId: string }
  | { type: "ADD_PRODUCT"; product: Product }
  | { type: "UPDATE_PRODUCT"; product: Product }
  | { type: "DELETE_PRODUCT"; productId: string }
  | { type: "ADD_CATEGORY"; category: Category }
  | { type: "UPDATE_CATEGORY"; category: Category }
  | { type: "DELETE_CATEGORY"; categoryId: string }
  | { type: "ADD_SUPPLIER"; supplier: Supplier }
  | { type: "UPDATE_SUPPLIER"; supplier: Supplier }
  | { type: "DELETE_SUPPLIER"; supplierId: string }
  | { type: "ADD_PURCHASE"; purchase: Purchase }
  | { type: "UPDATE_PURCHASE"; purchase: Purchase }
  | { type: "DELETE_PURCHASE"; purchaseId: string }
  | { type: "ADD_CUSTOMER"; customer: Customer }
  | { type: "UPDATE_CUSTOMER"; customer: Customer }
  | { type: "DELETE_CUSTOMER"; customerId: string }
  | { type: "ADD_ORDER"; order: Order }
  | { type: "UPDATE_ORDER"; order: Order }
  | { type: "DELETE_ORDER"; orderId: string }
  | { type: "RESET_DEMO" }
  // cloud sync pushes a whole state
  | { type: "REPLACE_STATE"; state: AppState }
  // purchase-ux2 bulk create: products + their purchase land in ONE dispatch
  // so the UI never shows a half-created batch.
  | { type: "BULK_CREATE_FOR_PURCHASE"; products: Product[]; purchase: Purchase };

// Exported for direct unit testing of state transitions (stock reservation,
// cascade deletes, entity CRUD) without spinning up a React tree.
export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD_STORE":
      return { ...state, stores: [...state.stores, action.store], activeStoreId: action.store.id };
    case "UPDATE_STORE":
      return { ...state, stores: state.stores.map((s) => (s.id === action.store.id ? action.store : s)) };
    case "DELETE_STORE":
      return {
        ...state,
        stores: state.stores.filter((s) => s.id !== action.storeId),
        products: state.products.filter((p) => p.storeId !== action.storeId),
        categories: state.categories.filter((c) => c.storeId !== action.storeId),
        suppliers: state.suppliers.filter((s) => s.storeId !== action.storeId),
        purchases: state.purchases.filter((p) => p.storeId !== action.storeId),
        customers: state.customers.filter((c) => c.storeId !== action.storeId),
        orders: state.orders.filter((o) => o.storeId !== action.storeId),
        activeStoreId:
          state.activeStoreId === action.storeId
            ? state.stores.find((s) => s.id !== action.storeId)?.id ?? null
            : state.activeStoreId,
      };
    case "SET_ACTIVE_STORE":
      return { ...state, activeStoreId: action.storeId || null };
    case "ADD_PRODUCT":
      return { ...state, products: [...state.products, action.product] };
    case "UPDATE_PRODUCT":
      return { ...state, products: state.products.map((p) => (p.id === action.product.id ? action.product : p)) };
    case "DELETE_PRODUCT":
      return { ...state, products: state.products.filter((p) => p.id !== action.productId) };
    case "ADD_CATEGORY":
      return { ...state, categories: [...state.categories, action.category] };
    case "UPDATE_CATEGORY":
      return { ...state, categories: state.categories.map((c) => (c.id === action.category.id ? action.category : c)) };
    case "DELETE_CATEGORY":
      return { ...state, categories: state.categories.filter((c) => c.id !== action.categoryId) };
    case "ADD_SUPPLIER":
      return { ...state, suppliers: [...state.suppliers, action.supplier] };
    case "UPDATE_SUPPLIER":
      return { ...state, suppliers: state.suppliers.map((s) => (s.id === action.supplier.id ? action.supplier : s)) };
    case "DELETE_SUPPLIER":
      return { ...state, suppliers: state.suppliers.filter((s) => s.id !== action.supplierId) };
    case "ADD_PURCHASE":
      return { ...state, purchases: [...state.purchases, action.purchase] };
    case "UPDATE_PURCHASE":
      return { ...state, purchases: state.purchases.map((p) => (p.id === action.purchase.id ? action.purchase : p)) };
    case "DELETE_PURCHASE":
      return { ...state, purchases: state.purchases.filter((p) => p.id !== action.purchaseId) };
    case "ADD_CUSTOMER":
      return { ...state, customers: [...state.customers, action.customer] };
    case "UPDATE_CUSTOMER":
      return { ...state, customers: state.customers.map((c) => (c.id === action.customer.id ? action.customer : c)) };
    case "DELETE_CUSTOMER":
      return { ...state, customers: state.customers.filter((c) => c.id !== action.customerId) };
    case "ADD_ORDER":
      return { ...state, orders: [...state.orders, action.order] };
    case "UPDATE_ORDER":
      return { ...state, orders: state.orders.map((o) => (o.id === action.order.id ? action.order : o)) };
    case "DELETE_ORDER":
      return { ...state, orders: state.orders.filter((o) => o.id !== action.orderId) };
    case "RESET_DEMO":
      return emptyState(); // "reset demo" now means "clear local data" (client demo seed removed)
    case "REPLACE_STATE":
      // A cloud sync must never move the user to another store: on slow
      // backends the snapshot can land after the user switched/created one,
      // reverting their selection (and the screen they're looking at).
      return state.activeStoreId &&
        action.state.stores.some((s) => s.id === state.activeStoreId)
        ? { ...action.state, activeStoreId: state.activeStoreId }
        : action.state;
    case "BULK_CREATE_FOR_PURCHASE": {
      const products = [...state.products];
      for (const product of action.products) {
        const i = products.findIndex((p) => p.id === product.id);
        if (i >= 0) products[i] = product;
        else products.push(product);
      }
      const exists = state.purchases.some((p) => p.id === action.purchase.id);
      return {
        ...state,
        products,
        purchases: exists
          ? state.purchases.map((p) => (p.id === action.purchase.id ? action.purchase : p))
          : [...state.purchases, action.purchase],
      };
    }
    default:
      return state;
  }
}

type StoreContextValue = {
  state: AppState;
  activeStore: Store | null;
  cloud: boolean; // true when operating on Firestore (signed in)
  addStore: (input: Omit<Store, "id" | "createdAt" | "updatedAt">) => Promise<Store>;
  updateStore: (patch: Partial<Store> & { id: string }) => Promise<void>;
  deleteStore: (storeId: string) => void;
  inviteMember: (storeId: string, email: string) => Promise<"invited" | "pending">;
  removeMember: (storeId: string, uid: string) => void;
  transferStoreOwnership: (storeId: string, email: string) => Promise<void>;
  /** Republish a store's public catalog projection (backfill / repair). */
  republishCatalog: (storeId: string) => Promise<void>;
  setActiveStore: (storeId: string | null) => void;
  upsertProduct: (product: Product) => Promise<void>;
  deleteProduct: (productId: string) => void;
  upsertCategory: (category: Category) => void;
  deleteCategory: (categoryId: string) => void;
  upsertSupplier: (supplier: Supplier) => void;
  deleteSupplier: (supplierId: string) => void;
  upsertPurchase: (purchase: Purchase) => Promise<void>;
  /**
   * Bulk-create private draft products and save the purchase that links them
   * in one atomic commit (cloud-only: the PDF import flow requires cloud).
   * One reducer action reflects the whole batch locally.
   */
  createDraftProductsForPurchase: (products: Product[], purchase: Purchase) => Promise<void>;
  /** The ONLY operation that moves inventory. Idempotent; throws "received" softly.
   * Takes the just-saved snapshot (local) or re-reads canonically in the cloud tx. */
  receivePurchase: (purchase: Purchase) => Promise<"received" | "already">;
  deletePurchase: (purchaseId: string) => void;
  upsertCustomer: (customer: Customer) => void;
  deleteCustomer: (customerId: string) => void;
  upsertOrder: (order: Order) => void;
  deleteOrder: (orderId: string) => void;
  resetDemo: () => void;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const cloud = isFirebaseConfigured() && !!user;

  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  // Track whether the current dispatch originated from a cloud sync so we don't
  // echo it back to Firestore (write loops).
  const fromCloud = useRef(false);

  // When auth mode changes, load the appropriate source.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (cloud && user) {
      // Seed demo stores on a brand-new (empty) cloud account, then load + subscribe.
      seedCloudIfEmpty(user)
        .then(() => loadCloudState(user))
        .then(async (s) => {
          const migrated = migrateCatalog(s);
          const writes: Promise<void>[] = [];
          for (const product of migrated.products) {
            const before = s.products.find((p) => p.id === product.id);
            if (before !== product) writes.push(saveEntity(user, "products", product));
          }
          for (const category of migrated.categories) {
            if (!s.categories.some((c) => c.id === category.id)) {
              writes.push(saveEntity(user, "categories", category));
            }
          }
          // scalable-pricing migration: persist ONLY the docs that changed
          // (identity comparison — the migration keeps refs for unchanged
          // entities) and republish each affected store's catalog ONCE.
          const migratedStores: Store[] = [];
          for (const store of migrated.stores) {
            const before = s.stores.find((x) => x.id === store.id);
            if (before !== store) {
              writes.push(saveEntity(user, "stores", storeWithMembership(store, user)));
              migratedStores.push(store);
            }
          }
          for (const order of migrated.orders) {
            const before = s.orders.find((o) => o.id === order.id);
            if (before !== order) writes.push(saveEntity(user, "orders", order));
          }
          // Render FIRST, persist in the background: on a cold/slow backend the
          // awaited writes delayed REPLACE_STATE so much that a REPLACE arriving
          // after the user switched stores reverted their selection. Migration
          // is idempotent, so a failed background write just re-migrates on the
          // next load.
          fromCloud.current = true;
          dispatch({ type: "REPLACE_STATE", state: migrated });
          fromCloud.current = false;
          void (async () => {
            try {
              await Promise.all(writes);
              // One public republish per affected store (not per product).
              await Promise.all(
                migratedStores.map((store) =>
                  projectPublicForStore(store, migrated.products, migrated.categories).catch(() => {})
                )
              );
            } catch {
              // Background migration write failed — retried on next load.
            }
          })();
        })
        .catch(() => {});
      unsub = subscribeCloudState(user, (s) => {
        fromCloud.current = true;
        dispatch({ type: "REPLACE_STATE", state: migrateCatalog(s) });
        fromCloud.current = false;
      });
    } else if (!cloud) {
      // Local mode: seed-backed localStorage.
      fromCloud.current = true;
      dispatch({ type: "REPLACE_STATE", state: loadState() });
      fromCloud.current = false;
    }
    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, user?.uid]);

  // Local mode persists every change to localStorage. Cloud mode writes through
  // to Firestore per-action (below); REPLACE_STATE from sync doesn't write back.
  useEffect(() => {
    if (cloud) return;
    if (fromCloud.current) return;
    saveState(state);
  }, [state, cloud]);

  // Cloud: backfill legacy pendingInvites to their canonical form (one batched
  // write per store, only when something actually changes) so invitations
  // saved before reliable-member-invitations match the login reconciliation.
  useEffect(() => {
    if (!cloud || !user) return;
    for (const store of state.stores) {
      const invites = store.pendingInvites ?? [];
      const normalized = Array.from(new Set(invites.map(normalizeEmail)));
      if (normalized.length === invites.length && invites.every((e, i) => e === normalized[i])) continue;
      const updated = { ...store, pendingInvites: normalized, updatedAt: nowIso() };
      dispatch({ type: "UPDATE_STORE", store: updated });
      void saveEntity(user, "stores", storeWithMembership(updated, user)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, user?.uid, state.stores]);

  function persistEntity(name: "stores" | "products" | "categories" | "suppliers" | "purchases" | "customers" | "orders", entity: { id: string } & Record<string, unknown>): Promise<void> {
    if (!cloud || !user || fromCloud.current) return Promise.resolve();
    return saveEntity(user, name, entity).catch((error) => {
      // Log with context for debugging, then re-throw so callers can surface a
      // toast instead of lying with a success. See persist-entity-error-handling.
      console.error(`[Firestore] Error al guardar ${name} (${entity.id}):`, error);
      throw error;
    });
  }

  const value: StoreContextValue = {
    state,
    activeStore: state.stores.find((s) => s.id === state.activeStoreId) ?? null,
    cloud,
    addStore: async (input) => {
      const store: Store = { ...input, id: uid("store"), createdAt: nowIso(), updatedAt: nowIso() };
      // Claim the slug first (throws SlugTakenError on global collision) so we
      // don't create a store whose catalog can't be published.
      if (cloud) await claimSlug(store.slug, store.id);
      dispatch({ type: "ADD_STORE", store });
      // persistEntity re-throws on Firestore rejection; callers surface a toast.
      await persistEntity("stores", storeWithMembership(store, user));
      if (cloud) {
        await projectPublicForStore(store, state.products, state.categories).catch(() => {});
      }
      return store;
    },
    updateStore: async (patch) => {
      const existing = state.stores.find((s) => s.id === patch.id);
      if (!existing) return;
      const store: Store = { ...existing, ...patch, updatedAt: nowIso() };
      const slugChanged = patch.slug !== undefined && patch.slug !== existing.slug;
      if (cloud && slugChanged) {
        // Rename: claim the new slug first (may throw SlugTakenError). The local
        // dispatch only runs if the claim succeeds, so a collision leaves nothing
        // half-renamed.
        await claimSlug(store.slug, store.id);
      }
      dispatch({ type: "UPDATE_STORE", store });
      await persistEntity("stores", store);
      if (cloud) {
        if (slugChanged) {
          // Remove the OLD public projection (storefront + products carrying the
          // old storeSlug) and release the old slug, so /catalogo/{oldSlug}
          // stops serving after the rename. unproject also releases the slug,
          // so no separate releaseSlug call is needed.
          await unprojectPublicForStore(existing).catch(() => {});
        }
        // Always re-project: storefront content (hero, FAQ, contact, SEO) lives
        // in publicStores, so an edit with no slug change must still republish.
        // No silent catch (scalable-pricing): if the projection fails the caller
        // must SEE it — a private write that "succeeds" while the public price
        // stays stale is a false success. Repair paths: save again, or
        // "Republicar catálogo" (projection only, no private writes).
        await projectPublicForStore(store, state.products, state.categories);
      }
    },
    deleteStore: (storeId) => {
      const store = state.stores.find((s) => s.id === storeId);
      dispatch({ type: "DELETE_STORE", storeId });
      if (cloud && user && store && !fromCloud.current) {
        deleteEntity(user, "stores", storeId).catch(() => {});
        // Best-effort: delete the store's entities + product photos in the cloud.
        state.products.filter((p) => p.storeId === storeId).forEach((p) => {
          deleteEntity(user, "products", p.id).catch(() => {});
          deleteProductImage(storeId, p.id).catch(() => {});
        });
        state.customers.filter((c) => c.storeId === storeId).forEach((c) => deleteEntity(user, "customers", c.id).catch(() => {}));
        state.orders.filter((o) => o.storeId === storeId).forEach((o) => deleteEntity(user, "orders", o.id).catch(() => {}));
        state.suppliers.filter((s) => s.storeId === storeId).forEach((s) => deleteEntity(user, "suppliers", s.id).catch(() => {}));
        state.purchases.filter((p) => p.storeId === storeId).forEach((p) => deleteEntity(user, "purchases", p.id).catch(() => {}));
        // Supplier PDFs are PII: delete them along with the store. Best-effort
        // (consistent with the entity deletes above) — a failure is logged so
        // orphaned files are traceable, not guaranteed cleanup.
        state.purchases
          .filter((p) => p.storeId === storeId && p.documentPath)
          .forEach((p) =>
            deletePurchasePdf(p.documentPath!).catch((e) =>
              console.error(`[Storage] No se pudo borrar el PDF de la compra ${p.id}:`, e)
            )
          );
        // Remove the public catalog projection + release the slug.
        unprojectPublicForStore(store).catch(() => {});
      }
    },
    inviteMember: async (storeId, email) => {
      const store = state.stores.find((s) => s.id === storeId);
      if (!store) return "pending";
      const normalized = email.toLowerCase().trim();
      // Try to find an existing (verified) account by email — literal first,
      // then the canonical form (Gmail dots/case).
      const uid = await findUidByEmail(normalized).catch(() => null);
      if (uid) {
        const memberUids = Array.from(new Set([...(store.memberUids ?? []), uid]));
        const updated = { ...store, memberUids, updatedAt: nowIso() };
        dispatch({ type: "UPDATE_STORE", store: updated });
        void persistEntity("stores", updated).catch(() => {});
        return "invited";
      }
      // No account yet: store a pending invite (canonical form, so the login
      // reconciliation matches); the email-link send happens in the cloud path.
      const pendingInvites = Array.from(new Set([...(store.pendingInvites ?? []), normalizeEmail(normalized)]));
      const updated = { ...store, pendingInvites, updatedAt: nowIso() };
      dispatch({ type: "UPDATE_STORE", store: updated });
      void persistEntity("stores", updated).catch(() => {});
      void sendInviteLink(normalized, store).catch(() => {});
      return "pending";
    },
    removeMember: (storeId, memberUid) => {
      const store = state.stores.find((s) => s.id === storeId);
      if (!store) return;
      const memberUids = (store.memberUids ?? []).filter((u) => u !== memberUid);
      const updated = { ...store, memberUids, updatedAt: nowIso() };
      dispatch({ type: "UPDATE_STORE", store: updated });
      void persistEntity("stores", updated).catch(() => {});
    },
    transferStoreOwnership: async (storeId, email) => {
      const store = state.stores.find((s) => s.id === storeId);
      if (!store) throw new Error("Tienda no encontrada.");
      const nextOwnerUid = await findUidByEmail(email.toLowerCase().trim());
      if (!nextOwnerUid || !(store.memberUids ?? []).includes(nextOwnerUid)) {
        throw new Error("Esa persona debe ser miembro de la tienda antes de recibirla.");
      }
      if (nextOwnerUid === store.ownerUid) return;
      const updated = { ...store, ownerUid: nextOwnerUid, updatedAt: nowIso() };
      dispatch({ type: "UPDATE_STORE", store: updated });
      await persistEntity("stores", updated);
    },
    republishCatalog: async (storeId) => {
      const store = state.stores.find((s) => s.id === storeId);
      if (!store || !cloud) return;
      await claimSlug(store.slug, store.id).catch(() => {});
      await projectPublicForStore(
        store,
        state.products.filter((p) => p.storeId === storeId),
        state.categories.filter((c) => c.storeId === storeId)
      );
    },
    setActiveStore: (storeId) => dispatch({ type: "SET_ACTIVE_STORE", storeId: storeId ?? "" }),
    upsertProduct: async (product) => {
      dispatch({ type: state.products.some((p) => p.id === product.id) ? "UPDATE_PRODUCT" : "ADD_PRODUCT", product });
      await persistEntity("products", product);
      if (cloud && !fromCloud.current) {
        const store = state.stores.find((s) => s.id === product.storeId);
        if (store) {
          // Rebuild against the post-dispatch product set so the catalog summary
          // reflects this save. state.products is pre-dispatch, so splice the
          // saved product in for the projection.
          const next = state.products.some((p) => p.id === product.id)
            ? state.products.map((p) => (p.id === product.id ? product : p))
            : [...state.products, product];
          await upsertPublicProduct(product, store.slug, next, state.categories, store.defaultTierId);
        }
      }
    },
    deleteProduct: (productId) => {
      // Look up storeId before dispatch (the reducer drops the product).
      const product = state.products.find((p) => p.id === productId);
      const storeId = product?.storeId;
      const slug = product?.slug;
      dispatch({ type: "DELETE_PRODUCT", productId });
      if (cloud && user && !fromCloud.current) {
        deleteEntity(user, "products", productId).catch(() => {});
        // Drop the detail doc + rebuild the catalog summary without this product.
        if (storeId && slug) {
          removePublicProductDoc(storeId, slug).catch(() => {});
          const store = state.stores.find((s) => s.id === storeId);
          if (store) {
            const remaining = state.products.filter((p) => p.id !== productId);
            rebuildPublicCatalog(store.slug, storeId, remaining, store?.defaultTierId).catch(() => {});
          }
        }
        if (product) deleteProductImage(product.storeId, productId).catch(() => {});
      }
    },
    upsertCategory: (category) => {
      const next = state.categories.some((c) => c.id === category.id)
        ? state.categories.map((c) => (c.id === category.id ? category : c))
        : [...state.categories, category];
      dispatch({ type: state.categories.some((c) => c.id === category.id) ? "UPDATE_CATEGORY" : "ADD_CATEGORY", category });
      void persistEntity("categories", category).catch(() => {});
      // Category edits reshape the storefront's category list — rebuild the
      // public catalog projection so /catalogo/:slug reflects it.
      if (cloud && !fromCloud.current) {
        const store = state.stores.find((s) => s.id === category.storeId);
        if (store) {
          projectPublicForStore(
            store,
            state.products.filter((p) => p.storeId === category.storeId),
            next.filter((c) => c.storeId === category.storeId)
          ).catch(() => {});
        }
      }
    },
    deleteCategory: (categoryId) => {
      const cat = state.categories.find((c) => c.id === categoryId);
      dispatch({ type: "DELETE_CATEGORY", categoryId });
      if (cloud && user && !fromCloud.current) {
        deleteEntity(user, "categories", categoryId).catch(() => {});
        if (cat) {
          const store = state.stores.find((s) => s.id === cat.storeId);
          if (store) {
            const remainingCats = state.categories.filter((c) => c.id !== categoryId);
            projectPublicForStore(
              store,
              state.products.filter((p) => p.storeId === cat.storeId),
              remainingCats
            ).catch(() => {});
          }
        }
      }
    },
    upsertSupplier: (supplier) => {
      dispatch({ type: state.suppliers.some((s) => s.id === supplier.id) ? "UPDATE_SUPPLIER" : "ADD_SUPPLIER", supplier });
      void persistEntity("suppliers", supplier).catch(() => {});
    },
    deleteSupplier: (supplierId) => {
      dispatch({ type: "DELETE_SUPPLIER", supplierId });
      if (cloud && user && !fromCloud.current) deleteEntity(user, "suppliers", supplierId).catch(() => {});
    },
    upsertPurchase: async (purchase) => {
      dispatch({ type: state.purchases.some((p) => p.id === purchase.id) ? "UPDATE_PURCHASE" : "ADD_PURCHASE", purchase });
      // Await so callers (PurchaseForm) can catch a Firestore rejection instead
      // of showing a false success toast. persistEntity re-throws on rejection.
      await persistEntity("purchases", purchase);
    },
    createDraftProductsForPurchase: async (products, purchase) => {
      if (!cloud) throw new Error("La creación en lote requiere sesión (cloud).");
      // One writeBatch: products + purchase in the same commit; an error
      // leaves everything untouched and re-throws (no local dispatch yet).
      await createDraftProductsForPurchaseTx(products, purchase);
      dispatch({ type: "BULK_CREATE_FOR_PURCHASE", products, purchase });
    },
    deletePurchase: (purchaseId) => {
      // A received purchase is inventory evidence: deleting it would strand
      // stock that entered through it. Block it (no reversals in V1).
      const purchase = state.purchases.find((p) => p.id === purchaseId);
      if (purchase && effectivePurchaseStatus(purchase) === "received") return;
      dispatch({ type: "DELETE_PURCHASE", purchaseId });
      if (cloud && user && !fromCloud.current) deleteEntity(user, "purchases", purchaseId).catch(() => {});
    },
    receivePurchase: async (purchase) => {
      // Both guards BEFORE any effect: legacy (status undefined) already
      // applied stock when it was saved, and receivedAt marks a prior receive.
      if (effectivePurchaseStatus(purchase) === "received" || purchase.receivedAt != null) {
        return "already";
      }
      if (cloud) {
        // Transactional in Firestore: stock + purchase in ONE commit, with the
        // legacy/receivedAt guards re-checked inside.
        try {
          await receivePurchaseTx(purchase.id);
        } catch (e) {
          if (e instanceof PurchaseAlreadyReceived) return "already";
          throw e;
        }
        // Reconcile local state from the transaction's outcome.
        const at = nowIso();
        const updated = applyPurchaseLines(state.products, purchase.lines);
        for (const [productId, update] of updated) {
          const p = state.products.find((x) => x.id === productId);
          if (p) {
            dispatch({ type: "UPDATE_PRODUCT", product: { ...p, ...update, updatedAt: at } });
          }
        }
        dispatch({ type: "UPDATE_PURCHASE", purchase: { ...purchase, status: "received", receivedAt: at, updatedAt: at } });
        return "received";
      }
      // Demo local: same effect, guarded by the check above. A stale or
      // corrupt localStorage must never mix stores: every linked product must
      // exist and belong to this purchase's store before stock moves.
      for (const line of purchase.lines) {
        if (!line.productId) throw new Error("Hay líneas sin producto vinculado.");
        const product = state.products.find((p) => p.id === line.productId);
        if (!product) throw new Error(`No se encontró el producto de la línea "${line.name}".`);
        if (product.storeId !== purchase.storeId) throw new Error(`El producto de la línea "${line.name}" pertenece a otra tienda.`);
      }
      const at = nowIso();
      const updated = applyPurchaseLines(state.products, purchase.lines);
      for (const [productId, update] of updated) {
        const p = state.products.find((x) => x.id === productId);
        if (p) {
          dispatch({ type: "UPDATE_PRODUCT", product: { ...p, ...update, updatedAt: at } });
          void persistEntity("products", { ...p, ...update, updatedAt: at }).catch(() => {});
        }
      }
      dispatch({ type: "UPDATE_PURCHASE", purchase: { ...purchase, status: "received", receivedAt: at, updatedAt: at } });
      void persistEntity("purchases", { ...purchase, status: "received", receivedAt: at, updatedAt: at }).catch(() => {});
      return "received";
    },
    upsertCustomer: (customer) => {
      dispatch({ type: state.customers.some((c) => c.id === customer.id) ? "UPDATE_CUSTOMER" : "ADD_CUSTOMER", customer });
      void persistEntity("customers", customer).catch(() => {});
    },
    deleteCustomer: (customerId) => {
      dispatch({ type: "DELETE_CUSTOMER", customerId });
      if (cloud && user && !fromCloud.current) deleteEntity(user, "customers", customerId).catch(() => {});
    },
    upsertOrder: (order) => {
      // Reserve/release stock: compare the existing order's quantity to the new
      // one. Negative stock is allowed (back-orders). On-demand stores carry no
      // quantityOnHand, so reservation is naturally skipped. Dispatch + persist
      // the product directly rather than via upsertProduct — reservation is a
      // stock-only change and stock is never in the public projection, so there
      // is no catalog re-projection to run.
      const prev = state.orders.find((o) => o.id === order.id);
      const product = order.productId ? state.products.find((p) => p.id === order.productId) : undefined;
      if (product && typeof product.quantityOnHand === "number") {
        const delta = reservationDelta(prev?.quantity, order.quantity);
        if (delta !== 0) {
          const updated = { ...product, quantityOnHand: product.quantityOnHand + delta, updatedAt: nowIso() };
          dispatch({ type: "UPDATE_PRODUCT", product: updated });
          void persistEntity("products", updated).catch(() => {});
        }
      }
      dispatch({ type: state.orders.some((o) => o.id === order.id) ? "UPDATE_ORDER" : "ADD_ORDER", order });
      void persistEntity("orders", order).catch(() => {});
    },
    deleteOrder: (orderId) => {
      // Release the reserved stock before removing the order.
      const existing = state.orders.find((o) => o.id === orderId);
      const product = existing?.productId ? state.products.find((p) => p.id === existing.productId) : undefined;
      if (existing && product && typeof product.quantityOnHand === "number") {
        const updated = { ...product, quantityOnHand: product.quantityOnHand + existing.quantity, updatedAt: nowIso() };
        dispatch({ type: "UPDATE_PRODUCT", product: updated });
        void persistEntity("products", updated).catch(() => {});
      }
      dispatch({ type: "DELETE_ORDER", orderId });
      if (cloud && user && !fromCloud.current) deleteEntity(user, "orders", orderId).catch(() => {});
    },
    resetDemo: () => {
      // Only meaningful in local mode (cloud has its own data).
      if (cloud) return;
      dispatch({ type: "RESET_DEMO" });
    },
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

// A cloud store doc carries ownerUid + memberUids (the signed-in user is owner+member).
function storeWithMembership(store: Store, user: AppUser | null): Store & { ownerUid?: string; memberUids?: string[] } {
  if (!user) return store;
  return { ...store, ownerUid: user.uid, memberUids: [user.uid] };
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

// New-entity factories with ids/timestamps prefilled, for forms.
export function newProduct(storeId: string): Product {
  const now = nowIso();
  return { id: uid("prod"), storeId, name: "", sku: "", category: "other", isPublic: false, status: "draft", createdAt: now, updatedAt: now };
}
export function newCategory(storeId: string, slug: string): Category {
  const now = nowIso();
  return {
    id: `${storeId}__${slug}`,
    storeId,
    name: "",
    slug,
    sortOrder: 0,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}
export function newCustomer(storeId: string): Customer {
  const now = nowIso();
  return { id: uid("cust"), storeId, name: "", createdAt: now, updatedAt: now };
}
export function newOrder(storeId: string): Order {
  const now = nowIso();
  return { id: uid("order"), storeId, customerId: "", productName: "", quantity: 1, price: 0, deposit: 0, status: "asked", createdAt: now, updatedAt: now };
}
export function newSupplier(storeId: string): Supplier {
  const now = nowIso();
  return { id: uid("supplier"), storeId, name: "", createdAt: now, updatedAt: now };
}
export function newPurchase(storeId: string): Purchase {
  const now = nowIso();
  return { id: uid("purchase"), storeId, date: now.slice(0, 10), lines: [], subtotal: 0, totalConfirmed: 0, status: "draft", origin: "manual", createdAt: now, updatedAt: now };
}
