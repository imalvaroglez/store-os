import type { AppState } from "../types";
import { migrateCatalog } from "./catalog";

export const STORAGE_KEY = "store_os_state_v1";

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
