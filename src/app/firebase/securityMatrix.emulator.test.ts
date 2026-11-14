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

// ── #374: public projections — the doc ID is bound to the content ──────────
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#374 public projection squatting — id ligado al contenido", () => {
  let env374: RulesTestEnvironment;
  beforeAll(async () => {
    env374 = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf-8") },
    });
    await env374.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "users/sec-member-a"), { role: "member" });
      await setDoc(doc(fs, "users/sec-member-b"), { role: "member" });
      await setDoc(doc(fs, `adminStores/${STORE_A}`), { ownerUid: "sec-owner-a", memberUids: ["sec-owner-a", "sec-member-a"] });
      await setDoc(doc(fs, `adminStores/${STORE_B}`), { ownerUid: "sec-member-b", memberUids: ["sec-member-b"] });
      // The create rules verify the projection id against the STORE's own slug.
      await setDoc(doc(fs, `stores/${STORE_A}`), { slug: "matrix-a", name: "A", type: "on_demand", createdAt: "", updatedAt: "" });
      await setDoc(doc(fs, `stores/${STORE_B}`), { slug: "matrix-b", name: "B", type: "on_demand", createdAt: "", updatedAt: "" });
      // r2: every legit projection is backed by its own reservation.
      await setDoc(doc(fs, "slugs/matrix-b"), { storeId: STORE_B, ownerUid: "sec-member-b", claimedAt: 0 });
    });
  });
  afterAll(async () => {
    await env374?.cleanup();
  });
  const dbA = () => env374.authenticatedContext("sec-member-a").firestore();
  const dbB = () => env374.authenticatedContext("sec-member-b").firestore();

  it("un miembro de A no puede ocupar la ruta pública futura de B (publicProducts)", async () => {
    await expect(
      setDoc(doc(dbA(), `publicProducts/${STORE_B}__anillo-futuro`), { storeId: STORE_A, productSlug: "anillo-futuro", name: "Falso" })
    ).rejects.toThrow();
  });

  it("su propia ruta sí se crea (id = storeId__slug del cuerpo)", async () => {
    await expect(
      setDoc(doc(dbA(), `publicProducts/${STORE_A}__anillo-propio`), { storeId: STORE_A, productSlug: "anillo-propio", name: "Válido" })
    ).resolves.toBeUndefined();
  });

  it("publicStores/{slug} exige que el slug sea de la tienda del cuerpo", async () => {
    await expect(
      setDoc(doc(dbA(), "publicStores/matrix-b"), { storeId: STORE_A, slug: "matrix-b", name: "Falsa B" })
    ).rejects.toThrow();
    await expect(
      setDoc(doc(dbB(), "publicStores/matrix-b"), { storeId: STORE_B, slug: "matrix-b", name: "B" })
    ).resolves.toBeUndefined();
  });

  it("publicCatalogs/{slug} igual — la dueña publica el suyo", async () => {
    await expect(
      setDoc(doc(dbA(), "publicCatalogs/matrix-b"), { storeId: STORE_A, categories: [], products: [] })
    ).rejects.toThrow();
    await expect(
      setDoc(doc(dbB(), "publicCatalogs/matrix-b"), { storeId: STORE_B, categories: [], products: [] })
    ).resolves.toBeUndefined();
  });
});

// #374 r2 — review return: ownsStoreSlug trusted stores/{id}.slug, which the
// store owner can re-point by SDK at a rival's FUTURE slug and then publish
// projections under it (probe P9). The slug must live bound to its
// RESERVATION in slugs/{slug}, and only the reserving store may move to it.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#374 r2 — el slug vive ligado a su reservación", () => {
  let envR2: RulesTestEnvironment;
  const STORE_R2A = "sec-r2-store-a";
  const STORE_R2B = "sec-r2-store-b";
  const STORE_R2C = "sec-r2-store-c";
  const OWNER_A = "sec-r2-owner-a";
  const OWNER_B = "sec-r2-owner-b";
  const OWNER_C = "sec-r2-owner-c";

  beforeAll(async () => {
    envR2 = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf-8") },
    });
    // The emulator persists across runs: reset so probes hit CREATE rules,
    // not updates over docs planted by a previous red run.
    await envR2.clearFirestore();
    await envR2.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      const seed = (path: string, data: Record<string, unknown>) => setDoc(doc(fs, path), data);
      await seed(`users/${OWNER_A}`, { role: "member" });
      await seed(`users/${OWNER_B}`, { role: "member" });
      await seed(`users/${OWNER_C}`, { role: "member" });
      await seed(`adminStores/${STORE_R2A}`, { ownerUid: OWNER_A, memberUids: [OWNER_A] });
      await seed(`adminStores/${STORE_R2B}`, { ownerUid: OWNER_B, memberUids: [OWNER_B] });
      await seed(`adminStores/${STORE_R2C}`, { ownerUid: OWNER_C, memberUids: [OWNER_C] });
      await seed(`stores/${STORE_R2A}`, { slug: "old-a", name: "A", type: "on_demand", ownerUid: OWNER_A, memberUids: [OWNER_A], createdAt: "", updatedAt: "" });
      await seed(`stores/${STORE_R2B}`, { slug: "matrix-b2", name: "B", type: "on_demand", ownerUid: OWNER_B, memberUids: [OWNER_B], createdAt: "", updatedAt: "" });
      // C already re-pointed its own slug at B's future route (attack step 1
      // completed via SDK before the fix existed).
      await seed(`stores/${STORE_R2C}`, { slug: "future-b", name: "C", type: "on_demand", ownerUid: OWNER_C, memberUids: [OWNER_C], createdAt: "", updatedAt: "" });
      // Reservations: A owns its current + rename-target slugs; B owns matrix-b2.
      await seed("slugs/old-a", { storeId: STORE_R2A, ownerUid: OWNER_A, claimedAt: 0 });
      await seed("slugs/new-a", { storeId: STORE_R2A, ownerUid: OWNER_A, claimedAt: 0 });
      await seed("slugs/matrix-b2", { storeId: STORE_R2B, ownerUid: OWNER_B, claimedAt: 0 });
      // Legacy projections under A's current slug.
      await seed("publicStores/old-a", { storeId: STORE_R2A, name: "A" });
      await seed("publicCatalogs/old-a", { storeId: STORE_R2A, categories: [], products: [] });
      await seed(`publicProducts/${STORE_R2A}__p1`, { storeId: STORE_R2A, storeSlug: "old-a", productSlug: "p1", name: "P1" });
    });
  });
  afterAll(async () => {
    await envR2?.cleanup();
  });
  const dbA = () => envR2.authenticatedContext(OWNER_A).firestore();
  const dbC = () => envR2.authenticatedContext(OWNER_C).firestore();

  it("P9: la dueña de A no puede re-apuntar stores/A.slug al slug reservado por B", async () => {
    await expect(
      updateDoc(doc(dbA(), `stores/${STORE_R2A}`), { slug: "matrix-b2" })
    ).rejects.toThrow();
  });

  it("P9: incluso con stores/C.slug ya re-apuntado, la proyección bajo el slug ajeno se niega", async () => {
    await expect(
      setDoc(doc(dbC(), "publicStores/future-b"), { storeId: STORE_R2C, name: "C falsificando B" })
    ).rejects.toThrow();
    await expect(
      setDoc(doc(dbC(), "publicCatalogs/future-b"), { storeId: STORE_R2C, categories: [], products: [] })
    ).rejects.toThrow();
  });

  it("renombre legítimo: la dueña mueve a un slug que SU tienda reservó y publica bajo él", async () => {
    await expect(
      updateDoc(doc(dbA(), `stores/${STORE_R2A}`), { slug: "new-a" })
    ).resolves.toBeUndefined();
    await expect(
      setDoc(doc(dbA(), "publicStores/new-a"), { storeId: STORE_R2A, name: "A" })
    ).resolves.toBeUndefined();
    await expect(
      setDoc(doc(dbA(), "publicCatalogs/new-a"), { storeId: STORE_R2A, categories: [], products: [] })
    ).resolves.toBeUndefined();
  });

  it("slugs/{slug} create: la reservación que nombra una tienda EXISTENTE exige membresía en ella", async () => {
    // Planting a reservation over B's namespace as an outsider: denied.
    await expect(
      setDoc(doc(dbC(), "slugs/stolen-b"), { storeId: STORE_R2B, ownerUid: OWNER_C, claimedAt: 0 })
    ).rejects.toThrow();
    // Own store's slug: allowed (rename flow).
    await expect(
      setDoc(doc(dbC(), "slugs/mine-c"), { storeId: STORE_R2C, ownerUid: OWNER_C, claimedAt: 0 })
    ).resolves.toBeUndefined();
    // addStore claims BEFORE the store doc exists: still allowed (documented
    // residual: a signed user can pre-claim slugs for stores that never
    // exist — namespace DoS, no cross-tenant content risk).
    await expect(
      setDoc(doc(dbC(), "slugs/brand-new"), { storeId: "store-never-created", ownerUid: OWNER_C, claimedAt: 0 })
    ).resolves.toBeUndefined();
  });
});
