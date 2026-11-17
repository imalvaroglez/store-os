import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { readFileSync } from "node:fs";
import { buildProfitDistributionDoc } from "../../lib/profitDistribution";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { authorizeProfitDistribution } from "./firestoreData";

let env: RulesTestEnvironment;

const distribution = (now: string, authorizedAmountCents = 96000, intentId = `int-${authorizedAmountCents}-${now}`) =>
  buildProfitDistributionDoc({
    storeId: "dist-store",
    period: "2026-10",
    closeId: "close-oct",
    authorizedAmountCents,
    split: { ferCents: 28800, oliviaCents: 57600, investorCents: 9600 },
    uid: "owner-user",
    now,
    intentId,
  });

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#459 r4 — autorización de reparto por el helper real", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "adminStores/dist-store"), { ownerUid: "owner-user", memberUids: ["owner-user", "member-user"] });
    });
    // The REAL helper under the OWNER's session — the exact path the UI takes.
    holder.db = env.authenticatedContext("owner-user").firestore();
  });
  afterAll(async () => { await env?.cleanup(); });

  it("la dueña crea la autorización — antes 100% de intentos moría en permission-denied", async () => {
    const result = await authorizeProfitDistribution(distribution("2026-11-01T10:00:00.000Z"));
    const saved = await getDoc(doc(holder.db, "profitDistributions", result.id));
    expect(saved.exists()).toBe(true);
    expect(saved.data()!.status).toBe("authorized");
  });

  it("el reintento del MISMO intento es idempotente aunque el reloj avance", async () => {
    const before = (await getDocs(query(collection(holder.db, "profitDistributions"), where("storeId", "==", "dist-store")))).size;
    const first = await authorizeProfitDistribution(distribution("2026-11-01T10:00:00.000Z", 96000, "int-retry"));
    // Un reintento tardío reconstruye el doc con OTRO `now` pero el MISMO
    // intentId: sin duplicados.
    const retry = await authorizeProfitDistribution(distribution("2026-11-01T10:05:00.000Z", 96000, "int-retry"));
    expect(retry.id).toBe(first.id);
    const snap = await getDocs(query(collection(holder.db, "profitDistributions"), where("storeId", "==", "dist-store")));
    expect(snap.size).toBe(before + 1);
  });

  it("#459 r6: dos autorizaciones legítimas del MISMO importe son DOS intents distintos", async () => {
    // Identificar por tienda+periodo+monto confundía un intento nuevo con el
    // reintento anterior: la segunda autorización de $400 del periodo se
    // absorbía en silencio. La identidad del intento es el intentId de la UI.
    const before = (await getDocs(query(collection(holder.db, "profitDistributions"), where("storeId", "==", "dist-store")))).size;
    const firstSame = await authorizeProfitDistribution(distribution("2026-11-01T11:00:00.000Z", 40000, "int-400-a"));
    const secondSame = await authorizeProfitDistribution(distribution("2026-11-01T12:00:00.000Z", 40000, "int-400-b"));
    expect(secondSame.id).not.toBe(firstSame.id); // mismo monto, intents distintos
    const snap = await getDocs(query(collection(holder.db, "profitDistributions"), where("storeId", "==", "dist-store")));
    expect(snap.size).toBe(before + 2); // dos intents del mismo importe
  });

  it("#459 r5: una SEGUNDA autorización por un monto distinto SÍ escribe (autorizaciones parciales sucesivas)", async () => {
    // Antes: devolvía el id de la primera sin escribir — el remanente quedaba
    // permanentemente inautorizable con éxito aparente en pantalla.
    const before = (await getDocs(query(collection(holder.db, "profitDistributions"), where("storeId", "==", "dist-store")))).size;
    const second = await authorizeProfitDistribution(distribution("2026-11-01T11:00:00.000Z", 40000, "int-400-x"));
    expect(second.id).toBeTruthy();
    let snap = await getDocs(query(collection(holder.db, "profitDistributions"), where("storeId", "==", "dist-store")));
    expect(snap.size).toBe(before + 1); // autorización sucesiva del periodo
    // Y su reintento (otro `now`, MISMO intentId) sigue idempotente.
    const retrySecond = await authorizeProfitDistribution(distribution("2026-11-01T11:30:00.000Z", 40000, "int-400-x"));
    expect(retrySecond.id).toBe(second.id);
    snap = await getDocs(query(collection(holder.db, "profitDistributions"), where("storeId", "==", "dist-store")));
    expect(snap.size).toBe(before + 1);
  });

  it("una colega miembro NO puede autorizar (reglas owner-only)", async () => {
    const memberDb = env.authenticatedContext("member-user").firestore();
    await expect(
      memberDb.collection("profitDistributions").doc("x1").set({
        ...distribution("2026-11-02T10:00:00.000Z"), id: "x1", createdBy: "member-user",
      })
    ).rejects.toThrow(/PERMISSION/i);
  });
});
