import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { saveOrderWithStockTx } from "./firestoreData";

let env: RulesTestEnvironment;
const user = { uid: "tx-user", role: "member" } as never;

const orderDoc = (id: string, extra: Record<string, unknown> = {}) => ({
  storeId: "pc-store",
  customerId: "pc-clienta",
  items: [{ lineId: `${id}_L0`, productName: "Pieza", quantity: 1, unitPrice: 100, subtotal: 100 }],
  deposit: 0,
  orderStatus: "confirmed",
  revision: 0,
  createdAt: "2026-11-13T10:00:00.000Z",
  updatedAt: "2026-11-13T10:00:00.000Z",
  ...extra,
});

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#380 prototype — reglas y guard de respaldo", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/tx-user"), { role: "member" });
      await setDoc(doc(db, "adminStores/pc-store"), { ownerUid: "tx-user", memberUids: ["tx-user"] });
      // Origin: $100 sale overpaid to $200 → $100 of credit; a sister order
      // consumed $100 of it (seeded as the callable would have written it).
      await setDoc(doc(db, "orders/pc-origin"), orderDoc("pc-origin", {
        orderStatus: "delivered",
        paymentsReceivedCents: 20000,
        inheritedDepositMaterialized: true,
        creditConsumedCents: 10000,
        creditLedger: [{ id: "con_app_x", kind: "consumption", fromOrderId: "pc-dest", amountCents: 10000, at: "2026-11-13T10:05:00.000Z", by: "tx-user" }],
        revision: 1,
      }));
      await setDoc(doc(db, "orders/pc-dest"), orderDoc("pc-dest", {
        items: [{ lineId: "d_L0", productName: "Pulsera", quantity: 1, unitPrice: 300, subtotal: 300 }],
        creditAppliedCents: 10000,
        creditLedger: [{ id: "app_x", kind: "application", fromOrderId: "pc-origin", amountCents: 10000, at: "2026-11-13T10:05:00.000Z", by: "tx-user" }],
        revision: 1,
      }));
    });
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("regla: el cliente ya no puede cambiar NINGÚN campo de crédito (la vía es el callable)", async () => {
    await expect(updateDoc(doc(holder.db, "orders/pc-dest"), { creditAppliedCents: 0 })).rejects.toThrow();
    await expect(updateDoc(doc(holder.db, "orders/pc-origin"), { creditConsumedCents: 999999 })).rejects.toThrow();
    await expect(updateDoc(doc(holder.db, "orders/pc-dest"), { creditLedger: [] })).rejects.toThrow();
  });

  it("regla: un guardado ordinario (crédito verbatim, sin cambios) SIGUE pasando", async () => {
    const snap = (await getDoc(doc(holder.db, "orders/pc-dest"))).data() as Record<string, unknown>;
    await updateDoc(doc(holder.db, "orders/pc-dest"), { notes: "edición ordinaria" });
    const after = (await getDoc(doc(holder.db, "orders/pc-dest"))).data()!;
    expect(after.creditAppliedCents).toBe(snap.creditAppliedCents); // verbatim intact
  });

  it("guard de respaldo: editar el origen de forma que el saldo quede sin respaldo → rechazo en español", async () => {
    const before = (await getDoc(doc(holder.db, "orders/pc-origin"))).data()!;
    // Raise the total by $150 → surplus drops to −$50 < $100 consumed.
    const edited = {
      id: "pc-origin",
      storeId: "pc-store",
      customerId: "pc-clienta",
      items: [{ lineId: "o_L0", productName: "Collar", quantity: 1, unitPrice: 250, subtotal: 250 }],
      deposit: 0,
      orderStatus: "delivered",
      paymentsReceivedCents: before.paymentsReceivedCents,
      inheritedDepositMaterialized: true,
      creditConsumedCents: before.creditConsumedCents,
      creditLedger: before.creditLedger,
      revision: before.revision,
      createdAt: "2026-11-13T10:00:00.000Z",
      updatedAt: "2026-11-13T10:00:00.000Z",
    } as never as Order;
    await expect(saveOrderWithStockTx(user, edited, before.revision as number, "pc-edit-backing"))
      .rejects.toThrow(/sin respaldo/i);
    const after = (await getDoc(doc(holder.db, "orders/pc-origin"))).data()!;
    expect(after.items[0].unitPrice).toBe(100); // unchanged — the edit aborted
  });

  it("guard de respaldo: una edición que NO toca el dinero del origen sigue pasando", async () => {
    const before = (await getDoc(doc(holder.db, "orders/pc-origin"))).data()!;
    const edited = {
      id: "pc-origin",
      storeId: "pc-store",
      customerId: "pc-clienta",
      items: before.items,
      deposit: 0,
      orderStatus: "delivered",
      paymentsReceivedCents: before.paymentsReceivedCents,
      inheritedDepositMaterialized: true,
      creditConsumedCents: before.creditConsumedCents,
      creditLedger: before.creditLedger,
      notes: "nota inofensiva",
      revision: before.revision,
      createdAt: "2026-11-13T10:00:00.000Z",
      updatedAt: "2026-11-13T10:00:00.000Z",
    } as never as Order;
    const saved = await saveOrderWithStockTx(user, edited, before.revision as number, "pc-edit-ok");
    expect(saved.order.notes).toBe("nota inofensiva");
  });
});
