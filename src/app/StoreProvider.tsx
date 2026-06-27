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
import {
  loadCloudState,
  subscribeCloudState,
  saveEntity,
  deleteEntity,
  seedCloudIfEmpty,
} from "./firebase/firestoreData";
import { isFirebaseConfigured } from "./firebase/config";

// Actions: every mutation flows through here. storeId is carried on entity-level
// actions and selectors enforce isolation, so a screen can't touch another store.
type Action =
  | { type: "ADD_STORE"; store: Store }
  | { type: "UPDATE_STORE"; store: Store }
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
    case "SET_ACTIVE_STORE":
      return { ...state, activeStoreId: action.storeId };
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
  addStore: (input: Omit<Store, "id" | "createdAt" | "updatedAt">) => Store;
  setActiveStore: (storeId: string) => void;
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
    addStore: (input) => {
      const store: Store = { ...input, id: uid("store"), createdAt: nowIso(), updatedAt: nowIso() };
      dispatch({ type: "ADD_STORE", store });
      persistEntity("stores", storeWithMembership(store, user));
      return store;
    },
    setActiveStore: (storeId) => dispatch({ type: "SET_ACTIVE_STORE", storeId }),
    upsertProduct: (product) => {
      dispatch({ type: state.products.some((p) => p.id === product.id) ? "UPDATE_PRODUCT" : "ADD_PRODUCT", product });
      persistEntity("products", product);
    },
    deleteProduct: (productId) => {
      dispatch({ type: "DELETE_PRODUCT", productId });
      if (cloud && user && !fromCloud.current) deleteEntity(user, "products", productId).catch(() => {});
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
