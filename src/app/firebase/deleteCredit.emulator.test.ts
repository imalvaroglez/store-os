import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { connectFirestoreEmulator, deleteDoc, doc, getDoc, initializeFirestore, setDoc } from "firebase/firestore";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { readFileSync } from "node:fs";
import type { AppUser } from "./auth";
import type { Order, OrderCreditLedgerEntry } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any, app: null as any }));
vi.mock("./config", () => ({
  getFirebase: () => ({ app: holder.app, db: holder.db }),
  isFirebaseConfigured: () => true,
  FIREBASE_EMULATOR_ENABLED: true,
}));
import {
  applyCustomerCreditTx,
  deleteOrderWithStockTx,
  getOrderFreshRevision,
  releaseCustomerCreditTx,
  saveOrderWithStockTx,
} from "./firestoreData";

let env: RulesTestEnvironment;

const user: AppUser = { uid: "tx-user", email: "fer@test.mx" } as never;

const orderDoc = (id: string, extra: Record<string, unknown> = {}) => ({
  storeId: "dc-store",
  customerId: "dc-clienta",
  items: [{ productName: "Pieza", quantity: 1, unitPrice: 200, subtotal: 200, lineId: `${id}_L0` }],
  deposit: 0,
  orderStatus: "confirmed",
  // No payment evidence by default: the credit guards must be isolated from
  // the (older) evidence guards that also block deletion.
  revision: 0,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
  ...extra,
});

const entry = (id: string, amountCents: number, fromOrderId: string): OrderCreditLedgerEntry => ({
  id, kind: "application", fromOrderId, amountCents, at: "2026-11-12T10:05:00.000Z", by: "tx-user",
});

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("deletion vs outstanding clienta credit (#363)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    // Real Auth-emulator user: the trusted callables authenticate this
    // identity (the rules-level fixtures keep using tx-user contexts).
    const app = initializeApp(
      { projectId: "store-os-dev", apiKey: "demo-api-key", authDomain: "store-os-dev.firebaseapp.com" },
      `dc-credit-${Date.now()}`
    );
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`, { disableWarnings: true });
    const created = await createUserWithEmailAndPassword(auth, `dc-credit-${Date.now()}@example.test`, "password123");
    const clientDb = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
    const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
    connectFirestoreEmulator(clientDb, fsHost, Number(fsPort));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/tx-user"), { role: "member" });
      await setDoc(doc(db, "adminStores/dc-store"), { ownerUid: "tx-user", memberUids: ["tx-user", created.user.uid] });
      // Overpaid origin: $200 total, $400 received → $200 of clienta credit.
      await setDoc(doc(db, "orders/dc-origin"), orderDoc("dc-origin", {
        items: [{ productName: "Anillo", quantity: 1, unitPrice: 200, subtotal: 200, lineId: "dc-origin_L0" }],
        paymentsReceivedCents: 40000,
      }));
      // A pure credit-backing doc (no payments): isolates the credit rule.
      await setDoc(doc(db, "orders/dc-origin2"), orderDoc("dc-origin2", { creditConsumedCents: 5000 }));
      // Destination owing $200 that the credit will cover.
      await setDoc(doc(db, "orders/dc-dest"), orderDoc("dc-dest"));
    });
    holder.app = app;
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("un borrado directo por SDK de un pedido con crédito aplicado lo niegan las reglas", async () => {
    await applyCustomerCreditTx({ entry: entry("app_1", 20000, "dc-origin"), orderId: "dc-dest", storeId: "dc-store" });
    const dest = (await getDoc(doc(holder.db, "orders/dc-dest"))).data()!;
    expect(dest.creditAppliedCents).toBe(20000);

    await expect(deleteDoc(doc(holder.db, "orders/dc-dest"))).rejects.toThrow(/PERMISSION_DENIED/i);
  });

  it("el borrado por SDK del pedido ORIGEN (respalda el crédito de una hermana) también se niega", async () => {
    // dc-origin carries payments too, so this also proves evidence protection;
    // dc-origin2 isolates the creditConsumedCents rule with no other evidence.
    await expect(deleteDoc(doc(holder.db, "orders/dc-origin"))).rejects.toThrow(/PERMISSION_DENIED/i);
    await expect(deleteDoc(doc(holder.db, "orders/dc-origin2"))).rejects.toThrow(/PERMISSION_DENIED/i);
  });

  it("deleteOrderWithStockTx aborta con error en español cuando el doc fresco tiene crédito pendiente (caller ciego)", async () => {
    // The in-flight scenario: the caller's local state never saw the credit.
    const dest = (await getDoc(doc(holder.db, "orders/dc-dest"))).data()!;
    await expect(
      deleteOrderWithStockTx(user, "dc-dest", dest.revision as number)
    ).rejects.toThrow(/usó saldo a favor de la clienta/i);
    // The doc (and its credit) survives.
    const after = (await getDoc(doc(holder.db, "orders/dc-dest"))).data()!;
    expect(after.creditAppliedCents).toBe(20000);
  });

  it("el editor con revisión vencida ya no puede revertir el crédito aplicado (StaleOrderError, fail-closed)", async () => {
    const dest = (await getDoc(doc(holder.db, "orders/dc-dest"))).data()!;
    const staleEdit = { ...dest, id: "dc-dest", notes: "edición con snapshot viejo" } as never as Order;
    // applyCustomerCreditTx bumped `revision`; an editor holding the PRE-apply
    // revision must fail closed instead of silently reverting the credit.
    await expect(
      saveOrderWithStockTx(user, staleEdit, (dest.revision as number) - 1, "mut_stale_editor")
    ).rejects.toThrow();
    const after = (await getDoc(doc(holder.db, "orders/dc-dest"))).data()!;
    expect(after.creditAppliedCents).toBe(20000); // credit intact
    expect(after.revision).toBe(dest.revision);   // nothing written
  });

  it("flujo legítimo: restituir el crédito y borrar con la revisión fresca elimina el pedido y deja el espejo en cero", async () => {
    const released = await releaseCustomerCreditTx({ orderId: "dc-dest", storeId: "dc-store", by: "tx-user", reason: "deletion" });
    expect(released).toBe(20000);

    const fresh = await getOrderFreshRevision("dc-dest");
    expect(typeof fresh).toBe("number");
    await deleteOrderWithStockTx(user, "dc-dest", fresh as number);

    expect((await getDoc(doc(holder.db, "orders/dc-dest"))).exists()).toBe(false);
    const origin = (await getDoc(doc(holder.db, "orders/dc-origin"))).data()!;
    expect(origin.creditConsumedCents).toBe(0); // the clienta's credit is whole again
  });

  it("un pedido sin crédito pendiente se borra normalmente (sin regresión)", async () => {
    await setDoc(doc(holder.db, "orders/dc-plain"), orderDoc("dc-plain"));
    const fresh = await getOrderFreshRevision("dc-plain");
    await deleteOrderWithStockTx(user, "dc-plain", fresh as number);
    expect((await getDoc(doc(holder.db, "orders/dc-plain"))).exists()).toBe(false);
  });
});
