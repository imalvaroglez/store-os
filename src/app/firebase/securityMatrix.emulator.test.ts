// #176 — Tenant-isolation security matrix: every administrative collection ×
// every role × every operation, against synthetic store A / store B data, plus
// direct-SDK attack probes that must fail closed. The matrix ENCODES the
// intended policy; any mismatch is a finding (either a rules defect or a
// stale expectation to re-derive from firestore.rules).
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, addDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

let env: RulesTestEnvironment;

const STORE_A = "sec-store-a";
const STORE_B = "sec-store-b";

// Minimal VALID docs per collection (content rules satisfied; the matrix is
// about WHO, and each write keeps within the collection's invariants).
const BUSINESS_DOCS: Array<{ name: string; path: (store: string) => string; doc: (store: string) => Record<string, unknown> }> = [
  { name: "products", path: (s) => `products/matrix-${s}`, doc: (s) => ({ storeId: s, name: "Pieza", notes: "x" }) },
  { name: "categories", path: (s) => `categories/matrix-${s}`, doc: (s) => ({ storeId: s, name: "Cat", slug: "cat" }) },
  { name: "suppliers", path: (s) => `suppliers/matrix-${s}`, doc: (s) => ({ storeId: s, name: "Prov" }) },
  { name: "expenses", path: (s) => `expenses/matrix-${s}`, doc: (s) => ({ storeId: s, amount: 10, date: "2026-11-10", createdAt: "2026-11-10T00:00:00.000Z", concept: "x" }) },
  { name: "purchases", path: (s) => `purchases/matrix-${s}`, doc: (s) => ({ storeId: s, status: "draft", lines: [] }) },
  { name: "customers", path: (s) => `customers/matrix-${s}`, doc: (s) => ({ storeId: s, name: "Clienta" }) },
  { name: "orders", path: (s) => `orders/matrix-${s}`, doc: (s) => ({ storeId: s, items: [], notes: "x", createdAt: "", updatedAt: "" }) },
];

type Ctx = "anon" | "memberA" | "memberB" | "superAdmin";
const UTILITY: Record<Ctx, string> = { anon: "", memberA: "sec-member-a", memberB: "sec-member-b", superAdmin: "sec-super" };

function dbOf(ctx: Ctx) {
  if (ctx === "anon") return env.unauthenticatedContext().firestore();
  return env.authenticatedContext(UTILITY[ctx]).firestore();
}

// Matrix expectation: can this context operate THIS store's business docs?
const CAN_OPERATE: Record<Ctx, (store: string) => boolean> = {
  anon: () => false,
  memberA: (s) => s === STORE_A,
  memberB: (s) => s === STORE_B,
  superAdmin: () => true,
};

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#176 security matrix — tenant isolation", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "users/sec-member-a"), { role: "member" });
      await setDoc(doc(fs, "users/sec-member-b"), { role: "member" });
      await setDoc(doc(fs, "users/sec-super"), { role: "super_admin" });
      // memberA is a NON-owner member (the owner path writes full docs via
      // setDoc; the partial-update evaluation quirk of the emulator would
      // otherwise deny for the wrong reason — same approach as #253/#274).
      await setDoc(doc(fs, `adminStores/${STORE_A}`), { ownerUid: "sec-owner-a", memberUids: ["sec-owner-a", "sec-member-a"] });
      await setDoc(doc(fs, `adminStores/${STORE_B}`), { ownerUid: "sec-member-b", memberUids: ["sec-member-b"] });
      for (const spec of BUSINESS_DOCS) {
        for (const store of [STORE_A, STORE_B]) {
          await setDoc(doc(fs, spec.path(store)), spec.doc(store));
        }
      }
    });
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  // ── THE GRID: read operations ─────────────────────────────────────────────
  for (const spec of BUSINESS_DOCS) {
    for (const ctx of ["anon", "memberA", "memberB", "superAdmin"] as Ctx[]) {
      it(`${ctx} GET ${spec.name} of store B — ${CAN_OPERATE[ctx](STORE_B) ? "allowed" : "DENIED"}`, async () => {
        const db = dbOf(ctx);
        const snap = getDoc(doc(db, spec.path(STORE_B)));
        if (CAN_OPERATE[ctx](STORE_B)) await expect(snap).resolves.toBeTruthy();
        else await expect(snap).rejects.toThrow();
      });
      it(`${ctx} LIST ${spec.name} where storeId == store B — ${CAN_OPERATE[ctx](STORE_B) ? "allowed" : "DENIED"}`, async () => {
        const db = dbOf(ctx);
        const listing = getDocs(query(collection(db, spec.name), where("storeId", "==", STORE_B)));
        if (CAN_OPERATE[ctx](STORE_B)) await expect(listing).resolves.toBeTruthy();
        else await expect(listing).rejects.toThrow();
      });
    }
  }

  // ── THE GRID: write operations on the FOREIGN store ───────────────────────
  for (const spec of BUSINESS_DOCS) {
    for (const ctx of ["anon", "memberA"] as Ctx[]) {
      it(`${ctx} UPDATE ${spec.name} of store B — DENIED`, async () => {
        const db = dbOf(ctx);
        await expect(updateDoc(doc(db, spec.path(STORE_B)), { notes: "ataque" })).rejects.toThrow();
      });
      it(`${ctx} DELETE ${spec.name} of store B — DENIED`, async () => {
        const db = dbOf(ctx);
        await expect(deleteDoc(doc(db, spec.path(STORE_B)))).rejects.toThrow();
      });
      it(`${ctx} CREATE ${spec.name} claiming storeId=B while store A is theirs — DENIED`, async () => {
        const db = dbOf(ctx);
        await expect(setDoc(doc(db, `${spec.name}/ataque-${UTILITY[ctx] || "anon"}`), { ...spec.doc(STORE_B), name: "ataque" })).rejects.toThrow();
      });
    }
  }

  // ── THE GRID: legitimate owner writes on OWN store stay possible ──────────
  for (const spec of BUSINESS_DOCS) {
    it(`memberA (owner) UPDATE/DELETE ${spec.name} of store A — allowed`, async () => {
      const db = dbOf("memberA");
      await expect(updateDoc(doc(db, spec.path(STORE_A)), { notes: "edición legítima" })).resolves.toBeUndefined();
      await expect(deleteDoc(doc(db, spec.path(STORE_A)))).resolves.toBeUndefined();
      // restore for later probes
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), spec.path(STORE_A)), spec.doc(STORE_A));
      });
    });
  }

  // ── stores (H2): settings collection in the grid ──────────────────────────
  it("memberB cannot read or hijack store A's settings document", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `stores/${STORE_A}`), { ownerUid: "sec-owner-a", memberUids: ["sec-owner-a", "sec-member-a"], name: "Tienda A" });
    });
    const db = dbOf("memberB");
    await expect(getDoc(doc(db, `stores/${STORE_A}`))).rejects.toThrow();
    await expect(updateDoc(doc(db, `stores/${STORE_A}`), { name: "Hackeada" })).rejects.toThrow();
    await expect(deleteDoc(doc(db, `stores/${STORE_A}`))).rejects.toThrow();
  });

  it("#274 member can touch ONLY packaging/pricingRules of their own store settings", async () => {
    const db = dbOf("memberA");
    await expect(updateDoc(doc(db, `stores/${STORE_A}`), { packaging: { byTier: {} }, updatedAt: "2026-11-10T00:00:00.000Z" })).resolves.toBeUndefined();
    await expect(updateDoc(doc(db, `stores/${STORE_A}`), { name: "Renombrada por miembro" })).rejects.toThrow();
    await expect(updateDoc(doc(db, `stores/${STORE_A}`), { ownerUid: "sec-member-b" })).rejects.toThrow();
  });

  it("memberB cannot write into publicCatalogs of store A", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "publicCatalogs/sec-catalog-a"), { storeId: STORE_A, products: [] });
    });
    const db = dbOf("memberB");
    await expect(updateDoc(doc(db, "publicCatalogs/sec-catalog-a"), { products: [{ name: "falso" }] })).rejects.toThrow();
  });

  // ── Direct-SDK attack probes ──────────────────────────────────────────────
  it("memberB cannot move their own doc into store A (storeId invariance)", async () => {
    const db = dbOf("memberB");
    await expect(updateDoc(doc(db, specPath("products", STORE_B)), { storeId: STORE_A })).rejects.toThrow();
  });

  it("memberB cannot attach a payment to store A's order", async () => {
    const db = dbOf("memberB");
    await expect(
      addDoc(collection(db, `orders/${pathSlug(STORE_A)}/payments`), {
        orderId: pathSlug(STORE_A), storeId: STORE_A, amount: 10, kind: "payment", method: "cash", date: "2026-11-10",
        amountCents: 1000, createdAt: "2026-11-10T00:00:00.000Z", createdBy: "sec-member-b",
      })
    ).rejects.toThrow();
  });

  it("member with a VERIFIED non-allowlisted email cannot self-escalate to super_admin", async () => {
    // Review H1: claims must include a verified email so the denial comes
    // from the ALLOWLIST branch, not from hasVerifiedEmail() failing earlier.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/sec-member-a"), {
        role: "member", email: "member@olivia.test", emailNormalized: "member@olivia.test", emailVerified: true,
      });
    });
    const db = env.authenticatedContext("sec-member-a", { email: "member@olivia.test", email_verified: true }).firestore();
    await expect(updateDoc(doc(db, "users/sec-member-a"), { role: "super_admin" })).rejects.toThrow();
  });

  it("the allowlisted platform email CAN hold super_admin (guard is the allowlist, not luck)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/sec-allowlisted"), {
        role: "member", email: "admin@store.os", emailNormalized: "admin@store.os", emailVerified: true,
      });
    });
    const db = env.authenticatedContext("sec-allowlisted", { email: "admin@store.os", email_verified: true }).firestore();
    await expect(updateDoc(doc(db, "users/sec-allowlisted"), { role: "super_admin" })).resolves.toBeUndefined();
  });

  it("member cannot list the adminStores control plane", async () => {
    const db = dbOf("memberA");
    await expect(getDocs(collection(db, "adminStores"))).rejects.toThrow();
  });

  it("memberB cannot delete store A's slug lock", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "slugs/sec-slug-a"), { ownerUid: "sec-member-a", storeId: STORE_A });
    });
    const db = dbOf("memberB");
    await expect(deleteDoc(doc(db, "slugs/sec-slug-a"))).rejects.toThrow();
  });

  it("anonymous: public projections readable, writes denied", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "publicStores/sec-pub"), { storeId: STORE_A, name: "A" });
      await setDoc(doc(ctx.firestore(), "publicProducts/mx-1"), { storeId: STORE_A, storeSlug: "sec-pub", name: "Pieza pública" });
    });
    const db = dbOf("anon");
    await expect(getDoc(doc(db, "publicStores/sec-pub"))).resolves.toBeTruthy();
    await expect(getDoc(doc(db, "publicProducts/mx-1"))).resolves.toBeTruthy();
    await expect(setDoc(doc(db, "publicProducts/mx-1"), { storeId: STORE_A, name: " falsificado" })).rejects.toThrow();
    await expect(setDoc(doc(db, "publicStores/sec-pub"), { storeId: STORE_A, name: "falsificado" })).rejects.toThrow();
  });

  it("anonymous LIST of the tenant directory (publicStores) is denied", async () => {
    const db = dbOf("anon");
    await expect(getDocs(collection(db, "publicStores"))).rejects.toThrow();
  });
});

function pathSlug(store: string): string {
  return `matrix-${store}`;
}
function specPath(name: string, store: string): string {
  const spec = BUSINESS_DOCS.find((s) => s.name === name)!;
  return spec.path(store);
}
