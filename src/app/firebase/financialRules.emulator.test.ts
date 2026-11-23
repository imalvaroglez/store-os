import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));

let env: RulesTestEnvironment;
const NOW = new Date().toISOString();

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#279 — reglas de posición financiera", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "adminStores/fin-store"), { ownerUid: "fin-user", memberUids: ["fin-user"] });
      await setDoc(doc(ctx.firestore(), "users/fin-user"), { role: "member" });
    });
    holder.db = env.authenticatedContext("fin-user").firestore();
  });
  afterAll(async () => { await env?.cleanup(); });

  it("un miembro registra un pago de tarjeta válido", async () => {
    await setDoc(doc(holder.db, "cardPayments/cp1"), {
      id: "cp1", storeId: "fin-store", date: "2026-11-20", amountCents: 100000,
      createdAt: NOW, createdBy: "fin-user",
    });
    expect((await getDoc(doc(holder.db, "cardPayments/cp1"))).exists()).toBe(true);
  });

  it("importe inválido, fecha ausente o autor falso se rechazan (fail closed)", async () => {
    await expect(setDoc(doc(holder.db, "cardPayments/cp2"), {
      id: "cp2", storeId: "fin-store", date: "2026-11-20", amountCents: 0, createdAt: NOW, createdBy: "fin-user",
    })).rejects.toThrow();
    await expect(setDoc(doc(holder.db, "cardPayments/cp3"), {
      id: "cp3", storeId: "fin-store", amountCents: 500, createdAt: NOW, createdBy: "fin-user",
    })).rejects.toThrow();
    await expect(setDoc(doc(holder.db, "cardPayments/cp4"), {
      id: "cp4", storeId: "fin-store", date: "2026-11-20", amountCents: 500, createdAt: NOW, createdBy: "someone-else",
    })).rejects.toThrow();
  });

  it("la evidencia es append-only: update y delete denegados incluso al miembro", async () => {
    await expect(updateDoc(doc(holder.db, "cardPayments/cp1"), { amountCents: 1 })).rejects.toThrow(/PERMISSION/i);
    await expect(deleteDoc(doc(holder.db, "cardPayments/cp1"))).rejects.toThrow();
  });

  it("un no-miembro no lee ni escribe pagos de la tienda", async () => {
    const foreign = env.authenticatedContext("stranger").firestore();
    await expect(getDoc(doc(foreign, "cardPayments/cp1"))).rejects.toThrow();
    await expect(setDoc(doc(foreign, "cardPayments/x1"), {
      id: "x1", storeId: "fin-store", date: "2026-11-20", amountCents: 100, createdAt: NOW, createdBy: "stranger",
    })).rejects.toThrow();
  });

  it("T0: creado por el miembro, con activatedAt inmutable después", async () => {
    await setDoc(doc(holder.db, "storeFinancials/fin-store"), { storeId: "fin-store", activatedAt: NOW });
    const before = (await getDoc(doc(holder.db, "storeFinancials/fin-store"))).data()!;
    expect(before.activatedAt).toBe(NOW);
    await expect(updateDoc(doc(holder.db, "storeFinancials/fin-store"), { activatedAt: "2020-01-01T00:00:00.000Z" })).rejects.toThrow();
    // Un update que NO mueve el corte pasa (campos accesorios futuros).
    await updateDoc(doc(holder.db, "storeFinancials/fin-store"), { note: "marcador" });
  });
});
