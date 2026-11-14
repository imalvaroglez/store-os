import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { readFileSync } from "node:fs";

// #335 r2: the price-change trail EXISTS operationally — manual saves and rule
// applications emit real events, and the collection is append-only, store-
// scoped and idempotent by intent (issue acceptance criteria).

const holder = vi.hoisted(() => ({ db: null as any, uid: undefined as string | undefined }));
vi.mock("./config", () => ({
  getFirebase: () => ({ db: holder.db, auth: { currentUser: holder.uid ? { uid: holder.uid } : null } }),
}));
import { applyProductPrices, saveProductWithPriceEvents } from "./firestoreData";
import { buildManualPriceEvents, eventDocId } from "../../lib/priceDiagnostics";
import type { Product } from "../../types";

let env: RulesTestEnvironment;
const STORE = "pd-store";
const OWNER = "pd-owner";
const FOREIGN = "pd-foreign";

const NOW = "2026-11-14T21:00:00.000Z";
const product = (id: string, prices: Record<string, number>): Product => ({
  id, storeId: STORE, name: "Pieza", category: "other", slug: id, status: "published", isPublic: true,
  quantityOnHand: 1, cost: 20, prices, createdAt: NOW, updatedAt: NOW,
} as unknown as Product);

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#335 r2 — eventos de precio (priceEvents)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf-8") },
    });
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, `users/${OWNER}`), { role: "member" });
      await setDoc(doc(fs, `users/${FOREIGN}`), { role: "member" });
      await setDoc(doc(fs, `adminStores/${STORE}`), { ownerUid: OWNER, memberUids: [OWNER] });
      await setDoc(doc(fs, "products/p1"), { storeId: STORE, name: "Pieza", prices: { t_retail: 300 }, createdAt: NOW, updatedAt: NOW });
    });
  });
  afterAll(async () => { await env?.cleanup(); });

  it("guardado MANUAL: el evento cae con el precio en el MISMO lote (id determinista por intento)", async () => {
    holder.db = env.authenticatedContext(OWNER).firestore();
    holder.uid = OWNER;
    const existing = product("p1", { t_retail: 300 });
    const next = { ...existing, prices: { t_retail: 350 }, updatedAt: NOW };
    await saveProductWithPriceEvents({ uid: OWNER } as never, existing, next);

    const event = (await getDoc(doc(holder.db, `priceEvents/${eventDocId("p1", `t_retail:300:350:${NOW}`)}`))).data();
    expect(event).toMatchObject({ storeId: STORE, productId: "p1", tierId: "t_retail", previousCents: 30000, nextCents: 35000, changedBy: OWNER, origin: "manual" });
    const price = (await getDoc(doc(holder.db, "products/p1"))).data();
    expect(price?.prices?.t_retail).toBe(350);
  });

  it("aplicación de REGLA: un evento por nivel efectivamente cambiado; el que no cambia no emite", async () => {
    holder.db = env.authenticatedContext(OWNER).firestore();
    // p1 quedó en 350 (prueba anterior); p2 NO cambia (300→300), p3 sí (300→400).
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/p2"), { storeId: STORE, prices: { t_retail: 300 }, createdAt: NOW, updatedAt: NOW });
      await setDoc(doc(ctx.firestore(), "products/p3"), { storeId: STORE, prices: { t_retail: 300 }, createdAt: NOW, updatedAt: NOW });
    });
    const at = "2026-11-14T21:05:00.000Z";
    await applyProductPrices({ id: STORE }, [
      { id: "p2", prices: { t_retail: 300 } },
      { id: "p3", prices: { t_retail: 400 } },
    ], at, OWNER);

    // Store-scoped query — the collection's LIST is membership-scoped (#176).
    const events = (await getDocs(query(collection(holder.db, "priceEvents"), where("storeId", "==", STORE)))).docs.map((d) => d.data());
    const ruleEvents = events.filter((e) => e.origin === "rule_application");
    expect(ruleEvents).toHaveLength(1);
    expect(ruleEvents[0]).toMatchObject({ productId: "p3", tierId: "t_retail", previousCents: 30000, nextCents: 40000 });
  });

  it("reintento del MISMO intento es idempotente (reescritura idéntica permitida); MODIFICAR se niega", async () => {
    const dbOwner = env.authenticatedContext(OWNER).firestore();
    const events = buildManualPriceEvents({
      storeId: STORE, productId: "p9", updatedAt: NOW, uid: OWNER,
      previous: { prices: { t_retail: 100 } }, next: { prices: { t_retail: 150 } },
    });
    await setDoc(doc(dbOwner, `priceEvents/${events[0].id}`), events[0] as never);
    // Same-intent retry: byte-identical write is a permitted no-op.
    await expect(setDoc(doc(dbOwner, `priceEvents/${events[0].id}`), events[0] as never)).resolves.toBeUndefined();
    // Any modification of history is denied (append-only).
    await expect(updateDoc(doc(dbOwner, `priceEvents/${events[0].id}`), { nextCents: 999999 })).rejects.toThrow();
    await expect(deleteDoc(doc(dbOwner, `priceEvents/${events[0].id}`))).rejects.toThrow();
  });

  it("aislamiento por tienda: ajeno no lee, no lista, no crea; el id debe ser el del cuerpo", async () => {
    const foreign = env.authenticatedContext(FOREIGN).firestore();
    const events = buildManualPriceEvents({
      storeId: STORE, productId: "p8", updatedAt: NOW, uid: OWNER,
      previous: { prices: { t_retail: 10 } }, next: { prices: { t_retail: 11 } },
    });
    const dbOwner = env.authenticatedContext(OWNER).firestore();
    await setDoc(doc(dbOwner, `priceEvents/${events[0].id}`), events[0] as never);
    await expect(getDoc(doc(foreign, `priceEvents/${events[0].id}`))).rejects.toThrow();
    await expect(getDocs(collection(foreign, "priceEvents"))).rejects.toThrow();
    await expect(setDoc(doc(foreign, "priceEvents/x"), { id: "x", storeId: STORE, changedBy: FOREIGN, productId: "p1", tierId: "t", previousCents: 1, nextCents: 2, effectiveAt: NOW, recordedAt: NOW, origin: "manual" })).rejects.toThrow();
    // Even a member: the event must name THEM as changedBy.
    await expect(setDoc(doc(dbOwner, "priceEvents/y"), { id: "y", storeId: STORE, changedBy: "someone-else", productId: "p1", tierId: "t", previousCents: 1, nextCents: 2, effectiveAt: NOW, recordedAt: NOW, origin: "manual" })).rejects.toThrow();
  });
});
