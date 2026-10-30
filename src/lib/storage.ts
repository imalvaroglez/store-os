import type { Order, OrderStatus } from "../types";

const LEGACY_ADMIN_STATE_KEY = "store_os_state_v1";
export const ACTIVE_STORE_KEY = "store_os_active_store_v1";

/** Remove the former full administrative snapshot without touching other keys. */
export function retireLegacyAdminState(): boolean {
  try {
    window.localStorage.removeItem(LEGACY_ADMIN_STATE_KEY);
    return true;
  } catch {
    return false;
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

export function orderDraftKey(storeId: string, orderId: string, isNew: boolean, userId: string): string {
  if (!userId.trim()) throw new Error("El borrador requiere una sesión autenticada.");
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
