import type { Order, OrderStatus } from "../../types";

// Offline draft persistence for the order editor (E1 — R8: a 50-line capture
// must survive a lost connection / accidental close, clearly distinguishable
// from a confirmed save). Drafts live in localStorage per store+order ("new"
// for the new-order editor) and are cleared on successful save.

export type OrderDraftSnapshot = {
  /** The saved order's updatedAt this draft was based on (stale check). */
  orderUpdatedAt: string;
  savedAt: string;
  customerId: string;
  customerQuery: string;
  lines: unknown[];
  deposit: string;
  promisedDate: string;
  orderStatus: OrderStatus;
  notes: string;
};

export function orderDraftKey(storeId: string, orderId: string, isNew: boolean): string {
  return `store_os_order_draft_v2::${storeId}::${isNew ? "new" : orderId}`;
}

/** A draft is only worth restoring if it carries at least one meaningful line. */
function hasMeaningfulLine(lines: unknown[]): boolean {
  return lines.some((line) => {
    const candidate = (line ?? {}) as { productId?: unknown; productName?: unknown };
    if (typeof candidate.productId === "string" && candidate.productId.trim() !== "") return true;
    return typeof candidate.productName === "string" && candidate.productName.trim() !== "";
  });
}

/**
 * Load a persisted editor draft. Returns null when there is none, when it is
 * corrupt, or when the saved order moved past it (another device saved a newer
 * version — restoring our older capture would silently revert their work).
 */
export function loadOrderDraft(key: string, order: Pick<Order, "updatedAt">, isNew: boolean): OrderDraftSnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<OrderDraftSnapshot>;
    if (!Array.isArray(draft.lines) || !hasMeaningfulLine(draft.lines)) return null;
    if (typeof draft.orderUpdatedAt !== "string" || typeof draft.customerId !== "string") return null;
    if (!isNew && draft.orderUpdatedAt !== order.updatedAt) return null; // order is newer than the draft
    return draft as OrderDraftSnapshot;
  } catch {
    return null; // corrupt draft: start clean
  }
}

export function saveOrderDraft(key: string, draft: OrderDraftSnapshot): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage full/blocked: the draft is best-effort, never a hard failure.
  }
}

export function clearOrderDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // best-effort
  }
}
