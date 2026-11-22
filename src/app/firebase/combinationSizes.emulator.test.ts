import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { saveOrderWithStockTx } from "./firestoreData";

let env: RulesTestEnvironment;

// #461 corte 3: an order line carrying variantSizeId moves EXACTLY its
// color×size shelf inside the transaction — create, edit and delete.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("combination sizes reserve their exact shelf (#461)", () => {
  const sizeLine = (quantity: number) => ({
    lineId: "l-s6",
    productId: "p-461",
    productName: "Anillo Sol",
    quantity,
    unitPrice: 300,
    subtotal: 300 * quantity,
    variantId: "v_gold",
    variantColor: "Dorado",
    variantSizeId: "s6",
    variantSize: "6",
  });
  const asOrder = (quantity: number): Order =>
    ({
      id: "ord-461aaa",
      storeId: "inv461-store",
      customerId: "ana",
      items: [sizeLine(quantity)] as Order["items"],
      deposit: 0,
      orderStatus: "confirmed",
      paymentStatus: "unpaid",
      installmentsReservedAt: "2026-11-22T00:00:00.000Z",
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
    }) as unknown as Order;

  async function readSizes(): Promise<{ s6: number | undefined; s5: number | undefined; colorLevel: number | undefined }> {
    const snap = await getDoc(doc(holder.db, "products", "p-461"));
    const variants = snap.data()?.variants as Array<{ id: string; quantityOnHand?: number; sizes?: Array<{ id: string; quantityOnHand?: number }> }>;
    const gold = variants.find((v) => v.id === "v_gold")!;
    return {
      s6: gold.sizes?.find((s) => s.id === "s6")?.quantityOnHand,
      s5: gold.sizes?.find((s) => s.id === "s5")?.quantityOnHand,
      colorLevel: gold.quantityOnHand,
    };
  }

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/inv461-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/inv461-store"), { ownerUid: "inv461-user", memberUids: ["inv461-user"] });
      await setDoc(doc(ctx.firestore(), "products/p-461"), {
        storeId: "inv461-store",
        name: "Anillo Sol",
        sku: "SOL",
        category: "other",
        status: "published",
        variants: [{
          id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100,
          sizes: [
            { id: "s6", size: "6", sku: "SOL-D-6", cost: 100, quantityOnHand: 5, createdAt: "", updatedAt: "" },
            { id: "s5", size: "5", sku: "SOL-D-5", cost: 100, quantityOnHand: 2, createdAt: "", updatedAt: "" },
          ],
          createdAt: "", updatedAt: "",
        }],
      });
    });
    holder.db = env.authenticatedContext("inv461-user").firestore();
  });

  afterAll(async () => { await env.cleanup(); });

  it("reservar 2 de la talla 6 descuenta SOLO s6; la talla 5 y el nivel del color quedan intactos", async () => {
    await saveOrderWithStockTx({ uid: "inv461-user" } as never, asOrder(2), null, "mut-461-a");
    const shelves = await readSizes();
    expect(shelves.s6).toBe(3);
    expect(shelves.s5).toBe(2);
    expect(shelves.colorLevel).toBeUndefined();
  });

  it("editar el pedido a 1 pieza devuelve la diferencia a la MISMA combinación", async () => {
    await saveOrderWithStockTx({ uid: "inv461-user" } as never, asOrder(1), 1, "mut-461-b");
    const shelves = await readSizes();
    expect(shelves.s6).toBe(4);
    expect(shelves.s5).toBe(2);
  });

  it("retirar la línea del pedido devuelve la pieza a su combinación exacta", async () => {
    const emptied = { ...asOrder(0), items: [] } as unknown as Order;
    await saveOrderWithStockTx({ uid: "inv461-user" } as never, emptied, 2, "mut-461-c");
    const shelves = await readSizes();
    expect(shelves.s6).toBe(5);
    expect(shelves.s5).toBe(2);
  });

  it("una talla que ya no existe en el diseño: la toma falla cerrado, sin mover nada", async () => {
    const ghost = { ...asOrder(1), id: "ord-461bbb", items: [{ ...sizeLine(1), variantSizeId: "s99" }] } as Order;
    await expect(
      saveOrderWithStockTx({ uid: "inv461-user" } as never, ghost, null, "mut-461-d")
    ).rejects.toThrow(/talla elegida ya no existe/i);
    const shelves = await readSizes();
    expect(shelves.s6).toBe(5);
    expect(shelves.s5).toBe(2);
  });
});
