import {
  createContext,
  useContext,
  useEffect,
  useReducer,
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
  | { type: "RESET_DEMO" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD_STORE":
      return {
        ...state,
        stores: [...state.stores, action.store],
        activeStoreId: action.store.id,
      };
    case "UPDATE_STORE":
      return {
        ...state,
        stores: state.stores.map((s) =>
          s.id === action.store.id ? action.store : s
        ),
      };
    case "SET_ACTIVE_STORE":
      return { ...state, activeStoreId: action.storeId };
    case "ADD_PRODUCT":
      return { ...state, products: [...state.products, action.product] };
    case "UPDATE_PRODUCT":
      return {
        ...state,
        products: state.products.map((p) =>
          p.id === action.product.id ? action.product : p
        ),
      };
    case "DELETE_PRODUCT":
      return {
        ...state,
        products: state.products.filter((p) => p.id !== action.productId),
      };
    case "ADD_CUSTOMER":
      return { ...state, customers: [...state.customers, action.customer] };
    case "UPDATE_CUSTOMER":
      return {
        ...state,
        customers: state.customers.map((c) =>
          c.id === action.customer.id ? action.customer : c
        ),
      };
    case "DELETE_CUSTOMER":
      return {
        ...state,
        customers: state.customers.filter((c) => c.id !== action.customerId),
      };
    case "ADD_ORDER":
      return { ...state, orders: [...state.orders, action.order] };
    case "UPDATE_ORDER":
      return {
        ...state,
        orders: state.orders.map((o) =>
          o.id === action.order.id ? action.order : o
        ),
      };
    case "DELETE_ORDER":
      return {
        ...state,
        orders: state.orders.filter((o) => o.id !== action.orderId),
      };
    case "RESET_DEMO":
      return buildSeedState();
    default:
      return state;
  }
}

type StoreContextValue = {
  state: AppState;
  activeStore: Store | null;
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
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  // Sole writer: persist every state change. No component touches localStorage.
  useEffect(() => {
    saveState(state);
  }, [state]);

  const value: StoreContextValue = {
    state,
    activeStore:
      state.stores.find((s) => s.id === state.activeStoreId) ?? null,
    addStore: (input) => {
      const store: Store = {
        ...input,
        id: uid("store"),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      dispatch({ type: "ADD_STORE", store });
      return store;
    },
    setActiveStore: (storeId) => dispatch({ type: "SET_ACTIVE_STORE", storeId }),
    upsertProduct: (product) =>
      dispatch({
        type: state.products.some((p) => p.id === product.id)
          ? "UPDATE_PRODUCT"
          : "ADD_PRODUCT",
        product,
      }),
    deleteProduct: (productId) =>
      dispatch({ type: "DELETE_PRODUCT", productId }),
    upsertCustomer: (customer) =>
      dispatch({
        type: state.customers.some((c) => c.id === customer.id)
          ? "UPDATE_CUSTOMER"
          : "ADD_CUSTOMER",
        customer,
      }),
    deleteCustomer: (customerId) =>
      dispatch({ type: "DELETE_CUSTOMER", customerId }),
    upsertOrder: (order) =>
      dispatch({
        type: state.orders.some((o) => o.id === order.id)
          ? "UPDATE_ORDER"
          : "ADD_ORDER",
        order,
      }),
    deleteOrder: (orderId) => dispatch({ type: "DELETE_ORDER", orderId }),
    resetDemo: () => dispatch({ type: "RESET_DEMO" }),
  };

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

// New-entity factories with ids/timestamps prefilled, for forms.
export function newProduct(storeId: string): Product {
  const now = nowIso();
  return {
    id: uid("prod"),
    storeId,
    name: "",
    category: "other",
    isPublic: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function newCustomer(storeId: string): Customer {
  const now = nowIso();
  return {
    id: uid("cust"),
    storeId,
    name: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function newOrder(storeId: string): Order {
  const now = nowIso();
  return {
    id: uid("order"),
    storeId,
    customerId: "",
    productName: "",
    quantity: 1,
    price: 0,
    deposit: 0,
    status: "asked",
    createdAt: now,
    updatedAt: now,
  };
}
