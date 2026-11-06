import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { OrderCreditLedgerEntry } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { applyCustomerCreditTx, releaseCustomerCreditTx } from "./firestoreData";

let env: RulesTestEnvironment;

const entry = (id: string, amountCents: number, fromOrderId = "credit-origin"): OrderCreditLedgerEntry => ({
  id, kind: "application", fromOrderId, amountCents, at: "2026-11-05T10:00:00.000Z", by: "tx-user",
});

const orderDoc = (id: string, extra: Record<string, unknown> = {}) => ({
  storeId: "credit-store",
  customerId: "credit-clienta",
  items: [{ productName: "Pieza", quantity: 1, unitPrice: 200, subtotal: 200, lineId: `${id}_L0` }],
  deposit: 0,
  orderStatus: "confirmed",
  paymentsReceivedCents: 0,
  inheritedDepositMaterialized: true,
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
  ...extra,
});

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("customer credit transactions with Firestore rules (#189)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/tx-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/credit-store"), { ownerUid: "tx-user", memberUids: ["tx-user"] });
      await setDoc(doc(ctx.firestore(), "adminStores/foreign-store"), { ownerUid: "someone-else", memberUids: ["someone-else"] });
      await setDoc(doc(ctx.firestore(), "orders/credit-origin"), orderDoc("credit-origin", {
        items: [{ productName: "Anillo", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "credit-origin_L0" }],
        paymentsReceivedCents: 11500, // overpaid: $100 total, $115 received → $15 credit
      }));
      await setDoc(doc(ctx.firestore(), "orders/credit-dest"), orderDoc("credit-dest")); // owes $200
      await setDoc(doc(ctx.firestore(), "orders/foreign-origin"), { ...orderDoc("foreign-origin"), storeId: "foreign-store", paymentsReceivedCents: 11500 });
      await setDoc(doc(ctx.firestore(), "orders/other-clienta"), { ...orderDoc("other-clienta", { paymentsReceivedCents: 21500 }), customerId: "otra-clienta" });
    });
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("applies the planned compensation atomically across both order documents", async () => {
    await applyCustomerCreditTx({ entry: entry("app_1", 1500), orderId: "credit-dest", storeId: "credit-store" });
    const dest = (await getDoc(doc(holder.db, "orders/credit-dest"))).data()!;
    const origin = (await getDoc(doc(holder.db, "orders/credit-origin"))).data()!;
    expect(dest.creditAppliedCents).toBe(1500);
    expect(Array.isArray(dest.creditLedger)).toBe(true);
    expect((dest.creditLedger as Array<{ id: string }>)[0].id).toBe("app_1");
    expect(origin.creditConsumedCents).toBe(1500);
  });

  it("is idempotent: retrying the same entry id writes nothing new", async () => {
    await applyCustomerCreditTx({ entry: entry("app_1", 1500), orderId: "credit-dest", storeId: "credit-store" });
    const dest = (await getDoc(doc(holder.db, "orders/credit-dest"))).data()!;
    expect(dest.creditAppliedCents).toBe(1500); // NOT 3000
    expect((dest.creditLedger as unknown[]).length).toBe(1);
  });

  it("aborts a stale plan: more than the fresh available credit or pending balance", async () => {
    await expect(
      applyCustomerCreditTx({ entry: entry("app_stale", 500), orderId: "credit-dest", storeId: "credit-store" })
    ).rejects.toThrow(/saldo (a favor|del pedido) cambió/i);
    const dest = (await getDoc(doc(holder.db, "orders/credit-dest"))).data()!;
    expect(dest.creditAppliedCents).toBe(1500); // untouched
  });

  it("never crosses stores or customers, and skips cancelled orders", async () => {
    // Cross-store: the RULES deny the foreign doc read before the store check
    // even runs — rejection either way, defense in depth.
    await expect(
      applyCustomerCreditTx({ entry: entry("app_xstore", 1000, "foreign-origin"), orderId: "credit-dest", storeId: "credit-store" })
    ).rejects.toThrow();
    await expect(
      applyCustomerCreditTx({ entry: entry("app_xclienta", 1000, "other-clienta"), orderId: "credit-dest", storeId: "credit-store" })
    ).rejects.toThrow(/misma clienta/i);
    await updateDoc(doc(holder.db, "orders/credit-dest"), { orderStatus: "cancelled" });
    await expect(
      applyCustomerCreditTx({ entry: entry("app_cancelled", 100), orderId: "credit-dest", storeId: "credit-store" })
    ).rejects.toThrow(/cancelado/i);
    await updateDoc(doc(holder.db, "orders/credit-dest"), { orderStatus: "confirmed" });
  });

  it("restitutes on valid cancellation and re-running writes nothing", async () => {
    await updateDoc(doc(holder.db, "orders/credit-dest"), { orderStatus: "cancelled" });
    const released = await releaseCustomerCreditTx({ orderId: "credit-dest", storeId: "credit-store", by: "tx-user" });
    expect(released).toBe(1500);
    const dest = (await getDoc(doc(holder.db, "orders/credit-dest"))).data()!;
    const origin = (await getDoc(doc(holder.db, "orders/credit-origin"))).data()!;
    expect(dest.creditAppliedCents).toBe(0);
    expect(origin.creditConsumedCents).toBe(0);
    const ledger = dest.creditLedger as Array<{ kind: string }>;
    expect(ledger.filter((e) => e.kind === "release")).toHaveLength(1);
    // Idempotent: net is zero now.
    const again = await releaseCustomerCreditTx({ orderId: "credit-dest", storeId: "credit-store", by: "tx-user" });
    expect(again).toBe(0);
    expect((dest.creditLedger as unknown[]).length).toBe(2);
  });

  it("a member of another store cannot touch these orders (rules)", async () => {
    const foreign = env.authenticatedContext("someone-else").firestore();
    await expect(
      getDoc(doc(foreign, "orders/credit-dest"))
    ).rejects.toThrow();
  });
});
