// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetListRestoreForTests, useListRestore } from "./listRestore";

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { value, configurable: true });
}

describe("useListRestore (#233)", () => {
  afterEach(() => {
    resetListRestoreForTests();
    setScrollY(0);
    vi.restoreAllMocks();
  });

  it("restores filters changed before unmounting", () => {
    const first = renderHook(() => useListRestore("orders", { filter: "all", query: "" }));
    act(() => first.result.current.setFilters({ filter: "unpaid", query: "aretes" }));
    first.unmount();

    const second = renderHook(() => useListRestore("orders", { filter: "all", query: "" }));
    expect(second.result.current.filters).toEqual({ filter: "unpaid", query: "aretes" });
    expect(second.result.current.hadSavedState).toBe(true);
  });

  it("keeps defaults when the list was never visited", () => {
    // Distinct key: RTL's auto-cleanup can re-save the previous case's key
    // AFTER this file's afterEach, so reuse would leak state into this test.
    const { result } = renderHook(() => useListRestore("never-visited", { filter: "all", query: "" }));
    expect(result.current.filters).toEqual({ filter: "all", query: "" });
    expect(result.current.hadSavedState).toBe(false);
  });

  it("captures scroll while mounted and restores it once", () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { value: scrollTo, configurable: true });

    const first = renderHook(() => useListRestore("orders", { filter: "all", query: "" }));
    setScrollY(640);
    act(() => window.dispatchEvent(new Event("scroll")));
    first.unmount();

    const second = renderHook(() => useListRestore("orders", { filter: "all", query: "" }));
    // Stub rAF BEFORE restoring: the apply is deferred (double rAF) so it
    // lands after same-commit focus restorations.
    const rafs: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { rafs.push(cb); return rafs.length; });
    const flushRafs = () => {
      const pending = [...rafs];
      rafs.length = 0;
      pending.forEach((cb) => cb(0));
    };
    let applied = 0;
    act(() => {
      applied = second.result.current.restoreScroll();
    });
    expect(applied).toBe(640);
    expect(scrollTo).not.toHaveBeenCalled(); // still deferred
    act(() => { flushRafs(); flushRafs(); });
    expect(scrollTo).toHaveBeenCalledWith({ top: 640 });
    // The tracker re-syncs to the applied target so a later unmount saves it.
    expect(second.result.current).toBeTruthy();
    // Idempotent: a repeated restore re-applies the SAME target (the tracker
    // re-syncs after applying), never a zero or a stale position.
    act(() => { flushRafs(); flushRafs(); second.result.current.restoreScroll(); flushRafs(); flushRafs(); });
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenNthCalledWith(2, { top: 640 });
  });

  it("does not scroll when the list was at the top", () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { value: scrollTo, configurable: true });
    const { result } = renderHook(() => useListRestore("fresh", { query: "" }));
    act(() => result.current.restoreScroll());
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("useListRestore key change (#233)", () => {
  afterEach(() => {
    resetListRestoreForTests();
    setScrollY(0);
  });

  it("resets to defaults on a live key change so store-scoped filters never leak (store switch)", () => {
    // Simulate two stores' product lists with different saved state.
    const first = renderHook(({ key }) => useListRestore(key, { restockOnly: false as boolean, query: "" }), {
      initialProps: { key: "products:store-a" },
    });
    act(() => first.result.current.setFilters({ restockOnly: true, query: "anillo" }));
    first.unmount();

    const second = renderHook(({ key }) => useListRestore(key, { restockOnly: false as boolean, query: "" }), {
      initialProps: { key: "products:store-b" },
    });
    expect(second.result.current.filters).toEqual({ restockOnly: false, query: "" }); // defaults, no leak

    // Switch back with non-default filters ACTIVE on store B: the live key
    // change must reset them. Without this, the assertion below passed even
    // with the reset effect deleted (mutation-tested blind spot, #252).
    act(() => second.result.current.setFilters({ restockOnly: true, query: "aretes" }));
    act(() => second.rerender({ key: "products:store-a" })); // switch back to store A
    // A live key change resets (fresh view per list); restoration only happens
    // on a fresh MOUNT of the same key (returning from a detail/editor).
    expect(second.result.current.filters).toEqual({ restockOnly: false, query: "" });
  });
});
