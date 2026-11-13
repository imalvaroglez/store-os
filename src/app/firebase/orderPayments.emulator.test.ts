import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, deleteField } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order, OrderPayment } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { registerOrderPaymentTx, saveOrderWithStockTx } from "./firestoreData";
import { docReceivedCents, signedAmountCents } from "../../features/orders/payments";

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
    expect(saved.payments).toHaveLength(2); // inherited deposit + the payment itself
    const retry = await registerOrderPaymentTx(payment("pay_a", 200), { method: "cash", date: "2026-10-20" });
    expect(retry.payments).toHaveLength(1); // same intent id: recognized, no second write
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
      batch.update(parent, { lastPaymentId: test.id, paymentsRevision: (before.paymentsRevision ?? 0) + 1, paymentsReceivedCents: before.paymentsReceivedCents + record.amountCents });
      await expect(batch.commit()).rejects.toThrow();
    }
    const docs = await getDocs(collection(holder.db, "orders/pay-order/payments"));
    expect(docs.size).toBe(3); // inherited + pay_a + pay_b: nothing leaked in
  });

  it("accepts a signed adjustment with its note (corrections stay valid evidence)", async () => {
    const saved = await registerOrderPaymentTx({ ...payment("adj_ok", -100), kind: "adjustment", method: "unknown", note: "Devolución en efectivo" });
    expect(saved.payments[0]).toMatchObject({ amount: -100, amountCents: -10000 });
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
    wrongSum.update(parent, { lastPaymentId: "wrong-sum", paymentsRevision: (before.paymentsRevision ?? 0) + 1, paymentsReceivedCents: before.paymentsReceivedCents + 999 });
    await expect(wrongSum.commit()).rejects.toThrow();
    const hidden = writeBatch(holder.db);
    for (const id of ["hidden-a", "hidden-b"]) hidden.set(doc(holder.db, "orders/pay-order/payments", id), { ...payment(id, 10), amountCents: 1000 });
    hidden.update(parent, { lastPaymentId: "hidden-a", paymentsRevision: (before.paymentsRevision ?? 0) + 1, paymentsReceivedCents: before.paymentsReceivedCents + 1000 });
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
      expect(saved.payments[0]).toMatchObject({ amount, amountCents: cents });
      total += cents;
      expect((await getDoc(parent)).data()?.paymentsReceivedCents).toBe(total);
      const forgedCents = cents > 0 ? cents - 1 : cents + 1;
      const forgedId = `forged-cent-${i}`;
      const batch = writeBatch(holder.db);
      batch.set(doc(holder.db, "orders", orderId, "payments", forgedId), { ...record, id: forgedId, amountCents: forgedCents });
      batch.update(parent, { lastPaymentId: forgedId, paymentsRevision: i + 2, paymentsReceivedCents: total + forgedCents });
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
    forged.update(parent, { inheritedDepositMaterialized: true, paymentsRevision: 1, paymentsReceivedCents: 100000, lastPaymentId: "materialize-forged" });
    await expect(forged.commit()).rejects.toThrow();
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(0);
    const saved = await registerOrderPaymentTx({ ...payment("materialize-real", 1), orderId }, { method: "cash", date: "2026-10-20" });
    expect(saved.payments).toHaveLength(2);
    expect(saved.payments[0]).toMatchObject({ id: "inherited_deposit", amount: 1.005, amountCents: 101 });
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
    expect((await getDoc(doc(holder.db, "orders", orderId))).data()).toMatchObject({ paymentsReceivedCents: 30000, revision: 1 }); // R8: sin bump de reserva
    expect((await getDoc(doc(holder.db, "products/ledger-first-race-product"))).data()?.quantityOnHand).toBe(1); // apartada desde la creación
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(2);
  });


  it("materializes a legacy deposit once when the first two receipts race", async () => {
    const orderId = "ledger-inherited-race";
    await setDoc(doc(holder.db, "orders", orderId), { storeId: "tx-store", deposit: 400, items: [], createdAt: "", updatedAt: "" });
    await Promise.all([
      registerOrderPaymentTx({ ...payment("inherited-race-a", 100), orderId }, { method: "cash", date: "2026-10-20" }),
      registerOrderPaymentTx({ ...payment("inherited-race-b", 200), orderId }, { method: "transfer", date: "2026-10-21" }),
    ]);
    expect((await getDoc(doc(holder.db, "orders", orderId))).data()).toMatchObject({ paymentsReceivedCents: 70000, inheritedDepositMaterialized: true });
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(3);
  });


  it("propagates a real content rejection without writing a receipt or changing the balance", async () => {
    const parent = doc(holder.db, "orders/pay-order");
    const before = (await getDoc(parent)).data();
    await expect(registerOrderPaymentTx({ ...payment("service-invalid-actor", 10), createdBy: "another-operator" }, { method: "cash", date: "2026-10-20" })).rejects.toMatchObject({ code: "permission-denied" });
    expect((await getDoc(parent)).data()).toEqual(before);
    expect((await getDoc(doc(holder.db, "orders/pay-order/payments/service-invalid-actor"))).exists()).toBe(false);
  });


  it("returns the latest canonical balance on retry without changing evidence or its version", async () => {
    const orderId = "canonical-retry-order";
    await setDoc(doc(holder.db, "orders", orderId), { storeId: "tx-store", deposit: 0, items: [], createdAt: "", updatedAt: "" });
    const first = await registerOrderPaymentTx({ ...payment("canonical-first", 400), orderId });
    expect(first.order).toMatchObject({ paymentsReceivedCents: 40000, paymentsRevision: 1 });
    await registerOrderPaymentTx({ ...payment("canonical-adjustment", -150), orderId, kind: "adjustment", method: "unknown", note: "Corrección" });
    const retry = await registerOrderPaymentTx({ ...payment("canonical-first", 400), orderId });
    expect(retry.payments).toHaveLength(1);
    expect(retry.order).toMatchObject({ paymentsReceivedCents: 25000, paymentsRevision: 2 });
    // Adjustment date is system metadata, not a user-edited intent field.
    const nextDay = await registerOrderPaymentTx({ ...payment("canonical-adjustment", -150), orderId, kind: "adjustment", method: "unknown", note: "Corrección", date: "2026-11-04" });
    expect(nextDay.order).toMatchObject({ paymentsReceivedCents: 25000, paymentsRevision: 2 });
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(2);
    await expect(updateDoc(doc(holder.db, "orders", orderId), { paymentsRevision: 1 })).rejects.toThrow();
    await expect(registerOrderPaymentTx({ ...payment("canonical-first", 900), orderId })).rejects.toThrow(/otros datos guardados/);
    expect((await getDoc(doc(holder.db, "orders", orderId))).data()?.paymentsReceivedCents).toBe(25000);
  });

  it("prevents the #218 phantom after a real receipt and permits in-app repair", async () => {
    const orderId = "deposit-218-repro";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 0, items: [{ productName: "Pieza", quantity: 1, unitPrice: 720, subtotal: 720 }], orderStatus: "confirmed", createdAt: "", updatedAt: "" });
    const paid = await registerOrderPaymentTx({ ...payment("deposit-218-receipt", 590), orderId });
    const saved = await saveOrderWithStockTx({ uid: "tx-user", role: "member" } as any, { ...paid.order, deposit: 590 }, 0, "deposit-218-save");
    expect(saved.order.deposit).toBe(0);
    expect(docReceivedCents(saved.order)).toBe(59000);
    expect((await getDoc(parent)).data()).toMatchObject({ deposit: 0, paymentsReceivedCents: 59000 });
    // Synthetic corrupt legacy state: the approved repair lowers only deposit —
    // since #271 with its SIGNED justification (who/from→to/why).
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "orders", orderId), { deposit: 590 });
    });
    const repaired = await saveOrderWithStockTx({ uid: "tx-user", role: "member" } as any, { ...saved.order, deposit: 0 }, saved.order.revision!, "deposit-218-repair", { depositCorrectionNote: "Depósito duplicado: el cobro ya lo cubre" });
    expect(docReceivedCents(repaired.order)).toBe(59000);
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(1);
  });

  it("freezes materialized deposits and leaves deposit-only orders editable", async () => {
    const orderId = "deposit-218-materialized";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 100, items: [], createdAt: "", updatedAt: "" });
    const editable = await saveOrderWithStockTx({ uid: "tx-user", role: "member" } as any, { ...(await getDoc(parent)).data(), id: orderId, deposit: 200 } as Order, 0, "deposit-218-free");
    expect(editable.order.deposit).toBe(200);
    const paid = await registerOrderPaymentTx({ ...payment("deposit-218-materialize", 10), orderId }, { method: "cash", date: "2026-11-01" });
    const saved = await saveOrderWithStockTx({ uid: "tx-user", role: "member" } as any, { ...paid.order, deposit: 0 }, editable.order.revision!, "deposit-218-frozen");
    expect(saved.order.deposit).toBe(200);
    expect(saved.order.inheritedDepositMaterialized).toBe(true);
    expect(docReceivedCents(saved.order)).toBe(21000);
  });

  it("accepts successive receipts on a historical order without a deposit field (#218 review)", async () => {
    const orderId = "deposit-218-absent";
    await setDoc(doc(holder.db, "orders", orderId), { storeId: "tx-store", items: [], createdAt: "", updatedAt: "" });
    await registerOrderPaymentTx({ ...payment("deposit-218-absent-first", 100), orderId });
    await registerOrderPaymentTx({ ...payment("deposit-218-absent-second", 50), orderId });
    const adjusted = await registerOrderPaymentTx({ ...payment("deposit-218-absent-adjust", -10), orderId, kind: "adjustment", method: "unknown", note: "Corrección" });
    expect(adjusted.order.paymentsReceivedCents).toBe(14000);
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(3);
  });

  it("preserves a real pending deposit after an adjustment-first record (#218)", async () => {
    const orderId = "deposit-218-adjustment-first";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 100, items: [], createdAt: "", updatedAt: "" });
    const adjusted = await registerOrderPaymentTx({ ...payment("deposit-218-first-adjustment", 10), orderId, kind: "adjustment", method: "unknown", note: "Corrección previa" });
    expect(adjusted.order.inheritedDepositMaterialized).not.toBe(true);
    const saved = await saveOrderWithStockTx({ uid: "tx-user", role: "member" } as any, { ...adjusted.order, deposit: 200 }, 0, "deposit-218-adjust-first-save");
    expect(saved.order.deposit).toBe(100);
    expect(docReceivedCents(saved.order)).toBe(11000);
    const paid = await registerOrderPaymentTx({ ...payment("deposit-218-after-adjustment", 20), orderId }, { method: "cash", date: "2026-11-01" });
    expect(paid.order.inheritedDepositMaterialized).toBe(true);
    expect(docReceivedCents(paid.order)).toBe(13000);
  });

  // #270 (PO 2026-11-09): a "Restar" adjustment is capped at what THIS order
  // received — paymentsReceivedCents never crosses into negative territory,
  // so no phantom debt can absorb a sister order's real saldo a favor.
  it("rejects a subtract beyond what the order received, with the actionable cap (#270)", async () => {
    const orderId = "cap-270-order";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 0, items: [], createdAt: "", updatedAt: "" });
    await registerOrderPaymentTx({ ...payment("cap-270-receipt", 100), orderId });
    // The adversarial repro: $100 received, a $600 "devolución" (typo of $60).
    await expect(
      registerOrderPaymentTx({ ...payment("cap-270-huge", -600), orderId, kind: "adjustment", method: "unknown", note: "Devolución con typo" })
    ).rejects.toThrow(/Puedes restar hasta \$100\.00/);
    expect((await getDoc(parent)).data()?.paymentsReceivedCents).toBe(10000);
    expect((await getDoc(doc(holder.db, "orders", orderId, "payments/cap-270-huge"))).exists()).toBe(false);
    // A raw batched write cannot force the negative either — the rules hold.
    const before = (await getDoc(parent)).data()!;
    const force = writeBatch(holder.db);
    force.set(doc(holder.db, "orders", orderId, "payments/cap-270-force"), { ...payment("cap-270-force", -600), kind: "adjustment", method: "unknown", note: "Fuerza bruta", amountCents: -60000 });
    force.update(parent, { lastPaymentId: "cap-270-force", paymentsRevision: (before.paymentsRevision ?? 0) + 1, paymentsReceivedCents: before.paymentsReceivedCents - 60000 });
    await expect(force.commit()).rejects.toThrow();
    expect((await getDoc(parent)).data()?.paymentsReceivedCents).toBe(10000);
  });

  it("allows the subtract up to the exact floor, but not one cent further (#270)", async () => {
    const orderId = "cap-270-floor";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 0, items: [], createdAt: "", updatedAt: "" });
    await registerOrderPaymentTx({ ...payment("cap-270-floor-receipt", 100), orderId });
    const partial = await registerOrderPaymentTx({ ...payment("cap-270-floor-partial", -40), orderId, kind: "adjustment", method: "unknown", note: "Devolución parcial" });
    expect(partial.order.paymentsReceivedCents).toBe(6000);
    const exact = await registerOrderPaymentTx({ ...payment("cap-270-floor-exact", -60), orderId, kind: "adjustment", method: "unknown", note: "Devolución del resto" });
    expect(exact.order.paymentsReceivedCents).toBe(0);
    await expect(
      registerOrderPaymentTx({ ...payment("cap-270-floor-cent", -0.01), orderId, kind: "adjustment", method: "unknown", note: "Un centavo de más" })
    ).rejects.toThrow(/Puedes restar hasta \$0\.00/);
    expect((await getDoc(parent)).data()?.paymentsReceivedCents).toBe(0);
  });

  it("does not let the pending inherited deposit widen the subtract cap (#270)", async () => {
    // Domain nuance (PO): the unmaterialized deposit is money received, but it
    // is NOT in the accumulator — its repair path is the deposit flow, never a
    // free adjustment that would push the accumulator below zero.
    const orderId = "cap-270-deposit";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 500, items: [], createdAt: "", updatedAt: "" });
    await expect(
      registerOrderPaymentTx({ ...payment("cap-270-deposit-sub", -100), orderId, kind: "adjustment", method: "unknown", note: "Devolución del anticipo" })
    ).rejects.toThrow(/Puedes restar hasta \$0\.00/);
    expect((await getDoc(parent)).data()?.paymentsReceivedCents).toBeUndefined();
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(0);
  });

  it("serializes two racing subtracts so the accumulator never goes negative (#270)", async () => {
    const orderId = "cap-270-race";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 0, items: [], createdAt: "", updatedAt: "" });
    await registerOrderPaymentTx({ ...payment("cap-270-race-receipt", 100), orderId });
    const results = await Promise.allSettled([
      registerOrderPaymentTx({ ...payment("cap-270-race-a", -60), orderId, kind: "adjustment", method: "unknown", note: "Devolución A" }),
      registerOrderPaymentTx({ ...payment("cap-270-race-b", -60), orderId, kind: "adjustment", method: "unknown", note: "Devolución B" }),
    ]);
    // Each fits alone ($100 received), together they do not ($120): exactly
    // one survives the transactional re-read, the other fails with the cap.
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect((await getDoc(parent)).data()?.paymentsReceivedCents).toBe(4000);
    expect((await getDocs(collection(holder.db, "orders", orderId, "payments"))).size).toBe(2); // receipt + one adjustment
  });

  it("lets a legacy negative accumulator climb back, but never deepen (#270)", async () => {
    const orderId = "cap-270-legacy";
    const parent = doc(holder.db, "orders", orderId);
    // Synthetic legacy corruption: the pre-#270 bug could leave a negative.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders", orderId), { storeId: "tx-store", deposit: 0, items: [], createdAt: "", updatedAt: "", paymentsReceivedCents: -50000, paymentsRevision: 3, lastPaymentId: "legacy" });
    });
    // A partial "Sumar" still lands negative but strictly improves — allowed.
    const repair = await registerOrderPaymentTx({ ...payment("cap-270-repair", 200), orderId, kind: "adjustment", method: "unknown", note: "Reparación parcial del negativo histórico" });
    expect(repair.order.paymentsReceivedCents).toBe(-30000);
    // Deepening the negative is denied at the rules layer, raw write included.
    const before = (await getDoc(parent)).data()!;
    const deepen = writeBatch(holder.db);
    deepen.set(doc(holder.db, "orders", orderId, "payments/cap-270-deepen"), { ...payment("cap-270-deepen", -100), kind: "adjustment", method: "unknown", note: "Empeorar", amountCents: -10000 });
    deepen.update(parent, { lastPaymentId: "cap-270-deepen", paymentsRevision: (before.paymentsRevision ?? 0) + 1, paymentsReceivedCents: before.paymentsReceivedCents - 10000 });
    await expect(deepen.commit()).rejects.toThrow();
    // And a subtract via the transaction is capped at zero received.
    await expect(
      registerOrderPaymentTx({ ...payment("cap-270-legacy-sub", -1), orderId, kind: "adjustment", method: "unknown", note: "Restar sobre negativo" })
    ).rejects.toThrow(/Puedes restar hasta \$0\.00/);
    expect((await getDoc(parent)).data()?.paymentsReceivedCents).toBe(-30000);
  });

  // #271 (PO 2026-11-09): lowering the deposit with payment evidence in the
  // doc requires a SIGNED correction — the silent edit erased real money.
  it("rejects a silent deposit lowering with evidence and records it with the motive (#271)", async () => {
    const orderId = "lower-271-order";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 500, items: [], createdAt: "", updatedAt: "" });
    // The #271 repro: an adjustment creates the accumulator WITHOUT
    // materializing the legacy deposit.
    await registerOrderPaymentTx({ ...payment("lower-271-adj", 10), orderId, kind: "adjustment", method: "unknown", note: "Corrección previa" });
    // Silent lowering: refused, nothing changes.
    const before = (await getDoc(parent)).data()!;
    await expect(
      saveOrderWithStockTx({ uid: "tx-user", role: "member" } as any, { ...(await getDoc(parent)).data(), id: orderId, deposit: 100 } as Order, 0, "lower-271-silent")
    ).rejects.toThrow(/motivo de la corrección/);
    expect((await getDoc(parent)).data()).toEqual(before);
    // With the motive: the lowering lands WITH its signed record.
    const corrected = await saveOrderWithStockTx(
      { uid: "tx-user", role: "member" } as any,
      { ...(await getDoc(parent)).data(), id: orderId, deposit: 100 } as Order,
      0,
      "lower-271-signed",
      { depositCorrectionNote: "Anticipo capturado por error: era $100" }
    );
    expect(corrected.order.deposit).toBe(100);
    expect(corrected.order.depositCorrections).toHaveLength(1);
    expect(corrected.order.depositCorrections![0]).toMatchObject({ from: 500, to: 100, by: "tx-user", note: "Anticipo capturado por error: era $100" });
    // The view keeps every peso accounted for: accumulator $10 + deposit $100.
    expect(docReceivedCents(corrected.order)).toBe(11000);
    expect((await getDoc(parent)).data()).toMatchObject({ deposit: 100, paymentsReceivedCents: 1000 });
  });

  it("a raw batched deposit lowering without the signed entry is denied by the rules (#271)", async () => {
    const orderId = "lower-271-raw";
    const parent = doc(holder.db, "orders", orderId);
    // Money fields on create are denied to clients — seed as the emulator
    // itself (the synthetic-corruption pattern of the #218 tests).
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders", orderId), { storeId: "tx-store", deposit: 500, items: [], createdAt: "", updatedAt: "", paymentsReceivedCents: 1000, paymentsRevision: 1, lastPaymentId: "seed" });
    });
    const direct = writeBatch(holder.db);
    direct.update(parent, { deposit: 100 });
    await expect(direct.commit()).rejects.toThrow();
    // A forged entry that does not match the change is still denied.
    const forged = writeBatch(holder.db);
    forged.update(parent, { deposit: 100, depositCorrections: [{ from: 999, to: 100, note: "Inventado", by: "tx-user", at: "2026-11-09T00:00:00.000Z" }] });
    await expect(forged.commit()).rejects.toThrow();
    // Another operator's signature does not pass either.
    const foreignBatch = writeBatch(holder.db);
    foreignBatch.update(parent, { deposit: 100, depositCorrections: [{ from: 500, to: 100, note: "No fui yo", by: "someone-else", at: "2026-11-09T00:00:00.000Z" }] });
    await expect(foreignBatch.commit()).rejects.toThrow();
    expect((await getDoc(parent)).data()?.deposit).toBe(500);
  });

  it("deposit lowering WITHOUT an accumulator stays free — the typo repair path (#271)", async () => {
    const orderId = "lower-271-free";
    const parent = doc(holder.db, "orders", orderId);
    await setDoc(parent, { storeId: "tx-store", deposit: 400, items: [], createdAt: "", updatedAt: "" });
    const fixed = await saveOrderWithStockTx({ uid: "tx-user", role: "member" } as any, { ...(await getDoc(parent)).data(), id: orderId, deposit: 100 } as Order, 0, "lower-271-free-fix");
    expect(fixed.order.deposit).toBe(100);
    expect(fixed.order.depositCorrections).toBeUndefined();
  });

  it("ordinary edits carry the corrections verbatim and cannot strip them (#271)", async () => {
    const orderId = "lower-271-carry";
    const parent = doc(holder.db, "orders", orderId);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders", orderId), { storeId: "tx-store", deposit: 200, items: [], notes: "", createdAt: "", updatedAt: "", paymentsReceivedCents: 500, paymentsRevision: 1, lastPaymentId: "seed", depositCorrections: [{ from: 500, to: 200, note: "Primera corrección", by: "tx-user", at: "2026-11-09T01:00:00.000Z" }] });
    });
    const edited = await saveOrderWithStockTx({ uid: "tx-user", role: "member" } as any, { ...(await getDoc(parent)).data(), id: orderId, notes: "nota nueva" } as Order, 0, "lower-271-carry-edit");
    expect(edited.order.depositCorrections).toHaveLength(1);
    // Stripping them by hand is denied.
    await expect(updateDoc(parent, { depositCorrections: [] })).rejects.toThrow();
    expect((await getDoc(parent)).data()?.depositCorrections).toHaveLength(1);
  });

  // ── #369: no new cobros on a cancelled order ─────────────────────────────
  // A cancelled order's money has no way out (no compensations, no incident
  // refund, no delete-with-evidence), so receiving MORE there traps cash.

  it("#369 rejects a cobro on a cancelled order (tx fail-closed, prior evidence preserved)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "orders/cancelled-pay-order"), {
        storeId: "tx-store",
        items: [{ lineId: "cp_L0", productName: "Aro Sol", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, orderStatus: "cancelled",
        paymentsReceivedCents: 3000, paymentsRevision: 1, lastPaymentId: "canc_prior",
        inheritedDepositMaterialized: true,
        createdAt: "", updatedAt: "",
      });
      await setDoc(doc(db, "orders/cancelled-pay-order/payments/canc_prior"), {
        id: "canc_prior", orderId: "cancelled-pay-order", storeId: "tx-store",
        date: "2026-11-01", method: "cash", kind: "payment", amount: 30, amountCents: 3000,
        createdAt: "2026-11-01T10:00:00.000Z", createdBy: "tx-user",
      });
    });
    await expect(
      registerOrderPaymentTx({ ...payment("canc_new", 50), orderId: "cancelled-pay-order" })
    ).rejects.toThrow(/cancelado/i);
    // Fail-closed leaves NO partial writes: prior evidence intact, nothing new.
    const order = (await getDoc(doc(holder.db, "orders/cancelled-pay-order"))).data()!;
    expect(order.orderStatus).toBe("cancelled");
    expect(order.paymentsReceivedCents).toBe(3000);
    expect(order.lastPaymentId).toBe("canc_prior");
    const docs = await getDocs(collection(holder.db, "orders/cancelled-pay-order/payments"));
    expect(docs.size).toBe(1);
  });

  it("#369 rules deny a raw SDK cobro batch on a cancelled order", async () => {
    const parent = doc(holder.db, "orders/cancelled-pay-order");
    const before = (await getDoc(parent)).data()!;
    const record = { ...payment("canc_sdk", 50), orderId: "cancelled-pay-order", amountCents: 5000 };
    const batch = writeBatch(holder.db);
    batch.set(doc(holder.db, "orders/cancelled-pay-order/payments/canc_sdk"), record);
    batch.update(parent, { lastPaymentId: "canc_sdk", paymentsRevision: (before.paymentsRevision ?? 0) + 1, paymentsReceivedCents: before.paymentsReceivedCents + 5000 });
    await expect(batch.commit()).rejects.toThrow();
    const docs = await getDocs(collection(holder.db, "orders/cancelled-pay-order/payments"));
    expect(docs.size).toBe(1); // only the prior evidence
  });

  it("#369 regla: cancelado LEGADO con campo plano status también rechaza el lote SDK", async () => {
    // Review #1 hallazgo MENOR: docs previos a orderStatus solo portan `status`.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/cancelled-legacy-status"), {
        storeId: "tx-store",
        items: [{ lineId: "cls_L0", productName: "Aro Sol", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, status: "cancelled", // legacy plane field — no orderStatus
        createdAt: "", updatedAt: "",
      });
    });
    const parent = doc(holder.db, "orders/cancelled-legacy-status");
    const record = { ...payment("cls_sdk", 50), orderId: "cancelled-legacy-status", amountCents: 5000 };
    const batch = writeBatch(holder.db);
    batch.set(doc(holder.db, "orders/cancelled-legacy-status/payments/cls_sdk"), record);
    batch.update(parent, { lastPaymentId: "cls_sdk", paymentsRevision: 1, paymentsReceivedCents: 5000 });
    await expect(batch.commit()).rejects.toThrow();
    const docs = await getDocs(collection(holder.db, "orders/cancelled-legacy-status/payments"));
    expect(docs.size).toBe(0);
  });

  it("#369 a signed adjustment on a cancelled order stays valid evidence (the exit is a separate PO decision)", async () => {
    const saved = await registerOrderPaymentTx({
      ...payment("canc_adj", -30), orderId: "cancelled-pay-order",
      kind: "adjustment", method: "unknown", note: "Devolución en efectivo",
    });
    expect(saved.payments[0]).toMatchObject({ amount: -30, kind: "adjustment" });
    const order = (await getDoc(doc(holder.db, "orders/cancelled-pay-order"))).data()!;
    expect(order.paymentsReceivedCents).toBe(0); // 3000 − 3000, evidence kept
  });

});
