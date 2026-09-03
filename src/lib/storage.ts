import type { AppState } from "../types";
import { migrateCatalog } from "./catalog";

export const STORAGE_KEY = "store_os_state_v1";
export const ACTIVE_STORE_KEY = "store_os_active_store_v1";
export const PUBLIC_ORDER_CLIENT_ID_KEY = "store-os:public-order-client-id";

// Test-only whole-state adapter. Runtime business data lives in Firestore.

// Fixtures for unit tests live here only; development data is seeded in the
// real store-os-dev Firebase project.
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
    // Corrupt test fixture -> reset to an empty test state.
    const seeded = emptyState();
    saveState(seeded);
    return seeded;
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full / unavailable: no-op. Firebase remains the runtime source.
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

/** Read/write the anonymous browser identifier used by the public-order rate limit. */
export function loadPublicOrderClientId(): string | null {
  try {
    return localStorage.getItem(PUBLIC_ORDER_CLIENT_ID_KEY);
  } catch {
    return null;
  }
}

export function savePublicOrderClientId(clientId: string): void {
  try {
    localStorage.setItem(PUBLIC_ORDER_CLIENT_ID_KEY, clientId);
  } catch {
    // Storage unavailable: the callable still applies its IP and daily limits.
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
