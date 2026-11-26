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
  ({ storeId: "inv366-store", customerId: "c1", items, deposit: 0, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", ...extra });

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
      // O4 — review H1: received $2,000, total $1,000, consumed $500 → the
      // FREE surplus (honest Restar ceiling) is $500, not $1,500.
      await setDoc(doc(ctx.firestore(), "orders/inv366-o4"), orderDoc([line("o4-a", 1000)], {
        orderStatus: "confirmed", paymentsReceivedCents: 200000, creditConsumedCents: 50000, revision: 1,
      }));
      // O5 — review H3: starts WITHOUT credit; the concurrent test seeds it
      // after the editor captured its stale copy.
      await setDoc(doc(ctx.firestore(), "orders/inv366-o5"), orderDoc([line("o5-a", 1000)], { revision: 1 }));
      // O6 — review H1: EXACT coverage (received 1500, total 1000, consumed
      // 500) on its own doc so the suite stays order-independent.
      await setDoc(doc(ctx.firestore(), "orders/inv366-o6"), orderDoc([line("o6-a", 1000)], {
        orderStatus: "confirmed", paymentsReceivedCents: 150000, creditConsumedCents: 50000, revision: 1,
      }));
      // O7/O9 — #524: converted into a point's first surtido. O8 — ordinary.
      // Each on its own doc so the point-link tests stay order-independent.
      await setDoc(doc(ctx.firestore(), "orders/inv366-o7"), orderDoc([line("o7-a", 1000)], {
        orderStatus: "confirmed", revision: 1, convertedToPointId: "inv366-point",
      }));
      await setDoc(doc(ctx.firestore(), "orders/inv366-o8"), orderDoc([line("o8-a", 400)], { revision: 1 }));
      await setDoc(doc(ctx.firestore(), "orders/inv366-o9"), orderDoc([line("o9-a", 1000)], {
        orderStatus: "confirmed", revision: 1, convertedToPointId: "inv366-point",
      }));
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

  it("the «Restar» cap subtracts the EFFECTIVE TOTAL — exact coverage means $0 (review H1)", async () => {
    // O1: received $1,500, total $1,000, consumed $500 → invariant
    // received − total ≥ consumed leaves NO free surplus: even −$1,000 (the
    // old, wrong ceiling) must be DENIED — it strands the $500 consumed.
    const adjustment: OrderPayment = {
      id: "adj-366-h1a", orderId: "inv366-o6", storeId: "inv366-store",
      date: "2026-11-10", method: "cash", kind: "adjustment", amount: -1000,
      note: "prueba", createdAt: "2026-11-10T10:00:00.000Z", createdBy: "inv366-user",
    };
    await expect(registerOrderPaymentTx(adjustment)).rejects.toThrow(/Puedes restar hasta \$0\.00/);
    const after = (await getDoc(doc(holder.db, "orders/inv366-o6"))).data();
    expect(after?.paymentsReceivedCents).toBe(150000); // untouched
  });

  it("the «Restar» cap lets the FREE surplus out and not a cent more (review H1)", async () => {
    const base = { date: "2026-11-10", method: "cash", kind: "adjustment", note: "prueba", createdAt: "2026-11-10T10:00:00.000Z", createdBy: "inv366-user" } as const;
    // O4: $2,000 − $1,000 − $500 consumed = $500 free.
    const within: OrderPayment = { ...base, id: "adj-366-h1b", orderId: "inv366-o4", storeId: "inv366-store", amount: -500 };
    await registerOrderPaymentTx(within);
    const after = (await getDoc(doc(holder.db, "orders/inv366-o4"))).data();
    expect(after?.paymentsReceivedCents).toBe(150000); // 2000 − 500
    // Now received == total + consumed → ceiling is $0 again.
    const greedy: OrderPayment = { ...base, id: "adj-366-h1c", orderId: "inv366-o4", storeId: "inv366-store", amount: -100 };
    await expect(registerOrderPaymentTx(greedy)).rejects.toThrow(/Puedes restar hasta \$0\.00/);
  });

  it("a credit applied BETWEEN capture and save is caught by the fresh-doc guard (review H3: cambio concurrente)", async () => {
    // The editor captured O5 with NO credit; a sister order's applyCredit
    // lands on the doc before the save — the transaction re-reads the fresh
    // doc and blocks the under-covering edit fail-closed.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/inv366-o5"), orderDoc([line("o5-a", 1000)], {
        orderStatus: "confirmed", paymentsReceivedCents: 150000, creditConsumedCents: 50000, revision: 2,
      }));
    });
    // Fail-closed either way: the coverage guard blocks the under-covering
    // edit, or the stale-capture guard (revision moved) rejects first — the
    // concurrent change can NEVER slip through.
    await expect(
      saveOrderWithStockTx({ uid: "inv366-user" } as never, asOrder("inv366-o5", [line("o5-a", 1400)]), 1, "mut-366-h3")
    ).rejects.toThrow(/sostiene \$500\.00 de saldo a favor|otro dispositivo|stale/i);
    const after = (await getDoc(doc(holder.db, "orders/inv366-o5"))).data();
    expect(after?.revision).toBe(2); // nothing was written
  });

  it("#524: an ordinary save carries the point link verbatim — the editor's payload cannot drop it", async () => {
    // OrderForm builds its payload WITHOUT convertedToPointId; the full-document
    // write used to wipe the link, returning the order to «Falta cobrar».
    const saved = await saveOrderWithStockTx({ uid: "inv366-user" } as never, asOrder("inv366-o7", [line("o7-a", 1000)]), 1, "mut-524-a");
    expect(saved.order.convertedToPointId).toBe("inv366-point"); // the in-memory reconcile keeps it too
    const after = (await getDoc(doc(holder.db, "orders/inv366-o7"))).data();
    expect(after?.convertedToPointId).toBe("inv366-point"); // verbatim, like the credit fields
    expect(after?.revision).toBe(2);
  });

  it("#524: the link belongs to the conversion callable — a save never rewrites or invents it", async () => {
    // A payload claiming ANOTHER point cannot move a converted order.
    const saved = await saveOrderWithStockTx(
      { uid: "inv366-user" } as never, asOrder("inv366-o9", [line("o9-a", 900)], { convertedToPointId: "another-point" }), 1, "mut-524-b"
    );
    expect(saved.order.convertedToPointId).toBe("inv366-point");
    // An ordinary order stays ordinary: the doc never had a link to carry.
    await saveOrderWithStockTx(
      { uid: "inv366-user" } as never, asOrder("inv366-o8", [line("o8-a", 400)], { convertedToPointId: "invented-point" }), 1, "mut-524-c"
    );
    const after = (await getDoc(doc(holder.db, "orders/inv366-o8"))).data();
    expect(after?.convertedToPointId).toBeUndefined();
  });
});
