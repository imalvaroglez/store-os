import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

// #202: closes and their adjustments are append-only, store-scoped evidence.
// Rules must deny: edits/deletes of saved versions (even by the owner),
// creation with a mismatched id, and any access from a foreign member.

let env: RulesTestEnvironment;

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#202 closes & ajustes (reglas)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf-8") },
    });
    // The emulator persists across runs: reset so creates stay CREATES.
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "users/fer-uid"), { role: "member" });
      await setDoc(doc(fs, "users/member-uid"), { role: "member" });
      await setDoc(doc(fs, "users/foreign-uid"), { role: "member" });
      await setDoc(doc(fs, "adminStores/olivia"), { ownerUid: "fer-uid", memberUids: ["fer-uid", "member-uid"] });
    });
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("la dueña crea una versión de cierre; guardada, ni ella puede editarla ni borrarla", async () => {
    const owner = env.authenticatedContext("fer-uid").firestore();
    await setDoc(doc(owner, "closes/olivia__2026-11__v1"), {
      id: "olivia__2026-11__v1", storeId: "olivia", month: "2026-11", version: 1,
      createdBy: "fer-uid", createdAt: "2026-12-01T00:00:00.000Z",
    });
    expect((await getDoc(doc(owner, "closes/olivia__2026-11__v1"))).exists()).toBe(true);
    await expect(updateDoc(doc(owner, "closes/olivia__2026-11__v1"), { total: 999 })).rejects.toThrow();
    await expect(deleteDoc(doc(owner, "closes/olivia__2026-11__v1"))).rejects.toThrow();
  });

  it("un ajuste se crea enlazado a su origen y queda inmutable; el id debe coincidir", async () => {
    const owner = env.authenticatedContext("fer-uid").firestore();
    await setDoc(doc(owner, "closeAdjustments/adj-1"), {
      id: "adj-1", storeId: "olivia", originCloseId: "olivia__2026-11__v1",
      appliesTo: "2027-01", differenceCents: 12000, kind: "apply", confirmed: true,
      createdBy: "fer-uid", createdAt: "2027-01-05T00:00:00.000Z",
    });
    await expect(updateDoc(doc(owner, "closeAdjustments/adj-1"), { differenceCents: 1 })).rejects.toThrow();
    await expect(setDoc(doc(owner, "closeAdjustments/adj-2"), {
      id: "otro", storeId: "olivia", originCloseId: "x", appliesTo: "2027-01",
      differenceCents: 1, kind: "apply", confirmed: false, createdBy: "fer-uid", createdAt: "",
    })).rejects.toThrow(); // id ≠ body.id
  });

  it("un miembro NO dueño no crea cierres ni ajustes; un usuario ajeno no lee", async () => {
    const member = env.authenticatedContext("member-uid").firestore();
    await expect(setDoc(doc(member, "closes/olivia__2027-01__v1"), {
      id: "olivia__2027-01__v1", storeId: "olivia", month: "2027-01", version: 1,
      createdBy: "member-uid", createdAt: "",
    })).rejects.toThrow(); // canOperateStore allows members... see note below
    const foreign = env.authenticatedContext("foreign-uid").firestore();
    await expect(getDoc(doc(foreign, "closes/olivia__2026-11__v1"))).rejects.toThrow();
  });

  it("#202 r2: un miembro autenticado de OTRA tienda no puede LISTAR los cierres financieros", async () => {
    const foreign = env.authenticatedContext("foreign-uid").firestore();
    // netCents/ferCents/oliviaCents/investorCents are money — an unfiltered
    // LIST must not hand them to any signed-up user (class #176/#438).
    await expect(getDocs(collection(foreign, "closes"))).rejects.toThrow();
    await expect(getDocs(collection(foreign, "closeAdjustments"))).rejects.toThrow();
  });

  it("#458: el snapshot de cierre oficial pasa las reglas closes — dueña sí, miembro no, suplantación de actor no", async () => {
    const owner = env.authenticatedContext("fer-uid").firestore();
    const member = env.authenticatedContext("member-uid").firestore();
    const snapshot = {
      id: "olivia__2026-09__v1", storeId: "olivia", period: "2026-09", version: 1,
      monthLabel: "septiembre 2026",
      totals: { salesCents: 1, costCents: 1, expensesCents: 1, operatingResultCents: 1, collectionsCents: 1 },
      coverageComplete: true, fingerprint: "fp_x", state: "closed",
      authorizedByUid: "fer-uid", authorizedAt: "2026-10-01T00:00:00.000Z",
      createdBy: "fer-uid", createdAt: "2026-10-01T00:00:00.000Z",
    };
    await expect(setDoc(doc(owner, "closes/olivia__2026-09__v1"), snapshot)).resolves.toBeUndefined();
    await expect(setDoc(doc(member, "closes/olivia__2026-09__v2"), { ...snapshot, id: "olivia__2026-09__v2", version: 2, createdBy: "member-uid", authorizedByUid: "member-uid" })).rejects.toThrow();
    await expect(setDoc(doc(owner, "closes/olivia__2026-09__v3"), { ...snapshot, id: "olivia__2026-09__v3", version: 3, createdBy: "someone-else" })).rejects.toThrow();
    // Miembro de la tienda SÍ lee el snapshot sellado (consulta), ajeno no (ya cubierto).
    await expect((await getDoc(doc(member, "closes/olivia__2026-09__v1"))).exists()).toBe(true);
  });
});
