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
    });
    holder.db = env.authenticatedContext("finv-user").firestore();
  });
  afterAll(async () => { await env?.cleanup(); });

  it("un update NO puede AGREGAR installmentsReservedFor a un pedido sin respaldo", async () => {
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
});
