import type { AppState, Order, OrderStatus } from "../types";
import { migrateCatalog } from "./catalog";

export const STORAGE_KEY = "store_os_state_v1";
export const ACTIVE_STORE_KEY = "store_os_active_store_v1";

// ponytail: whole-state load/save. Simpler than per-entity keys; local-first so size is tiny.
// When Firebase lands later, swap this adapter; the reducer/UI shape stays.

// A signed-out visitor (or a developer who hasn't logged in) with empty storage
// reaches the AuthScreen — we NEVER auto-seed demo stores into the browser.
// The Olivia fixture for the DEV backend lives only in scripts/seed-dev.cjs.
export function emptyState(): AppState {
  return { stores: [], activeStoreId: null, products: [], categories: [], suppliers: [], purchases: [], customers: [], orders: [] };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = emptyState();
      saveState(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as AppState;
    return migrateCatalog(normalizeState(parsed));
  } catch {
    // Corrupt state -> reset. Demo seed in dev, empty in production.
    const seeded = emptyState();
    saveState(seeded);
    return seeded;
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full / unavailable: no-op. Local-first degrades silently.
  }
}

export function loadPreferredStoreId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_STORE_KEY);
  } catch {
    return null;
  }
}

export function savePreferredStoreId(storeId: string | null): void {
  try {
    if (storeId) localStorage.setItem(ACTIVE_STORE_KEY, storeId);
    else localStorage.removeItem(ACTIVE_STORE_KEY);
  } catch {
    // Storage unavailable: the in-memory selection still works.
  }
}

// Defensive: tolerate older/partial shapes so a missing array never crashes the app.
function normalizeState(s: Partial<AppState> | null | undefined): AppState {
  return {
    stores: s?.stores ?? [],
    activeStoreId: s?.activeStoreId ?? s?.stores?.[0]?.id ?? null,
    products: s?.products ?? [],
    categories: s?.categories ?? [],
    suppliers: s?.suppliers ?? [],
    purchases: s?.purchases ?? [],
    customers: s?.customers ?? [],
    orders: s?.orders ?? [],
  };
}



// Offline draft persistence for the order editor (E1 — R8: a 50-line capture
// must survive a lost connection / accidental close, clearly distinguishable
// from a confirmed save). Drafts live in localStorage per store+order ("new"
// for the new-order editor) and are cleared on successful save.

export type OrderDraftSnapshot = {
  /** The saved order's updatedAt this draft was based on (stale check). */
  orderUpdatedAt: string;
  savedAt: string;
  orderId?: string;
  orderCreatedAt?: string;
  expectedRevision?: number | null;
  mutationId?: string;
  mutationPayload?: string;
  customerId: string;
  customerQuery: string;
  lines: unknown[];
  deposit: string;
  promisedDate: string;
  orderStatus: OrderStatus;
  notes: string;
};

export function orderDraftKey(storeId: string, orderId: string, isNew: boolean, userId = "demo"): string {
  return `store_os_order_draft_v3::${userId}::${storeId}::${isNew ? "new" : orderId}`;
}

/**
 * Load a persisted editor draft. Returns null when there is none, when it is
 * corrupt, or when the saved order moved past it (another device saved a newer
 * version — restoring our older capture would silently revert their work).
 */
export function loadOrderDraft(key: string, order: Pick<Order, "updatedAt" | "revision">, isNew: boolean): OrderDraftSnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<OrderDraftSnapshot>;
    if (!Array.isArray(draft.lines) || draft.lines.length === 0 || draft.lines.some((line) => {
      if (!line || typeof line !== "object") return true;
      const item = line as Record<string, unknown>;
      return ["key", "productName", "productQuery", "quantityText", "unitPriceText", "costText"].some((field) => typeof item[field] !== "string");
    })) return null;
    if (typeof draft.orderUpdatedAt !== "string" || typeof draft.customerId !== "string" ||
        typeof draft.customerQuery !== "string" || typeof draft.deposit !== "string" ||
        typeof draft.promisedDate !== "string" || typeof draft.notes !== "string" ||
        !["asked", "quoted", "confirmed", "preparing", "ready", "delivered", "cancelled"].includes(String(draft.orderStatus))) return null;
    if (!isNew && (draft.expectedRevision != null
      ? draft.expectedRevision !== (order.revision ?? 0)
      : draft.orderUpdatedAt !== order.updatedAt)) return null;
    return draft as OrderDraftSnapshot;
  } catch {
    return null; // corrupt draft: start clean
  }
}

export function saveOrderDraft(key: string, draft: OrderDraftSnapshot): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearOrderDraft(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
