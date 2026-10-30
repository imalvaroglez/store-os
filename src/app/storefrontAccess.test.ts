import { describe, expect, it } from "vitest";
import type { RouteMatch } from "../lib/router";
import { canEditOliviaStorefront } from "./storefrontAccess";

const home: RouteMatch = { name: "public_store", params: { slug: "olivia" } };
const store = { slug: "olivia", ownerUid: "owner_1" };

describe("canEditOliviaStorefront", () => {
  it("allows only the signed-in owner on the Olivia home route", () => {
    expect(canEditOliviaStorefront(home, { uid: "owner_1" }, store)).toBe(true);
    expect(canEditOliviaStorefront(home, null, store)).toBe(false);
    expect(canEditOliviaStorefront(home, { uid: "member_1" }, store)).toBe(false);
    expect(canEditOliviaStorefront(home, { uid: "owner_1" }, { ...store, slug: "otra" })).toBe(false);
    expect(canEditOliviaStorefront({ name: "public_category", params: { slug: "olivia", categorySlug: "anillos" } }, { uid: "owner_1" }, store)).toBe(false);
  });
});
