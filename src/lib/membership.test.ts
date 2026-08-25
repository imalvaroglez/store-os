import { describe, expect, it } from "vitest";
import { storeWithMembership, invitesNeedBackfill } from "./membership";
import type { Store } from "../types";

const store = (o: Partial<Store> = {}): Store =>
  ({
    id: "store_1",
    name: "Tienda",
    slug: "tienda",
    type: "on_demand",
    createdAt: "",
    updatedAt: "",
    ...o,
  }) as Store;

const owner = { uid: "owner_uid" } as never;
const member = { uid: "member_uid" } as never;

describe("storeWithMembership (preserve semantics — regression: 2026-08-25 membership wipe)", () => {
  it("creates defaults for a brand-new store (no membership fields)", () => {
    const result = storeWithMembership(store(), owner);
    expect(result.ownerUid).toBe("owner_uid");
    expect(result.memberUids).toEqual(["owner_uid"]);
  });

  it("PRESERVES existing membership — never collapses to the current user", () => {
    const existing = store({ ownerUid: "owner_uid", memberUids: ["owner_uid", "member_uid"] });
    // The owner logs in on a store they own with another member.
    const byOwner = storeWithMembership(existing, owner);
    expect(byOwner.ownerUid).toBe("owner_uid");
    expect(byOwner.memberUids).toEqual(["owner_uid", "member_uid"]);
    // A MEMBER logs in on the same store (backfill/migration paths).
    const byMember = storeWithMembership(existing, member);
    expect(byMember.ownerUid).toBe("owner_uid"); // owner NOT reassigned
    expect(byMember.memberUids).toEqual(["owner_uid", "member_uid"]); // nobody dropped
  });

  it("keeps the current user in memberUids when absent (self-heal, never destructive)", () => {
    const existing = store({ ownerUid: "owner_uid", memberUids: ["owner_uid"] });
    const result = storeWithMembership(existing, member);
    expect(result.memberUids).toEqual(["owner_uid", "member_uid"]);
  });

  it("returns the store unchanged without a user", () => {
    const existing = store({ ownerUid: "owner_uid", memberUids: ["owner_uid"] });
    expect(storeWithMembership(existing, null)).toEqual(existing);
  });
});

describe("invitesNeedBackfill", () => {
  it("is false for already-canonical invites (no write fires)", () => {
    expect(invitesNeedBackfill(["a@b.com"])).toBe(false);
    expect(invitesNeedBackfill([])).toBe(false);
    expect(invitesNeedBackfill(undefined)).toBe(false);
  });
  it("is true for legacy non-normalized invites", () => {
    expect(invitesNeedBackfill(["A@B.com"])).toBe(true);
    expect(invitesNeedBackfill(["a@b.com", "a@b.com"])).toBe(true);
    expect(invitesNeedBackfill([" a@b.com "])).toBe(true);
  });
});
