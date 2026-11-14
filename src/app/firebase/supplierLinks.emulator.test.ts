import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

// #211: confirmed supplier-code → product associations are store-scoped like
// every business entity; the doc id encodes the identity so a member can
// only ever read/write links inside their own store.

let env: RulesTestEnvironment;

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#211 supplier-code links (reglas)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf-8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "users/tx-owner"), { role: "member" });
      await setDoc(doc(fs, "users/tx-other-b"), { role: "member" });
      await setDoc(doc(fs, "adminStores/sw-store"), { ownerUid: "tx-owner", memberUids: ["tx-owner"] });
      await setDoc(doc(fs, "supplierLinks/sw-store__sup1__abc123"), {
        id: "sw-store__sup1__abc123", storeId: "sw-store", supplierId: "sup1", code: "ABC-123",
        normalizedCode: "abc123", productId: "p1", productName: "P1",
        confirmedAt: "2026-11-01T00:00:00.000Z", confirmedBy: "tx-owner",
      });
    });
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("el dueño lee la asociación de SU tienda; el id debe coincidir con el cuerpo", async () => {
    const owner = env.authenticatedContext("tx-owner").firestore();
    expect((await getDoc(doc(owner, "supplierLinks/sw-store__sup1__abc123"))).exists()).toBe(true);
    await expect(setDoc(doc(owner, "supplierLinks/sw-store__sup1__otro99"), {
      id: "distinto", storeId: "sw-store", supplierId: "sup1", code: "X", normalizedCode: "x",
      productId: "p1", productName: "P1", confirmedAt: "", confirmedBy: "tx-owner",
    })).rejects.toThrow(); // id ≠ body.id: la regla lo rechaza
  });

  it("un miembro de OTRA tienda no lee ni crea asociaciones ajenas", async () => {
    const foreign = env.authenticatedContext("tx-other-b").firestore();
    await expect(getDoc(doc(foreign, "supplierLinks/sw-store__sup1__abc123"))).rejects.toThrow();
    await expect(setDoc(doc(foreign, "supplierLinks/sw-store__sup2__nuevo1"), {
      id: "sw-store__sup2__nuevo1", storeId: "sw-store", supplierId: "sup2", code: "N",
      normalizedCode: "n", productId: "p2", productName: "P2", confirmedAt: "", confirmedBy: "tx-other-b",
    })).rejects.toThrow(); // no es miembro de sw-store
  });
});
