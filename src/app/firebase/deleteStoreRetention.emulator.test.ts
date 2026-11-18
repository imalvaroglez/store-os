import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { initializeApp, deleteApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import type { AppUser } from "./auth";

const holder = vi.hoisted(() => ({ env: null as RulesTestEnvironment | null, db: null as unknown, app: null as unknown }));
vi.mock("./config", () => ({
  getFirebase: () => ({ app: holder.app, db: holder.db }),
  isFirebaseConfigured: () => true,
  FIREBASE_EMULATOR_ENABLED: true,
}));
import { retainStoreEvidence } from "./firestoreData";

// #375 (PO decision 18-nov): retention with expulsion. Deleting a store
// expels every member (memberUids emptied, sealed with retainedAt), keeps the
// money evidence frozen (paid orders, payments subcollection, priceEvents)
// readable ONLY by platform, and the control doc can never be deleted.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("store deletion retention (#375)", () => {
  beforeAll(async () => {
    holder.env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await holder.env.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore();
      // users docs: isSuperAdmin reads the users profile (role) — without it
      // the rules evaluation errors instead of denying.
      await admin.doc("users/plat375").set({ email: "admin@store.os", emailNormalized: "admin@store.os", emailVerified: true, role: "super_admin", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
      await admin.doc("users/fer375").set({ email: "fer375@test.mx", emailNormalized: "fer375@test.mx", emailVerified: true, role: "member", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
      await admin.doc("users/col375").set({ email: "col375@test.mx", emailNormalized: "col375@test.mx", emailVerified: true, role: "member", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
      await admin.doc("adminStores/ret-store").set({ ownerUid: "fer375", memberUids: ["fer375", "col375"], name: "Fer", slug: "fer-ret", type: "inventory_tiered" });
      await admin.doc("stores/ret-store").set({ id: "ret-store", name: "Fer", slug: "fer-ret", ownerUid: "fer375", memberUids: ["fer375", "col375"] });
      await admin.doc("products/ret-p1").set({ storeId: "ret-store", name: "Pieza", status: "published" });
      await admin.doc("orders/ret-paid").set({ storeId: "ret-store", customerId: "c1", paymentsReceivedCents: 50000, orderStatus: "delivered", revision: 1 });
      await admin.doc("orders/ret-paid/payments/pay1").set({ amountCents: 50000, method: "cash" });
      await admin.doc("orders/ret-free").set({ storeId: "ret-store", customerId: "c1", paymentsReceivedCents: 0, orderStatus: "asked", revision: 1 });
      await admin.doc("priceEvents/ret-pe1").set({ storeId: "ret-store", productId: "ret-p1", from: 100, to: 120 });
    });
  });
  afterAll(async () => {
    await holder.env?.cleanup();
    if (holder.app) await deleteApp(holder.app as never);
  });

  beforeAll(async () => {
    const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
    const app = initializeApp({ projectId: "store-os-dev", apiKey: "x", authDomain: "x" }, "retention-375");
    const db = getFirestore(app as never);
    connectFirestoreEmulator(db as never, host, Number(port));
    holder.app = app; holder.db = db;
  });

  const owner: AppUser = { uid: "fer375", email: "fer375@test.mx" } as never;

  it("the owner can seal the retention: memberships expelled, evidence sealed", async () => {
    const adminDb = holder.db;
    holder.db = holder.env!.authenticatedContext("fer375").firestore();
    await retainStoreEvidence(owner, "ret-store");
    holder.db = adminDb;
    const sealed = await holder.env!.authenticatedContext("plat375", { email: "admin@store.os", email_verified: true })
      .firestore().doc("adminStores/ret-store").get();
    expect(sealed.get("memberUids")).toEqual([]);
    expect(typeof sealed.get("retainedAt")).toBe("string");
  });

  it("matrix: ex-members lose everything, platform keeps reading the frozen evidence", async () => {
    // Ex-member (former owner and former colleague): no read, no new docs.
    for (const uid of ["fer375", "col375"]) {
      await holder.env!.withSecurityRulesDisabled(() => Promise.resolve());
      const db = holder.env!.authenticatedContext(uid).firestore();
      await expect(db.doc("orders/ret-paid").get()).rejects.toThrow();
      await expect(db.doc("adminStores/ret-store").get()).rejects.toThrow();
      await expect(db.doc("products/ret-p2").set({ storeId: "ret-store", name: "Forge" })).rejects.toThrow();
    }
    // Platform super_admin: reads the frozen money evidence.
    const superDb = holder.env!.authenticatedContext("plat375", { email: "admin@store.os", email_verified: true }).firestore();
    const paid = await superDb.doc("orders/ret-paid").get();
    expect(paid.get("paymentsReceivedCents")).toBe(50000);
    const payment = await superDb.doc("orders/ret-paid/payments/pay1").get();
    expect(payment.get("amountCents")).toBe(50000);
    const event = await superDb.doc("priceEvents/ret-pe1").get();
    expect(event.exists).toBe(true);
  });

  it("the control doc stays undeletable even for platform", async () => {
    const superDb = holder.env!.authenticatedContext("plat375", { email: "admin@store.os", email_verified: true }).firestore();
    await expect(superDb.doc("adminStores/ret-store").delete()).rejects.toThrow();
  });
});
