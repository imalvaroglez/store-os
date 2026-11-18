import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { saveOrderWithStockTx } from "./firestoreData";

let env: RulesTestEnvironment;

const line = (lineId: string, unitPrice: number) =>
  ({ lineId, productId: `p-${lineId}`, name: `Pieza ${lineId}`, quantity: 1, unitPrice, subtotal: unitPrice });

const asOrder = (id: string, customerId: string, items: unknown[], extra: Record<string, unknown> = {}): Order =>
  ({ id, storeId: "inv367-store", customerId, items: items as Order["items"], deposit: 0,
     orderStatus: "confirmed", paymentStatus: "unpaid",
     createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", ...extra } as unknown as Order);

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("credit customer change with Firestore rules (#367)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/inv367-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/inv367-store"), { ownerUid: "inv367-user", memberUids: ["inv367-user"] });
      // A destination order: María's money ($700 applied) sits on it.
      await setDoc(doc(ctx.firestore(), "orders/inv367-o2"), {
        storeId: "inv367-store", customerId: "maria", items: [line("o2-a", 1000)], deposit: 0,
        orderStatus: "confirmed", paymentsReceivedCents: 30000, creditAppliedCents: 70000, revision: 1,
        createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
      });
      // An origin order: consumed credit mirror on it.
      await setDoc(doc(ctx.firestore(), "orders/inv367-o1"), {
        storeId: "inv367-store", customerId: "maria", items: [line("o1-a", 1000)], deposit: 0,
        orderStatus: "confirmed", paymentsReceivedCents: 150000, creditConsumedCents: 50000, revision: 1,
        createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
      });
      // A REAL settled credit: application + release entries (both positive,
      // append-only) with zero accumulators — the state releaseCredit leaves.
      await setDoc(doc(ctx.firestore(), "orders/inv367-o3"), {
        storeId: "inv367-store", customerId: "maria", items: [line("o3-a", 400)], deposit: 0,
        orderStatus: "confirmed", revision: 1,
        creditAppliedCents: 0,
        creditLedger: [
          { id: "e1", kind: "application", amountCents: 40000, at: "2026-11-01T00:00:00.000Z", by: "inv367-user" },
          { id: "e2", kind: "release", amountCents: 40000, at: "2026-11-02T00:00:00.000Z", by: "inv367-user" },
        ],
        createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
      });
      // A credit-free order: changing its clienta is ordinary work.
      await setDoc(doc(ctx.firestore(), "orders/inv367-o4"), {
        storeId: "inv367-store", customerId: "maria", items: [line("o4-a", 300)], deposit: 0,
        orderStatus: "confirmed", revision: 1,
        createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
      });
    });
    holder.db = env.authenticatedContext("inv367-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("blocks changing the clienta of an order with credit APPLIED (money would transfer between people)", async () => {
    await expect(
      saveOrderWithStockTx({ uid: "inv367-user" } as never, asOrder("inv367-o2", "ana", [line("o2-a", 1000)]), 1, "mut-367-a")
    ).rejects.toThrow(/cambiar la clienta movería ese dinero a otra persona/);
    const after = (await getDoc(doc(holder.db, "orders/inv367-o2"))).data();
    expect(after?.customerId).toBe("maria"); // untouched
    expect(after?.revision).toBe(1);
  });

  it("blocks changing the clienta of an order SUSTAINING consumed credit", async () => {
    await expect(
      saveOrderWithStockTx({ uid: "inv367-user" } as never, asOrder("inv367-o1", "ana", [line("o1-a", 1000)]), 1, "mut-367-b")
    ).rejects.toThrow(/cambiar la clienta movería ese dinero/);
  });

  it("allows the clienta change after a REAL settled ledger (application + release, zero accumulators)", async () => {
    const saved = await saveOrderWithStockTx({ uid: "inv367-user" } as never, asOrder("inv367-o3", "ana", [line("o3-a", 400)]), 1, "mut-367-c");
    expect(saved.order.revision).toBe(2);
    expect((await getDoc(doc(holder.db, "orders/inv367-o3"))).data()?.customerId).toBe("ana");
  });

  it("credit-free orders change clienta as always", async () => {
    const saved = await saveOrderWithStockTx({ uid: "inv367-user" } as never, asOrder("inv367-o4", "lucia", [line("o4-a", 300)]), 1, "mut-367-d");
    expect(saved.order.revision).toBe(2);
  });
});
