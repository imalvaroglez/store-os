import { describe, expect, it } from "vitest";
import { resolveStoreId } from "./publicCatalog";
import type { PublicStore } from "./publicCatalog";

// 2026-08-25 regression: prod's publicStores/olivia doc lacked storeId,
// breaking every product-detail page. The loader must fall back to
// publicCatalogs.storeId.
const store = (storeId?: string): PublicStore =>
  ({ slug: "olivia", storeId, name: "Olivia", type: "inventory_tiered" }) as PublicStore;

describe("resolveStoreId", () => {
  it("uses publicStores.storeId when present", () => {
    expect(resolveStoreId(store("store_olivia"), "fallback")).toBe("store_olivia");
  });
  it("falls back to publicCatalogs.storeId when the doc is stale", () => {
    expect(resolveStoreId(store(undefined), "store_olivia")).toBe("store_olivia");
  });
  it("returns undefined when neither has it (caller 404s)", () => {
    expect(resolveStoreId(store(undefined), undefined)).toBeUndefined();
  });
});
