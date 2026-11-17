import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));

let env: RulesTestEnvironment;
const order = { storeId: "finv-store", customerId: "c1", items: [], deposit: 0, orderStatus: "confirmed", createdAt: "", updatedAt: "" };

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#478 — el marcador de cuotas es inmutable también al agregarlo", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "adminStores/finv-store"), { ownerUid: "finv-user", memberUids: ["finv-user"] });
      await setDoc(doc(ctx.firestore(), "orders/finv-o1"), order);
      await setDoc(doc(ctx.firestore(), "orders/finv-o2"), { ...order, installmentsReservedAt: "2026-01-01T00:00:00.000Z" });
      // #478 C1: an ordinary order with no receipts and zero deposit — the
      // legitimate conversion target for plan + anticipo in one save.
      await setDoc(doc(ctx.firestore(), "orders/finv-o3"), order);
    });
    holder.db = env.authenticatedContext("finv-user").firestore();
  });
  afterAll(async () => { await env?.cleanup(); });

  it("un update NO puede AGREGAR installmentsReservedAt a un pedido sin respaldo", async () => {
    await expect(
      updateDoc(doc(holder.db, "orders/finv-o1"), { installmentsReservedAt: "2026-01-01T00:00:00.000Z" })
    ).rejects.toThrow(/PERMISSION/i);
  });

  it("un update NO puede BORRARLO ni cambiarlo en un pedido respaldado", async () => {
    await expect(
      updateDoc(doc(holder.db, "orders/finv-o2"), { installmentsReservedAt: null })
    ).rejects.toThrow(/PERMISSION/i);
    await expect(
      updateDoc(doc(holder.db, "orders/finv-o2"), { installmentsReservedAt: "2030-01-01T00:00:00.000Z" })
    ).rejects.toThrow(/PERMISSION/i);
  });

  it("las ediciones ordinarias siguen pasando (ausente→ausente, intacto→intacto)", async () => {
    await updateDoc(doc(holder.db, "orders/finv-o1"), { notes: "edición ordinaria" });
    await updateDoc(doc(holder.db, "orders/finv-o2"), { notes: "respaldado editable" });
    expect(true).toBe(true);
  });

  it("#478 C1: el marcador NACE cuando la MISMA escritura sube el anticipo desde cero con el plan", async () => {
    // The legitimate single-save conversion: install the plan, capture the
    // first anticipo, stamp the reservation — the helper writes exactly this
    // shape (firestoreData.ts L791 counts the same-edit deposit).
    await expect(
      updateDoc(doc(holder.db, "orders/finv-o3"), {
        installments: { count: 4, frequency: "weekly", firstDueDate: "2026-12-01", agreedAt: "2026-11-17", agreedBy: "finv-user" },
        deposit: 150,
        installmentsReservedAt: "2026-11-17T00:00:00.000Z",
      })
    ).resolves.toBeUndefined();
  });

  it("…pero el anticipo solo no basta sin plan: la subida sin plan sigue forja", async () => {
    await expect(
      updateDoc(doc(holder.db, "orders/finv-o1"), {
        deposit: 200,
        installmentsReservedAt: "2026-11-17T00:00:00.000Z",
      })
    ).rejects.toThrow(/PERMISSION/i);
  });
});
