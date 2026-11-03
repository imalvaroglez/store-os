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

  it("rejects the first payment on a pending deposit without the anticipo's date/method (PO 2026-11-03)", async () => {
    await expect(registerOrderPaymentTx(payment("pay_x", 50))).rejects.toThrow(/anticipo previo/i);
    const docs = await getDocs(collection(holder.db, "orders/pay-order/payments"));
    expect(docs.size).toBe(0); // nothing was written
  });

  it("registers a payment, materializes the inherited deposit once, and a retry never duplicates", async () => {
    const saved = await registerOrderPaymentTx(payment("pay_a", 200), { method: "cash", date: "2026-10-20" });
    expect(saved).toHaveLength(2); // inherited deposit + the payment itself
    const retry = await registerOrderPaymentTx(payment("pay_a", 200), { method: "cash", date: "2026-10-20" });
    expect(retry).toHaveLength(1); // same intent id: recognized, no second write
    const docs = await getDocs(collection(holder.db, "orders/pay-order/payments"));
    expect(docs.size).toBe(2);
    const inherited = docs.docs.find((d) => d.id === "inherited_deposit");
    expect(inherited?.data()).toMatchObject({ method: "cash", amount: 400, date: "2026-10-20" });
    // #168: the doc-level accumulator absorbed payment + inherited deposit in
    // the SAME transaction, and the deposit is marked so it never double-counts.
    const orderDoc = (await getDoc(doc(holder.db, "orders/pay-order"))).data();
    expect(orderDoc?.paymentsReceivedCents).toBe(60000); // $200 + inherited $400
    expect(orderDoc?.inheritedDepositMaterialized).toBe(true);
  });

  it("never re-materializes the inherited deposit on later payments", async () => {
    await registerOrderPaymentTx(payment("pay_b", 100), { method: "transfer", date: "2026-10-25" });
    const docs = await getDocs(collection(holder.db, "orders/pay-order/payments"));
    expect(docs.size).toBe(3); // inherited + pay_a + pay_b
    // The accumulator keeps folding: 600 + 100 cents-dollars = $700.
    expect((await getDoc(doc(holder.db, "orders/pay-order"))).data()?.paymentsReceivedCents).toBe(70000);
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

  // #168 F5: the create rule validates CONTENT — records are money evidence,
  // so a raw SDK write cannot inject garbage amounts or invented enums.
  it("rejects payment writes with invalid content", async () => {
    const base = { orderId: "pay-order", storeId: "tx-store", date: "2026-11-02", createdAt: "", createdBy: "tx-user" };
    const ref = (id: string) => doc(holder.db, "orders/pay-order/payments", id);
    await expect(setDoc(ref("bad_text"), { ...base, method: "cash", kind: "payment", amount: "200" })).rejects.toThrow();
    await expect(setDoc(ref("bad_negative"), { ...base, method: "cash", kind: "payment", amount: -50 })).rejects.toThrow();
    await expect(setDoc(ref("bad_zero"), { ...base, method: "cash", kind: "payment", amount: 0 })).rejects.toThrow();
    await expect(setDoc(ref("bad_method"), { ...base, method: "paypal", kind: "payment", amount: 50 })).rejects.toThrow();
    await expect(setDoc(ref("bad_kind"), { ...base, method: "cash", kind: "birthday", amount: 50 })).rejects.toThrow();
    await expect(setDoc(ref("bad_huge"), { ...base, method: "cash", kind: "payment", amount: 9.5e12 })).rejects.toThrow();
    await expect(setDoc(ref("bad_adj_note"), { ...base, method: "unknown", kind: "adjustment", amount: -100 })).rejects.toThrow();
    const docs = await getDocs(collection(holder.db, "orders/pay-order/payments"));
    expect(docs.size).toBe(3); // inherited + pay_a + pay_b: nothing leaked in
  });

  it("accepts a signed adjustment with its note (corrections stay valid evidence)", async () => {
    const ref = doc(holder.db, "orders/pay-order/payments/adj_ok");
    await expect(
      setDoc(ref, { orderId: "pay-order", storeId: "tx-store", createdAt: "2026-11-02T10:00:00.000Z", createdBy: "tx-user", method: "unknown", kind: "adjustment", amount: -100, note: "Devolución en efectivo" })
    ).resolves.toBeUndefined();
  });
});
