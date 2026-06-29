import type { AppState } from "../types";
import { buildSeedState } from "./seed";

export const STORAGE_KEY = "store_os_state_v1";

// ponytail: whole-state load/save. Simpler than per-entity keys; local-first so size is tiny.
// When Firebase lands later, swap this adapter; the reducer/UI shape stays.

// In a built deployment we never auto-seed demo data into a visitor's browser —
// a signed-out visitor with empty storage should reach the AuthScreen, not a demo.
// In dev/tests (import.meta.env.DEV) the seed keeps the local demo working.
function emptyState(): AppState {
  return { stores: [], activeStoreId: null, products: [], customers: [], orders: [] };
}

function freshState(): AppState {
  return import.meta.env.DEV ? buildSeedState() : emptyState();
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
    return normalizeState(parsed);
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
    customers: s?.customers ?? [],
    orders: s?.orders ?? [],
  };
}
