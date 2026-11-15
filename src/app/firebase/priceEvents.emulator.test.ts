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
import { applyProductPrices, loadPriceEvents, saveProductWithPriceEvents } from "./firestoreData";
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

  it("revisión C1: apagar «se vende por color» BORRA el campo variants en el doc (canje canónico de anaquel)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/pv1"), { storeId: STORE, name: "Pieza color", prices: { t_retail: 100 }, variants: [{ id: "v1", color: "Dorado" }], createdAt: NOW, updatedAt: NOW });
    });
    holder.db = env.authenticatedContext(OWNER).firestore();
    holder.uid = OWNER;
    const existing = product("pv1", { t_retail: 100 }) as never as { variants?: unknown[] };
    await saveProductWithPriceEvents({ uid: OWNER, email: "fer@example.com" } as never, existing as never, {
      ...(existing as object), name: "Pieza color", prices: { t_retail: 120 }, variants: undefined, updatedAt: NOW,
    } as never);
    const saved = (await getDoc(doc(holder.db, "products/pv1"))).data();
    expect(saved?.variants).toBeUndefined(); // el campo YA NO EXISTE en el doc
  });

  it("M2: loadPriceEvents devuelve SOLO los eventos de la tienda, del más reciente al más viejo", async () => {
    const dbOwner = env.authenticatedContext(OWNER).firestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "adminStores/other-store"), { ownerUid: "o", memberUids: ["o"] });
      await setDoc(doc(fs, "priceEvents/h1"), { id: "h1", storeId: STORE, productId: "p1", tierId: "t_retail", previousCents: 1, nextCents: 2, changedBy: OWNER, effectiveAt: NOW, recordedAt: "2026-11-14T10:00:00.000Z", origin: "manual" });
      await setDoc(doc(fs, "priceEvents/h2"), { id: "h2", storeId: STORE, productId: "p1", tierId: "t_retail", previousCents: 2, nextCents: 3, changedBy: OWNER, effectiveAt: NOW, recordedAt: "2026-11-14T11:00:00.000Z", origin: "manual" });
      await setDoc(doc(fs, "priceEvents/h3"), { id: "h3", storeId: "other-store", productId: "x", tierId: "t", previousCents: 9, nextCents: 9, changedBy: "o", effectiveAt: NOW, recordedAt: "2026-11-14T12:00:00.000Z", origin: "manual" });
    });
    holder.db = dbOwner;
    holder.uid = OWNER;
    const events = await loadPriceEvents(STORE);
    const ids = events.map((e) => e.id);
    // Solo SU tienda (h3 ajeno jamás aparece), orden descendente entre los sembrados.
    expect(ids).not.toContain("h3");
    expect(ids).toContain("h2");
    expect(ids).toContain("h1");
    expect(ids.indexOf("h2")).toBeLessThan(ids.indexOf("h1"));
  });

  it("#335 r3 VOLUMEN: 260 piezas (520 operaciones) aplican completas — precios y eventos íntegros", async () => {
    holder.db = env.authenticatedContext(OWNER).firestore();
    // Seed 260 products at t_retail 300 under ADMIN (rules off).
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      const batchWrites: Array<Promise<void>> = [];
      for (let i = 0; i < 260; i += 400) {
        const b = [];
        // setDoc loop in chunks — admin context, plain writes.
        for (let j = i; j < Math.min(i + 400, 260); j++) {
          b.push(setDoc(doc(fs, `products/vol${j}`), { storeId: STORE, prices: { t_retail: 300 }, createdAt: NOW, updatedAt: NOW }));
        }
        batchWrites.push(Promise.all(b).then(() => undefined));
      }
      await Promise.all(batchWrites);
    });
    const at = "2026-11-14T22:30:00.000Z";
    const updates = Array.from({ length: 260 }, (_, i) => ({ id: `vol${i}`, prices: { t_retail: 300 + (i % 7) } }));
    // 260 reads (26 chunks of 10 — under the 20-access/query rule limit) and
    // 520 write ops (2 batches — under the 500-op production limit).
    await applyProductPrices({ id: STORE }, updates, at, OWNER);

    let checked = 0;
    // Sample indices whose price EFFECTIVELY changes (i % 7 !== 0): a piece
    // whose rule price equals its current price emits no event, by design.
    for (let i = 1; i < 260; i += 25) {
      if (i % 7 === 0) continue; // price unchanged → no event, by design
      const p = (await getDoc(doc(holder.db, `products/vol${i}`))).data();
      expect(p?.prices?.t_retail).toBe(300 + (i % 7));
      const ev = await getDoc(doc(holder.db, `priceEvents/vol${i}__t_retail:300:${300 + (i % 7)}:${at}`));
      expect(ev.exists()).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(10); // sampled across the whole range
  });
});
