import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ FIREBASE_EMULATOR_ENABLED: false, getFirebase: () => ({ db: holder.db }) }));
import { deleteOrderWithStockTx, saveOrderWithStockTx, StaleOrderError } from "./firestoreData";

let env: RulesTestEnvironment;
const user = { uid: "tx-user", role: "member" } as any;
const makeOrder = (id: string, productId: string, quantity: number): Order => ({
  id, storeId: "tx-store", customerId: "c1", items: [{ lineId: "l1", productId, productName: "Anillo", quantity, unitPrice: 50, subtotal: quantity * 50 }],
  deposit: 0, orderStatus: "asked", paymentStatus: "unpaid", schemaVersion: 2,
  createdAt: "2026-10-28T10:00:00.000Z", updatedAt: "2026-10-28T10:00:00.000Z",
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("order transactions with Firestore rules", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: "store-os-dev", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/tx-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/tx-store"), { ownerUid: "tx-user", memberUids: ["tx-user"] });
      for (const id of ["p1", "p2"]) await setDoc(doc(ctx.firestore(), "products", id), { storeId: "tx-store", quantityOnHand: 10 });
      await setDoc(doc(ctx.firestore(), "products/foreign"), { storeId: "other-store", quantityOnHand: 10 });
    });
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => { await env?.cleanup(); });

  it("limits missing-document reads and preserves isolation", async () => {
    const anonymous = env.unauthenticatedContext().firestore();
    await expect(getDoc(doc(anonymous, "orders/absent"))).rejects.toThrow();
    expect((await getDoc(doc(holder.db, "orders/absent"))).exists()).toBe(false);
    await expect(getDoc(doc(holder.db, "products/foreign"))).rejects.toThrow();
  });

  it("deduplicates concurrent creation and retry", async () => {
    const order = makeOrder("duplicate", "p1", 2);
    await Promise.all([saveOrderWithStockTx(user, order, null, "op1"), saveOrderWithStockTx(user, order, null, "op1")]);
    await saveOrderWithStockTx(user, order, null, "op1");
    expect((await getDoc(doc(holder.db, "products/p1"))).data()?.quantityOnHand).toBe(8);
    expect((await getDoc(doc(holder.db, "orders/duplicate"))).data()?.revision).toBe(1);
  });

  it("reserves distinct orders concurrently and refuses stale updates and deletion", async () => {
    const first = makeOrder("first", "p2", 2);
    const second = makeOrder("second", "p2", 2);
    const [a] = await Promise.all([saveOrderWithStockTx(user, first, null, "op-a"), saveOrderWithStockTx(user, second, null, "op-b")]);
    expect((await getDoc(doc(holder.db, "products/p2"))).data()?.quantityOnHand).toBe(6);
    const changed = makeOrder("first", "p2", 5);
    await saveOrderWithStockTx(user, changed, a.order.revision!, "op-c");
    await expect(saveOrderWithStockTx(user, first, a.order.revision!, "op-d")).rejects.toBeInstanceOf(StaleOrderError);
    await expect(deleteOrderWithStockTx(user, first.id, a.order.revision!)).rejects.toBeInstanceOf(StaleOrderError);
    await deleteOrderWithStockTx(user, first.id, 2);
    expect((await getDoc(doc(holder.db, "products/p2"))).data()?.quantityOnHand).toBe(8);
  });

  it("saves a 50-product order under the actual rules", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await Promise.all(Array.from({ length: 50 }, (_, i) => setDoc(doc(ctx.firestore(), "products", `bulk-${i}`), { storeId: "tx-store", quantityOnHand: 10 })));
    });
    const order = makeOrder("bulk-order", "bulk-0", 1);
    order.items = Array.from({ length: 50 }, (_, i) => ({ lineId: `line-${i}`, productId: `bulk-${i}`, productName: `Pieza ${i}`, quantity: 1, unitPrice: 1, subtotal: 1 }));
    await saveOrderWithStockTx(user, order, null, "bulk-op");
    expect((await getDoc(doc(holder.db, "products/bulk-49"))).data()?.quantityOnHand).toBe(9);
  });

  it("rejects a product from another store without creating an order", async () => {
    await expect(saveOrderWithStockTx(user, makeOrder("foreign-order", "foreign", 1), null, "foreign-op")).rejects.toThrow();
    expect((await getDoc(doc(holder.db, "orders/foreign-order"))).exists()).toBe(false);
  });
});
