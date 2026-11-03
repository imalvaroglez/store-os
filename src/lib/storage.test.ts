// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retireLegacyAdminState } from "./storage";

const LEGACY_ADMIN_STATE_KEY = "store_os_state_v1";

describe("retireLegacyAdminState", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("removes only the old administrative state and preserves other browser data", () => {
    localStorage.setItem(LEGACY_ADMIN_STATE_KEY, JSON.stringify({ stores: [{ name: "Señuelo" }] }));
    localStorage.setItem("store_os_active_store_v1", "store_olivia");
    localStorage.setItem("store_os_theme", "paper");
    localStorage.setItem("store-os:cart:olivia", JSON.stringify({ lines: [] }));
    localStorage.setItem("store_os_order_draft_v3::uid_fer::store_olivia::new", "draft");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");

    expect(retireLegacyAdminState()).toBe(true);

    expect(removeItem).toHaveBeenCalledTimes(1);
    expect(removeItem).toHaveBeenCalledWith(LEGACY_ADMIN_STATE_KEY);
    expect(localStorage.getItem(LEGACY_ADMIN_STATE_KEY)).toBeNull();
    expect(localStorage.getItem("store_os_active_store_v1")).toBe("store_olivia");
    expect(localStorage.getItem("store_os_theme")).toBe("paper");
    expect(localStorage.getItem("store-os:cart:olivia")).toBe(JSON.stringify({ lines: [] }));
    expect(localStorage.getItem("store_os_order_draft_v3::uid_fer::store_olivia::new")).toBe("draft");
  });

  it("reports a blocked cleanup without deleting unrelated keys", () => {
    localStorage.setItem(LEGACY_ADMIN_STATE_KEY, "private legacy data");
    localStorage.setItem("store_os_theme", "paper");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(retireLegacyAdminState()).toBe(false);
    expect(localStorage.getItem(LEGACY_ADMIN_STATE_KEY)).toBe("private legacy data");
    expect(localStorage.getItem("store_os_theme")).toBe("paper");
  });
});
