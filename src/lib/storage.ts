import type { AppState } from "../types";
import { migrateCatalog } from "./catalog";

export const STORAGE_KEY = "store_os_state_v1";

// ponytail: whole-state load/save. Simpler than per-entity keys; local-first so size is tiny.
// When Firebase lands later, swap this adapter; the reducer/UI shape stays.

// A signed-out visitor (or a developer who hasn't logged in) with empty storage
// reaches the AuthScreen — we NEVER auto-seed demo stores (Olivia/Santi/Joyería)
// into the browser. Seeing phantom demo stores was confusing operators. Demo
// data is still available for tests via buildSeedState(); it just isn't loaded
// automatically into localStorage anymore. The resetDemo() action can still
// pull it in on demand from the UI.
function emptyState(): AppState {
  return { stores: [], activeStoreId: null, products: [], categories: [], suppliers: [], purchases: [], customers: [], orders: [] };
}

function freshState(): AppState {
  return emptyState();
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = freshState();
      saveState(seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw) as AppState;
    return migrateCatalog(normalizeState(parsed));
  } catch {
    // Corrupt state -> reset. Demo seed in dev, empty in production.
    const seeded = freshState();
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

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
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
