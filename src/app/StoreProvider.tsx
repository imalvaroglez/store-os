import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type {
  AppState,
  Store,
  Product,
  Customer,
  Order,
} from "../types";
import { loadState, saveState } from "../lib/storage";
import { buildSeedState } from "../lib/seed";
import { uid } from "../lib/ids";
import { nowIso } from "../lib/dates";
import { useAuth } from "./firebase/AuthProvider";
import type { AppUser } from "./firebase/auth";
import { findUidByEmail, sendInviteLink } from "./firebase/auth";
import {
  loadCloudState,
  subscribeCloudState,
  saveEntity,
  deleteEntity,
  seedCloudIfEmpty,
  claimSlug,
  releaseSlug,
  projectPublicForStore,
  unprojectPublicForStore,
  upsertPublicProduct,
  removePublicProduct,
} from "./firebase/firestoreData";
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
  | { type: "ADD_CUSTOMER"; customer: Customer }
  | { type: "UPDATE_CUSTOMER"; customer: Customer }
  | { type: "DELETE_CUSTOMER"; customerId: string }
  | { type: "ADD_ORDER"; order: Order }
  | { type: "UPDATE_ORDER"; order: Order }
  | { type: "DELETE_ORDER"; orderId: string }
  | { type: "RESET_DEMO" }
  | { type: "REPLACE_STATE"; state: AppState }; // cloud sync pushes a whole state

function reducer(state: AppState, action: Action): AppState {
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
      return buildSeedState();
    case "REPLACE_STATE":
      return action.state;
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
  /** Republish a store's public catalog projection (backfill / repair). */
  republishCatalog: (storeId: string) => Promise<void>;
  setActiveStore: (storeId: string | null) => void;
  upsertProduct: (product: Product) => void;
  deleteProduct: (productId: string) => void;
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
        .then((s) => {
          fromCloud.current = true;
          dispatch({ type: "REPLACE_STATE", state: s });
          fromCloud.current = false;
        })
        .catch(() => {});
      unsub = subscribeCloudState(user, (s) => {
        fromCloud.current = true;
        dispatch({ type: "REPLACE_STATE", state: s });
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

  function persistEntity(name: "stores" | "products" | "customers" | "orders", entity: { id: string } & Record<string, unknown>) {
    if (!cloud || !user || fromCloud.current) return;
    saveEntity(user, name, entity).catch(() => {});
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
      persistEntity("stores", storeWithMembership(store, user));
      if (cloud) {
        await projectPublicForStore(store, state.products).catch(() => {});
      }
      return store;
    },
    updateStore: async (patch) => {
      const existing = state.stores.find((s) => s.id === patch.id);
      if (!existing) return;
      const store: Store = { ...existing, ...patch, updatedAt: nowIso() };
      const slugChanged = patch.slug !== undefined && patch.slug !== existing.slug;
      if (cloud && slugChanged) {
        // Rename: claim the new slug (may throw SlugTakenError), then update the
        // store, re-parent its public products to the new slug, and release the
        // old slug reservation. The local dispatch only runs if the claim succeeds.
        await claimSlug(store.slug, store.id);
      }
      dispatch({ type: "UPDATE_STORE", store });
      persistEntity("stores", store);
      if (cloud) {
        await projectPublicForStore(store, state.products).catch(() => {});
        if (slugChanged) await releaseSlug(existing.slug);
      }
    },
    deleteStore: (storeId) => {
      const store = state.stores.find((s) => s.id === storeId);
      dispatch({ type: "DELETE_STORE", storeId });
      if (cloud && user && store && !fromCloud.current) {
        deleteEntity(user, "stores", storeId).catch(() => {});
        // Best-effort: delete the store's entities in the cloud.
        state.products.filter((p) => p.storeId === storeId).forEach((p) => deleteEntity(user, "products", p.id).catch(() => {}));
        state.customers.filter((c) => c.storeId === storeId).forEach((c) => deleteEntity(user, "customers", c.id).catch(() => {}));
        state.orders.filter((o) => o.storeId === storeId).forEach((o) => deleteEntity(user, "orders", o.id).catch(() => {}));
        // Remove the public catalog projection + release the slug.
        unprojectPublicForStore(store).catch(() => {});
      }
    },
    inviteMember: async (storeId, email) => {
      const store = state.stores.find((s) => s.id === storeId);
      if (!store) return "pending";
      const normalized = email.toLowerCase().trim();
      // Try to find an existing user by email.
      const uid = await findUidByEmail(normalized).catch(() => null);
      if (uid) {
        const memberUids = Array.from(new Set([...(store.memberUids ?? []), uid]));
        const updated = { ...store, memberUids, updatedAt: nowIso() };
        dispatch({ type: "UPDATE_STORE", store: updated });
        persistEntity("stores", updated);
        return "invited";
      }
      // No account yet: store a pending invite; the real email-link send happens
      // in the cloud path (emulator can't deliver email, so this is the durable bit).
      const pendingInvites = Array.from(new Set([...(store.pendingInvites ?? []), normalized]));
      const updated = { ...store, pendingInvites, updatedAt: nowIso() };
      dispatch({ type: "UPDATE_STORE", store: updated });
      persistEntity("stores", updated);
      void sendInviteLink(normalized, store).catch(() => {});
      return "pending";
    },
    removeMember: (storeId, memberUid) => {
      const store = state.stores.find((s) => s.id === storeId);
      if (!store) return;
      const memberUids = (store.memberUids ?? []).filter((u) => u !== memberUid);
      const updated = { ...store, memberUids, updatedAt: nowIso() };
      dispatch({ type: "UPDATE_STORE", store: updated });
      persistEntity("stores", updated);
    },
    republishCatalog: async (storeId) => {
      const store = state.stores.find((s) => s.id === storeId);
      if (!store || !cloud) return;
      await claimSlug(store.slug, store.id).catch(() => {});
      await projectPublicForStore(store, state.products.filter((p) => p.storeId === storeId));
    },
    setActiveStore: (storeId) => dispatch({ type: "SET_ACTIVE_STORE", storeId: storeId ?? "" }),
    upsertProduct: (product) => {
      dispatch({ type: state.products.some((p) => p.id === product.id) ? "UPDATE_PRODUCT" : "ADD_PRODUCT", product });
      persistEntity("products", product);
      if (cloud && !fromCloud.current) {
        const store = state.stores.find((s) => s.id === product.storeId);
        if (store) upsertPublicProduct(product, store.slug).catch(() => {});
      }
    },
    deleteProduct: (productId) => {
      dispatch({ type: "DELETE_PRODUCT", productId });
      if (cloud && user && !fromCloud.current) {
        deleteEntity(user, "products", productId).catch(() => {});
        removePublicProduct(productId).catch(() => {});
      }
    },
    upsertCustomer: (customer) => {
      dispatch({ type: state.customers.some((c) => c.id === customer.id) ? "UPDATE_CUSTOMER" : "ADD_CUSTOMER", customer });
      persistEntity("customers", customer);
    },
    deleteCustomer: (customerId) => {
      dispatch({ type: "DELETE_CUSTOMER", customerId });
      if (cloud && user && !fromCloud.current) deleteEntity(user, "customers", customerId).catch(() => {});
    },
    upsertOrder: (order) => {
      dispatch({ type: state.orders.some((o) => o.id === order.id) ? "UPDATE_ORDER" : "ADD_ORDER", order });
      persistEntity("orders", order);
    },
    deleteOrder: (orderId) => {
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
  return { id: uid("prod"), storeId, name: "", category: "other", isPublic: true, createdAt: now, updatedAt: now };
}
export function newCustomer(storeId: string): Customer {
  const now = nowIso();
  return { id: uid("cust"), storeId, name: "", createdAt: now, updatedAt: now };
}
export function newOrder(storeId: string): Order {
  const now = nowIso();
  return { id: uid("order"), storeId, customerId: "", productName: "", quantity: 1, price: 0, deposit: 0, status: "asked", createdAt: now, updatedAt: now };
}
