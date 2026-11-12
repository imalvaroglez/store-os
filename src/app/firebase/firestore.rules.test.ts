import { describe, it, beforeAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { FIREBASE_DEV_PROJECT_ID } from "./projectIds";

let env: RulesTestEnvironment;

const PROJ = FIREBASE_DEV_PROJECT_ID;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJ,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

async function asUser(uid: string) {
  const ctx = env.authenticatedContext(uid);
  return ctx.firestore();
}

describe("G-P05 anonymous cannot write private collections", () => {
  it("anonymous cannot create a customer", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, "customers/c1"), { storeId: "s1", name: "x" }));
  });
  it("anonymous can read a public projection but cannot write it", async () => {
    const db = env.unauthenticatedContext().firestore();
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "publicStores/olivia"), { storeId: "s1" });
    });
    await assertSucceeds(getDoc(doc(db, "publicStores/olivia")));
    await assertFails(setDoc(doc(db, "publicStores/olivia"), { storeId: "s1" }));
  });

  // No enumeration: the apiKey is public in the bundle, so an anonymous LIST
  // would hand out the whole tenant directory and bulk-dump every catalog in
  // one request. Only gets-by-slug/id are public; the deploy-time prerender
  // lists via a rules-bypassing service account.
  it("anonymous cannot LIST the public collections (tenant enumeration)", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, "publicStores")));
    await assertFails(getDocs(collection(db, "publicCatalogs")));
    await assertFails(getDocs(collection(db, "publicProducts")));
  });

  // The client's projection prune queries publicProducts (where storeSlug ==)
  // as the signed-in owner — a fully denied list broke the storefront editor's
  // save (CI e2e caught it). Pin both sides of the contract.
  it("signed-in users CAN list publicProducts (client prune query)", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "publicProducts/s1__pieza"), { storeId: "s1", storeSlug: "olivia", name: "Pieza" });
    });
    const db = await asUser("u1");
    await assertSucceeds(getDocs(query(collection(db, "publicProducts"), where("storeSlug", "==", "olivia"))));
  });

  it("anonymous GET still works on every public collection", async () => {
    const db = env.unauthenticatedContext().firestore();
    await env.withSecurityRulesDisabled(async (c) => {
      const fs = c.firestore();
      await setDoc(doc(fs, "publicStores/olivia"), { storeId: "s1" });
      await setDoc(doc(fs, "publicCatalogs/olivia"), { storeId: "s1", categories: [], products: [] });
      await setDoc(doc(fs, "publicProducts/s1__pieza"), { storeId: "s1", name: "Pieza" });
    });
    await assertSucceeds(getDoc(doc(db, "publicStores/olivia")));
    await assertSucceeds(getDoc(doc(db, "publicCatalogs/olivia")));
    await assertSucceeds(getDoc(doc(db, "publicProducts/s1__pieza")));
  });
});

describe("G-P06 storeId invariance on update", () => {
  it("member cannot change storeId of a product to another store", async () => {
    // Seed: store s1 with member u1, a product in s1. Membership authority now
    // lives in adminStores (G-P02), so the canonical doc is seeded there too;
    // stores/s1 is kept as the derived business-doc seed for the store entity.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "stores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "products/p1"), { storeId: "s1", name: "x" });
    });
    const db = await asUser("u1");
    // Same-store update allowed:
    await assertSucceeds(updateDoc(doc(db, "products/p1"), { name: "y" }));
    // Cross-store update denied:
    await assertFails(updateDoc(doc(db, "products/p1"), { storeId: "s2" }));
  });
});

describe("publicProducts legacy storeId catch-22", () => {
  it("denies a legacy doc until an admin backfill adds storeId", async () => {
    const storeId = "s_public_legacy";
    const productPath = `publicProducts/${storeId}__collar`;
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), `adminStores/${storeId}`), {
        storeId,
        ownerUid: "u_public",
        memberUids: ["u_public"],
      });
      await setDoc(doc(c.firestore(), productPath), {
        name: "Collar",
        storeSlug: "olivia",
      });
    });

    const db = await asUser("u_public");
    await assertFails(updateDoc(doc(db, productPath), { name: "Collar legado" }));
    await assertFails(deleteDoc(doc(db, productPath)));

    await env.withSecurityRulesDisabled(async (c) => {
      await updateDoc(doc(c.firestore(), productPath), { storeId });
    });

    await assertSucceeds(updateDoc(doc(db, productPath), { name: "Collar reparado" }));
  });
});

describe("#176 users directory privacy", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users/u_a"), { email: "a@x.com", role: "member" });
      await setDoc(doc(c.firestore(), "users/u_b"), { email: "b@x.com", role: "member" });
      await setDoc(doc(c.firestore(), "users/u_sa"), { email: "sa@x.com", role: "super_admin" });
    });
  });

  it("a member can get only their own profile", async () => {
    const db = await asUser("u_a");
    await assertSucceeds(getDoc(doc(db, "users/u_a")));
  });

  it("a member cannot get another user's profile (cross-store identity exposure)", async () => {
    const db = await asUser("u_a");
    await assertFails(getDoc(doc(db, "users/u_b")));
  });

  it("a member cannot list the users directory (email enumeration)", async () => {
    const db = await asUser("u_a");
    await assertFails(getDocs(collection(db, "users")));
    await assertFails(
      getDocs(query(collection(db, "users"), where("email", "==", "b@x.com"), where("emailVerified", "==", true)))
    );
  });

  it("anonymous cannot read users at all", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "users/u_a")));
    await assertFails(getDocs(collection(db, "users")));
  });

  it("super_admin can get any profile and list the directory (PlatformUsersScreen)", async () => {
    const db = await asUser("u_sa");
    await assertSucceeds(getDoc(doc(db, "users/u_b")));
    await assertSucceeds(getDocs(collection(db, "users")));
  });
});

describe("G-P01 isolation between stores", () => {
  it("member of s1 cannot read s2's customer by known id", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "adminStores/s2"), { ownerUid: "u2", memberUids: ["u2"] });
      await setDoc(doc(c.firestore(), "customers/c2"), { storeId: "s2", name: "secret" });
    });
    const db = await asUser("u1");
    await assertFails(getDoc(doc(db, "customers/c2")));
  });
});

describe("G-P02 super_admin can operate any store by role", () => {
  it("super_admin (not a member) can read and update customers/orders of s1", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "users/admin"), { email: "admin@store.os", role: "super_admin" });
      await setDoc(doc(c.firestore(), "customers/c1"), { storeId: "s1", name: "x", phone: "555" });
      await setDoc(doc(c.firestore(), "orders/o1"), { storeId: "s1", productName: "x" });
    });
    const db = await asUser("admin"); // role super_admin
    await assertSucceeds(getDoc(doc(db, "customers/c1")));
    await assertSucceeds(getDoc(doc(db, "orders/o1")));
    await assertSucceeds(updateDoc(doc(db, "customers/c1"), { name: "y" }));
    await assertSucceeds(updateDoc(doc(db, "orders/o1"), { status: "new" }));
  });

  it("super_admin can operate every current store data collection", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s_all"), { ownerUid: "u_other", memberUids: ["u_other"] });
      await setDoc(doc(c.firestore(), "users/u_all"), { email: "a@x", role: "super_admin" });
      await setDoc(doc(c.firestore(), "products/p_all"), { storeId: "s_all", name: "Ring" });
      await setDoc(doc(c.firestore(), "categories/c_all"), { storeId: "s_all", name: "Jewelry" });
      await setDoc(doc(c.firestore(), "suppliers/s_all"), { storeId: "s_all", name: "Supplier" });
      await setDoc(doc(c.firestore(), "purchases/p_all"), { storeId: "s_all", status: "draft" });
    });

    const db = await asUser("u_all");
    for (const path of [
      "products/p_all",
      "categories/c_all",
      "suppliers/s_all",
      "purchases/p_all",
    ]) {
      await assertSucceeds(getDoc(doc(db, path)));
    }
    await assertSucceeds(updateDoc(doc(db, "products/p_all"), { name: "Ring updated" }));
    await assertSucceeds(updateDoc(doc(db, "categories/c_all"), { name: "Jewelry updated" }));
    await assertSucceeds(updateDoc(doc(db, "suppliers/s_all"), { name: "Supplier updated" }));
    await assertSucceeds(updateDoc(doc(db, "purchases/p_all"), { status: "ordered" }));
  });
  it("super_admin can read adminStores (control plane)", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { storeId: "s1", name: "Olivia", ownerUid: "u1", memberUids: ["u1"] });
    });
    const db = await asUser("admin");
    await assertSucceeds(getDoc(doc(db, "adminStores/s1")));
  });
});

// Regression guard for the batched-create path introduced in Task 8: the client
// writes `stores/{id}` and `adminStores/{id}` together in one writeBatch. Within
// a batched write, sibling writes are NOT visible to each other's rule
// evaluation (exists()/get() see the PRE-batch state), so both create rules must
// be self-sufficient on the owner-creator identity rather than consulting the
// not-yet-visible adminStores document. If either rule started calling
// isMember()/isOwner() again, this test would fail.
describe("G-P02 batched create — stores + adminStores in one batch", () => {
  it("#274 deny-list closed: member cannot write skuPrefix or retainedPrivacyRequestCount", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1", "u2"] });
      await setDoc(doc(c.firestore(), "stores/s1"), { ownerUid: "u1", memberUids: ["u1", "u2"], name: "Olivia", skuPrefix: "OL", retainedPrivacyRequestCount: 2 });
    });
    const db = await asUser("u2"); // member, not owner
    await assertFails(updateDoc(doc(db, "stores/s1"), { skuPrefix: "FAKE" }));
    await assertFails(updateDoc(doc(db, "stores/s1"), { retainedPrivacyRequestCount: 0 }));
    await assertFails(updateDoc(doc(db, "stores/s1"), { someFutureField: true }));
    // The allowed business-content fields keep working (regression).
    await assertSucceeds(
      updateDoc(doc(db, "stores/s1"), { packaging: { materials: [], byTier: {} }, updatedAt: "2026-11-09T00:00:00.000Z" })
    );
  });

  it("#274 an already-member with a stale self-invite cannot add someone else's uid", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const base = { ownerUid: "u1", memberUids: ["u1", "u2"], pendingInvites: ["member2@x.com"] };
      await setDoc(doc(c.firestore(), "adminStores/s1"), base);
      await setDoc(doc(c.firestore(), "stores/s1"), base);
    });
    const db = await asUser("u2"); // already a member, own email still pending
    await assertFails(
      updateDoc(doc(db, "stores/s1"), { memberUids: ["u1", "u2", "u_evil"], pendingInvites: [] })
    );
    // The legitimate fresh-invitee join is regression-tested by the
    // "reliable invitations" suite below (u_guest joins with the invite).
  });

  it("#253 a member can update ONLY the packaging field of their store", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1", "u2"] });
      await setDoc(doc(c.firestore(), "stores/s1"), { ownerUid: "u1", memberUids: ["u1", "u2"], name: "Olivia" });
    });
    const db = await asUser("u2"); // member, not owner
    await assertSucceeds(
      updateDoc(doc(db, "stores/s1"), {
        packaging: { materials: [], byTier: {} },
        updatedAt: "2026-11-09T00:00:00.000Z",
      })
    );
    // #254: pricing rules ride the same field-scoped exception.
    await assertSucceeds(
      updateDoc(doc(db, "stores/s1"), {
        pricingRules: { byTier: {} },
        updatedAt: "2026-11-09T00:00:00.000Z",
      })
    );
    // #280: the strategy screen's category band tables ride the same path —
    // three bands rules with shared limits under byCategory.
    await assertSucceeds(
      updateDoc(doc(db, "stores/s1"), {
        pricingRules: {
          byTier: { t_iconic: { kind: "markup", percent: 100 } },
          byCategory: {
            cat1: {
              t_retail: { kind: "bands", bands: [{ min: 0, max: 60, price: 290 }, { min: 60, price: 310 }], rounding: "none" },
              t_girly: { kind: "bands", bands: [{ min: 0, max: 60, price: 230 }, { min: 60, price: 260 }], rounding: "none" },
              t_iconic: { kind: "bands", bands: [{ min: 0, max: 60, price: 160 }, { min: 60, price: 170 }], rounding: "none" },
            },
          },
        },
        updatedAt: "2026-11-09T00:00:00.000Z",
      })
    );
    // A member of the store can read its rules back.
    await assertSucceeds(getDoc(doc(db, "stores/s1")));
    // Anything beyond the business-content fields stays owner-only.
    await assertFails(updateDoc(doc(db, "stores/s1"), { name: "Otra cosa" }));
    await assertFails(updateDoc(doc(db, "stores/s1"), { ownerUid: "u2" }));
    await assertFails(updateDoc(doc(db, "stores/s1"), { memberUids: ["u2"] }));
    // A stranger cannot touch even the packaging field.
    const stranger = await asUser("u3");
    await assertFails(
      updateDoc(doc(stranger, "stores/s1"), {
        packaging: { materials: [], byTier: {} },
        updatedAt: "2026-11-09T00:00:00.000Z",
      })
    );
    // #280: another store's member cannot READ Olivia's financial rules either.
    await assertFails(getDoc(doc(stranger, "stores/s1")));
  });

  it("owner can create stores/{id} and adminStores/{id} together", async () => {
    const db = await asUser("u1");
    const batch = writeBatch(db);
    batch.set(doc(db, "stores/s_new"), {
      ownerUid: "u1",
      memberUids: ["u1"],
      name: "New",
      slug: "new",
      type: "on_demand",
    });
    batch.set(doc(db, "adminStores/s_new"), {
      storeId: "s_new",
      ownerUid: "u1",
      memberUids: ["u1"],
      name: "New",
      slug: "new",
      type: "on_demand",
    });
    await assertSucceeds(batch.commit());
  });

  it("non-owner cannot create a store as someone else's in a batch", async () => {
    const db = await asUser("attacker");
    const batch = writeBatch(db);
    batch.set(doc(db, "stores/s_evil"), {
      ownerUid: "victim",
      memberUids: ["victim"],
      name: "Evil",
      slug: "evil",
      type: "on_demand",
    });
    batch.set(doc(db, "adminStores/s_evil"), {
      storeId: "s_evil",
      ownerUid: "victim",
      memberUids: ["victim"],
      name: "Evil",
      slug: "evil",
      type: "on_demand",
    });
    await assertFails(batch.commit());
  });
});

// Regression for the Olivia-disappears incident + the seed-dev defect: a store
// doc in `stores/{id}` with ownerUid/memberUids set is STILL unreadable if its
// canonical control-plane doc `adminStores/{id}` is missing, because
// isMember() requires exists(adminStores/{id}). This is exactly what happened
// when Espec 1 rules shipped and pre-existing stores had no adminStores, and
// again when seed-dev.cjs wrote stores/ but not adminStores/. This test pins
// the contract so a future seed/migration cannot recreate the half-visible
// store. The companion fix lives in scripts/seed-dev.cjs (writes both docs in
// one batch, mirroring the client's saveEntity writeBatch).
describe("G-P02 store without adminStores control-plane doc is unreadable", () => {
  it("member cannot read stores/{id} when adminStores/{id} is missing (the bug)", async () => {
    // Seed ONLY the data-plane doc (the buggy half-visible state). Use a
    // unique storeId so it isn't polluted by adminStores/s1 from other tests
    // (the emulator shares state across tests in this file). Use the
    // rules-disabled context for setup so seeding itself isn't blocked.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "stores/s_half_visible"), {
        ownerUid: "u_hv",
        memberUids: ["u_hv"],
        name: "Olivia",
        slug: "olivia",
        type: "inventory_tiered",
      });
    });
    // Deliberately do NOT write adminStores/s_half_visible.
    const db = await asUser("u_hv");
    await assertFails(getDoc(doc(db, "stores/s_half_visible")));
  });

  it("member can read stores/{id} once adminStores/{id} exists (the fix)", async () => {
    // Seed BOTH the control-plane and data-plane docs.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s_both"), {
        storeId: "s_both",
        ownerUid: "u_both",
        memberUids: ["u_both"],
        name: "Olivia",
      });
      await setDoc(doc(c.firestore(), "stores/s_both"), {
        ownerUid: "u_both",
        memberUids: ["u_both"],
        name: "Olivia",
        slug: "olivia",
        type: "inventory_tiered",
      });
    });
    const db = await asUser("u_both");
    await assertSucceeds(getDoc(doc(db, "stores/s_both")));
  });
});

// A super_admin's role is independent of resource.data, so the full collection
// query used by the cloud adapter is valid even when the store is not theirs.
describe("G-P02 super_admin bare-collection query", () => {
  it("super_admin can query products from stores they do not own", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s_x"), {
        storeId: "s_x",
        ownerUid: "u_other",
        memberUids: ["u_other"],
        name: "X",
      });
      await setDoc(doc(c.firestore(), "users/u_admin"), { email: "a@x", role: "super_admin" });
      await setDoc(doc(c.firestore(), "products/p1"), { storeId: "s_x", name: "Ring" });
    });
    const db = await asUser("u_admin");
    // Bare query (no where) — this is what the super_admin cloud adapter uses.
    await assertSucceeds(getDocs(collection(db, "products")));
  });

  it("same super_admin: query WITH where(storeId in [...]) on a member store is ALLOWED", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s_y"), {
        storeId: "s_y",
        ownerUid: "u_admin2",
        memberUids: ["u_admin2"],
        name: "Y",
      });
      await setDoc(doc(c.firestore(), "users/u_admin2"), { email: "a@y", role: "super_admin" });
      await setDoc(doc(c.firestore(), "products/p2"), { storeId: "s_y", name: "Necklace" });
    });
    const db = await asUser("u_admin2");
    await assertSucceeds(getDocs(query(collection(db, "products"), where("storeId", "in", ["s_y"]))));
  });
});


// Does super_admin bare-collection adminStores query work? (isSuperAdmin is not
// resource.data-dependent, so it SHOULD pass — unlike the products bare query.)
describe("G-P02 super_admin bare adminStores query", () => {
  it("super_admin can list adminStores (bare collection)", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users/u_sa"), { email: "sa@x", role: "super_admin" });
      await setDoc(doc(c.firestore(), "adminStores/s_sa"), { storeId: "s_sa", ownerUid: "u_sa", memberUids: ["u_sa"], name: "SA" });
    });
    const db = await asUser("u_sa");
    await assertSucceeds(getDocs(collection(db, "adminStores")));
  });
});

// ── reliable-member-invitations ────────────────────────────────────────
// Verified-email guard + anti-spoofing on users, invitee discovery via
// pendingInvites (canonical email), and the exact invitee join diff.

async function asUserWithClaims(uid: string, claims: Record<string, unknown>) {
  const ctx = env.authenticatedContext(uid, claims);
  return ctx.firestore();
}
const VERIFIED = { email: "a.b@gmail.com", email_verified: true };

describe("reliable invitations — users anti-spoofing", () => {
  it("self create with verified token and matching identity succeeds", async () => {
    const db = await asUserWithClaims("u_new", VERIFIED);
    await assertSucceeds(
      setDoc(doc(db, "users/u_new"), {
        email: "a.b@gmail.com", emailNormalized: "ab@gmail.com", emailVerified: true,
        displayName: "", role: "member",
      })
    );
  });
  it("rejects claiming someone else's email", async () => {
    const db = await asUserWithClaims("u_new2", VERIFIED);
    await assertFails(
      setDoc(doc(db, "users/u_new2"), {
        email: "victim@x.com", emailNormalized: "victim@x.com", emailVerified: true, role: "member",
      })
    );
  });
  it("rejects inconsistent emailNormalized and emailVerified=false", async () => {
    const db = await asUserWithClaims("u_new3", VERIFIED);
    await assertFails(
      setDoc(doc(db, "users/u_new3"), {
        email: "a.b@gmail.com", emailNormalized: "WRONG@gmail.com", emailVerified: true, role: "member",
      })
    );
    await assertFails(
      setDoc(doc(db, "users/u_new3"), {
        email: "a.b@gmail.com", emailNormalized: "ab@gmail.com", emailVerified: false, role: "member",
      })
    );
  });
  it("rejects a token without email_verified", async () => {
    const db = await asUserWithClaims("u_new4", { email: "a.b@gmail.com" });
    await assertFails(
      setDoc(doc(db, "users/u_new4"), {
        email: "a.b@gmail.com", emailNormalized: "ab@gmail.com", emailVerified: true, role: "member",
      })
    );
  });
  it("self-update changing identity fails; displayName update passes", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users/u_me"), {
        email: "a.b@gmail.com", emailNormalized: "ab@gmail.com", emailVerified: true, role: "member",
      });
    });
    const db = await asUserWithClaims("u_me", VERIFIED);
    await assertFails(updateDoc(doc(db, "users/u_me"), { email: "other@x.com" }));
    await assertFails(updateDoc(doc(db, "users/u_me"), { emailVerified: false }));
    await assertFails(updateDoc(doc(db, "users/u_me"), { role: "super_admin" }));
    await assertSucceeds(updateDoc(doc(db, "users/u_me"), { displayName: "Ana" }));
  });
  it("allowlisted verified admin can recover the super_admin role", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users/u_recover"), {
        email: "admin@store.os",
        emailNormalized: "admin@store.os",
        emailVerified: true,
        role: "member",
      });
    });
    const db = await asUserWithClaims("u_recover", { email: "admin@store.os", email_verified: true });
    await assertSucceeds(updateDoc(doc(db, "users/u_recover"), { role: "super_admin" }));
  });
  it("the PO's real account is allowlisted for super_admin (#353)", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users/u_po"), {
        email: "imalvaroglez@gmail.com",
        emailNormalized: "imalvaroglez@gmail.com",
        emailVerified: true,
        role: "member",
      });
    });
    const db = await asUserWithClaims("u_po", { email: "imalvaroglez@gmail.com", email_verified: true });
    await assertSucceeds(updateDoc(doc(db, "users/u_po"), { role: "super_admin" }));
    // Legitimate Gmail variants of the same mailbox behave identically —
    // canonical comparison on both sides (no "admin fantasma"). And the FIRST
    // login (no doc yet) goes through create, not update.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users/u_po3"), {
        email: "i.malvaroglez@gmail.com", emailNormalized: "imalvaroglez@gmail.com",
        emailVerified: true, role: "member",
      });
    });
    const dotted = await asUserWithClaims("u_po3", { email: "i.malvaroglez@gmail.com", email_verified: true });
    await assertSucceeds(updateDoc(doc(dotted, "users/u_po3"), { role: "super_admin" }));
    const fresh = await asUserWithClaims("u_po4", { email: "imalvaroglez@googlemail.com", email_verified: true });
    await assertSucceeds(setDoc(doc(fresh, "users/u_po4"), {
      email: "imalvaroglez@googlemail.com", emailNormalized: "imalvaroglez@gmail.com",
      emailVerified: true, role: "super_admin",
    }));
    // An unverified token of the same email escalates nothing (fresh member doc:
    // the doc above is already super_admin, whose profile edits follow admin rules).
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users/u_po2"), {
        email: "imalvaroglez@gmail.com",
        emailNormalized: "imalvaroglez@gmail.com",
        emailVerified: true,
        role: "member",
      });
    });
    const unverified = await asUserWithClaims("u_po2", { email: "imalvaroglez@gmail.com", email_verified: false });
    await assertFails(updateDoc(doc(unverified, "users/u_po2"), { role: "super_admin" }));
  });
  it("admin cross-user update: role change ok, identity change denied", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users/u_sa2"), { email: "sa@x.com", role: "super_admin" });
      await setDoc(doc(c.firestore(), "users/u_other"), {
        email: "o@x.com", emailNormalized: "o@x.com", emailVerified: true, role: "member",
      });
    });
    const db = await asUserWithClaims("u_sa2", { email: "sa@x.com", email_verified: true });
    await assertSucceeds(updateDoc(doc(db, "users/u_other"), { role: "member" }));
    await assertFails(updateDoc(doc(db, "users/u_other"), { email: "hijack@x.com" }));
  });
});

describe("reliable invitations — invitee discovery + join", () => {
  beforeAll(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const fs = c.firestore();
      await setDoc(doc(fs, "stores/s_inv"), {
        ownerUid: "u_owner", memberUids: ["u_owner"], pendingInvites: ["ab@gmail.com"],
      });
      await setDoc(doc(fs, "adminStores/s_inv"), {
        storeId: "s_inv", ownerUid: "u_owner", memberUids: ["u_owner"], pendingInvites: ["ab@gmail.com"],
      });
    });
  });

  it("canonical email matches across Gmail dots/case (no TS/Rules drift)", async () => {
    // Token says A.B@Googlemail.com — canonical ab@gmail.com must hit the invite.
    const db = await asUserWithClaims("u_guest", { email: "A.B@Googlemail.com", email_verified: true });
    await assertSucceeds(
      getDocs(query(collection(db, "stores"), where("pendingInvites", "array-contains", "ab@gmail.com")))
    );
  });

  it("unverified or uninvited users cannot list invited stores", async () => {
    const unverified = await asUserWithClaims("u_guest", { email: "A.B@gmail.com" });
    await assertFails(
      getDocs(query(collection(unverified, "stores"), where("pendingInvites", "array-contains", "ab@gmail.com")))
    );
    const stranger = await asUserWithClaims("u_stranger", { email: "z@x.com", email_verified: true });
    await assertFails(
      getDocs(query(collection(stranger, "stores"), where("pendingInvites", "array-contains", "ab@gmail.com")))
    );
  });

  it("invitee join: exact two-doc batch succeeds", async () => {
    const db = await asUserWithClaims("u_guest", VERIFIED);
    const batch = writeBatch(db);
    batch.update(doc(db, "stores/s_inv"), {
      memberUids: ["u_owner", "u_guest"], pendingInvites: [],
    });
    batch.update(doc(db, "adminStores/s_inv"), {
      memberUids: ["u_owner", "u_guest"], pendingInvites: [],
    });
    await assertSucceeds(batch.commit());
  });

  it("after joining, the new member can read the store; escalation attempts fail", async () => {
    const db = await asUserWithClaims("u_guest", VERIFIED);
    await assertSucceeds(getDoc(doc(db, "stores/s_inv")));
    // Re-seed pending state to probe bad diffs.
    await env.withSecurityRulesDisabled(async (c) => {
      const fs = c.firestore();
      await setDoc(doc(fs, "stores/s_inv"), { ownerUid: "u_owner", memberUids: ["u_owner"], pendingInvites: ["ab@gmail.com"] });
      await setDoc(doc(fs, "adminStores/s_inv"), { storeId: "s_inv", ownerUid: "u_owner", memberUids: ["u_owner"], pendingInvites: ["ab@gmail.com"] });
    });
    // Escalate ownerUid alongside the join → denied.
    await assertFails(
      updateDoc(doc(db, "stores/s_inv"), {
        ownerUid: "u_guest", memberUids: ["u_owner", "u_guest"], pendingInvites: [],
      })
    );
    // Adding someone ELSE'S uid instead of their own → denied.
    await assertFails(
      updateDoc(doc(db, "stores/s_inv"), {
        memberUids: ["u_owner", "u_other"], pendingInvites: [],
      })
    );
    // Keeping the invite (not removing it) → denied.
    await assertFails(
      updateDoc(doc(db, "stores/s_inv"), {
        memberUids: ["u_owner", "u_guest"], pendingInvites: ["ab@gmail.com"],
      })
    );
  });

  it("owner path has no regression (owner can still update members)", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users/u_owner2"), { email: "own@x.com", emailNormalized: "own@x.com", emailVerified: true, role: "member" });
    });
    const db = await asUserWithClaims("u_owner", { email: "own@x.com", email_verified: true });
    await assertSucceeds(updateDoc(doc(db, "stores/s_inv"), { name: "Renamed" }));
  });
});

describe("purchase-ux2 — bulk batch: products + purchase in one writeBatch", () => {
  it("member of s1 can create 50 products + the purchase that links them", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "stores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
    });
    const db = await asUser("u1");
    const batch = writeBatch(db);
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `bulk_p_${i}`;
      ids.push(id);
      batch.set(doc(db, "products", id), { storeId: "s1", name: `Pieza ${i}`, cost: 20 + i, status: "draft" });
    }
    batch.set(doc(db, "purchases/bulk1"), {
      storeId: "s1",
      lines: ids.map((id, i) => ({ productId: id, name: `Pieza ${i}`, quantity: 1, unitCost: 20 + i })),
      status: "draft",
    });
    await assertSucceeds(batch.commit());
  });

  it("batch fails when a product belongs to another store (G-P01)", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s2"), { ownerUid: "u2", memberUids: ["u2"] });
      await setDoc(doc(c.firestore(), "stores/s2"), { ownerUid: "u2", memberUids: ["u2"] });
      await setDoc(doc(c.firestore(), "products/foreign"), { storeId: "s2", name: "ajena" });
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "stores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
    });
    const db = await asUser("u1"); // member of s1 only
    const batch = writeBatch(db);
    batch.set(doc(db, "products/mine"), { storeId: "s1", name: "propia", status: "draft" });
    batch.set(doc(db, "products/foreign2"), { storeId: "s2", name: "ajena nueva", status: "draft" });
    batch.set(doc(db, "purchases/bulk2"), { storeId: "s1", lines: [], status: "draft" });
    await assertFails(batch.commit());
  });

  it("member of s1 cannot create a purchase for s2", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s2"), { ownerUid: "u2", memberUids: ["u2"] });
      await setDoc(doc(c.firestore(), "stores/s2"), { ownerUid: "u2", memberUids: ["u2"] });
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "stores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
    });
    const db = await asUser("u1");
    await assertFails(setDoc(doc(db, "purchases/xstore"), { storeId: "s2", lines: [], status: "draft" }));
  });
});

describe("purchase-ux2 — received purchases are immutable evidence", () => {
  it("member cannot delete a received purchase", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "stores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "purchases/recv1"), { storeId: "s1", status: "received", receivedAt: "2026-08-20T00:00:00Z" });
    });
    const db = await asUser("u1");
    await assertFails(deleteDoc(doc(db, "purchases/recv1")));
  });

  it("member cannot update a received purchase", async () => {
    const db = await asUser("u1");
    await assertFails(updateDoc(doc(db, "purchases/recv1"), { notes: "x" }));
  });

  // FER-02 (#126): the ONLY mutation allowed on received evidence is appending
  // a post-reception expense adjustment — a report-only field that never feeds
  // stock, product cost or the supplier document.
  it("member can append a post-reception expense adjustment", async () => {
    const db = await asUser("u1");
    await assertSucceeds(updateDoc(doc(db, "purchases/recv1"), {
      saleCostAdjustments: [{
        id: "adj1", at: "2026-11-02T00:00:00Z", category: "customer_delivery", amount: 25,
        allocations: [{ lineId: "line", saleExpenseCents: 2500 }],
      }],
      updatedAt: "2026-11-02T00:00:00Z",
    }));
  });

  it("an adjustment cannot smuggle changes to the received evidence", async () => {
    const db = await asUser("u1");
    await assertFails(updateDoc(doc(db, "purchases/recv1"), {
      saleCostAdjustments: [{ id: "adj2", at: "2026-11-02T00:00:00Z", category: "other", amount: 1 }],
      notes: "x",
    }));
    await assertFails(updateDoc(doc(db, "purchases/recv1"), { status: "draft" }));
  });

  it("the receive transaction itself can mark a purchase received (update draft → received)", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "purchases/draft1"), { storeId: "s1", status: "ready" });
    });
    const db = await asUser("u1");
    await assertSucceeds(updateDoc(doc(db, "purchases/draft1"), { status: "received", receivedAt: "2026-08-20T00:00:00Z" }));
  });
});

describe("#184 loose expenses (expenses collection)", () => {
  const expense = { storeId: "exp-store", amount: 15, date: "2026-11-06", category: "operation", createdAt: "2026-11-06T10:00:00Z", updatedAt: "2026-11-06T10:00:00Z" };

  it("a member of the store registers, updates and deletes their expense", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "users/exp-user"), { role: "member" });
      await setDoc(doc(c.firestore(), "adminStores/exp-store"), { ownerUid: "exp-user", memberUids: ["exp-user"] });
    });
    const db = await asUser("exp-user");
    await assertSucceeds(setDoc(doc(db, "expenses/exp-1"), { ...expense, id: "exp-1" }));
    await assertSucceeds(updateDoc(doc(db, "expenses/exp-1"), { description: "Gasolina", updatedAt: "2026-11-06T11:00:00Z" }));
    await assertSucceeds(deleteDoc(doc(db, "expenses/exp-1")));
  });

  it("the original amount and date are evidence: an update cannot rewrite them", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "expenses/exp-2"), { ...expense, id: "exp-2" });
    });
    const db = await asUser("exp-user");
    await assertFails(updateDoc(doc(db, "expenses/exp-2"), { amount: 5 }));
    await assertFails(updateDoc(doc(db, "expenses/exp-2"), { date: "2026-10-01" }));
  });

  it("never crosses stores (read or write)", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      // A expense of ANOTHER store (exp-user is not a member there).
      await setDoc(doc(c.firestore(), "adminStores/other-store"), { ownerUid: "someone", memberUids: ["someone"] });
      await setDoc(doc(c.firestore(), "expenses/exp-3"), { ...expense, id: "exp-3", storeId: "other-store" });
    });
    const db = await asUser("exp-user");
    await assertFails(getDoc(doc(db, "expenses/exp-3")));
    await assertFails(setDoc(doc(db, "expenses/exp-4"), { ...expense, id: "exp-4", storeId: "other-store" }));
  });
});


describe("legacy deposit cannot rise after payment evidence (#218)", () => {
  beforeAll(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/deposit-218-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/deposit-218-store"), { ownerUid: "deposit-218-user", memberUids: ["deposit-218-user"] });
      await setDoc(doc(ctx.firestore(), "orders/deposit-218-acc"), { storeId: "deposit-218-store", deposit: 590, paymentsReceivedCents: 59000 });
      await setDoc(doc(ctx.firestore(), "orders/deposit-218-marker"), { storeId: "deposit-218-store", deposit: 590, paymentsReceivedCents: 59000, inheritedDepositMaterialized: true });
      await setDoc(doc(ctx.firestore(), "orders/deposit-218-zero"), { storeId: "deposit-218-store", paymentsReceivedCents: 0 });
    });
  });
  it("rejects raw increases and removal, permits lowering an unmaterialized deposit", async () => {
    const db = await asUser("deposit-218-user");
    const ref = doc(db, "orders/deposit-218-acc");
    await assertFails(updateDoc(ref, { deposit: 720 }));
    await assertFails(setDoc(ref, { storeId: "deposit-218-store", paymentsReceivedCents: 59000 }));
    // #271 (PO 2026-11-09): the raw lowering is no longer silent either — it
    // requires the signed correction entry (from/to/note/author) in the same
    // write; the end-to-end path is covered in the orderPayments suite.
    // Forged variants FIRST (the doc is still pristine at deposit 590).
    await assertFails(updateDoc(ref, { deposit: 0 }));
    await assertFails(updateDoc(ref, { deposit: 0, depositCorrections: [{ from: 590, to: 0, note: "No fui yo", by: "someone-else", at: "2026-11-09T00:00:00.000Z" }] }));
    await assertFails(updateDoc(ref, { deposit: 0, depositCorrections: [{ from: 999, to: 0, note: "Monto inventado", by: "deposit-218-user", at: "2026-11-09T00:00:00.000Z" }] }));
    await assertFails(updateDoc(ref, { deposit: 0, depositCorrections: [{ from: 590, to: 0, note: "   ", by: "deposit-218-user", at: "2026-11-09T00:00:00.000Z" }] }));
    // Review probes: the trail cannot be rewritten or fabricated without a
    // real lowering — same-size swap, silent append, and cover edit inside a
    // common edit are all denied.
    await assertFails(updateDoc(ref, { depositCorrections: [{ from: 999, to: 0, note: "Falsificado", by: "attacker", at: "2026-11-09T00:00:00.000Z" }] }));
    await assertFails(updateDoc(ref, { depositCorrections: [{ from: 590, to: 590, note: "Nunca pasó", by: "deposit-218-user", at: "2026-11-09T00:00:00.000Z" }] }));
    await assertFails(updateDoc(ref, { notes: "edición común", depositCorrections: [{ from: 999, to: 0, note: "Encubierto", by: "deposit-218-user", at: "2026-11-09T00:00:00.000Z" }] }));
    // The legitimate signed lowering passes — and afterwards the trail is
    // frozen verbatim (no same-size rewrite, no strip).
    await assertSucceeds(updateDoc(ref, {
      deposit: 0,
      depositCorrections: [{ from: 590, to: 0, note: "Depósito duplicado: el cobro ya lo cubre", by: "deposit-218-user", at: "2026-11-09T00:00:00.000Z" }],
    }));
    await assertFails(updateDoc(ref, { depositCorrections: [] }));
    await assertFails(updateDoc(ref, { depositCorrections: [{ from: 590, to: 0, note: "Reescrito", by: "deposit-218-user", at: "2026-11-10T00:00:00.000Z" }] }));
    await assertSucceeds(updateDoc(ref, { notes: "edición común sin tocar dinero" }));
    await assertFails(updateDoc(doc(db, "orders/deposit-218-zero"), { deposit: 1 }));
    await assertSucceeds(updateDoc(doc(db, "orders/deposit-218-zero"), { deposit: 0 }));
  });
  it("freezes a materialized deposit in both directions but permits unrelated edits", async () => {
    const db = await asUser("deposit-218-user");
    const ref = doc(db, "orders/deposit-218-marker");
    await assertFails(updateDoc(ref, { deposit: 0 }));
    await assertFails(updateDoc(ref, { deposit: 720 }));
    await assertSucceeds(updateDoc(ref, { notes: "Sin cambiar dinero" }));
  });
  it("keeps creation with an anticipo and edits without evidence legal", async () => {
    const db = await asUser("deposit-218-user");
    const ref = doc(db, "orders/deposit-218-create");
    await assertSucceeds(setDoc(ref, { storeId: "deposit-218-store", deposit: 590 }));
    await assertSucceeds(updateDoc(ref, { deposit: 720 }));
  });
});

// #333: the delivery ledger is append-only evidence — verbatim carries pass,
// one well-formed signed event per write passes, rewrites and fabrications
// fail, and delivered orders cannot be deleted.
describe("#333 delivery ledger append-only", () => {
  const STORE = "delivery-333-store";
  const ORDER = "delivery-333-order";

  async function seed(orderData: Record<string, unknown> = {}) {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/" + STORE), { ownerUid: "u333", memberUids: ["u333"] });
      await setDoc(doc(c.firestore(), `orders/${ORDER}`), { storeId: STORE, ...orderData });
    });
  }

  const event = (over: Record<string, unknown> = {}) => ({
    id: "dev-1",
    orderId: ORDER,
    storeId: STORE,
    deliveredAt: "2026-11-12",
    recordedAt: "2026-11-12T10:00:00.000Z",
    by: "u333",
    lines: [{ productId: "p1", quantity: 2 }],
    ...over,
  });

  it("un append bien formado y firmado pasa; el carry verbatim pasa", async () => {
    await seed();
    const db = await asUser("u333");
    const ref = doc(db, "orders/" + ORDER);
    await assertSucceeds(updateDoc(ref, { deliveries: [event()] }));
    // A later ordinary edit keeps the ledger verbatim.
    await assertSucceeds(updateDoc(ref, { notes: "edit", deliveries: [event()] }));
  });

  it("reescribir o borrar el ledger falla; sin firma del autor falla", async () => {
    await seed({ deliveries: [event()] });
    const db = await asUser("u333");
    const ref = doc(db, "orders/" + ORDER);
    await assertFails(updateDoc(ref, { deliveries: [event({ deliveredAt: "2026-11-01" })] })); // reescritura
    await assertFails(updateDoc(ref, { deliveries: [] })); // borrado
    // Reescribir el historial DETRÁS de un append genuino también falla (el
    // prefijo ya no es el mismo; verificación spot-check del primer elemento).
    await assertFails(updateDoc(ref, { deliveries: [event({ deliveredAt: "2026-11-01" }), event({ id: "dev-2" })] }));
    const other = await asUser("u_other");
    await assertFails(updateDoc(doc(other, "orders/" + ORDER), { deliveries: [event({ id: "dev-3" }), event()] }));
  });

  it("reescribir un evento PREVIO detrás de un append genuino es denegado (hasAll, P2 revisión)", async () => {
    await seed({ deliveries: [event(), event({ id: "dev-2" })] });
    const db = await asUser("u333");
    await assertFails(
      // The last previous event is rewritten (quantity 99) behind a real append.
      updateDoc(doc(db, "orders/" + ORDER), {
        deliveries: [event(), event({ id: "dev-2", lines: [{ productId: "p1", quantity: 99 }] }), event({ id: "dev-3" })],
      })
    );
    // The honest append still passes.
    await assertSucceeds(updateDoc(doc(db, "orders/" + ORDER), { deliveries: [event(), event({ id: "dev-2" }), event({ id: "dev-3" })] }));
  });

  it("un evento con fecha efectiva basura (2099) es denegado por las reglas", async () => {
    await seed({ deliveries: [event()] });
    const db = await asUser("u333");
    await assertFails(
      updateDoc(doc(db, "orders/" + ORDER), { deliveries: [event(), event({ id: "dev-junk", deliveredAt: "2099-12-31" })] })
    );
  });

  it("crear un pedido con entregas fabricadas falla; borrar un pedido con entregas falla", async () => {
    await seed({ deliveries: [event()] });
    const db = await asUser("u333");
    await assertFails(setDoc(doc(db, "orders/delivery-333-new"), { storeId: STORE, deliveries: [event({ orderId: "delivery-333-new" })] }));
    await assertFails(deleteDoc(doc(db, "orders/" + ORDER)));
  });
});
