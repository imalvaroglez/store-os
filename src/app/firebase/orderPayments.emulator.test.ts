import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, deleteField } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order, OrderPayment } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { registerOrderPaymentTx, saveOrderWithStockTx } from "./firestoreData";
import { signedAmountCents } from "../../features/orders/payments";

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
      await setDoc(doc(ctx.firestore(), "users/tx-ledger-admin"), { role: "super_admin" });
      await setDoc(doc(ctx.firestore(), "adminStores/tx-store"), { ownerUid: "tx-user", memberUids: ["tx-user"] });
      await setDoc(doc(ctx.firestore(), "adminStores/other-store"), { ownerUid: "tx-other", memberUids: ["tx-other"] });
      await setDoc(doc(ctx.firestore(), "orders/pay-order"), { storeId: "tx-store", items: [], deposit: 400, createdAt: "", updatedAt: "" });
      // Distinct id from other emulator suites: vitest orders files by size,
      // so a shared doc id can leak state across suites and flip their rules
      // expectations depending on which file grew last.
      await setDoc(doc(ctx.firestore(), "orders/foreign-pay-order"), { storeId: "other-store", items: [], deposit: 0, createdAt: "", updatedAt: "" });
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
    const foreign: OrderPayment = { ...payment("pay_f", 50), orderId: "foreign-pay-order", storeId: "other-store" };
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
    const parent = doc(holder.db, "orders/pay-order");
    const before = (await getDoc(parent)).data()!;
    const cases = [
      { id: "bad_text", amount: "200", amountCents: 20000 },
      { id: "bad_negative", amount: -50, amountCents: -5000 },
      { id: "bad_zero", amount: 0, amountCents: 0 },
      { id: "bad_method", method: "paypal" },
      { id: "bad_kind", kind: "birthday" },
      { id: "bad_huge", amount: 9.5e12, amountCents: 9.5e14 },
      { id: "bad_adj_note", method: "unknown", kind: "adjustment", amount: -100, amountCents: -10000 },
      { id: "bad_actor", createdBy: "another-operator" },
    ];
    for (const test of cases) {
      const record = { ...payment(test.id, 50), amountCents: 5000, ...test };
      const batch = writeBatch(holder.db);
      batch.set(doc(holder.db, "orders/pay-order/payments", test.id), record);
      batch.update(parent, { lastPaymentId: test.id, paymentsReceivedCents: before.paymentsReceivedCents + record.amountCents });
      await expect(batch.commit()).rejects.toThrow();
    }
    const docs = await getDocs(collection(holder.db, "orders/pay-order/payments"));
    expect(docs.size).toBe(3); // inherited + pay_a + pay_b: nothing leaked in
  });

  it("accepts a signed adjustment with its note (corrections stay valid evidence)", async () => {
    const saved = await registerOrderPaymentTx({ ...payment("adj_ok", -100), kind: "adjustment", method: "unknown", note: "Devolución en efectivo" });
    expect(saved[0]).toMatchObject({ amount: -100, amountCents: -10000 });
    expect((await getDoc(doc(holder.db, "orders/pay-order"))).data()?.paymentsReceivedCents).toBe(60000);
  });

  it("blocks raw accumulator changes, invented links, forged creation and detached evidence", async () => {
    const parent = doc(holder.db, "orders/pay-order");
    const before = (await getDoc(parent)).data()!;
    for (const patch of [
      { paymentsReceivedCents: before.paymentsReceivedCents + 1 },
      { paymentsReceivedCents: before.paymentsReceivedCents - 1 },
      { paymentsReceivedCents: deleteField() },
      { lastPaymentId: "missing-receipt" },
      { lastPaymentId: deleteField() },
      { inheritedDepositMaterialized: false },
    ]) await expect(updateDoc(parent, patch)).rejects.toThrow();
    const adminDb = env.authenticatedContext("tx-ledger-admin").firestore();
    await expect(updateDoc(doc(adminDb, "orders/pay-order"), { paymentsReceivedCents: before.paymentsReceivedCents + 100 })).rejects.toThrow();
    await expect(setDoc(doc(holder.db, "orders/forged-money"), { storeId: "tx-store", deposit: 0, paymentsReceivedCents: 99900 })).rejects.toThrow();
    await expect(setDoc(doc(holder.db, "orders/pay-order/payments/detached"), { ...payment("detached", 10), amountCents: 1000 })).rejects.toThrow();
    expect((await getDoc(parent)).data()).toEqual(before);
    expect((await getDoc(doc(holder.db, "orders/pay-order/payments/detached"))).exists()).toBe(false);
  });

  it("rejects a replayed receipt and batches that omit or miscount their evidence", async () => {
    const parent = doc(holder.db, "orders/pay-order");
    const before = (await getDoc(parent)).data()!;
    await expect(updateDoc(parent, { lastPaymentId: "pay_a", paymentsReceivedCents: before.paymentsReceivedCents + 20000 })).rejects.toThrow();
    const wrongSum = writeBatch(holder.db);
    wrongSum.set(doc(holder.db, "orders/pay-order/payments/wrong-sum"), { ...payment("wrong-sum", 10), amountCents: 1000 });
    wrongSum.update(parent, { lastPaymentId: "wrong-sum", paymentsReceivedCents: before.paymentsReceivedCents + 999 });
    await expect(wrongSum.commit()).rejects.toThrow();
    const hidden = writeBatch(holder.db);
    for (const id of ["hidden-a", "hidden-b"]) hidden.set(doc(holder.db, "orders/pay-order/payments", id), { ...payment(id, 10), amountCents: 1000 });
    hidden.update(parent, { lastPaymentId: "hidden-a", paymentsReceivedCents: before.paymentsReceivedCents + 1000 });
    await expect(hidden.commit()).rejects.toThrow();
    expect((await getDoc(parent)).data()).toEqual(before);
    for (const id of ["wrong-sum", "hidden-a", "hidden-b"]) expect((await getDoc(doc(holder.db, "orders/pay-order/payments", id))).exists()).toBe(false);
  });

  it("validates symmetric exact cents at decimal boundaries and rejects a forged cent", async () => {
    const orderId = "rounding-ledger";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 0, items: [], createdAt: "", updatedAt: "" });
    let total = 0;
    const amounts = [0.1, 0.29, 1.005, 2.675, 1.0049999999999997, -1.005, -2.675, 1e-7, -1e-7, 8999999999999.064, -8999999999999.074, 9000000000000];
    for (const [i, amount] of amounts.entries()) {
      const record = { ...payment(`round-${i}`, amount), orderId, ...(amount < 0 ? { kind: "adjustment" as const, method: "unknown" as const, note: "Corrección con precisión heredada" } : {}) };
      const saved = await registerOrderPaymentTx(record);
      const cents = signedAmountCents(amount);
      expect(saved[0]).toMatchObject({ amount, amountCents: cents });
      total += cents;
      expect((await getDoc(parent)).data()?.paymentsReceivedCents).toBe(total);
      const forgedCents = cents > 0 ? cents - 1 : cents + 1;
      const forgedId = `forged-cent-${i}`;
      const batch = writeBatch(holder.db);
      batch.set(doc(holder.db, "orders", orderId, "payments", forgedId), { ...record, id: forgedId, amountCents: forgedCents });
      batch.update(parent, { lastPaymentId: forgedId, paymentsReceivedCents: total + forgedCents });
      await expect(batch.commit()).rejects.toThrow();
      expect((await getDoc(parent)).data()?.paymentsReceivedCents).toBe(total);
    }
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(amounts.length);
  }, 15000);

  it("materializes fractional legacy deposits exactly and refuses an invented inherited amount", async () => {
    const orderId = "fractional-inherited";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 1.005, items: [], createdAt: "", updatedAt: "" });
    const forged = writeBatch(holder.db);
    forged.set(doc(holder.db, "orders", orderId, "payments", "inherited_deposit"), { id: "inherited_deposit", orderId, storeId: "tx-store", createdAt: "2026-11-02", createdBy: "tx-user", kind: "payment", method: "unknown", amount: 999, amountCents: 99900 });
    forged.set(doc(holder.db, "orders", orderId, "payments", "materialize-forged"), { ...payment("materialize-forged", 1), orderId, amountCents: 100 });
    forged.update(parent, { inheritedDepositMaterialized: true, paymentsReceivedCents: 100000, lastPaymentId: "materialize-forged" });
    await expect(forged.commit()).rejects.toThrow();
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(0);
    const saved = await registerOrderPaymentTx({ ...payment("materialize-real", 1), orderId });
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ id: "inherited_deposit", amount: 1.005, amountCents: 101 });
    expect((await getDoc(parent)).data()).toMatchObject({ paymentsReceivedCents: 201, lastPaymentId: "materialize-real", inheritedDepositMaterialized: true });
  });

  it("serializes concurrent receipts and keeps the canonical link through a stale form save", async () => {
    const orderId = "concurrent-ledger";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 0, items: [], createdAt: "", updatedAt: "" });
    await Promise.all([
      registerOrderPaymentTx({ ...payment("concurrent-a", 10), orderId }),
      registerOrderPaymentTx({ ...payment("concurrent-b", 20), orderId }),
    ]);
    const before = (await getDoc(parent)).data()!;
    expect(before.paymentsReceivedCents).toBe(3000);
    const result = await saveOrderWithStockTx({ uid: "tx-user", role: "member" } as any, { ...before, id: orderId, lastPaymentId: "invented-link", paymentsReceivedCents: 99900 } as Order, before.revision ?? 0, "save-after-concurrent");
    expect(result.order.lastPaymentId).toBe(before.lastPaymentId);
    expect(result.order.paymentsReceivedCents).toBe(3000);
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(2);
  });


  it("keeps a 50-product first reservation within rules access limits", async () => {
    const orderId = "ledger-bulk-plan";
    await env.withSecurityRulesDisabled(async (ctx) => {
      await Promise.all(Array.from({ length: 50 }, (_, i) => setDoc(doc(ctx.firestore(), "products", `ledger-bulk-${i}`), { storeId: "tx-store", quantityOnHand: 2 })));
    });
    const order: Order = {
      id: orderId, storeId: "tx-store", customerId: "c1", deposit: 0,
      items: Array.from({ length: 50 }, (_, i) => ({ lineId: `line-${i}`, productId: `ledger-bulk-${i}`, productName: "Pieza de prueba", quantity: 1, unitPrice: 1, subtotal: 1 })),
      orderStatus: "asked", paymentStatus: "unpaid", createdAt: "2026-11-03", updatedAt: "2026-11-03",
      installments: { count: 2, frequency: "weekly", firstDueDate: "2026-11-15", agreedAt: "2026-11-03", agreedBy: "tx-user" },
    };
    await saveOrderWithStockTx({ uid: "tx-user", role: "member" } as any, order, null, "ledger-bulk-create");
    await registerOrderPaymentTx({ ...payment("bulk-first", 1), orderId });
    expect((await getDoc(doc(holder.db, "orders", orderId))).data()).toMatchObject({ paymentsReceivedCents: 100, lastPaymentId: "bulk-first" });
    expect((await getDoc(doc(holder.db, "products/ledger-bulk-49"))).data()?.quantityOnHand).toBe(1);
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(1);
  }, 15000);


  it("concurrent first abonos keep one reservation and both receipts", async () => {
    const orderId = "ledger-first-race";
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/ledger-first-race-product"), { storeId: "tx-store", quantityOnHand: 2 });
    });
    const order: Order = {
      id: orderId, storeId: "tx-store", customerId: "c1", deposit: 0,
      items: [{ productId: "ledger-first-race-product", productName: "Caja de prueba", quantity: 1, unitPrice: 900, subtotal: 900 }],
      orderStatus: "asked", paymentStatus: "unpaid", createdAt: "2026-11-03", updatedAt: "2026-11-03",
      installments: { count: 3, frequency: "monthly", firstDueDate: "2026-11-15", agreedAt: "2026-11-03", agreedBy: "tx-user" },
    };
    await saveOrderWithStockTx({ uid: "tx-user", role: "member" } as any, order, null, "ledger-first-race-create");
    await Promise.all([
      registerOrderPaymentTx({ ...payment("first-race-a", 100), orderId }),
      registerOrderPaymentTx({ ...payment("first-race-b", 200), orderId }),
    ]);
    expect((await getDoc(doc(holder.db, "orders", orderId))).data()).toMatchObject({ paymentsReceivedCents: 30000, revision: 2 });
    expect((await getDoc(doc(holder.db, "products/ledger-first-race-product"))).data()?.quantityOnHand).toBe(1);
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(2);
  });

});
