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
  const [state, setState] = useState<{ key: string; filters: F }>(() => {
    const cached = savedLists.get(key);
    if (!cached) return { key, filters: defaults };
    hadSavedState.current = true;
    return { key, filters: { ...defaults, ...cached.filters } as F };
  });
  const scrollY = useRef(savedLists.get(key)?.scrollY ?? 0);

  // A key change means a DIFFERENT list on the same mounted screen (e.g.
  // switching store): the operator expects a fresh view for that list, never
  // the previous store's filters leaking in ("Por surtir" is store-scoped).
  // Restoration only applies when RETURNING to a list (same key, fresh mount).
  // #346: the reset happens DURING the render that first sees the new key
  // (React's adjust-state-when-props-change pattern). The previous effect-
  // based reset could flush LATE — after a filter applied against the new
  // key — silently reverting it: the CI flake where the filtered list never
  // settled. In-render there is no window: the reset lands in the very commit
  // that carries the new key, before any interaction with it.
  if (state.key !== key) {
    hadSavedState.current = false;
    scrollY.current = 0;
    setState({ key, filters: defaults });
  }

  // Persist filters as they change so even an unmount without cleanup (route
  // replace) keeps them.
  useEffect(() => {
    merge(key, { filters: state.filters });
  }, [key, state.filters]);

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
    if (target > 0) {
      // #463: land the position and VERIFY it stuck. Late agents (the route
      // reset on navigation, a Dialog/Sheet focus-return scrolling its
      // trigger into view) can zero the document after the first landing;
      // a fixed double-rAF lost that race 3 of 5 times in QA. Re-landing on
      // the next frame until the document actually holds the target makes
      // the restoration deterministic — bounded so a pathological page can
      // never loop forever.
      let attempts = 0;
      const land = () => {
        attempts += 1;
        window.scrollTo({ top: target });
        // A programmatic instant scroll may not fire the listener in every
        // engine; re-sync the tracker so a later unmount saves the real
        // position instead of the consumed zero.
        scrollY.current = target;
        requestAnimationFrame(() => {
          if (Math.abs(window.scrollY - target) > 1 && attempts < 12) land();
        });
      };
      // Double rAF before the first landing: land AFTER same-commit focus
      // restorations (Dialog/Sheet return focus to the opening control,
      // which scrolls it into view).
      requestAnimationFrame(() => requestAnimationFrame(land));
    }
    return target;
  }, []);

  // The setter keeps accepting values AND functional updates (screens use
  // both shapes); the key rides along so the render-phase check above only
  // compares against the key the filters belong to.
  const setFilters = useCallback((update: F | ((prev: F) => F)) => {
    setState((prev) => ({
      key: prev.key,
      filters: typeof update === "function" ? (update as (prevFilters: F) => F)(prev.filters) : update,
    }));
  }, []);

  return { filters: state.filters, setFilters, restoreScroll, hadSavedState: hadSavedState.current };
}

/** Test seam: wipe the session cache between cases. */
export function resetListRestoreForTests(): void {
  savedLists.clear();
}
