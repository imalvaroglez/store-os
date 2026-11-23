// #538 — the Estrategia band-table draft survives the exits Fer actually
// takes (Diagnóstico, Inicio, another category, a reload of the same tab).
// localStorage is the sanctioned home for a draft tied to an authenticated
// person; Firestore keeps the SAVED table as the only source of truth until
// «Guardar tabla».
//
// Isolation is the storage key: person (uid) × store × category. Corrupt or
// foreign-shape data reads as "no draft" — the editor always starts healthy.

export type StrategyTableDraft = {
  limits: Array<{ min: number; max?: number }>;
  prices: Record<string, Array<number | null>>; // tierId -> price per band
  dirty: boolean;
};

type StoredStrategyDraft = { v: 1; draft: StrategyTableDraft; draftBase: string; savedAt: string };

const SCHEMA_VERSION = 1;

export function strategyDraftKey(uid: string, storeId: string, categoryId: string): string {
  return `store-os:strategy-draft:${uid}:${storeId}:${categoryId}`;
}

function isDraft(value: unknown): value is StrategyTableDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as StrategyTableDraft;
  return Array.isArray(draft.limits) && draft.limits.length > 0 && typeof draft.prices === "object";
}

export function loadStrategyDraft(uid: string, storeId: string, categoryId: string): StoredStrategyDraft | null {
  try {
    const raw = localStorage.getItem(strategyDraftKey(uid, storeId, categoryId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredStrategyDraft> | null;
    if (!parsed || parsed.v !== SCHEMA_VERSION || typeof parsed.draftBase !== "string" || !isDraft(parsed.draft)) {
      return null;
    }
    return { v: SCHEMA_VERSION, draft: parsed.draft, draftBase: parsed.draftBase, savedAt: parsed.savedAt ?? "" };
  } catch {
    return null; // corrupt JSON: discard and start clean
  }
}

export function saveStrategyDraft(uid: string, storeId: string, categoryId: string, draft: StrategyTableDraft, draftBase: string): void {
  // Best-effort like the public cart: a broken (read-only) localStorage must
  // never take the strategy editor down — persistence is lost, memory is true.
  try {
    localStorage.setItem(strategyDraftKey(uid, storeId, categoryId), JSON.stringify({ v: SCHEMA_VERSION, draft, draftBase, savedAt: new Date().toISOString() } satisfies StoredStrategyDraft));
  } catch {
    /* best-effort persistence */
  }
}

export function clearStrategyDraft(uid: string, storeId: string, categoryId: string): void {
  try {
    localStorage.removeItem(strategyDraftKey(uid, storeId, categoryId));
  } catch {
    /* nothing to clear on a broken storage */
  }
}
