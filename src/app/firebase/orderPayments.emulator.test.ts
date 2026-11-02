import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { OrderPayment } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { registerOrderPaymentTx } from "./firestoreData";

let env: RulesTestEnvironment;

const payment = (id: string, amount: number): OrderPayment => ({
  id,
  orderId: "pay-order",
  storeId: "tx-store",
  date: "2026-11-02",
  method: "cash",
  kind: "payment",
  amount,
  createdAt: "2026-11-02T10:00:00.000Z",
  createdBy: "tx-user",
});

// Runs in CI's rules job (emulator); skipped locally per the no-emulators rule.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("order payments with Firestore rules", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/tx-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "users/tx-other"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/tx-store"), { ownerUid: "tx-user", memberUids: ["tx-user"] });
      await setDoc(doc(ctx.firestore(), "adminStores/other-store"), { ownerUid: "tx-other", memberUids: ["tx-other"] });
      await setDoc(doc(ctx.firestore(), "orders/pay-order"), { storeId: "tx-store", items: [], deposit: 400, createdAt: "", updatedAt: "" });
      await setDoc(doc(ctx.firestore(), "orders/foreign-order"), { storeId: "other-store", items: [], deposit: 0, createdAt: "", updatedAt: "" });
    });
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("registers a payment, materializes the inherited deposit once, and a retry never duplicates", async () => {
    const saved = await registerOrderPaymentTx(payment("pay_a", 200));
    expect(saved).toHaveLength(2); // inherited deposit + the payment itself
    const retry = await registerOrderPaymentTx(payment("pay_a", 200));
    expect(retry).toHaveLength(1); // same intent id: recognized, no second write
    const docs = await getDocs(collection(holder.db, "orders/pay-order/payments"));
    expect(docs.size).toBe(2);
    const inherited = docs.docs.find((d) => d.id === "inherited_deposit");
    expect(inherited?.data()).toMatchObject({ method: "unknown", amount: 400 });
    expect(inherited?.data().date).toBeUndefined(); // unknown stays unknown
  });

  it("never re-materializes the inherited deposit on later payments", async () => {
    await registerOrderPaymentTx(payment("pay_b", 100));
    const docs = await getDocs(collection(holder.db, "orders/pay-order/payments"));
    expect(docs.size).toBe(3); // inherited + pay_a + pay_b
  });

  it("a member of another store cannot attach a payment to a foreign order", async () => {
    const foreign: OrderPayment = { ...payment("pay_f", 50), orderId: "foreign-order", storeId: "other-store" };
    // The transaction reads the parent order, which this member cannot access.
    await expect(registerOrderPaymentTx(foreign)).rejects.toThrow();
    const foreignDb = env.authenticatedContext("tx-other").firestore();
    await expect(
      setDoc(doc(foreignDb, "orders/pay-order/payments/pay_g"), { ...payment("pay_g", 50) })
    ).rejects.toThrow();
    const docs = await getDocs(collection(holder.db, "orders/pay-order/payments"));
    expect(docs.size).toBe(3); // nothing leaked in
  });

  it("treats payment records as immutable evidence", async () => {
    const ref = doc(holder.db, "orders/pay-order/payments/pay_a");
    await expect(updateDoc(ref, { amount: 999 })).rejects.toThrow();
    await expect(deleteDoc(ref)).rejects.toThrow();
  });

  it("keeps payments private to store members", async () => {
    const anonymous = env.unauthenticatedContext().firestore();
    await expect(getDoc(doc(anonymous, "orders/pay-order/payments/pay_a"))).rejects.toThrow();
    expect((await getDoc(doc(holder.db, "orders/pay-order/payments/pay_a"))).exists()).toBe(true);
  });
});
