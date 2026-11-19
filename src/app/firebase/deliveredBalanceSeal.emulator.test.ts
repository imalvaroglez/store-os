import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order, OrderDelivery } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db, auth: { currentUser: { uid: "inv383-user" } } }) }));
import { registerDeliveryTx, saveOrderWithStockTx } from "./firestoreData";

let env: RulesTestEnvironment;

const SEAL = {
  deliveredWithBalanceCents: 70000,
  deliveredWithBalanceConfirmedAt: "2026-11-10T10:00:00.000Z",
  deliveredWithBalanceConfirmedBy: "inv383-user",
};

const line = (lineId: string, unitPrice: number) =>
  ({ lineId, productId: `p-${lineId}`, name: `Pieza ${lineId}`, quantity: 1, unitPrice, subtotal: unitPrice });

const orderDoc = (extra: Record<string, unknown> = {}) =>
  ({ storeId: "inv383-store", customerId: "c1", items: [line("d-a", 1000)], deposit: 0,
     orderStatus: "confirmed", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", ...extra });

const asOrder = (id: string, extra: Record<string, unknown> = {}): Order =>
  ({ id, storeId: "inv383-store", customerId: "c1", items: [line("d-a", 1000)], deposit: 0,
     orderStatus: "confirmed", paymentStatus: "unpaid",
     createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", ...extra } as unknown as Order);

const delivery = (id: string): OrderDelivery =>
  ({ id, orderId: "inv383-deliver", storeId: "inv383-store", deliveredAt: "2026-11-10",
     recordedAt: "2026-11-10T10:00:00.000Z", by: "inv383-user", lines: [{ productId: "p-d-a", quantity: 1 }] });

// Runs in CI's rules job (emulator); skipped locally per the no-emulators rule.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("deliveredWithBalance seal with Firestore rules (#383)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/inv383-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/inv383-store"), { ownerUid: "inv383-user", memberUids: ["inv383-user"] });
      // Confirmed order with uncovered money ($1,000 total, $300 received).
      await setDoc(doc(ctx.firestore(), "orders/inv383-forge"), orderDoc({ paymentsReceivedCents: 30000, revision: 1 }));
      // Delivered order already sealed by the legitimate path (simulated
      // history): the seal is evidence and must survive edits verbatim.
      await setDoc(doc(ctx.firestore(), "orders/inv383-sealed"), orderDoc({
        orderStatus: "delivered", paymentsReceivedCents: 30000, notes: "original", revision: 5, ...SEAL,
      }));
      // #370 compat: a historical DELIVERED order that predates the seal.
      await setDoc(doc(ctx.firestore(), "orders/inv383-historical"), orderDoc({
        orderStatus: "delivered", paymentsReceivedCents: 30000, notes: "viejo", revision: 2,
      }));
      // For the legitimate delivery path.
      await setDoc(doc(ctx.firestore(), "orders/inv383-deliver"), orderDoc({ paymentsReceivedCents: 30000, revision: 1 }));
    });
    holder.db = env.authenticatedContext("inv383-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  // ── SDK forgeries: every one must be DENIED by the rules. ──────────────
  it("denies stamping the seal on an order that does not transition into delivered", async () => {
    await expect(
      updateDoc(doc(holder.db, "orders/inv383-forge"), SEAL)
    ).rejects.toThrow(/permission/i);
  });

  it("denies an INCOMPLETE seal even alongside a transition to delivered", async () => {
    await expect(
      updateDoc(doc(holder.db, "orders/inv383-forge"), {
        orderStatus: "delivered",
        deliveredWithBalanceCents: 70000,
        deliveredWithBalanceConfirmedAt: "2026-11-10T10:00:00.000Z",
        // confirmedBy missing → incomplete stamp.
      })
    ).rejects.toThrow(/permission/i);
  });

  it("denies a forged seal attributed to somebody else", async () => {
    await expect(
      updateDoc(doc(holder.db, "orders/inv383-forge"), {
        orderStatus: "delivered",
        ...SEAL,
        deliveredWithBalanceConfirmedBy: "someone-else",
      })
    ).rejects.toThrow(/permission/i);
  });

  it("denies ERASING (or tampering with) a recorded seal", async () => {
    await expect(
      updateDoc(doc(holder.db, "orders/inv383-sealed"), { deliveredWithBalanceCents: deleteField() })
    ).rejects.toThrow(/permission/i);
    await expect(
      updateDoc(doc(holder.db, "orders/inv383-sealed"), { notes: "edit inocuo", ...SEAL, deliveredWithBalanceCents: 100 })
    ).rejects.toThrow(/permission/i);
  });

  // ── Legitimate paths: every one must keep working. ─────────────────────
  it("saveOrderWithStockTx stamps the seal on the confirmed transition into delivered", async () => {
    const saved = await saveOrderWithStockTx(
      { uid: "inv383-user" } as never,
      asOrder("inv383-forge", { orderStatus: "delivered" }),
      1,
      "mut-383-save",
      { confirmDeliveredWithBalance: true },
    );
    expect(saved.order.deliveredWithBalanceCents).toBe(70000);
    const after = (await getDoc(doc(holder.db, "orders/inv383-forge"))).data();
    expect(after?.deliveredWithBalanceConfirmedBy).toBe("inv383-user");
  });

  it("a later edit of the sealed order carries the seal VERBATIM and saves", async () => {
    const saved = await saveOrderWithStockTx(
      { uid: "inv383-user" } as never,
      asOrder("inv383-sealed", { orderStatus: "delivered", notes: "editado", revision: 5, ...SEAL } as never),
      5,
      "mut-383-edit",
    );
    expect(saved.order.notes).toBe("editado");
    expect(saved.order.deliveredWithBalanceCents).toBe(70000);
  });

  it("registerDeliveryTx completing the order stamps the seal with the operator's confirmation", async () => {
    const order = await registerDeliveryTx({
      orderId: "inv383-deliver",
      storeId: "inv383-store",
      delivery: delivery("del-383-a"),
      confirmDeliveredWithBalance: true,
    });
    expect(order.orderStatus).toBe("delivered");
    expect(order.deliveredWithBalanceCents).toBe(70000);
  });

  it("historical delivered orders without a seal keep editing normally (#370 compat)", async () => {
    const saved = await saveOrderWithStockTx(
      { uid: "inv383-user" } as never,
      asOrder("inv383-historical", { orderStatus: "delivered", notes: "aún editable", revision: 2 }),
      2,
      "mut-383-hist",
    );
    expect(saved.order.notes).toBe("aún editable");
  });
});
