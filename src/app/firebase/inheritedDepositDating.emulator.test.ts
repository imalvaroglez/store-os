import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, runTransaction, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { materializeInheritedDepositTx } from "./firestoreData";

let env: RulesTestEnvironment;

// The #455 r5 scenario: TOTAL anticipo captured at creation, nothing left to
// collect, no payment records — the money needs a date for the monthly close.
const orderDoc = (extra: Record<string, unknown> = {}) => ({
  storeId: "date-store",
  customerId: "c1",
  items: [{ lineId: "l1", productId: "p1", productName: "Collar", quantity: 1, unitPrice: 300, subtotal: 300 }],
  deposit: 300,
  orderStatus: "delivered",
  paymentStatus: "paid",
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
  ...extra,
});

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#455 r5 — materializar la fecha del anticipo sin cobro nuevo", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "adminStores/date-store"), { ownerUid: "date-owner", memberUids: ["date-owner"] });
      await setDoc(doc(ctx.firestore(), "products/p1"), { storeId: "date-store", quantityOnHand: 0 });
      await setDoc(doc(ctx.firestore(), "orders/date-o1"), orderDoc());
      await setDoc(doc(ctx.firestore(), "orders/date-o2"), orderDoc());
      await setDoc(doc(ctx.firestore(), "orders/date-o3"), orderDoc());
      // o4: a forged dating write against an order that ALREADY has cobros.
      await setDoc(doc(ctx.firestore(), "orders/date-o4"), orderDoc({ paymentsReceivedCents: 10000, paymentsRevision: 1, lastPaymentId: "pay1" }));
      await setDoc(doc(ctx.firestore(), "orders/date-o4/payments/pay1"), { id: "pay1", orderId: "date-o4", storeId: "date-store", kind: "payment", method: "cash", date: "2026-11-06", amount: 100, amountCents: 10000, createdAt: "2026-11-06T10:00:00.000Z", createdBy: "date-owner" });
    });
    holder.db = env.authenticatedContext("date-owner").firestore();
  });
  afterAll(async () => { await env?.cleanup(); });

  it("el helper REAL registra fecha y método: nace el acumulador desde el recibo heredado", async () => {
    const result = await materializeInheritedDepositTx({
      orderId: "date-o1",
      storeId: "date-store",
      input: { method: "cash", date: "2026-11-05" },
      by: "date-owner",
    });
    expect(result.order.inheritedDepositMaterialized).toBe(true);
    expect(result.order.paymentsReceivedCents).toBe(30000);
    const receipt = (await getDoc(doc(holder.db, "orders/date-o1/payments/inherited_deposit"))).data();
    expect(receipt).toMatchObject({ date: "2026-11-05", method: "cash", amount: 300 });
  });

  it("es idempotente hacia el operador: repetir avisa en español sin romper nada", async () => {
    await expect(
      materializeInheritedDepositTx({ orderId: "date-o1", storeId: "date-store", input: { method: "transfer", date: "2026-11-05" }, by: "date-owner" })
    ).rejects.toThrow(/ya está registrado/i);
  });

  it("la fecha es obligatoria y con formato — nunca 'sin fecha' en el cierre", async () => {
    await expect(
      materializeInheritedDepositTx({ orderId: "date-o2", storeId: "date-store", input: { method: "cash", date: "" }, by: "date-owner" })
    ).rejects.toThrow(/Captura la fecha del anticipo/i);
  });

  it("con cobros previos la vía es el siguiente cobro, no esta escritura", async () => {
    await expect(
      materializeInheritedDepositTx({ orderId: "date-o4", storeId: "date-store", input: { method: "cash", date: "2026-11-05" }, by: "date-owner" })
    ).rejects.toThrow(/junto con el siguiente cobro/i);
  });

  it("por SDK directo: la forma exacta del helper pasa; las variantes forjadas no", async () => {
    // The helper's exact batch shape on a pristine order: ALLOWED.
    await runTransaction(holder.db, async (tx) => {
      const orderRef = doc(holder.db as any, "orders/date-o2");
      tx.set(doc(holder.db as any, "orders/date-o2/payments/inherited_deposit"), {
        id: "inherited_deposit", orderId: "date-o2", storeId: "date-store",
        date: "2026-11-05", method: "cash", kind: "payment", amount: 300, amountCents: 30000,
        note: "Anticipo previo: fecha y método estimados por la operadora.",
        createdAt: "2026-11-17T10:00:00.000Z", createdBy: "date-owner",
      });
      tx.update(orderRef, { paymentsReceivedCents: 30000, inheritedDepositMaterialized: true, paymentsRevision: 1, updatedAt: "2026-11-17T10:00:00.000Z" });
    });
    const saved = (await getDoc(doc(holder.db, "orders/date-o2"))).data();
    expect(saved?.inheritedDepositMaterialized).toBe(true);

    // Forged: accumulator already exists → this shape dies (o4).
    await expect(
      runTransaction(holder.db, async (tx) => {
        tx.set(doc(holder.db as any, "orders/date-o4/payments/inherited_deposit"), {
          id: "inherited_deposit", orderId: "date-o4", storeId: "date-store",
          date: "2026-11-05", method: "cash", kind: "payment", amount: 300,
          createdAt: "2026-11-17T10:00:00.000Z", createdBy: "date-owner",
        });
        tx.update(doc(holder.db as any, "orders/date-o4"), { paymentsReceivedCents: 40000, inheritedDepositMaterialized: true, paymentsRevision: 2, updatedAt: "2026-11-17T10:00:00.000Z" });
      })
    ).rejects.toThrow(/PERMISSION/i);

    // Forged: receipt amount does not match the deposit (o3).
    await expect(
      runTransaction(holder.db, async (tx) => {
        tx.set(doc(holder.db as any, "orders/date-o3/payments/inherited_deposit"), {
          id: "inherited_deposit", orderId: "date-o3", storeId: "date-store",
          date: "2026-11-05", method: "cash", kind: "payment", amount: 999, amountCents: 99900,
          createdAt: "2026-11-17T10:00:00.000Z", createdBy: "date-owner",
        });
        tx.update(doc(holder.db as any, "orders/date-o3"), { paymentsReceivedCents: 99900, inheritedDepositMaterialized: true, paymentsRevision: 1, updatedAt: "2026-11-17T10:00:00.000Z" });
      })
    ).rejects.toThrow(/PERMISSION/i);

    // Forged: deposit silently CHANGED in the same write (o3, correct amount
    // for the new deposit) — the dating write never moves the deposit.
    await expect(
      runTransaction(holder.db, async (tx) => {
        tx.set(doc(holder.db as any, "orders/date-o3/payments/inherited_deposit"), {
          id: "inherited_deposit", orderId: "date-o3", storeId: "date-store",
          date: "2026-11-05", method: "cash", kind: "payment", amount: 500, amountCents: 50000,
          createdAt: "2026-11-17T10:00:00.000Z", createdBy: "date-owner",
        });
        tx.update(doc(holder.db as any, "orders/date-o3"), { deposit: 500, paymentsReceivedCents: 50000, inheritedDepositMaterialized: true, paymentsRevision: 1, updatedAt: "2026-11-17T10:00:00.000Z" });
      })
    ).rejects.toThrow(/PERMISSION/i);
  });
});
