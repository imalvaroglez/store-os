import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { ExpenseAssignment, LooseExpense } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { assignExpenseTx, consumeSupplyTx } from "./firestoreData";

let env: RulesTestEnvironment;

const expense = (id: string, extra: Partial<LooseExpense> = {}): LooseExpense => ({
  id, storeId: "exp2-store", amount: 15, date: "2026-11-06", category: "operation",
  createdAt: "2026-11-06T10:00:00Z", updatedAt: "2026-11-06T10:00:00Z", ...extra,
});

const assignment = (id: string, amountCents: number, target: ExpenseAssignment["target"], mode: ExpenseAssignment["mode"] = "units"): Omit<ExpenseAssignment, never> => ({
  id, at: "2026-11-06T12:00:00Z", by: "exp2-user", target, mode, amountCents,
});

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("loose expense transactions with Firestore rules (#184)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/exp2-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/exp2-store"), { ownerUid: "exp2-user", memberUids: ["exp2-user"] });
      await setDoc(doc(ctx.firestore(), "orders/exp2-order"), {
        storeId: "exp2-store", customerId: "c1",
        items: [{ lineId: "o_L0", productName: "Anillo", quantity: 2, unitPrice: 100, subtotal: 200 }],
        deposit: 0, orderStatus: "confirmed", createdAt: "2026-11-06T10:00:00Z", updatedAt: "2026-11-06T10:00:00Z",
      });
      await setDoc(doc(ctx.firestore(), "purchases/exp2-open"), {
        storeId: "exp2-store", name: "Compra abierta QA", date: "2026-11-06", status: "draft",
        lines: [{ lineId: "p_L0", name: "Pieza", quantity: 5, unitCost: 10 }],
        totalConfirmed: 50, createdAt: "2026-11-06T10:00:00Z", updatedAt: "2026-11-06T10:00:00Z",
      });
      await setDoc(doc(ctx.firestore(), "purchases/exp2-received"), {
        storeId: "exp2-store", name: "Compra recibida QA", date: "2026-11-06", status: "received",
        lines: [{ lineId: "r_L0", name: "Pieza", quantity: 1, unitCost: 10 }],
        totalConfirmed: 10, createdAt: "2026-11-06T10:00:00Z", updatedAt: "2026-11-06T10:00:00Z",
      });
    });
    holder.db = env.authenticatedContext("exp2-user").firestore();
  });
  afterAll(async () => { await env?.cleanup(); });

  it("assigns to an order: the charge lands on the order in the SAME commit", async () => {
    await setDoc(doc(holder.db, "expenses/exp2-1"), { ...expense("exp2-1"), id: "exp2-1" });
    await assignExpenseTx({
      expenseId: "exp2-1", storeId: "exp2-store",
      assignment: assignment("asg1", 1500, { kind: "order", orderId: "exp2-order" }),
    });
    const order = (await getDoc(doc(holder.db, "orders/exp2-order"))).data()!;
    expect(order.saleExpenses).toHaveLength(1);
    expect(order.saleExpenses[0].amountCents).toBe(1500);
    const updated = (await getDoc(doc(holder.db, "expenses/exp2-1"))).data()!;
    expect(updated.assignments).toHaveLength(1);
  });

  it("is idempotent by assignment id and never assigns past the pending balance", async () => {
    await assignExpenseTx({
      expenseId: "exp2-1", storeId: "exp2-store",
      assignment: assignment("asg1", 1500, { kind: "order", orderId: "exp2-order" }),
    });
    await expect(
      assignExpenseTx({ expenseId: "exp2-1", storeId: "exp2-store", assignment: assignment("asg2", 1, { kind: "order", orderId: "exp2-order" }) })
    ).rejects.toThrow(/por asignar/i);
  });

  it("never assigns to a received purchase (historical cost is evidence)", async () => {
    await setDoc(doc(holder.db, "expenses/exp2-2"), { ...expense("exp2-2"), id: "exp2-2" });
    await expect(
      assignExpenseTx({ expenseId: "exp2-2", storeId: "exp2-store", assignment: assignment("asg3", 500, { kind: "purchase", purchaseId: "exp2-received" }) })
    ).rejects.toThrow(/recibida/i);
  });

  it("assigns to an open purchase via the native sourcing path", async () => {
    await assignExpenseTx({
      expenseId: "exp2-2", storeId: "exp2-store",
      assignment: assignment("asg4", 500, { kind: "purchase", purchaseId: "exp2-open" }),
      purchaseExpense: { id: "pexp1", category: "sourcing_transport", amount: 5, description: "Gasolina" },
    });
    const purchase = (await getDoc(doc(holder.db, "purchases/exp2-open"))).data()!;
    expect(purchase.sourcingExpenses).toHaveLength(1);
  });

  it("supplies: consumption charges the order exactly and availability never goes negative", async () => {
    // 100 bolsas por $15 → $0.15 por unidad (criterio 5).
    await setDoc(doc(holder.db, "expenses/exp2-bags"), {
      ...expense("exp2-bags", { amount: 15, category: "supplies", description: "Bolsas" }),
      id: "exp2-bags",
      supply: { quantityInitial: 100, consumptions: [] },
    });
    await consumeSupplyTx({
      expenseId: "exp2-bags", storeId: "exp2-store",
      consumption: { id: "con1", at: "2026-11-06T12:00:00Z", by: "exp2-user", quantity: 1, orderId: "exp2-order" },
    });
    const order = (await getDoc(doc(holder.db, "orders/exp2-order"))).data()!;
    const bagCharge = (order.saleExpenses ?? []).find((charge: { id: string }) => charge.id === "sup_con1");
    expect(bagCharge.amountCents).toBe(15);
    const stash = (await getDoc(doc(holder.db, "expenses/exp2-bags"))).data()!;
    expect(stash.supply.consumptions).toHaveLength(1);
    // 99 disponibles; intentar consumir 100 aborta.
    await expect(
      consumeSupplyTx({ expenseId: "exp2-bags", storeId: "exp2-store", consumption: { id: "con2", at: "2026-11-06T12:00:00Z", by: "exp2-user", quantity: 100 } })
    ).rejects.toThrow(/disponibles/i);
  });

  it("#214 F1: editing the order through the normal save path keeps the direct charges (OrderForm-shaped caller)", async () => {
    const { saveOrderWithStockTx } = await import("./firestoreData");
    const before = (await getDoc(doc(holder.db, "orders/exp2-order"))).data()!;
    expect((before.saleExpenses ?? []).length).toBeGreaterThan(0);
    // The caller shape is OrderForm's: a whitelist WITHOUT saleExpenses.
    const { saleExpenses, ...callerShape } = before;
    const edited = { ...callerShape, id: "exp2-order", notes: "editado tras asignar" };
    await saveOrderWithStockTx({ uid: "exp2-user" } as never, edited as never, before.revision ?? 0, "mut_exp_f1");
    const after = (await getDoc(doc(holder.db, "orders/exp2-order"))).data()!;
    expect(after.saleExpenses).toEqual(saleExpenses); // evidence survives the edit
    expect(after.notes).toBe("editado tras asignar");
  });

  it("#214 F2: a supply cannot be assigned — it distributes by consumption", async () => {
    await expect(
      assignExpenseTx({
        expenseId: "exp2-bags", storeId: "exp2-store",
        assignment: assignment("asgSup", 500, { kind: "order", orderId: "exp2-order" }),
      })
    ).rejects.toThrow(/suministros se distribuyen consum/i);
  });

  it("never crosses stores", async () => {
    await expect(
      assignExpenseTx({ expenseId: "exp2-1", storeId: "foreign-store", assignment: assignment("asgX", 100, { kind: "order", orderId: "exp2-order" }) })
    ).rejects.toThrow(/otra tienda/i);
  });
});
