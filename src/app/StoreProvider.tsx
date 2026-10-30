import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useState,
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
import { CURRENT_ORDER_SCHEMA_VERSION } from "../types";
import { loadPreferredStoreId, savePreferredStoreId } from "../lib/storage";
import { migrateCatalog } from "../lib/catalog";
import { uid } from "../lib/ids";
import { nowIso } from "../lib/dates";
import { applyPurchaseLines } from "../lib/inventory";
import { migrateOrder, paymentStatusForOrder } from "../lib/orders";
import { useAuth } from "./firebase/AuthProvider";
import type { AppUser } from "./firebase/auth";
import { findUidByEmail, normalizeEmail, sendInviteLink } from "./firebase/auth";
import {
  loadCloudState,
  subscribeCloudState,
  saveEntity,
  deleteEntity,
  claimSlug,
  projectPublicForStore,
  unprojectPublicForStore,
  upsertPublicProduct,
  removePublicProductDoc,
  rebuildPublicCatalog,
  receivePurchaseTx,
  createDraftProductsForPurchaseTx,
  saveOrderWithStockTx,
  deleteOrderWithStockTx,
  StaleOrderError,
  PurchaseAlreadyReceived,
  PublicCatalogProjectionError,
  stripUndefined,
} from "./firebase/firestoreData";
import { deleteProductImage, deletePurchasePdf } from "./firebase/storage";

// Actions: every mutation flows through here. The active store scopes normal UI
// work; membership and super_admin access are enforced by Firebase rules.
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
  cloud: boolean;
  stateStatus: "idle" | "loading" | "ready" | "error";
  stateError: string | null;
  retryStateLoad: () => void;
  draftOwnerId: string;
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
  /** The ONLY operation that moves inventory. Idempotent; throws "received" softly. */
  receivePurchase: (purchase: Purchase) => Promise<"received" | "already">;
  deletePurchase: (purchaseId: string) => void;
  upsertCustomer: (customer: Customer) => Promise<void>;
  deleteCustomer: (customerId: string) => void;
  upsertOrder: (order: Order, options?: { expectedRevision: number | null; mutationId: string }) => Promise<void>;
  deleteOrder: (orderId: string, expectedRevision: number) => Promise<void>;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const cloud = !!user;
  const [state, dispatch] = useReducer(reducer, undefined, emptyAppState);
  const [cloudLoad, setCloudLoad] = useState<{
    uid: string | null;
    status: "idle" | "loading" | "ready" | "error";
    error: string | null;
  }>({ uid: null, status: "idle", error: null });
  const [loadAttempt, setLoadAttempt] = useState(0);

  function requireAuthenticatedUser(): AppUser {
    if (!user) throw new Error("Inicia sesión para administrar tu tienda.");
    return user;
  }
  // Administrative state exists only in memory and is hydrated from Firestore
  // after Auth confirms a session. A signed-out provider never reads business
  // data from browser storage.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let active = true;
    if (user) {
      setCloudLoad({ uid: user.uid, status: "loading", error: null });
      const publishCloudState = (raw: AppState) => {
        if (!active) return;
        const migrated = migrateCatalog(raw);
        dispatch({ type: "REPLACE_STATE", state: migrated });
        setCloudLoad({ uid: user.uid, status: "ready", error: null });
      };
      loadCloudState(user)
        .then(async (s) => {
          if (!active) return;
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
              // The cloud loader already returned the canonical owner/member
              // fields, including for a super_admin operating another store.
              writes.push(saveEntity(user, "stores", store));
              migratedStores.push(store);
            }
          }
          // Normalize orders in memory only: writing a stale migration snapshot
          // here could overwrite an order edited by another device.
          // Render FIRST, persist in the background: on a cold/slow backend the
          // awaited writes delayed REPLACE_STATE so much that a REPLACE arriving
          // after the user switched stores reverted their selection. Migration
          // is idempotent, so a failed background write just re-migrates on the
          // next load.
          // Restore the latest explicitly selected store after auth hydration.
          // Read at dispatch time so a switch made while loading wins.
          const preferred = loadPreferredStoreId();
          if (preferred && migrated.stores.some((store) => store.id === preferred)) {
            dispatch({ type: "SET_ACTIVE_STORE", storeId: preferred });
          }
          dispatch({ type: "REPLACE_STATE", state: migrated });
          setCloudLoad({ uid: user.uid, status: "ready", error: null });
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
        .catch(() => {
          if (active) setCloudLoad({ uid: user.uid, status: "error", error: "No se pudieron cargar tus tiendas. Revisa tu conexión e intenta de nuevo." });
        });
      try {
        unsub = subscribeCloudState(
          user,
          publishCloudState,
          () => {
            if (active) setCloudLoad({ uid: user.uid, status: "error", error: "No se pudieron actualizar tus tiendas. Revisa tu conexión e intenta de nuevo." });
          }
        );
      } catch {
        setCloudLoad({ uid: user.uid, status: "error", error: "No se pudieron actualizar tus tiendas. Revisa tu conexión e intenta de nuevo." });
      }
    } else {
      dispatch({ type: "REPLACE_STATE", state: emptyAppState() });
      setCloudLoad({ uid: null, status: "idle", error: null });
    }
    return () => { active = false; unsub?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, loadAttempt]);

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
      void saveEntity(user, "stores", updated).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, user?.uid, state.stores]);

  function persistEntity(name: "stores" | "products" | "categories" | "suppliers" | "purchases" | "customers" | "orders", entity: { id: string } & Record<string, unknown>): Promise<void> {
    const currentUser = requireAuthenticatedUser();
    return saveEntity(currentUser, name, entity).catch((error) => {
      // Log with context for debugging, then re-throw so callers can surface a
      // toast instead of lying with a success. See persist-entity-error-handling.
      console.error(`[Firestore] Error al guardar ${name} (${entity.id}):`, error);
      throw error;
    });
  }

  const stateStatus = cloud && cloudLoad.uid === user?.uid ? cloudLoad.status : cloud ? "loading" : "idle";
  const stateError = stateStatus === "error" ? cloudLoad.error : null;

  const value: StoreContextValue = {
    state,
    activeStore: state.stores.find((s) => s.id === state.activeStoreId) ?? null,
    cloud,
    stateStatus,
    stateError,
    retryStateLoad: () => setLoadAttempt((attempt) => attempt + 1),
    draftOwnerId: user?.uid ?? "",
    addStore: async (input) => {
      const currentUser = requireAuthenticatedUser();
      const store: Store = { ...input, id: uid("store"), createdAt: nowIso(), updatedAt: nowIso() };
      // Claim the slug first (throws SlugTakenError on global collision) so we
      // don't create a store whose catalog can't be published.
      await claimSlug(store.slug, store.id);
      const privateStore = storeWithMembership(store, currentUser);
      // Persist before exposing the store locally: a rejected private write
      // must not leave the frontend ahead of Firestore.
      await persistEntity("stores", privateStore);
      try {
        await projectPublicForStore(store, state.products, state.categories);
      } catch (error) {
        throw new PublicCatalogProjectionError(error);
      }
      dispatch({ type: "ADD_STORE", store: privateStore });
      return privateStore;
    },
    updateStore: async (patch) => {
      requireAuthenticatedUser();
      const existing = state.stores.find((s) => s.id === patch.id);
      if (!existing) return;
      const store: Store = { ...existing, ...patch, updatedAt: nowIso() };
      const slugChanged = patch.slug !== undefined && patch.slug !== existing.slug;
      if (slugChanged) {
        // Rename: claim the new slug first (may throw SlugTakenError). The local
        // dispatch only runs if the claim succeeds, so a collision leaves nothing
        // half-renamed.
        await claimSlug(store.slug, store.id);
      }
      // Persist ONLY the patch. A full-object write replays every field of the
      // cached state, so a stale tab could clobber remote edits field by field
      // (the 2026-08 whatsapp + storefront overwrite). Merged `store` above is
      // still what drives claimSlug, the dispatch and the public projection.
      const persisted = stripUndefined({ ...patch, updatedAt: nowIso() }) as { id: string } & Record<string, unknown>;
      await persistEntity("stores", persisted);
      // Cloud state follows the private write. This prevents a rejected write
      // from leaving the UI ahead of Firestore; a later public projection error
      // still leaves the private store visible so the user can repair publishing.
      dispatch({ type: "UPDATE_STORE", store });
      {
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
        try {
          await projectPublicForStore(store, state.products, state.categories);
        } catch (error) {
          throw new PublicCatalogProjectionError(error);
        }
      }
    },
    deleteStore: (storeId) => {
      const currentUser = requireAuthenticatedUser();
      const store = state.stores.find((s) => s.id === storeId);
      dispatch({ type: "DELETE_STORE", storeId });
      if (store) {
        deleteEntity(currentUser, "stores", storeId).catch(() => {});
        // Best-effort: delete the store's entities + product photos in the cloud.
        state.products.filter((p) => p.storeId === storeId).forEach((p) => {
          deleteEntity(currentUser, "products", p.id).catch(() => {});
          deleteProductImage(storeId, p.id).catch(() => {});
        });
        state.customers.filter((c) => c.storeId === storeId).forEach((c) => deleteEntity(currentUser, "customers", c.id).catch(() => {}));
        state.orders.filter((o) => o.storeId === storeId).forEach((o) => deleteEntity(currentUser, "orders", o.id).catch(() => {}));
        state.suppliers.filter((s) => s.storeId === storeId).forEach((s) => deleteEntity(currentUser, "suppliers", s.id).catch(() => {}));
        state.purchases.filter((p) => p.storeId === storeId).forEach((p) => deleteEntity(currentUser, "purchases", p.id).catch(() => {}));
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
      requireAuthenticatedUser();
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
      requireAuthenticatedUser();
      const store = state.stores.find((s) => s.id === storeId);
      if (!store) return;
      const memberUids = (store.memberUids ?? []).filter((u) => u !== memberUid);
      const updated = { ...store, memberUids, updatedAt: nowIso() };
      dispatch({ type: "UPDATE_STORE", store: updated });
      void persistEntity("stores", updated).catch(() => {});
    },
    transferStoreOwnership: async (storeId, email) => {
      requireAuthenticatedUser();
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
      requireAuthenticatedUser();
      const store = state.stores.find((s) => s.id === storeId);
      if (!store) return;
      await claimSlug(store.slug, store.id).catch(() => {});
      try {
        await projectPublicForStore(
          store,
          state.products.filter((p) => p.storeId === storeId),
          state.categories.filter((c) => c.storeId === storeId)
        );
      } catch (error) {
        throw new PublicCatalogProjectionError(error);
      }
    },
    setActiveStore: (storeId) => {
      requireAuthenticatedUser();
      if (storeId && !state.stores.some((store) => store.id === storeId)) {
        throw new Error("No puedes seleccionar una tienda que no está disponible en tu cuenta.");
      }
      savePreferredStoreId(storeId);
      dispatch({ type: "SET_ACTIVE_STORE", storeId: storeId ?? "" });
    },
    upsertProduct: async (product) => {
      requireAuthenticatedUser();
      dispatch({ type: state.products.some((p) => p.id === product.id) ? "UPDATE_PRODUCT" : "ADD_PRODUCT", product });
      await persistEntity("products", product);
      {
        const store = state.stores.find((s) => s.id === product.storeId);
        if (store) {
          // Rebuild against the post-dispatch product set so the catalog summary
          // reflects this save. state.products is pre-dispatch, so splice the
          // saved product in for the projection.
          const next = state.products.some((p) => p.id === product.id)
            ? state.products.map((p) => (p.id === product.id ? product : p))
            : [...state.products, product];
          await upsertPublicProduct(product, store.slug, next, state.categories, store);
        }
      }
    },
    deleteProduct: (productId) => {
      const currentUser = requireAuthenticatedUser();
      // Look up storeId before dispatch (the reducer drops the product).
      const product = state.products.find((p) => p.id === productId);
      const storeId = product?.storeId;
      const slug = product?.slug;
      dispatch({ type: "DELETE_PRODUCT", productId });
      {
        deleteEntity(currentUser, "products", productId).catch(() => {});
        // Drop the detail doc + rebuild the catalog summary without this product.
        if (storeId && slug) {
          removePublicProductDoc(storeId, slug).catch(() => {});
          const store = state.stores.find((s) => s.id === storeId);
          if (store) {
            const remaining = state.products.filter((p) => p.id !== productId);
            rebuildPublicCatalog(store.slug, storeId, remaining, store).catch(() => {});
          }
        }
        if (product) deleteProductImage(product.storeId, productId).catch(() => {});
      }
    },
    upsertCategory: (category) => {
      requireAuthenticatedUser();
      const next = state.categories.some((c) => c.id === category.id)
        ? state.categories.map((c) => (c.id === category.id ? category : c))
        : [...state.categories, category];
      dispatch({ type: state.categories.some((c) => c.id === category.id) ? "UPDATE_CATEGORY" : "ADD_CATEGORY", category });
      void persistEntity("categories", category).catch(() => {});
      // Category edits reshape the storefront's category list — rebuild the
      // public catalog projection so /catalogo/:slug reflects it.
      {
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
      const currentUser = requireAuthenticatedUser();
      const cat = state.categories.find((c) => c.id === categoryId);
      dispatch({ type: "DELETE_CATEGORY", categoryId });
      {
        deleteEntity(currentUser, "categories", categoryId).catch(() => {});
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
      requireAuthenticatedUser();
      dispatch({ type: state.suppliers.some((s) => s.id === supplier.id) ? "UPDATE_SUPPLIER" : "ADD_SUPPLIER", supplier });
      void persistEntity("suppliers", supplier).catch(() => {});
    },
    deleteSupplier: (supplierId) => {
      const currentUser = requireAuthenticatedUser();
      dispatch({ type: "DELETE_SUPPLIER", supplierId });
      deleteEntity(currentUser, "suppliers", supplierId).catch(() => {});
    },
    upsertPurchase: async (purchase) => {
      requireAuthenticatedUser();
      dispatch({ type: state.purchases.some((p) => p.id === purchase.id) ? "UPDATE_PURCHASE" : "ADD_PURCHASE", purchase });
      // Await so callers (PurchaseForm) can catch a Firestore rejection instead
      // of showing a false success toast. persistEntity re-throws on rejection.
      await persistEntity("purchases", purchase);
    },
    createDraftProductsForPurchase: async (products, purchase) => {
      requireAuthenticatedUser();
      // One writeBatch: products + purchase in the same commit; an error
      // leaves everything untouched and re-throws (no local dispatch yet).
      await createDraftProductsForPurchaseTx(products, purchase);
      dispatch({ type: "BULK_CREATE_FOR_PURCHASE", products, purchase });
    },
    deletePurchase: (purchaseId) => {
      const currentUser = requireAuthenticatedUser();
      // A received purchase is inventory evidence: deleting it would strand
      // stock that entered through it. Block it (no reversals in V1).
      const purchase = state.purchases.find((p) => p.id === purchaseId);
      if (purchase && effectivePurchaseStatus(purchase) === "received") return;
      dispatch({ type: "DELETE_PURCHASE", purchaseId });
      {
        deleteEntity(currentUser, "purchases", purchaseId).catch(() => {});
        // Retention policy: the PDF lives while its purchase does.
        if (purchase?.documentPath) {
          deletePurchasePdf(purchase.documentPath).catch((e) =>
            console.error(`[Storage] No se pudo borrar el PDF de la compra ${purchaseId}:`, e)
          );
        }
      }
    },
    receivePurchase: async (purchase) => {
      requireAuthenticatedUser();
      // Both guards BEFORE any effect: legacy (status undefined) already
      // applied stock when it was saved, and receivedAt marks a prior receive.
      if (effectivePurchaseStatus(purchase) === "received" || purchase.receivedAt != null) {
        return "already";
      }
      // Transactional in Firestore: stock + purchase in ONE commit, with the
      // legacy/receivedAt guards re-checked inside.
      try {
        await receivePurchaseTx(purchase.id);
      } catch (e) {
        if (e instanceof PurchaseAlreadyReceived) return "already";
        throw e;
      }
      // Reconcile in-memory state only after the transaction commits.
      const at = nowIso();
      const updated = applyPurchaseLines(state.products, purchase.lines);
      for (const [productId, update] of updated) {
        const p = state.products.find((x) => x.id === productId);
        if (p) dispatch({ type: "UPDATE_PRODUCT", product: { ...p, ...update, updatedAt: at } });
      }
      dispatch({ type: "UPDATE_PURCHASE", purchase: { ...purchase, status: "received", receivedAt: at, updatedAt: at } });
      return "received";
    },
    upsertCustomer: async (customer) => {
      await persistEntity("customers", customer);
      dispatch({ type: state.customers.some((c) => c.id === customer.id) ? "UPDATE_CUSTOMER" : "ADD_CUSTOMER", customer });
    },
    deleteCustomer: (customerId) => {
      const currentUser = requireAuthenticatedUser();
      dispatch({ type: "DELETE_CUSTOMER", customerId });
      deleteEntity(currentUser, "customers", customerId).catch(() => {});
    },
    upsertOrder: async (order, options) => {
      const currentUser = requireAuthenticatedUser();
      // Canonical v2 snapshot before it touches either store: migration +
      // paymentStatus derivation in one place for every caller.
      const nextOrder = {
        ...migrateOrder(order),
        paymentStatus: paymentStatusForOrder(order),
      };
      const prev = state.orders.find((o) => o.id === order.id);
      // ONE transaction (order + every stock delta). Deltas are applied
      // RELATIVE to the canonical quantities re-read inside the transaction, so
      // concurrent orders on another device can't be silently overwritten; a
      // stale edit of THIS order aborts with StaleOrderError. Local state
      // commits only on success, so a failed save leaves no phantom order and
      // the retry the toast invites replays the FULL delta set.
      const result = await saveOrderWithStockTx(currentUser, nextOrder, options ? options.expectedRevision : prev ? (order.revision ?? 0) : null, options?.mutationId ?? uid("mutation"));
      for (const update of result.stock) {
        const product = state.products.find((p) => p.id === update.productId);
        if (product) dispatch({ type: "UPDATE_PRODUCT", product: { ...product, quantityOnHand: update.quantityOnHand, updatedAt: result.order.updatedAt } });
      }
      dispatch({ type: prev ? "UPDATE_ORDER" : "ADD_ORDER", order: result.order });
    },
    deleteOrder: async (orderId, expectedRevision) => {
      const currentUser = requireAuthenticatedUser();
      // Release the held stock and remove the order atomically (cancelling a
      // delivered sale also returns the goods — see reservationDeltas*).
      const existing = state.orders.find((o) => o.id === orderId);
      if (existing && (existing.revision ?? 0) !== expectedRevision) throw new StaleOrderError();
      if (!existing) throw new Error("No se encontró el pedido.");
      const updates = await deleteOrderWithStockTx(currentUser, orderId, expectedRevision);
      for (const update of updates) {
        const product = state.products.find((p) => p.id === update.productId);
        if (product) dispatch({ type: "UPDATE_PRODUCT", product: { ...product, quantityOnHand: update.quantityOnHand, updatedAt: nowIso() } });
      }
      dispatch({ type: "DELETE_ORDER", orderId });
    },
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

// New cloud stores carry ownerUid + memberUids for the signed-in creator.
function storeWithMembership(store: Store, user: AppUser): Store & { ownerUid?: string; memberUids?: string[] } {
  return { ...store, ownerUid: user.uid, memberUids: [user.uid] };
}

export function emptyAppState(): AppState {
  return { stores: [], activeStoreId: null, products: [], categories: [], suppliers: [], purchases: [], customers: [], orders: [] };
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
  return {
    id: uid("order"), storeId, customerId: "", items: [], deposit: 0,
    orderStatus: "asked", paymentStatus: "unpaid", schemaVersion: CURRENT_ORDER_SCHEMA_VERSION,
    createdAt: now, updatedAt: now,
  };
}
export function newSupplier(storeId: string): Supplier {
  const now = nowIso();
  return { id: uid("supplier"), storeId, name: "", createdAt: now, updatedAt: now };
}
export function newPurchase(storeId: string): Purchase {
  const now = nowIso();
  return { id: uid("purchase"), storeId, date: now.slice(0, 10), lines: [], subtotal: 0, totalConfirmed: 0, status: "draft", origin: "manual", createdAt: now, updatedAt: now };
}
