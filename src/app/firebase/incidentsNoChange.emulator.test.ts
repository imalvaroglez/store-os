// #560: «Sin cambio» end-to-end against the REAL rules + auth + functions
// emulators. The close is idempotent evidence; the wrongly-charged line
// becomes editable (#368 lifted read-side by the derived state) and the
// reconciled credit still flows to the next eligible order through the
// TRUSTED applyCredit callable, exactly as production does (#189).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, initializeFirestore, setDoc } from "firebase/firestore";
import { initializeApp, type FirebaseApp } from "firebase/app";
import { readFileSync } from "node:fs";
import type { Order, OrderIncident, OrderIncidentEvent } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any, app: null as any }));
vi.mock("./config", () => ({
  getFirebase: () => ({ app: holder.app, db: holder.db }),
  isFirebaseConfigured: () => true,
  FIREBASE_EMULATOR_ENABLED: true,
}));
import { applyCustomerCreditTx, applyIncidentEventTx, openIncidentTx, saveOrderWithStockTx, StaleOrderError } from "./firestoreData";
import { IncidentEvidenceError } from "../../features/orders/incidents";

let env: RulesTestEnvironment;

const event = (id: string, kind: OrderIncidentEvent["kind"], detail?: Record<string, string | number>): OrderIncidentEvent => ({
  id, kind, at: "2026-11-21T12:00:00.000Z", by: "inc560-user", ...(detail ? { detail } : {}),
});

const line = (lineId: string, unitPrice: number) =>
  ({ lineId, productId: `p-${lineId}`, productName: `Pieza ${lineId}`, quantity: 1, unitPrice, subtotal: unitPrice });

const asOrder = (id: string, items: unknown[], extra: Record<string, unknown> = {}): Order =>
  ({ id, storeId: "inc560-store", customerId: "inc560-clienta", items: items as Order["items"], deposit: 0,
     orderStatus: "confirmed", paymentStatus: "unpaid",
     createdAt: "2026-11-20T10:00:00.000Z", updatedAt: "2026-11-21T12:00:00.000Z", ...extra } as unknown as Order);

/** A client app connected to the auth/firestore emulators with a freshly
 * created signed-in user (the callables get a real token; functionsInstance
 * connects itself to the emulator under the right region). */
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

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("cierre «Sin cambio» con emuladores (#560)", () => {
  let operator: { app: FirebaseApp; uid: string };

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    operator = await emulatedClientApp(`inc560-op-${Date.now()}`);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/inc560-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/inc560-store"), { ownerUid: "inc560-user", memberUids: ["inc560-user", operator.uid] });
      await setDoc(doc(ctx.firestore(), "products/p-L1"), {
        storeId: "inc560-store", name: "Collar", sku: "QA-560-A", category: "jewelry",
        quantityOnHand: 5, price: 760, cost: 300, status: "draft", createdAt: "", updatedAt: "",
      });
      await setDoc(doc(ctx.firestore(), "products/p-L30"), {
        storeId: "inc560-store", name: "Aro cambio", sku: "QA-560-B", category: "jewelry",
        quantityOnHand: 5, price: 30, cost: 10, status: "draft", createdAt: "", updatedAt: "",
      });
      await setDoc(doc(ctx.firestore(), "products/inc560-repl"), {
        storeId: "inc560-store", name: "Aro reemplazo", sku: "QA-560-C", category: "jewelry",
        quantityOnHand: 2, price: 60, cost: 20, status: "draft", createdAt: "", updatedAt: "",
      });
      // The order of the case: $790 (a $760 sale + a $30 line charged only
      // for the never-happened change), paid $820, $30 already applied to a
      // sister order.
      await setDoc(doc(ctx.firestore(), "orders/inc560-order"), {
        storeId: "inc560-store", customerId: "inc560-clienta",
        items: [line("L1", 760), line("L30", 30)],
        deposit: 0, orderStatus: "confirmed", paymentsReceivedCents: 82000,
        inheritedDepositMaterialized: true, creditConsumedCents: 3000, revision: 1,
        createdAt: "2026-11-20T10:00:00Z", updatedAt: "2026-11-20T10:00:00Z",
      });
      // The next eligible order: owes $500, no payments yet.
      await setDoc(doc(ctx.firestore(), "orders/inc560-next"), {
        storeId: "inc560-store", customerId: "inc560-clienta",
        items: [line("N1", 500)],
        deposit: 0, orderStatus: "confirmed", revision: 1,
        createdAt: "2026-11-22T10:00:00Z", updatedAt: "2026-11-22T10:00:00Z",
      });
      // A second order whose incident WILL be confirmed (executed-facts guard).
      await setDoc(doc(ctx.firestore(), "orders/inc560-order-b"), {
        storeId: "inc560-store", customerId: "inc560-clienta",
        items: [line("B1", 120)],
        deposit: 0, orderStatus: "confirmed", paymentsReceivedCents: 12000,
        inheritedDepositMaterialized: true, revision: 1,
        createdAt: "2026-11-19T10:00:00Z", updatedAt: "2026-11-19T10:00:00Z",
      });
    });
    holder.app = operator.app;
    holder.db = env.authenticatedContext("inc560-user").firestore();
    // The incident on the case's $30 line, with an agreed-but-unexecuted
    // replacement resolution (exactly the desist scenario).
    await openIncidentTx({
      orderId: "inc560-order", storeId: "inc560-store",
      incident: {
        id: "inc560-i1", lineId: "L30", productId: "p-L30", productName: "Aro cambio",
        quantity: 1, reason: "Piedra fallada", originalUnitPriceCents: 3000,
        events: [event("inc560-open", "opened")],
      },
    });
    await applyIncidentEventTx({
      orderId: "inc560-order", storeId: "inc560-store", incidentId: "inc560-i1",
      event: event("inc560-agree", "resolution_agreed"),
      resolution: { kind: "replacement_with_difference", saleAdjustmentUnitCents: 3000 },
      replacement: { productId: "inc560-repl", productName: "Aro reemplazo", unitPriceCents: 6000, unitCostCents: 2000, chargeDifference: true },
    });
    // The second order's incident, agreed and left open for the confirm test.
    await openIncidentTx({
      orderId: "inc560-order-b", storeId: "inc560-store",
      incident: {
        id: "inc560-i2", lineId: "B1", productId: "p-L1", productName: "Collar",
        quantity: 1, reason: "Falló el cierre", originalUnitPriceCents: 12000,
        events: [event("inc560-open-b", "opened")],
      } as OrderIncident,
    });
    await applyIncidentEventTx({
      orderId: "inc560-order-b", storeId: "inc560-store", incidentId: "inc560-i2",
      event: event("inc560-agree-b", "resolution_agreed"),
      resolution: { kind: "replacement_equivalent" },
      replacement: { productId: "inc560-repl", productName: "Aro reemplazo", unitPriceCents: 6000, unitCostCents: 2000, chargeDifference: false },
    });
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("bloquea retirar el renglón mientras la incidencia sostiene la solución (#368)", async () => {
    const revision = (await getDoc(doc(holder.db, "orders/inc560-order"))).data()!.revision;
    await expect(
      saveOrderWithStockTx({ uid: "inc560-user" } as never, asOrder("inc560-order", [line("L1", 760)]), revision, "mut-560-evidence")
    ).rejects.toThrow(IncidentEvidenceError);
  });

  it("cierra sin cambio con motivo; el reintento con el mismo id no duplica", async () => {
    await applyIncidentEventTx({
      orderId: "inc560-order", storeId: "inc560-store", incidentId: "inc560-i1",
      event: event("inc560-close", "closed_no_change", { reason: "La clienta ya no quiere el cambio" }),
    });
    // Idempotent retry after a lost response.
    await applyIncidentEventTx({
      orderId: "inc560-order", storeId: "inc560-store", incidentId: "inc560-i1",
      event: event("inc560-close", "closed_no_change", { reason: "La clienta ya no quiere el cambio" }),
    });
    const order = (await getDoc(doc(holder.db, "orders/inc560-order"))).data()!;
    const incident = (order.incidents as OrderIncident[]).find((i) => i.id === "inc560-i1")!;
    const closes = incident.events.filter((e) => e.kind === "closed_no_change");
    expect(closes).toHaveLength(1);
    expect(closes[0].detail?.reason).toBe("La clienta ya no quiere el cambio");
    // A second session closing with a DIFFERENT id loses; further actions are
    // rejected — the incident is history now.
    await expect(
      applyIncidentEventTx({ orderId: "inc560-order", storeId: "inc560-store", incidentId: "inc560-i1", event: event("inc560-close-2", "closed_no_change", { reason: "otro" }) })
    ).rejects.toThrow(/ya está cerrada/i);
    await expect(
      applyIncidentEventTx({ orderId: "inc560-order", storeId: "inc560-store", incidentId: "inc560-i1", event: event("inc560-agree-2", "resolution_agreed") })
    ).rejects.toThrow(/cerrada sin cambio/i);
  });

  it("el cierre sin motivo se rechaza (el hecho queda firmado con el porqué)", async () => {
    await expect(
      applyIncidentEventTx({ orderId: "inc560-order", storeId: "inc560-store", incidentId: "inc560-i1", event: event("inc560-close-3", "closed_no_change") })
    ).rejects.toThrow(/motivo|cerrada/i);
  });

  it("tras el cierre permite retirar el renglón: total $760, cobro intacto, excedente $60", async () => {
    const fresh = (await getDoc(doc(holder.db, "orders/inc560-order"))).data()!;
    // A stale revision from another session aborts first (concurrency guard).
    await expect(
      saveOrderWithStockTx({ uid: "inc560-user" } as never, asOrder("inc560-order", [line("L1", 760)]), (fresh.revision as number) - 1, "mut-560-stale")
    ).rejects.toThrow(StaleOrderError);
    const saved = await saveOrderWithStockTx({ uid: "inc560-user" } as never, asOrder("inc560-order", [line("L1", 760)]), fresh.revision, "mut-560-fix");
    expect(saved.order.items).toHaveLength(1);
    const after = (await getDoc(doc(holder.db, "orders/inc560-order"))).data()!;
    expect(after.items).toHaveLength(1);
    expect(after.items[0].unitPrice).toBe(760);
    // The original payment and the already-applied credit stay verbatim.
    expect(after.paymentsReceivedCents).toBe(82000);
    expect(after.creditConsumedCents).toBe(3000);
    expect(after.incidents).toHaveLength(1); // evidence carried, never dropped
  });

  it("el crédito reconciliado se aplica al siguiente pedido elegible con trazabilidad (#189)", async () => {
    // After the correction: 82000 − 76000 = 6000 surplus, 3000 already
    // consumed → 3000 available; the sister order owes 50000.
    await applyCustomerCreditTx({
      entry: { id: "credit-560-1", kind: "application", fromOrderId: "inc560-order", amountCents: 3000, at: "2026-11-22T12:00:00.000Z", by: "inc560-user" },
      orderId: "inc560-next", storeId: "inc560-store",
    });
    const next = (await getDoc(doc(holder.db, "orders/inc560-next"))).data()!;
    expect(next.creditAppliedCents).toBe(3000);
    expect((next.creditLedger as { fromOrderId: string }[]).some((entry) => entry.fromOrderId === "inc560-order")).toBe(true);
    const origin = (await getDoc(doc(holder.db, "orders/inc560-order"))).data()!;
    expect(origin.creditConsumedCents).toBe(6000); // mirror accumulator updated
  });

  it("una solución ya ejecutada conserva sus protecciones: el cierre se rechaza", async () => {
    await applyIncidentEventTx({
      orderId: "inc560-order-b", storeId: "inc560-store", incidentId: "inc560-i2",
      event: event("inc560-confirm-b", "confirmed"),
    });
    await expect(
      applyIncidentEventTx({ orderId: "inc560-order-b", storeId: "inc560-store", incidentId: "inc560-i2", event: event("inc560-close-b", "closed_no_change", { reason: "desistió" }) })
    ).rejects.toThrow(/hechos ejecutados/i);
    // And its evidence line stays protected (#368).
    const revision = (await getDoc(doc(holder.db, "orders/inc560-order-b"))).data()!.revision;
    await expect(
      saveOrderWithStockTx({ uid: "inc560-user" } as never, asOrder("inc560-order-b", []), revision, "mut-560-guard")
    ).rejects.toThrow(IncidentEvidenceError);
  });
});
