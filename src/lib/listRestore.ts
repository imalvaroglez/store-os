import { useCallback, useEffect, useRef, useState } from "react";

// #233: returning from a detail/editor must land the operator exactly where
// they were — same list filters, same scroll position. Lists are in-memory
// (data loads at login), so a per-session module cache is enough; nothing is
// persisted to localStorage (preferences-only policy) and no query is re-run.

export type ListFilters = Record<string, string | number | boolean>;

type SavedListState = { filters: ListFilters; scrollY: number };

const savedLists = new Map<string, SavedListState>();

function merge(key: string, patch: Partial<SavedListState>): SavedListState {
  const current = savedLists.get(key) ?? { filters: {}, scrollY: 0 };
  const next = { ...current, ...patch };
  savedLists.set(key, next);
  return next;
}

/**
 * Session-scoped list state. `filters` re-hydrates on mount (merged over
 * `defaults`); scroll is tracked while mounted, saved on unmount, and
 * `restoreScroll()` applies it once, after the list has rendered.
 */
export function useListRestore<F extends ListFilters>(key: string, defaults: F) {
  const hadSavedState = useRef(false);
  const [filters, setFiltersState] = useState<F>(() => {
    const cached = savedLists.get(key);
    if (!cached) return defaults;
    hadSavedState.current = true;
    return { ...defaults, ...cached.filters } as F;
  });
  const scrollY = useRef(savedLists.get(key)?.scrollY ?? 0);

  // A key change means a DIFFERENT list on the same mounted screen (e.g.
  // switching store): the operator expects a fresh view for that list, never
  // the previous store's filters leaking in ("Por surtir" is store-scoped).
  // Restoration only applies when RETURNING to a list (same key, fresh mount).
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    hadSavedState.current = false;
    scrollY.current = 0;
    setFiltersState(defaults);
    merge(key, { filters: defaults as ListFilters, scrollY: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist filters as they change so even an unmount without cleanup (route
  // replace) keeps them.
  useEffect(() => {
    merge(key, { filters });
  }, [key, filters]);

  useEffect(() => {
    const onScroll = () => {
      scrollY.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      merge(key, { scrollY: scrollY.current });
    };
  }, [key]);

  const restoreScroll = useCallback(() => {
    const target = scrollY.current;
    scrollY.current = 0; // one-shot: later navigation starts from a clean slate
    console.log('[listRestore] restore', key, 'target', target);
    if (target > 0) {
      // Double rAF: land AFTER same-commit focus restorations (Dialog/Sheet
      // return focus to the opening control, which scrolls it into view).
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.scrollTo({ top: target });
        // A programmatic instant scroll may not fire the listener in every
        // engine; re-sync the tracker so a later unmount saves the real
        // position instead of the consumed zero.
        scrollY.current = target;
      }));
    }
    return target;
  }, []);

  return { filters, setFilters: setFiltersState, restoreScroll, hadSavedState: hadSavedState.current };
}

/** Test seam: wipe the session cache between cases. */
export function resetListRestoreForTests(): void {
  savedLists.clear();
}
