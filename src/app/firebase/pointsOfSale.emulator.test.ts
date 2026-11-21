import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

// #524 — Firestore model of physical points of sale, first cut: `points` is a
// private config entity scoped by store membership (categories idiom);
// `pointEntries`/`pointOperations` are AUDITABLE EVIDENCE — readable by the
// store's members, never writable by any client (the authenticated callable
// owns every write inside its transaction).

let env: RulesTestEnvironment;

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#524 puntos de venta (reglas)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf-8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "users/pt-owner"), { role: "member" });
      await setDoc(doc(fs, "users/pt-other"), { role: "member" });
      await setDoc(doc(fs, "adminStores/pt-store"), { ownerUid: "pt-owner", memberUids: ["pt-owner"] });
      await setDoc(doc(fs, "points/pt-store__mostrador"), {
        id: "pt-store__mostrador",
        storeId: "pt-store",
        name: "Mostrador centro",
        active: true,
        createdAt: "2026-11-21T00:00:00.000Z",
        updatedAt: "2026-11-21T00:00:00.000Z",
      });
      await setDoc(doc(fs, "pointEntries/pe1"), {
        id: "pe1",
        storeId: "pt-store",
        pointId: "pt-store__mostrador",
        productId: "p1",
        productName: "Perfume",
        entryDate: "2026-11-21",
        quantity: 2,
        consumedQty: 0,
        markedPriceCents: 95000,
        unitCostCents: 40000,
        originOrderId: "o1",
        createdAt: "2026-11-21T00:00:00.000Z",
        updatedAt: "2026-11-21T00:00:00.000Z",
      });
      await setDoc(doc(fs, "pointOperations/pop1"), {
        id: "pop1",
        storeId: "pt-store",
        pointId: "pt-store__mostrador",
        kind: "first_surtido",
        intentionId: "int-1",
        confirmedBy: "pt-owner",
        confirmedAt: "2026-11-21T00:00:00.000Z",
      });
    });
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("un miembro de la tienda lee el punto, sus entradas y sus operaciones", async () => {
    const owner = env.authenticatedContext("pt-owner").firestore();
    expect((await getDoc(doc(owner, "points/pt-store__mostrador"))).exists()).toBe(true);
    expect((await getDoc(doc(owner, "pointEntries/pe1"))).exists()).toBe(true);
    expect((await getDoc(doc(owner, "pointOperations/pop1"))).exists()).toBe(true);
  });

  it("un miembro de OTRA tienda no lee ni lista puntos, entradas ni operaciones ajenas", async () => {
    const foreign = env.authenticatedContext("pt-other").firestore();
    await expect(getDoc(doc(foreign, "points/pt-store__mostrador"))).rejects.toThrow();
    await expect(getDoc(doc(foreign, "pointEntries/pe1"))).rejects.toThrow();
    await expect(getDoc(doc(foreign, "pointOperations/pop1"))).rejects.toThrow();
    await expect(getDocs(collection(foreign, "pointEntries"))).rejects.toThrow();
  });

  it("nadie escribe la evidencia del punto desde el cliente (sólo el callable)", async () => {
    const owner = env.authenticatedContext("pt-owner").firestore();
    await expect(setDoc(doc(owner, "pointEntries/pe2"), {
      id: "pe2", storeId: "pt-store", pointId: "pt-store__mostrador", productId: "p2",
      productName: "X", entryDate: "2026-11-21", quantity: 1, consumedQty: 0, markedPriceCents: 100,
    })).rejects.toThrow();
    await expect(updateDoc(doc(owner, "pointEntries/pe1"), { consumedQty: 1 })).rejects.toThrow();
    await expect(deleteDoc(doc(owner, "pointEntries/pe1"))).rejects.toThrow();
    await expect(setDoc(doc(owner, "pointOperations/pop2"), {
      id: "pop2", storeId: "pt-store", pointId: "pt-store__mostrador", kind: "first_surtido",
    })).rejects.toThrow();
    await expect(updateDoc(doc(owner, "pointOperations/pop1"), { kind: "corte" })).rejects.toThrow();
    await expect(deleteDoc(doc(owner, "pointOperations/pop1"))).rejects.toThrow();
  });

  it("el punto es configuración de la tienda: el dueño lo crea/edita, el ajeno no; nadie lo borra", async () => {
    const owner = env.authenticatedContext("pt-owner").firestore();
    await expect(setDoc(doc(owner, "points/pt-store__vitrina"), {
      id: "pt-store__vitrina", storeId: "pt-store", name: "Vitrina plaza", active: true,
      createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z",
    })).resolves.toBeUndefined();
    // #524 review: the REAL client path (saveEntity) keeps ids OUT of the
    // body — the doc path alone carries the identity.
    await expect(setDoc(doc(owner, "points/pt-store__mostrador2"), {
      storeId: "pt-store", name: "Mostrador 2", active: true,
      createdAt: "2026-11-21T00:00:00.000Z", updatedAt: "2026-11-21T00:00:00.000Z",
    })).resolves.toBeUndefined();
    await expect(updateDoc(doc(owner, "points/pt-store__mostrador"), { name: "Mostrador centro 2" })).resolves.toBeUndefined();
    await expect(deleteDoc(doc(owner, "points/pt-store__mostrador"))).rejects.toThrow();

    const foreign = env.authenticatedContext("pt-other").firestore();
    await expect(setDoc(doc(foreign, "points/pt-store__intruso"), {
      id: "pt-store__intruso", storeId: "pt-store", name: "Intruso", active: true,
    })).rejects.toThrow();
    await expect(updateDoc(doc(foreign, "points/pt-store__mostrador"), { name: "Ajeno" })).rejects.toThrow();
  });

  it("sin sesión no hay lecturas de puntos ni evidencia", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await expect(getDoc(doc(anon, "points/pt-store__mostrador"))).rejects.toThrow();
    await expect(getDoc(doc(anon, "pointEntries/pe1"))).rejects.toThrow();
  });
});
