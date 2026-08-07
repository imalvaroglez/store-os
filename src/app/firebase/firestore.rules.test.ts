import { describe, it, expect, beforeAll } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, setDoc, getDoc, updateDoc } from "firebase/firestore";

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
