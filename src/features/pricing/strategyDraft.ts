// #538 — the Estrategia band-table draft survives the exits Fer actually
// takes (Diagnóstico, Inicio, another category, a reload of the same tab).
// localStorage is the sanctioned home for a draft tied to an authenticated
// person; Firestore keeps the SAVED table as the only source of truth until
// «Guardar tabla».
//
// Isolation is the storage key: person (uid) × store × category. Corrupt or
// foreign-shape data reads as "no draft" — the editor always starts healthy.
//
// Retention follows the order drafts' convention (storage.ts): keyed by the
// signed-in person, no expiry, not wiped on sign-out.

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

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Adapts a stored draft to the levels visible NOW. A level hidden after the
 * draft was stored leaves (its saved rule rides along untouched on save); one
 * un-hidden since starts as pending (null) — never as a price. Anything that
 * is not a sound band table reads as "no draft".
 */
export function normalizeStrategyDraft(draft: unknown, tierIds: string[]): StrategyTableDraft | null {
  if (!draft || typeof draft !== "object") return null;
  const source = draft as Partial<StrategyTableDraft>;
  if (!Array.isArray(source.limits) || source.limits.length === 0 || !source.prices || typeof source.prices !== "object") return null;
  const limits: Array<{ min: number; max?: number }> = [];
  for (const limit of source.limits) {
    if (!limit || !isFiniteNumber(limit.min) || limit.min < 0) return null;
    if (limit.max !== undefined && (!isFiniteNumber(limit.max) || limit.max < limit.min)) return null;
    limits.push(limit.max === undefined ? { min: limit.min } : { min: limit.min, max: limit.max });
  }
  const prices: Record<string, Array<number | null>> = {};
  for (const tierId of tierIds) {
    const stored = (source.prices as Record<string, unknown>)[tierId];
    prices[tierId] = limits.map((_, index) => {
      const value = Array.isArray(stored) ? stored[index] : undefined;
      return isFiniteNumber(value) && value >= 0 ? value : null;
    });
  }
  return { limits, prices, dirty: true };
}

export function loadStrategyDraft(uid: string, storeId: string, categoryId: string, tierIds: string[]): StoredStrategyDraft | null {
  try {
    const raw = localStorage.getItem(strategyDraftKey(uid, storeId, categoryId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredStrategyDraft> | null;
    if (!parsed || parsed.v !== SCHEMA_VERSION || typeof parsed.draftBase !== "string") return null;
    const draft = normalizeStrategyDraft(parsed.draft, tierIds);
    if (!draft) return null;
    return { v: SCHEMA_VERSION, draft, draftBase: parsed.draftBase, savedAt: parsed.savedAt ?? "" };
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
