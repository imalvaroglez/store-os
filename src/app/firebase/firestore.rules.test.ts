import { describe, it, beforeAll } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";

let env: RulesTestEnvironment;

const PROJ = "store-os-demo";

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

describe("G-P02 super_admin cannot read data PII by role", () => {
  it("super_admin (not a member) cannot read customers/orders of s1", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "users/admin"), { email: "admin@store.os", role: "super_admin" });
      await setDoc(doc(c.firestore(), "customers/c1"), { storeId: "s1", name: "x", phone: "555" });
      await setDoc(doc(c.firestore(), "orders/o1"), { storeId: "s1", productName: "x" });
    });
    const db = await asUser("admin"); // role super_admin
    await assertFails(getDoc(doc(db, "customers/c1")));
    await assertFails(getDoc(doc(db, "orders/o1")));
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

// Reproduce the super_admin "permission-denied" bug: the client subscribes to a
// BARE products collection (no where()) for super_admin, but the products rule
// is `read: if isMember(resource.data.storeId)` — a resource.data-dependent rule.
// Firestore ("rules are not filters") cannot validate a bare query against such
// a rule and rejects the whole query. This pins the bug before the fix.
describe("G-P02 super_admin bare-collection query on resource.data rule (bug repro)", () => {
  it("super_admin who IS a member: bare collection(products) query is DENIED (the bug)", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s_x"), {
        storeId: "s_x",
        ownerUid: "u_admin",
        memberUids: ["u_admin"],
        name: "X",
      });
      await setDoc(doc(c.firestore(), "users/u_admin"), { email: "a@x", role: "super_admin" });
      await setDoc(doc(c.firestore(), "products/p1"), { storeId: "s_x", name: "Ring" });
    });
    const db = await asUser("u_admin");
    // Bare query (no where) — this is what subscribeCloudState does for super_admin.
    await assertFails(getDocs(collection(db, "products")));
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
