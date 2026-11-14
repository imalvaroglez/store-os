import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { confirmSupplierLinkTx } from "./firestoreData";
import { suggestedProductFor } from "../../lib/supplierLinks";

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

  it("MAYOR r2: un miembro autenticado de OTRA tienda no puede LISTAR todas las asociaciones", async () => {
    const foreign = env.authenticatedContext("tx-other-b").firestore();
    // Unfiltered collection LIST: same protection level as products (#176).
    await expect(getDocs(collection(foreign, "supplierLinks"))).rejects.toThrow();
  });

  it("M4 r2: revocar una asociación ya inexistente es idempotente (delete no niega)", async () => {
    const owner = env.authenticatedContext("tx-owner").firestore();
    await expect(deleteDoc(doc(owner, "supplierLinks/sw-store__sup1__nunca99"))).resolves.toBeUndefined();
  });

  it("M1 r2: un código con «__» guarda su normalizedCode COMPLETO — la sugerencia dispara", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      holder.db = ctx.firestore();
      const link = await confirmSupplierLinkTx({
        storeId: "sw-store", supplierId: "sup1", code: "AB-1__2",
        productId: "p9", productName: "P9", confirmedBy: "tx-owner",
      });
      expect(link.normalizedCode).toBe("ab1__2"); // split("__")[2] truncaba a "ab1"
      expect(link.id).toBe("sw-store__sup1__ab1__2");
      expect(suggestedProductFor([link], "sw-store", "sup1", "AB-1__2")?.productId).toBe("p9");
    });
  });

  it("M3 r2: un código con «/» se rechaza con error claro ANTES de intentar el doc id inválido", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      holder.db = ctx.firestore();
      await expect(confirmSupplierLinkTx({
        storeId: "sw-store", supplierId: "sup1", code: "AB/12",
        productId: "p9", productName: "P9", confirmedBy: "tx-owner",
      })).rejects.toThrow(/no válid|carácter/i);
    });
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
