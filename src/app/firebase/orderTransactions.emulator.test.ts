import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
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

  it("#421 vincular la ficha de un renglón capturado por nombre aparta exactamente una pieza, una sola vez", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/link-p1"), { storeId: "tx-store", quantityOnHand: 2, name: "Aro Luna" });
    });
    // 1) Pedido abierto con el renglón SIN ficha (capturado por nombre): nada se aparta.
    const unlinked = makeOrder("link-order", "link-p1", 1);
    delete (unlinked.items[0] as { productId?: string }).productId;
    unlinked.items[0] = { ...unlinked.items[0], productName: "Aro Luna" } as typeof unlinked.items[0];
    await saveOrderWithStockTx(user, unlinked, null, "link-1");
    expect((await getDoc(doc(holder.db, "products/link-p1"))).data()?.quantityOnHand).toBe(2);

    // 2) La operadora vincula la ficha (mismo renglón, cantidad y precio) y guarda: aparta exactamente una.
    const saved = (await getDoc(doc(holder.db, "orders/link-order"))).data() as { revision?: number } & Record<string, unknown>;
    const linked = makeOrder("link-order", "link-p1", 1);
    (linked.items[0] as { productName: string }).productName = "Aro Luna";
    const r1 = await saveOrderWithStockTx(user, linked, saved.revision ?? null, "link-2");
    expect((await getDoc(doc(holder.db, "products/link-p1"))).data()?.quantityOnHand).toBe(1);

    // 3) Volver a guardar SIN cambios no vuelve a descontar.
    await saveOrderWithStockTx(user, { ...r1.order }, r1.order.revision ?? null, "link-3");
    expect((await getDoc(doc(holder.db, "products/link-p1"))).data()?.quantityOnHand).toBe(1);
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
// #124: per-exact-color stock inside the SAME order transaction — confirming
// reserves the chosen color, cancelling restores it, and nothing ever lands
// on the design-level field.

  const designId = "p_variants";
  const variantLine = (quantity: number, variantId: string) => ({
    lineId: "lv", productId: designId, productName: "Anillo Sol", quantity,
    unitPrice: 300, subtotal: 300 * quantity, variantId, variantColor: variantId === "v_gold" ? "Dorado" : "Plateado", variantSku: `SKU-${variantId}`,
  });

  it("reserves the exact color once; sibling intact; design field untouched; cancel restores", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products", designId), {
        storeId: "tx-store",
        variants: [
          { id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", quantityOnHand: 2, createdAt: "", updatedAt: "" },
          { id: "v_silver", color: "Plateado", skuSuffix: "P", sku: "SOL-P", quantityOnHand: 1, createdAt: "", updatedAt: "" },
        ],
      });
    });
    const order: Order = {
      ...makeOrder("variant-order", designId, 1),
      items: [variantLine(1, "v_gold")],
    };
    await saveOrderWithStockTx(user, order, null, "variant-create");
    const saved = (await getDoc(doc(holder.db, "products", designId))).data() as { variants: Array<{ id: string; quantityOnHand?: number }>; quantityOnHand?: number };
    expect(saved.variants!.find((v) => v.id === "v_gold")!.quantityOnHand).toBe(1);
    expect(saved.variants!.find((v) => v.id === "v_silver")!.quantityOnHand).toBe(1);
    expect(saved.quantityOnHand).toBeUndefined();

    // Cancel restores the exact color (the delta model, not a special case).
    await saveOrderWithStockTx(user, { ...order, orderStatus: "cancelled" }, 1, "variant-cancel");
    const restored = (await getDoc(doc(holder.db, "products", designId))).data() as { variants: Array<{ id: string; quantityOnHand?: number }> };
    expect(restored.variants!.find((v) => v.id === "v_gold")!.quantityOnHand).toBe(2);

    // Switching colors in an edit moves both shelves.
    await saveOrderWithStockTx(user, { ...order, orderStatus: "asked", items: [variantLine(1, "v_silver")] }, 2, "variant-switch");
    const switched = (await getDoc(doc(holder.db, "products", designId))).data() as { variants: Array<{ id: string; quantityOnHand?: number }> };
    expect(switched.variants!.find((v) => v.id === "v_gold")!.quantityOnHand).toBe(2);
    expect(switched.variants!.find((v) => v.id === "v_silver")!.quantityOnHand).toBe(0);

    // A vanished color fails closed — stock never lands on the design level.
    await expect(
      saveOrderWithStockTx(user, { ...order, items: [variantLine(1, "v_fantasma")] }, 3, "variant-ghost")
    ).rejects.toThrow(/color elegido ya no existe/);
    const afterGhost = (await getDoc(doc(holder.db, "products", designId))).data() as { variants: Array<{ id: string; quantityOnHand?: number }> };
    expect(afterGhost.variants!.find((v) => v.id === "v_silver")!.quantityOnHand).toBe(0);

    // #124/H1-twin: DELETING a color order returns the exact colors, and the
    // result carries the shelves for in-memory reconcile.
    await saveOrderWithStockTx(user, { ...order, items: [variantLine(1, "v_gold"), variantLine(1, "v_silver")] }, 3, "variant-both");
    const deleteResult = await deleteOrderWithStockTx(user, "variant-order", 4);
    const afterDelete = (await getDoc(doc(holder.db, "products", designId))).data() as { variants: Array<{ id: string; quantityOnHand?: number }> };
    expect(afterDelete.variants!.find((v) => v.id === "v_gold")!.quantityOnHand).toBe(2);
    expect(afterDelete.variants!.find((v) => v.id === "v_silver")!.quantityOnHand).toBe(1);
    expect(deleteResult.variantStock?.find((v) => v.productId === designId)?.variants).toBeTruthy();
  });

  it("replaces both colors of a deleted design with separate products in the same order", async () => {
    const db = holder.db;
    const deleted = doc(db, "products/deleted-watch");
    await setDoc(deleted, {
      storeId: "tx-store",
      variants: [
        { id: "v_gold", color: "Dorado", quantityOnHand: 2 },
        { id: "v_silver", color: "Plateado", quantityOnHand: 2 },
      ],
    });
    const order = {
      ...makeOrder("watch-order", deleted.id, 1),
      orderStatus: "confirmed" as const,
      items: ["v_gold", "v_silver"].map((color) => ({
        ...variantLine(1, color), lineId: color, productId: deleted.id,
      })),
    };
    const created = await saveOrderWithStockTx(user, order, null, "watch-create");
    await deleteDoc(deleted);
    const replacementIds = ["watch-gold", "watch-silver"];
    for (const id of replacementIds) {
      await setDoc(doc(db, "products", id), { storeId: order.storeId, quantityOnHand: 2 });
    }
    const corrected = {
      ...order,
      items: replacementIds.map((id) => ({ ...makeOrder(id, id, 1).items![0], lineId: id })),
    };

    const saved = await saveOrderWithStockTx(user, corrected, created.order.revision!, "watch-replace");
    await saveOrderWithStockTx(user, corrected, created.order.revision!, "watch-replace");

    expect(saved.order.revision).toBe(2);
    expect((await getDoc(doc(db, "orders", order.id))).data()?.items).toEqual(corrected.items);
    expect((await getDoc(deleted)).exists()).toBe(false);
    for (const id of replacementIds) {
      expect((await getDoc(doc(db, "products", id))).data()?.quantityOnHand).toBe(1);
    }
  });

  it("deletes an order whose reserved color product no longer exists", async () => {
    const db = holder.db;
    const product = doc(db, "products/deleted-for-order-removal");
    await setDoc(product, {
      storeId: "tx-store", variants: [{ id: "v_gold", color: "Dorado", quantityOnHand: 1 }],
    });
    const order = {
      ...makeOrder("remove-watch-order", product.id, 1),
      items: [{ ...variantLine(1, "v_gold"), productId: product.id }],
    };
    const saved = await saveOrderWithStockTx(user, order, null, "removal-create");
    await deleteDoc(product);

    expect(await deleteOrderWithStockTx(user, order.id, saved.order.revision!)).toEqual([]);
    expect((await getDoc(doc(db, "orders", order.id))).exists()).toBe(false);
    expect((await getDoc(product)).exists()).toBe(false);
  });

});
