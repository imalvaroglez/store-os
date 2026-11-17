import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order, OrderPayment } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { registerOrderPaymentTx, saveOrderWithStockTx } from "./firestoreData";

let env: RulesTestEnvironment;

const line = (lineId: string, unitPrice: number, quantity = 1) =>
  ({ lineId, productId: `p-${lineId}`, name: `Pieza ${lineId}`, quantity, unitPrice, subtotal: unitPrice * quantity });

const orderDoc = (items: unknown[], extra: Record<string, unknown> = {}) =>
  ({ storeId: "inv366-store", items, deposit: 0, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", ...extra });

const asOrder = (id: string, items: unknown[], extra: Record<string, unknown> = {}): Order =>
  ({ id, storeId: "inv366-store", customerId: "c1", items: items as Order["items"], deposit: 0,
     orderStatus: "confirmed", paymentStatus: "unpaid",
     createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", ...extra } as unknown as Order);

// Runs in CI's rules job (emulator); skipped locally per the no-emulators rule.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("credit edit invariants with Firestore rules (#366)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/inv366-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/inv366-store"), { ownerUid: "inv366-user", memberUids: ["inv366-user"] });
      // O1 — the ORIGIN: overpaid by $500 which a sister order already consumed.
      await setDoc(doc(ctx.firestore(), "orders/inv366-o1"), orderDoc([line("o1-a", 1000)], {
        orderStatus: "confirmed", paymentsReceivedCents: 150000, creditConsumedCents: 50000, revision: 3,
      }));
      // O2 — the DESTINATION: $300 cash + $700 credit = exactly covered.
      await setDoc(doc(ctx.firestore(), "orders/inv366-o2"), orderDoc([line("o2-a", 1000)], {
        orderStatus: "confirmed", paymentsReceivedCents: 30000, creditAppliedCents: 70000, revision: 1,
      }));
      // O3 — pre-ledger: no credit accumulators at all.
      await setDoc(doc(ctx.firestore(), "orders/inv366-o3"), orderDoc([line("o3-a", 400)], { revision: 1 }));
    });
    holder.db = env.authenticatedContext("inv366-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("blocks editing the ORIGIN into under-covering its consumed credit (scenario 1)", async () => {
    // Total $10 → $14 leaves $1,500 received − $1,400 = $100 < the $500 consumed.
    await expect(
      saveOrderWithStockTx({ uid: "inv366-user" } as never, asOrder("inv366-o1", [line("o1-a", 1000), line("o1-b", 400)]), 3, "mut-366-a")
    ).rejects.toThrow(/sostiene \$500\.00 de saldo a favor/);
    const after = (await getDoc(doc(holder.db, "orders/inv366-o1"))).data();
    expect(after?.items).toHaveLength(1); // nothing was written
    expect(after?.revision).toBe(3);
  });

  it("an in-limit edit of the ORIGIN still saves (surplus keeps covering the consumption)", async () => {
    // Total $10 → $9: surplus $600 ≥ the $500 consumed — must save.
    const saved = await saveOrderWithStockTx({ uid: "inv366-user" } as never, asOrder("inv366-o1", [line("o1-a", 900)]), 3, "mut-366-b");
    expect(saved.order.revision).toBe(4);
    const after = (await getDoc(doc(holder.db, "orders/inv366-o1"))).data();
    expect(after?.paymentsReceivedCents).toBe(150000); // money fields verbatim
    expect(after?.creditConsumedCents).toBe(50000); // credit fields verbatim
  });

  it("blocks LOWERING the DESTINATION total below cash+credit (scenario 2: stranded money)", async () => {
    // $300 + $700 applied > $500 new total → $500 would vanish from every view.
    await expect(
      saveOrderWithStockTx({ uid: "inv366-user" } as never, asOrder("inv366-o2", [line("o2-a", 500)]), 1, "mut-366-c")
    ).rejects.toThrow(/saldo a favor aplicado.*bajando el total/);
    const after = (await getDoc(doc(holder.db, "orders/inv366-o2"))).data();
    expect(after?.items[0].unitPrice).toBe(1000); // untouched
    expect(after?.revision).toBe(1);
  });

  it("raising the DESTINATION total saves fine (no over-coverage)", async () => {
    const saved = await saveOrderWithStockTx({ uid: "inv366-user" } as never, asOrder("inv366-o2", [line("o2-a", 1200)]), 1, "mut-366-d");
    expect(saved.order.revision).toBe(2);
  });

  it("pre-ledger documents (no credit accumulators) edit without new guards", async () => {
    const saved = await saveOrderWithStockTx({ uid: "inv366-user" } as never, asOrder("inv366-o3", [line("o3-a", 600)]), 1, "mut-366-e");
    expect(saved.order.revision).toBe(2);
  });

  it("the «Restar» adjustment cap accounts for the credit this order sustains (criterion 2)", async () => {
    // O1 received $1,500 and sustains $500 consumed — the ceiling is $1,000,
    // not $1,500: draining the consumed surplus by another door is the same
    // broken invariant as scenario 1. Subtracting $1,100 lands at $400 < $500.
    const adjustment: OrderPayment = {
      id: "adj-366-fresh", orderId: "inv366-o1", storeId: "inv366-store",
      date: "2026-11-10", method: "cash", kind: "adjustment", amount: -1100,
      note: "prueba", createdAt: "2026-11-10T10:00:00.000Z", createdBy: "inv366-user",
    };
    await expect(registerOrderPaymentTx(adjustment)).rejects.toThrow(/Puedes restar hasta \$1,000\.00/);
    const after = (await getDoc(doc(holder.db, "orders/inv366-o1"))).data();
    expect(after?.paymentsReceivedCents).toBe(150000); // untouched
  });
});
