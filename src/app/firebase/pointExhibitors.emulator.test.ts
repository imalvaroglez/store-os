// #524 — Exhibidores tab end-to-end against the REAL rules + auth +
// functions emulators: deliverPointExhibitors writes one piece doc per
// renglón (idempotent per intent), confirmPointExhibitorCost seals a pending
// cost as immutable evidence, withdrawPointExhibitors retires the oldest
// assigned pieces of a row and keeps history. The registry is operational
// ONLY: no pointEntries/pointOperations may appear.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { connectFirestoreEmulator, collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
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

const NOW = "2026-11-22T12:00:00.000Z";
const PT = "pt-store__mostrador";

async function callFn(app: FirebaseApp, name: string, data: Record<string, unknown>) {
  const fns = getFunctions(app, "us-east1");
  const [fnHost, fnPort] = (process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001").split(":");
  connectFunctionsEmulator(fns, fnHost, Number(fnPort));
  return httpsCallable(fns, name)(data);
}

async function pieceDoc(id: string) {
  return (await getDoc(doc(holder.db, "pointExhibitors/" + id))).data();
}

async function piecesInRegistry() {
  // Store-scoped listing (the app's own query shape) — rules reference
  // resource.data.storeId, so member reads stay filtered like production.
  return (await getDocs(query(collection(holder.db, "pointExhibitors"), where("storeId", "==", "pt-store")))).size;
}

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("#524 exhibidores: entrega, costo y retiro (callables)", () => {
  let operator: { app: FirebaseApp; uid: string };
  let outsider: { app: FirebaseApp; uid: string };

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf-8") },
    });
    operator = await emulatedClientApp(`pex-op-${Date.now()}`);
    outsider = await emulatedClientApp(`pex-out-${Date.now()}`);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, "users/tx-user"), { role: "member" });
      await setDoc(doc(fs, "adminStores/pt-store"), { ownerUid: "tx-user", memberUids: ["tx-user", operator.uid] });
      await setDoc(doc(fs, "points/" + PT), {
        id: PT, storeId: "pt-store", name: "Mostrador centro", active: true,
        priceTierId: "t_retail", commissionRate: 0.2, createdAt: NOW, updatedAt: NOW,
      });
    });
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("la entrega crea una pieza por renglón con apertura, costo y auditoría (misión 2×$104 + $58 + $72)", async () => {
    const res = await callFn(operator.app, "deliverPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "dex-1", physicalDate: "2026-11-01", opening: true,
      lines: [
        { name: "Tabla", quantity: 2, unitCostCents: 10400 },
        { name: "Exhibidor chico", quantity: 1, unitCostCents: 5800 },
        { name: "Exhibidor grande", quantity: 1, unitCostCents: 7200 },
      ],
    });
    expect(res.data).toMatchObject({ delivered: true, pieces: 4 });
    const first = (await pieceDoc("pex_dex-1_0"))!;
    expect(first).toMatchObject({
      storeId: "pt-store", pointId: PT, deliveryId: "dex-1", lineIndex: 0, name: "Tabla",
      deliveredAt: "2026-11-01", opening: true, unitCostCents: 10400,
      deliveredBy: operator.uid, costConfirmedBy: operator.uid,
    });
    expect((await pieceDoc("pex_dex-1_1"))).toMatchObject({ name: "Tabla", lineIndex: 0 });
    expect((await pieceDoc("pex_dex-1_2"))).toMatchObject({ name: "Exhibidor chico", lineIndex: 1 });
    expect((await pieceDoc("pex_dex-1_3"))).toMatchObject({ name: "Exhibidor grande", lineIndex: 2 });
    // Separación estructural: el registro operativo no genera evidencia de
    // mercancía ni de dinero.
    expect((await getDocs(query(collection(holder.db, "pointEntries"), where("storeId", "==", "pt-store")))).size).toBe(0);
    expect((await getDocs(query(collection(holder.db, "pointOperations"), where("storeId", "==", "pt-store")))).size).toBe(0);
  });

  it("reintentar el MISMO intento no duplica piezas", async () => {
    const res = await callFn(operator.app, "deliverPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "dex-1", physicalDate: "2026-11-01", opening: true,
      lines: [{ name: "Tabla", quantity: 2, unitCostCents: 10400 }],
    });
    expect(res.data).toMatchObject({ delivered: false, alreadyDelivered: true });
    expect(await piecesInRegistry()).toBe(4);
  });

  it("un costo pendiente se confirma después y queda sellado como evidencia", async () => {
    await callFn(operator.app, "deliverPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "dex-2", physicalDate: "2026-11-18", opening: false,
      lines: [{ name: "Barral", quantity: 1 }],
    });
    const pending = (await pieceDoc("pex_dex-2_0"))!;
    expect(pending.unitCostCents).toBeUndefined();

    const confirm = await callFn(operator.app, "confirmPointExhibitorCost", {
      storeId: "pt-store", pointId: PT, items: [{ exhibitorId: "pex_dex-2_0", unitCostCents: 5800 }],
    });
    expect(confirm.data).toMatchObject({ confirmed: 1 });
    const sealed = (await pieceDoc("pex_dex-2_0"))!;
    expect(sealed.unitCostCents).toBe(5800);
    expect(sealed.costConfirmedBy).toBe(operator.uid);
    expect(typeof sealed.costConfirmedAt).toBe("string");

    // Mismo valor: reintento idempotente.
    const retry = await callFn(operator.app, "confirmPointExhibitorCost", {
      storeId: "pt-store", pointId: PT, items: [{ exhibitorId: "pex_dex-2_0", unitCostCents: 5800 }],
    });
    expect(retry.data).toMatchObject({ alreadyConfirmed: 1 });
    // Valor distinto: el costo confirmado es inmutable.
    await expect(callFn(operator.app, "confirmPointExhibitorCost", {
      storeId: "pt-store", pointId: PT, items: [{ exhibitorId: "pex_dex-2_0", unitCostCents: 9000 }],
    })).rejects.toThrow(/costo confirmado distinto/i);
  });

  it("el retiro marca la pieza más antigua del renglón y conserva el historial", async () => {
    await callFn(operator.app, "deliverPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "dex-3", physicalDate: "2026-11-15", opening: false,
      lines: [{ name: "Exhibidor mediano", quantity: 1, unitCostCents: 9000 }],
    });
    const res = await callFn(operator.app, "withdrawPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "wex-1", physicalDate: "2026-11-24",
      lines: [{ deliveryId: "dex-1", lineIndex: 0, quantity: 1 }],
    });
    expect(res.data).toMatchObject({ withdrawn: true, pieces: 1 });
    const retired = (await pieceDoc("pex_dex-1_0"))!;
    expect(retired).toMatchObject({ withdrawnAt: "2026-11-24", withdrawnBy: operator.uid, withdrawalIntentionId: "wex-1" });
    expect((await pieceDoc("pex_dex-1_1"))!.withdrawnAt).toBeUndefined();
    // La apertura es histórica: la pieza retirada conserva su costo de apertura.
    expect(retired.opening).toBe(true);
    expect(retired.unitCostCents).toBe(10400);
  });

  it("reintentar el retiro con el MISMO intento no marca nada más", async () => {
    const res = await callFn(operator.app, "withdrawPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "wex-1", physicalDate: "2026-11-24",
      lines: [{ deliveryId: "dex-1", lineIndex: 0, quantity: 1 }],
    });
    expect(res.data).toMatchObject({ withdrawn: false, alreadyWithdrawn: true });
    expect((await pieceDoc("pex_dex-1_1"))!.withdrawnAt).toBeUndefined();
  });

  it("retirar más de lo asignado falla limpio, sin efectos parciales", async () => {
    await expect(callFn(operator.app, "withdrawPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "wex-2", physicalDate: "2026-11-24",
      lines: [{ deliveryId: "dex-1", lineIndex: 0, quantity: 2 }],
    })).rejects.toThrow(/No hay suficientes exhibidores/i);
    expect((await pieceDoc("pex_dex-1_1"))!.withdrawnAt).toBeUndefined();
  });

  it("retiros concurrentes con intenciones distintas no sobregiran el renglón", async () => {
    const first = callFn(operator.app, "withdrawPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "wex-3", physicalDate: "2026-11-25",
      lines: [{ deliveryId: "dex-1", lineIndex: 0, quantity: 1 }],
    });
    const second = callFn(operator.app, "withdrawPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "wex-4", physicalDate: "2026-11-25",
      lines: [{ deliveryId: "dex-1", lineIndex: 0, quantity: 1 }],
    });
    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    expect(fulfilled + rejected).toBe(2);
    // Solo había 1 tabla asignada: exactamente una intención gana.
    expect([fulfilled, rejected]).toContain(1);
    const withdrawn = (await getDocs(query(collection(holder.db, "pointExhibitors"), where("storeId", "==", "pt-store")))).docs.filter(
      (d) => d.get("withdrawnAt") !== undefined && d.get("deliveryId") === "dex-1" && d.get("lineIndex") === 0
    );
    expect(withdrawn).toHaveLength(2); // pex_dex-1_0 (wex-1) + la tabla restante
  });

  it("confirmar el costo de una pieza retirada se rechaza", async () => {
    await expect(callFn(operator.app, "confirmPointExhibitorCost", {
      storeId: "pt-store", pointId: PT, items: [{ exhibitorId: "pex_dex-1_0", unitCostCents: 9000 }],
    })).rejects.toThrow(/retirada/i);
  });

  it("una operadora ajena a la tienda no entrega, no confirma ni retira", async () => {
    await expect(callFn(outsider.app, "deliverPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "dex-x", physicalDate: "2026-11-22", opening: false,
      lines: [{ name: "Intruso", quantity: 1 }],
    })).rejects.toThrow(/acceso a esta tienda/i);
    await expect(callFn(outsider.app, "confirmPointExhibitorCost", {
      storeId: "pt-store", pointId: PT, items: [{ exhibitorId: "pex_dex-2_0", unitCostCents: 5800 }],
    })).rejects.toThrow(/acceso a esta tienda/i);
    await expect(callFn(outsider.app, "withdrawPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "wex-x", physicalDate: "2026-11-22",
      lines: [{ deliveryId: "dex-1", lineIndex: 1, quantity: 1 }],
    })).rejects.toThrow(/acceso a esta tienda/i);
  });

  it("valida fecha irreal, nombre vacío y cantidad cero antes de tocar Firestore", async () => {
    await expect(callFn(operator.app, "deliverPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "dex-bad-1", physicalDate: "2026-02-30", opening: false,
      lines: [{ name: "Tabla", quantity: 1 }],
    })).rejects.toThrow(/fecha real/i);
    await expect(callFn(operator.app, "deliverPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "dex-bad-2", physicalDate: "2026-11-22", opening: false,
      lines: [{ name: "   ", quantity: 1 }],
    })).rejects.toThrow(/nombre/i);
    await expect(callFn(operator.app, "deliverPointExhibitors", {
      storeId: "pt-store", pointId: PT, intentId: "dex-bad-3", physicalDate: "2026-11-22", opening: false,
      lines: [{ name: "Tabla", quantity: 0 }],
    })).rejects.toThrow(/cantidad/i);
  });
});
