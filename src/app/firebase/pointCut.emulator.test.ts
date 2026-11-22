// #524 — cortes/cobros/anulación end-to-end against the REAL rules + auth +
// functions emulators. The rules deny every client write to pointEntries/
// pointOperations, so these suites drive the trusted callables exactly as
// production would. The happy path is the issue's own worked example.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { connectFirestoreEmulator, doc, getDoc, setDoc } from "firebase/firestore";
import { initializeFirestore } from "firebase/firestore";
import { initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { readFileSync } from "node:fs";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({
  getFirebase: () => ({ db: holder.db }),
  isFirebaseConfigured: () => true,
  FIREBASE_EMULATOR_ENABLED: true,
}));

let env: RulesTestEnvironment;

async function emulatedClientApp(name: string): Promise<{ app: FirebaseApp; uid: string }> {
  const app = initializeApp(
    { projectId: "store-os-dev", apiKey: "demo-api-key", authDomain: "store-os-dev.firebaseapp.com" },
    name
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`, { disableWarnings: true });
  const created = await createUserWithEmailAndPassword(auth, `${name}-${Date.now()}@example.test`, "password123");
  const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  const [fsHost, fsPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
  connectFirestoreEmulator(db, fsHost, Number(fsPort));
  return { app, uid: created.user.uid };
}

const NOW = "2026-11-21T12:00:00.000Z";
const PT = "pt-store__mostrador";

async function callCut(app: FirebaseApp, name: string, data: Record<string, unknown>) {
  const fns = getFunctions(app, "us-east1");
  const [fnHost, fnPort] = (process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001").split(":");
  connectFunctionsEmulator(fns, fnHost, Number(fnPort));
  return httpsCallable(fns, name)(data);
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#524 cortes, cobro y anulación (callables)", () => {
  let operator: { app: FirebaseApp; uid: string };
  let outsider: { app: FirebaseApp; uid: string };

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    operator = await emulatedClientApp(`cut-op-${Date.now()}`);
    outsider = await emulatedClientApp(`cut-out-${Date.now()}`);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "users/tx-user"), { role: "member" });
      await setDoc(doc(fs, "adminStores/pt-store"), { ownerUid: "tx-user", memberUids: ["tx-user", operator.uid] });
      await setDoc(doc(fs, "points/" + PT), {
        id: PT, storeId: "pt-store", name: "Mostrador centro", active: true,
        priceTierId: "t_retail", commissionRate: 0.2, createdAt: NOW, updatedAt: NOW,
      });
      // The issue's example: 10 pieces at $100 (cost $50), single entry.
      await setDoc(doc(fs, "pointEntries/pe-cut-1"), {
        id: "pe-cut-1", storeId: "pt-store", pointId: PT, productId: "p1",
        productName: "Reloj", entryDate: "2026-11-01", quantity: 10, consumedQty: 0,
        markedPriceCents: 10000, unitCostCents: 5000, createdAt: NOW, updatedAt: NOW,
      });
    });
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("el ejemplo de la issue: vender 5 de 10 y perder 1 con comisión 20%", async () => {
    const res = await callCut(operator.app, "registerPointCut", {
      storeId: "pt-store", pointId: PT, intentId: "cut-1", effectiveDate: "2026-11-21",
      commissionRate: 0.2,
      lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 5 }],
      writeOffs: [{ productId: "p1", markedPriceCents: 10000, qty: 1, reason: "Pieza perdida en mostrador" }],
    });
    expect(res.data).toMatchObject({
      registered: true,
      corteId: "corte_cut-1",
      totals: {
        grossSaleCents: 50000, commissionCents: 10000, netCents: 40000,
        soldCostCents: 25000, writeOffCostCents: 5000, resultCents: 10000,
        remainingUnits: 4, pendingCostUnits: 0, writeOffPendingUnits: 0,
      },
    });
    const entry = (await getDoc(doc(holder.db, "pointEntries/pe-cut-1"))).data()!;
    expect(entry.consumedQty).toBe(6); // 5 vendidas + 1 baja sobre la misma entrada
    const op = (await getDoc(doc(holder.db, "pointOperations/corte_cut-1"))).data()!;
    expect(op).toMatchObject({ kind: "corte", status: "pendiente_de_cobro", effectiveDate: "2026-11-21", commissionRate: 0.2 });
    expect(op.confirmedBy).toBe(operator.uid);
  });

  it("reintentar el MISMO intento no duplica consumos ni evidencia", async () => {
    const res = await callCut(operator.app, "registerPointCut", {
      storeId: "pt-store", pointId: PT, intentId: "cut-1", effectiveDate: "2026-11-21",
      commissionRate: 0.2,
      lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 5 }],
      writeOffs: [{ productId: "p1", markedPriceCents: 10000, qty: 1, reason: "Pieza perdida en mostrador" }],
    });
    expect(res.data).toMatchObject({ registered: false, alreadyRegistered: true });
    const entry = (await getDoc(doc(holder.db, "pointEntries/pe-cut-1"))).data()!;
    expect(entry.consumedQty).toBe(6);
  });

  it("stock insuficiente se rechaza con la línea y no consume nada", async () => {
    await expect(callCut(operator.app, "registerPointCut", {
      storeId: "pt-store", pointId: PT, intentId: "cut-2", effectiveDate: "2026-11-21",
      commissionRate: 0.2,
      lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 5 }],
    })).rejects.toThrow(/faltan/i);
    const entry = (await getDoc(doc(holder.db, "pointEntries/pe-cut-1"))).data()!;
    expect(entry.consumedQty).toBe(6); // sin cambios
    expect((await getDoc(doc(holder.db, "pointOperations/corte_cut-2"))).exists()).toBe(false);
  });

  it("cobro: importe completo propuesto, fecha real y medio; el corte queda cobrado e idempotente", async () => {
    const res = await callCut(operator.app, "registerPointCutPayment", {
      storeId: "pt-store", pointId: PT, corteId: "corte_cut-1", intentId: "pay-1",
      method: "cash", date: "2026-12-03",
    });
    expect(res.data).toMatchObject({ registered: true, amountCents: 40000, date: "2026-12-03", method: "cash" });
    const cobro = (await getDoc(doc(holder.db, "pointOperations/cobro_pay-1"))).data()!;
    expect(cobro).toMatchObject({ kind: "cobro", corteId: "corte_cut-1", amountCents: 40000 });
    const corte = (await getDoc(doc(holder.db, "pointOperations/corte_cut-1"))).data()!;
    expect(corte.status).toBe("cobrado");

    const retry = await callCut(operator.app, "registerPointCutPayment", {
      storeId: "pt-store", pointId: PT, corteId: "corte_cut-1", intentId: "pay-1",
      method: "cash", date: "2026-12-03",
    });
    expect(retry.data).toMatchObject({ registered: false, alreadyRegistered: true });
    await expect(callCut(operator.app, "registerPointCutPayment", {
      storeId: "pt-store", pointId: PT, corteId: "corte_cut-1", intentId: "pay-2",
      method: "transfer", date: "2026-12-04",
    })).rejects.toThrow(/ya tiene su cobro/i);
  });

  it("anular un corte YA COBRADO se rechaza", async () => {
    await expect(callCut(operator.app, "annulPointCut", {
      storeId: "pt-store", pointId: PT, corteId: "corte_cut-1", intentId: "annul-1", motive: "Error de captura",
    })).rejects.toThrow(/cobrado no se puede anular/i);
  });

  it("anulación del último corte sin cobrar repone las MISMAS entradas", async () => {
    // Un corte fresco sobre lo restante (4 piezas): vender 2.
    const cut = await callCut(operator.app, "registerPointCut", {
      storeId: "pt-store", pointId: PT, intentId: "cut-3", effectiveDate: "2026-11-25",
      commissionRate: 0.2,
      lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 2 }],
    });
    expect(cut.data).toMatchObject({ registered: true });
    let entry = (await getDoc(doc(holder.db, "pointEntries/pe-cut-1"))).data()!;
    expect(entry.consumedQty).toBe(8); // 6 + 2

    const annul = await callCut(operator.app, "annulPointCut", {
      storeId: "pt-store", pointId: PT, corteId: "corte_cut-3", intentId: "annul-2", motive: "Se capturó dos veces",
    });
    expect(annul.data).toMatchObject({ registered: true });
    entry = (await getDoc(doc(holder.db, "pointEntries/pe-cut-1"))).data()!;
    expect(entry.consumedQty).toBe(6); // repuestas exactas
    const corte = (await getDoc(doc(holder.db, "pointOperations/corte_cut-3"))).data()!;
    expect(corte.status).toBe("anulado");
    const anul = (await getDoc(doc(holder.db, "pointOperations/anul_annul-2"))).data()!;
    expect(anul).toMatchObject({ kind: "anulacion", corteId: "corte_cut-3", motive: "Se capturó dos veces" });

    // Anular de nuevo (o con movimiento posterior) se rechaza.
    await expect(callCut(operator.app, "annulPointCut", {
      storeId: "pt-store", pointId: PT, corteId: "corte_cut-3", intentId: "annul-3", motive: "Otra vez",
    })).rejects.toThrow(/anulado/i);
  });

  it("un corte neto CERO queda «sin cobro» (no exige viaje de cobranza)", async () => {
    const res = await callCut(operator.app, "registerPointCut", {
      storeId: "pt-store", pointId: PT, intentId: "cut-zero", effectiveDate: "2026-11-26",
      commissionRate: 1, // comisión del 100% sólo para forzar neto cero en prueba
      lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 1 }],
    });
    expect(res.data).toMatchObject({ registered: true, totals: { netCents: 0 } });
    const op = (await getDoc(doc(holder.db, "pointOperations/corte_cut-zero"))).data()!;
    expect(op.status).toBe("sin_cobro");
  });

  it("una operadora ajena a la tienda no puede registrar cortes", async () => {
    await expect(callCut(outsider.app, "registerPointCut", {
      storeId: "pt-store", pointId: PT, intentId: "cut-x", effectiveDate: "2026-11-21",
      commissionRate: 0.2, lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 1 }],
    })).rejects.toThrow();
  });

  // --- Dictamen QA #524 (22-nov) — Mayor 2: sealed months are enforced by the
  // SERVER, not the UI: an annulment/backdated cut/payment of a closed month
  // is rejected inside the transaction with no partial writes.
  it("un corte de un mes SELLADO no se puede anular: rechazo de servidor sin escrituras (repro QA)", async () => {
    await callCut(operator.app, "registerPointCut", {
      storeId: "pt-store", pointId: PT, intentId: "cut-sealed", effectiveDate: "2026-11-20",
      commissionRate: 0.2,
      lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 1 }],
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "closes/close-2026-11"), {
        id: "close-2026-11", storeId: "pt-store", period: "2026-11",
        status: "authorized", createdAt: NOW, updatedAt: NOW,
      });
    });
    await expect(callCut(operator.app, "annulPointCut", {
      storeId: "pt-store", pointId: PT, corteId: "corte_cut-sealed", intentId: "annul-sealed", motive: "Prueba del guard",
    })).rejects.toThrow(/mes cerrado|sellado|cerrado/i);
    // No partial writes: the corte keeps its status and NO anulación exists.
    const op = (await getDoc(doc(holder.db, "pointOperations/corte_cut-sealed"))).data()!;
    expect(op.status).toBe("pendiente_de_cobro");
    expect((await getDoc(doc(holder.db, "pointOperations/anul_annul-sealed"))).exists()).toBe(false);
  });

  it("registerPointCut con effectiveDate de un mes sellado se rechaza en el servidor", async () => {
    await expect(callCut(operator.app, "registerPointCut", {
      storeId: "pt-store", pointId: PT, intentId: "cut-backdate", effectiveDate: "2026-11-05",
      commissionRate: 0.2,
      lines: [{ productId: "p1", markedPriceCents: 10000, soldQty: 1 }],
    })).rejects.toThrow(/mes cerrado|sellado|cerrado/i);
    expect((await getDoc(doc(holder.db, "pointOperations/corte_cut-backdate"))).exists()).toBe(false);
  });

  it("registerPointCutPayment con fecha de un mes sellado se rechaza en el servidor", async () => {
    await expect(callCut(operator.app, "registerPointCutPayment", {
      storeId: "pt-store", pointId: PT, corteId: "corte_cut-sealed", intentId: "pay-sealed",
      date: "2026-11-15", method: "cash",
    })).rejects.toThrow(/mes cerrado|sellado|cerrado/i);
    expect((await getDoc(doc(holder.db, "pointOperations/cobro_pay-sealed"))).exists()).toBe(false);
  });
});
