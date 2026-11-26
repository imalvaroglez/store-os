// #189/#380: saldo a favor end-to-end against the REAL rules + auth +
// functions emulators. The rules deny every client write to the credit
// fields, so this suite drives the TRUSTED callables through the app's own
// wrappers (applyCustomerCreditTx / releaseCustomerCreditTx /
// applyIncidentEventTx) exactly as production does: a real Auth-emulator
// user (member of the seeded store) signs in on the client app, the callable
// authenticates that identity, and rules-checked reads/writes go through the
// rules-unit-testing context of the same project.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  initializeFirestore,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { readFileSync } from "node:fs";
import type { AppUser } from "./auth";
import type { Order, OrderCreditLedgerEntry, OrderIncident, OrderIncidentEvent } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any, app: null as any }));
vi.mock("./config", () => ({
  getFirebase: () => ({ app: holder.app, db: holder.db }),
  isFirebaseConfigured: () => true,
  FIREBASE_EMULATOR_ENABLED: true,
}));
import { applyCustomerCreditTx, applyIncidentEventTx, releaseCustomerCreditTx, saveOrderWithStockTx } from "./firestoreData";

let env: RulesTestEnvironment;

const user = { uid: "tx-user" } as AppUser;

const entry = (id: string, amountCents: number, fromOrderId = "credit-origin"): OrderCreditLedgerEntry => ({
  id, kind: "application", fromOrderId, amountCents, at: "2026-11-05T10:00:00.000Z", by: "tx-user",
});

const event = (id: string, kind: OrderIncidentEvent["kind"]): OrderIncidentEvent => ({
  id, kind, at: "2026-11-05T12:00:00.000Z", by: "tx-user",
});

const orderDoc = (id: string, extra: Record<string, unknown> = {}) => ({
  storeId: "credit-store",
  customerId: "credit-clienta",
  items: [{ productName: "Pieza", quantity: 1, unitPrice: 200, subtotal: 200, lineId: `${id}_L0` }],
  deposit: 0,
  orderStatus: "confirmed",
  paymentsReceivedCents: 0,
  inheritedDepositMaterialized: true,
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
  ...extra,
});

const incidentDoc = (id: string, extra: Partial<OrderIncident> = {}): OrderIncident => ({
  id, productId: "ic-product", productName: "Anillo QA", quantity: 1,
  reason: "Piedra fallada", originalUnitPriceCents: 20000,
  events: [event(`${id}-open`, "opened")], ...extra,
});

const agreedRefund = (id: string): OrderIncident => incidentDoc(id, {
  events: [event(`${id}-open`, "opened"), event(`${id}-agree`, "resolution_agreed")],
  resolution: { kind: "refund", destination: "credit_accepted", saleAdjustmentUnitCents: 20000, refundOwedCents: 0 },
});

/** A client app connected to the auth/firestore/functions emulators, with a
 * freshly created (and signed-in) user. The auth emulator hands the callables
 * a real token for that identity. */
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

// Runs in CI's rules job (emulator, auth+firestore+functions); skipped
// locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("customer credit through the trusted callables (#189/#380)", () => {
  let operator: { app: FirebaseApp; uid: string };

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    operator = await emulatedClientApp(`credit-op-${Date.now()}`);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/tx-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/credit-store"), { ownerUid: "tx-user", memberUids: ["tx-user", operator.uid] });
      await setDoc(doc(ctx.firestore(), "adminStores/foreign-store"), { ownerUid: "someone-else", memberUids: ["someone-else"] });
      await setDoc(doc(ctx.firestore(), "products/ic-product"), {
        storeId: "credit-store", name: "Anillo QA", sku: "QA-CR", category: "jewelry",
        quantityOnHand: 5, price: 200, cost: 80, status: "draft", createdAt: "", updatedAt: "",
      });
      await setDoc(doc(ctx.firestore(), "orders/credit-origin"), orderDoc("credit-origin", {
        items: [{ productName: "Anillo", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "credit-origin_L0" }],
        paymentsReceivedCents: 11500, // overpaid: $100 total, $115 received → $15 credit
      }));
      await setDoc(doc(ctx.firestore(), "orders/credit-dest"), orderDoc("credit-dest")); // owes $200
      await setDoc(doc(ctx.firestore(), "orders/foreign-origin"), { ...orderDoc("foreign-origin"), storeId: "foreign-store", paymentsReceivedCents: 11500 });
      await setDoc(doc(ctx.firestore(), "orders/other-clienta"), { ...orderDoc("other-clienta", { paymentsReceivedCents: 21500 }), customerId: "otra-clienta" });
    });
    holder.app = operator.app;
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("applies the planned compensation atomically across both order documents", async () => {
    await applyCustomerCreditTx({ entry: entry("t1", 1500), orderId: "credit-dest", storeId: "credit-store" });
    const dest = (await getDoc(doc(holder.db, "orders/credit-dest"))).data()!;
    const origin = (await getDoc(doc(holder.db, "orders/credit-origin"))).data()!;
    expect(dest.creditAppliedCents).toBe(1500);
    expect(Array.isArray(dest.creditLedger)).toBe(true);
    const destLedger = dest.creditLedger as Array<{ id: string; kind: string }>;
    expect(destLedger[0].id).toBe("app_t1");
    expect(destLedger[0].kind).toBe("application");
    expect(origin.creditConsumedCents).toBe(1500);
    const originLedger = origin.creditLedger as Array<{ id: string; kind: string }>;
    expect(originLedger.some((saved) => saved.id === "con_app_t1" && saved.kind === "consumption")).toBe(true);
  });

  it("is idempotent: retrying the same entry id writes nothing new", async () => {
    await applyCustomerCreditTx({ entry: entry("t1", 1500), orderId: "credit-dest", storeId: "credit-store" });
    const dest = (await getDoc(doc(holder.db, "orders/credit-dest"))).data()!;
    expect(dest.creditAppliedCents).toBe(1500); // NOT 3000
    expect((dest.creditLedger as unknown[]).length).toBe(1);
  });

  it("aborts a stale plan with the replan wording (StoreProvider contract), state untouched", async () => {
    // The callable rejects with the REAL figures; the wrapper maps it to the
    // historical "cambió mientras se aplicaba" family that callers treat as
    // expected concurrency.
    await expect(
      applyCustomerCreditTx({ entry: entry("t2", 500), orderId: "credit-dest", storeId: "credit-store" })
    ).rejects.toThrow(/cambió mientras se aplicaba/i);
    const dest = (await getDoc(doc(holder.db, "orders/credit-dest"))).data()!;
    expect(dest.creditAppliedCents).toBe(1500); // untouched
  });

  it("two concurrent applications commit exactly the available credit", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "orders/cc-origin-2"), orderDoc("cc-origin-2", {
        items: [{ productName: "Collar", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "cc-origin-2_L0" }],
        paymentsReceivedCents: 20000, // $100 of credit
      }));
      for (const id of ["cc-dest-a", "cc-dest-b"]) {
        await setDoc(doc(db, "orders", id), orderDoc(id, {
          items: [{ productName: "Pulsera", quantity: 1, unitPrice: 300, subtotal: 300, lineId: `${id}_L0` }],
        }));
      }
    });
    const settled = await Promise.allSettled([
      applyCustomerCreditTx({ entry: entry("cc_a", 10000, "cc-origin-2"), orderId: "cc-dest-a", storeId: "credit-store" }),
      applyCustomerCreditTx({ entry: entry("cc_b", 10000, "cc-origin-2"), orderId: "cc-dest-b", storeId: "credit-store" }),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/cambió mientras se aplicaba/i);
    const origin = (await getDoc(doc(holder.db, "orders/cc-origin-2"))).data()!;
    expect(origin.creditConsumedCents).toBe(10000); // exactly the available
  });

  it("never crosses stores or customers, and skips cancelled orders", async () => {
    await expect(
      applyCustomerCreditTx({ entry: entry("t_xstore", 1000, "foreign-origin"), orderId: "credit-dest", storeId: "credit-store" })
    ).rejects.toThrow(/otra tienda/i);
    await expect(
      applyCustomerCreditTx({ entry: entry("t_xclienta", 1000, "other-clienta"), orderId: "credit-dest", storeId: "credit-store" })
    ).rejects.toThrow(/misma clienta/i);
    await updateDoc(doc(holder.db, "orders/credit-dest"), { orderStatus: "cancelled" });
    await expect(
      applyCustomerCreditTx({ entry: entry("t_cancelled", 100), orderId: "credit-dest", storeId: "credit-store" })
    ).rejects.toThrow(/cancelado/i);
    await updateDoc(doc(holder.db, "orders/credit-dest"), { orderStatus: "confirmed" });
  });

  it("an authenticated NON-member cannot move credit through the callable", async () => {
    const outsider = await emulatedClientApp(`credit-out-${Date.now()}`);
    const fns = getFunctions(outsider.app, "us-east1");
    const [fnHost, fnPort] = (process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001").split(":");
    connectFunctionsEmulator(fns, fnHost, Number(fnPort));
    await expect(
      httpsCallable(fns, "applyCredit")({
        storeId: "credit-store", fromOrderId: "credit-origin", toOrderId: "credit-dest", amountCents: 100, intentId: "hack",
      })
    ).rejects.toThrow(/No tienes acceso a esta tienda/i);
  });

  it("restitutes on valid cancellation and re-running writes nothing", async () => {
    await updateDoc(doc(holder.db, "orders/credit-dest"), { orderStatus: "cancelled" });
    const released = await releaseCustomerCreditTx({ orderId: "credit-dest", storeId: "credit-store", by: "tx-user" });
    expect(released).toBe(1500);
    const dest = (await getDoc(doc(holder.db, "orders/credit-dest"))).data()!;
    const origin = (await getDoc(doc(holder.db, "orders/credit-origin"))).data()!;
    expect(dest.creditAppliedCents).toBe(0);
    expect(origin.creditConsumedCents).toBe(0);
    const ledger = dest.creditLedger as Array<{ kind: string; id: string }>;
    expect(ledger.filter((saved) => saved.kind === "release")).toHaveLength(1);
    expect(ledger.find((saved) => saved.kind === "release")!.id).toContain("release_cancellation_credit-dest");
    // Idempotent: net is zero now.
    const again = await releaseCustomerCreditTx({ orderId: "credit-dest", storeId: "credit-store", by: "tx-user" });
    expect(again).toBe(0);
    const after = (await getDoc(doc(holder.db, "orders/credit-dest"))).data()!;
    expect((after.creditLedger as unknown[]).length).toBe(2);
  });

  it("a member of another store cannot touch these orders (rules)", async () => {
    const foreign = env.authenticatedContext("someone-else").firestore();
    await expect(
      getDoc(doc(foreign, "orders/credit-dest"))
    ).rejects.toThrow();
  });

  it("editing an order through the normal save path keeps the credit fields intact (review F1)", async () => {
    // Re-apply a compensation on a live destination.
    await updateDoc(doc(holder.db, "orders/credit-dest"), { orderStatus: "confirmed" });
    await applyCustomerCreditTx({ entry: entry("t_edit", 1500), orderId: "credit-dest", storeId: "credit-store" });

    // Edit and save the DESTINATION: the credit applied to it must survive.
    // The caller shape is OrderForm's: it builds `next` WITHOUT the credit
    // fields — the regression this pins is exactly their loss on a
    // full-document write, so they are stripped here on purpose.
    const before = (await getDoc(doc(holder.db, "orders/credit-dest"))).data()!;
    const { creditAppliedCents, creditConsumedCents, creditLedger, ...callerShape } = before;
    expect(creditAppliedCents).toBe(1500); // the doc does carry them before the edit
    const edited = { ...callerShape, id: "credit-dest", notes: "editado tras compensación" } as never;
    await saveOrderWithStockTx(user, edited as never, before.revision ?? 0, "mut_edit_dest");
    const after = (await getDoc(doc(holder.db, "orders/credit-dest"))).data()!;
    expect(after.creditAppliedCents).toBe(1500);
    expect((after.creditLedger as Array<{ id: string }>).length).toBeGreaterThanOrEqual(2);
    expect(after.notes).toBe("editado tras compensación");

    // Edit and save the ORIGIN: its consumed mirror must survive too.
    const originBefore = (await getDoc(doc(holder.db, "orders/credit-origin"))).data()!;
    const { creditAppliedCents: _a, creditConsumedCents: _c, creditLedger: _l, ...originCallerShape } = originBefore;
    const originEdited = { ...originCallerShape, id: "credit-origin", notes: "origen editado" } as never;
    await saveOrderWithStockTx(user, originEdited as never, originBefore.revision ?? 0, "mut_edit_origin");
    const originAfter = (await getDoc(doc(holder.db, "orders/credit-origin"))).data()!;
    expect(originAfter.creditConsumedCents).toBe(1500);
    expect(originAfter.notes).toBe("origen editado");
  });

  it("the delivery gate counts applied credit as covered and records the NET saldo (review F2)", async () => {
    // $200 order with $100 received on it + $100 credit applied from a sister
    // order. Money fields only enter through the disabled-rules seeder — the
    // rules themselves forbid creating docs that carry them.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/credit-origin-2"), orderDoc("credit-origin-2", {
        items: [{ productName: "Aro", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "credit-origin-2_L0" }],
        paymentsReceivedCents: 20000,
      }));
      await setDoc(doc(ctx.firestore(), "orders/credit-deliver"), orderDoc("credit-deliver", { paymentsReceivedCents: 10000 }));
    });
    await applyCustomerCreditTx({ entry: entry("t_deliver", 10000, "credit-origin-2"), orderId: "credit-deliver", storeId: "credit-store" });

    // Delivering without explicit confirmation must NOT fire the gate: the
    // credit is the clienta's money, received on her other order.
    const snap = (await getDoc(doc(holder.db, "orders/credit-deliver"))).data()!;
    const delivered = { ...snap, id: "credit-deliver", orderStatus: "delivered" } as never;
    await saveOrderWithStockTx(user, delivered as never, snap.revision ?? 0, "mut_deliver");
    const result = (await getDoc(doc(holder.db, "orders/credit-deliver"))).data()!;
    expect(result.orderStatus).toBe("delivered");
    expect(result.deliveredWithBalanceCents).toBeUndefined(); // nothing uncovered

    // Partial credit: $200 total, $100 received, $50 credit → the R9 stamp
    // records the NET uncovered $50 (not the gross $100).
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/credit-deliver-2"), orderDoc("credit-deliver-2", { paymentsReceivedCents: 10000 }));
      await setDoc(doc(ctx.firestore(), "orders/credit-origin-3"), orderDoc("credit-origin-3", {
        items: [{ productName: "Esclava", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "credit-origin-3_L0" }],
        paymentsReceivedCents: 15000,
      }));
    });
    await applyCustomerCreditTx({ entry: entry("t_deliver_2", 5000, "credit-origin-3"), orderId: "credit-deliver-2", storeId: "credit-store" });
    const snap2 = (await getDoc(doc(holder.db, "orders/credit-deliver-2"))).data()!;
    const { creditAppliedCents: _applied, creditConsumedCents: _consumed, creditLedger: _ledger, ...caller2 } = snap2;
    const delivered2 = { ...caller2, id: "credit-deliver-2", orderStatus: "delivered" } as never;
    await saveOrderWithStockTx(user, delivered2 as never, snap2.revision ?? 0, "mut_deliver_2", { confirmDeliveredWithBalance: true });
    const stamped = (await getDoc(doc(holder.db, "orders/credit-deliver-2"))).data()!;
    expect(stamped.deliveredWithBalanceCents).toBe(5000); // net, not the gross 10000
  });

  it("a confirmed incident restitutes the applied credit through the callable, and retries add nothing", async () => {
    // ic-origin overpays $100; ic-dest sells an anillo ($200) + a cadena
    // ($100) with $100 received. The $100 credit is applied while the sale is
    // live (pending covers it); the $200-piece refund is agreed afterwards —
    // confirming it hands the applied credit back to its origin.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/ic-origin"), orderDoc("ic-origin", {
        items: [{ productName: "Collar", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "ic-origin_L0" }],
        paymentsReceivedCents: 20000,
        orderStatus: "delivered",
      }));
      await setDoc(doc(ctx.firestore(), "orders/ic-dest"), orderDoc("ic-dest", {
        items: [
          { lineId: "ic_L0", productId: "ic-product", productName: "Anillo QA", quantity: 1, unitPrice: 200, subtotal: 200 },
          { lineId: "ic_L1", productName: "Cadena QA", quantity: 1, unitPrice: 100, subtotal: 100 },
        ],
        paymentsReceivedCents: 10000,
      }));
    });
    await applyCustomerCreditTx({ entry: entry("ic1", 10000, "ic-origin"), orderId: "ic-dest", storeId: "credit-store" });
    // The refund is agreed AFTER the compensation landed (a plain incidents
    // update — the rules keep every credit key locked).
    await updateDoc(doc(holder.db, "orders/ic-dest"), { incidents: [agreedRefund("inc-1")] });

    const result = await applyIncidentEventTx({
      orderId: "ic-dest", storeId: "credit-store", incidentId: "inc-1", event: event("ic-conf-1", "confirmed"),
    });
    expect(result.order.incidents?.[0].events?.some((saved) => saved.kind === "confirmed")).toBe(true);
    const dest = (await getDoc(doc(holder.db, "orders/ic-dest"))).data()!;
    const origin = (await getDoc(doc(holder.db, "orders/ic-origin"))).data()!;
    expect(dest.creditAppliedCents).toBe(0);
    expect(origin.creditConsumedCents).toBe(0);
    const ledger = dest.creditLedger as Array<{ kind: string; id: string }>;
    const release = ledger.find((saved) => saved.kind === "release");
    expect(release!.id).toContain("rel_ic-conf-1");
    const ledgerLength = ledger.length;

    // Idempotent retry: the event is already saved; no further movement.
    await applyIncidentEventTx({
      orderId: "ic-dest", storeId: "credit-store", incidentId: "inc-1", event: event("ic-conf-1", "confirmed"),
    });
    const after = (await getDoc(doc(holder.db, "orders/ic-dest"))).data()!;
    const originAfter = (await getDoc(doc(holder.db, "orders/ic-origin"))).data()!;
    expect((after.creditLedger as unknown[]).length).toBe(ledgerLength);
    expect(originAfter.creditConsumedCents).toBe(0);
  });

  it("self-heals a confirmed event whose restitution never landed", async () => {
    // The event committed but the release didn't (e.g. a crash between the
    // two): re-registering the same confirmation must finish the job.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/ic-origin-2"), orderDoc("ic-origin-2", {
        items: [{ productName: "Broche", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "ic-origin-2_L0" }],
        paymentsReceivedCents: 20000,
        creditConsumedCents: 10000,
        creditLedger: [{ id: "con_ic2", kind: "consumption", fromOrderId: "ic-dest-2", amountCents: 10000, at: "2026-11-05T10:05:00.000Z", by: "tx-user" }],
        revision: 1,
      }));
      await setDoc(doc(ctx.firestore(), "orders/ic-dest-2"), orderDoc("ic-dest-2", {
        items: [{ lineId: "ic2_L0", productId: "ic-product", productName: "Anillo QA", quantity: 1, unitPrice: 200, subtotal: 200 }],
        paymentsReceivedCents: 10000,
        creditAppliedCents: 10000,
        creditLedger: [{ id: "ic2", kind: "application", fromOrderId: "ic-origin-2", amountCents: 10000, at: "2026-11-05T10:05:00.000Z", by: "tx-user" }],
        revision: 1,
        incidents: [incidentDoc("inc-2", {
          events: [event("inc-2-open", "opened"), event("inc-2-agree", "resolution_agreed"), event("ic-conf-2", "confirmed")],
          resolution: { kind: "refund", destination: "credit_accepted", saleAdjustmentUnitCents: 20000, refundOwedCents: 0 },
        })],
      }));
    });
    await applyIncidentEventTx({
      orderId: "ic-dest-2", storeId: "credit-store", incidentId: "inc-2", event: event("ic-conf-2", "confirmed"),
    });
    const dest = (await getDoc(doc(holder.db, "orders/ic-dest-2"))).data()!;
    const origin = (await getDoc(doc(holder.db, "orders/ic-origin-2"))).data()!;
    expect(dest.creditAppliedCents).toBe(0);
    expect(origin.creditConsumedCents).toBe(0);
    expect((dest.creditLedger as Array<{ kind: string }>).some((saved) => saved.kind === "release")).toBe(true);
  });

  it("a shortfall in the incident restitution is loud, never silent", async () => {
    // The origin's mirror does not back the credit the ledger claims
    // (drift): the callable conservatively releases nothing, and the
    // confirmation surfaces the shortfall instead of swallowing it.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/ic-origin-3"), orderDoc("ic-origin-3", {
        items: [{ productName: "Alicate", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "ic-origin-3_L0" }],
        paymentsReceivedCents: 20000,
        // drift: no creditConsumedCents / consumption ledger on the origin
      }));
      await setDoc(doc(ctx.firestore(), "orders/ic-dest-3"), orderDoc("ic-dest-3", {
        items: [{ lineId: "ic3_L0", productId: "ic-product", productName: "Anillo QA", quantity: 1, unitPrice: 200, subtotal: 200 }],
        paymentsReceivedCents: 10000,
        creditAppliedCents: 10000,
        creditLedger: [{ id: "ic3", kind: "application", fromOrderId: "ic-origin-3", amountCents: 10000, at: "2026-11-05T10:05:00.000Z", by: "tx-user" }],
        revision: 1,
        incidents: [agreedRefund("inc-3")],
      }));
    });
    await expect(
      applyIncidentEventTx({ orderId: "ic-dest-3", storeId: "credit-store", incidentId: "inc-3", event: event("ic-conf-3", "confirmed") })
    ).rejects.toThrow(/solo se restituyeron/i);
    // The incident itself stayed confirmed; the credit stayed untouched.
    const dest = (await getDoc(doc(holder.db, "orders/ic-dest-3"))).data()!;
    expect((dest.incidents as Order["incidents"])![0].events!.some((saved) => saved.kind === "confirmed")).toBe(true);
    expect(dest.creditAppliedCents).toBe(10000);
  });

  it("#380 QA r3 (MAYOR-1): el reintento tras liberación PARCIAL completa la obligación congelada", async () => {
    // Single origin whose committed mirror (12000) is smaller than its net
    // (30000): the callable conservatively releases only 12000. The retry —
    // after the mirror is repaired — must release the REMAINING 18000 against
    // the FROZEN obligation (30000), not a recomputed 18000−12000=6000.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/ic-origin-p1"), orderDoc("ic-origin-p1", {
        items: [{ productName: "Broche", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "ic-origin-p1_L0" }],
        paymentsReceivedCents: 40000,
        creditConsumedCents: 12000,
        creditLedger: [{ id: "con_p1", kind: "consumption", fromOrderId: "ic-dest-p1", amountCents: 12000, at: "2026-11-05T10:05:00.000Z", by: "tx-user" }],
        revision: 1,
      }));
      await setDoc(doc(ctx.firestore(), "orders/ic-dest-p1"), orderDoc("ic-dest-p1", {
        items: [{ lineId: "p1_L0", productId: "ic-product", productName: "Anillo QA", quantity: 1, unitPrice: 400, subtotal: 400 }],
        paymentsReceivedCents: 10000,
        creditAppliedCents: 30000,
        creditLedger: [{ id: "p1", kind: "application", fromOrderId: "ic-origin-p1", amountCents: 30000, at: "2026-11-05T10:05:00.000Z", by: "tx-user" }],
        revision: 1,
        incidents: [agreedRefund("inc-p1")],
      }));
    });
    await expect(
      applyIncidentEventTx({ orderId: "ic-dest-p1", storeId: "credit-store", incidentId: "inc-p1", event: event("ic-conf-p1", "confirmed") })
    ).rejects.toThrow(/solo se restituyeron 120 de los 200/i);
    let dest = (await getDoc(doc(holder.db, "orders/ic-dest-p1"))).data()!;
    expect(dest.creditAppliedCents).toBe(18000); // 30000 − the 12000 that landed
    // The mirror gets repaired (the drift was the cap): now the retry must
    // finish the job against the FROZEN 30000 — exactly once, no double.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/ic-origin-p1"), {
        ...( (await getDoc(doc(holder.db, "orders/ic-origin-p1"))).data() as object),
        creditConsumedCents: 18000,
      }, { merge: true });
    });
    await applyIncidentEventTx({
      orderId: "ic-dest-p1", storeId: "credit-store", incidentId: "inc-p1", event: event("ic-conf-p1", "confirmed"),
    });
    dest = (await getDoc(doc(holder.db, "orders/ic-dest-p1"))).data()!;
    const origin = (await getDoc(doc(holder.db, "orders/ic-origin-p1"))).data()!;
    // The obligation was 20000; the other 10000 stays applied by design.
    expect(dest.creditAppliedCents).toBe(10000);
    expect(origin.creditConsumedCents).toBe(10000); // 18000 repaired − the 8000 the retry returned
    const released = ((dest.creditLedger as Array<{ kind: string; id: string; amountCents: number }>) ?? [])
      .filter((entry) => entry.kind === "release" && entry.id.startsWith("rel_ic-conf-p1"))
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    expect(released).toBe(20000); // exactly the obligation — una sola vez
  });

  it("#380 QA r3 (MAYOR-1): liberación parcial con deriva NO repara — reintenta con las MISMAS cifras, jamás éxito falso", async () => {
    // Two origins: one healthy (15000), one drifted (no mirror). The confirm
    // releases the healthy 15000; retries can do no better — and must keep
    // saying "150 de los 300" against the frozen obligation instead of
    // reporting success with the clienta short.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/ic-origin-q1"), orderDoc("ic-origin-q1", {
        items: [{ productName: "Aro", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "ic-origin-q1_L0" }],
        paymentsReceivedCents: 20000,
        creditConsumedCents: 15000,
        creditLedger: [{ id: "con_q1", kind: "consumption", fromOrderId: "ic-dest-q1", amountCents: 15000, at: "2026-11-05T10:05:00.000Z", by: "tx-user" }],
        revision: 1,
      }));
      // q2: drift — the ledger claims credit the mirror never recorded.
      await setDoc(doc(ctx.firestore(), "orders/ic-origin-q2"), orderDoc("ic-origin-q2", {
        items: [{ productName: "Esclava", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "ic-origin-q2_L0" }],
        paymentsReceivedCents: 20000,
      }));
      await setDoc(doc(ctx.firestore(), "orders/ic-dest-q1"), orderDoc("ic-dest-q1", {
        items: [{ lineId: "q1_L0", productId: "ic-product", productName: "Anillo QA", quantity: 1, unitPrice: 400, subtotal: 400 }],
        paymentsReceivedCents: 10000,
        creditAppliedCents: 30000,
        creditLedger: [
          { id: "q1a", kind: "application", fromOrderId: "ic-origin-q1", amountCents: 15000, at: "2026-11-05T10:05:00.000Z", by: "tx-user" },
          { id: "q1b", kind: "application", fromOrderId: "ic-origin-q2", amountCents: 15000, at: "2026-11-05T10:05:00.000Z", by: "tx-user" },
        ],
        revision: 1,
        incidents: [agreedRefund("inc-q1")],
      }));
    });
    await expect(
      applyIncidentEventTx({ orderId: "ic-dest-q1", storeId: "credit-store", incidentId: "inc-q1", event: event("ic-conf-q1", "confirmed") })
    ).rejects.toThrow(/solo se restituyeron 150 de los 200/i);
    // Retry: nothing changed — the SAME loud shortfall, never a false success.
    await expect(
      applyIncidentEventTx({ orderId: "ic-dest-q1", storeId: "credit-store", incidentId: "inc-q1", event: event("ic-conf-q1", "confirmed") })
    ).rejects.toThrow(/solo se restituyeron 150 de los 200/i);
    const dest = (await getDoc(doc(holder.db, "orders/ic-dest-q1"))).data()!;
    expect(dest.creditAppliedCents).toBe(15000); // only the healthy 15000 came back
    const released = ((dest.creditLedger as Array<{ kind: string; id: string; amountCents: number }>) ?? [])
      .filter((entry) => entry.kind === "release" && entry.id.startsWith("rel_ic-conf-q1"))
      .reduce((sum, entry) => sum + entry.amountCents, 0);
    expect(released).toBe(15000);
  });

  it("an absent credit origin surfaces the same loud shortfall (r4 successor)", async () => {
    // The backing order document no longer exists: the callable skips it
    // (conservative), the confirmation lands, and the shortfall is loud —
    // repairing the origin and re-registering the confirmation self-heals.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/ic-dest-4"), orderDoc("ic-dest-4", {
        items: [{ lineId: "ic4_L0", productId: "ic-product", productName: "Anillo QA", quantity: 1, unitPrice: 200, subtotal: 200 }],
        paymentsReceivedCents: 10000,
        creditAppliedCents: 10000,
        creditLedger: [{ id: "ic4", kind: "application", fromOrderId: "ic-origin-gone", amountCents: 10000, at: "2026-11-05T10:05:00.000Z", by: "tx-user" }],
        revision: 1,
        incidents: [agreedRefund("inc-4")],
      }));
    });
    await expect(
      applyIncidentEventTx({ orderId: "ic-dest-4", storeId: "credit-store", incidentId: "inc-4", event: event("ic-conf-4", "confirmed") })
    ).rejects.toThrow(/solo se restituyeron/i);
    const dest = (await getDoc(doc(holder.db, "orders/ic-dest-4"))).data()!;
    expect(dest.creditAppliedCents).toBe(10000); // nothing moved
  });

  // #176 (Funciones/importaciones): pin the adversarial-input contract of the
  // trusted callables. Malformed payloads must die on the invalid-argument
  // ladder BEFORE any store/order access, and a self-compensation (from==to)
  // must die on the money invariant — never a partial or creative write.
  it("#176 malformed payloads are rejected before any access, with zero writes", async () => {
    // Fresh docs owned by this test: an overpaid origin ($215 received on a
    // $200 order → $15 surplus) and a destination that still owes $200.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/adv-origin"), orderDoc("adv-origin", { paymentsReceivedCents: 21500 }));
      await setDoc(doc(ctx.firestore(), "orders/adv-dest"), orderDoc("adv-dest"));
    });
    const fns = getFunctions(operator.app, "us-east1");
    const [fnHost, fnPort] = (process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001").split(":");
    connectFunctionsEmulator(fns, fnHost, Number(fnPort));
    const apply = httpsCallable(fns, "applyCredit");
    const release = httpsCallable(fns, "releaseCredit");
    const wellFormed = { storeId: "credit-store", fromOrderId: "adv-origin", toOrderId: "adv-dest", intentId: "adv-x" };
    const badApply = [
      { ...wellFormed, amountCents: "1500" },        // string, not a safe integer
      { ...wellFormed, amountCents: 0 },             // zero
      { ...wellFormed, amountCents: -100 },          // negative
      { ...wellFormed, amountCents: 15.5 },          // fractional centavo
      { ...wellFormed, amountCents: 9000000000001 }, // over the safe-precision bound
      { ...wellFormed, amountCents: 100, fromOrderId: 42 }, // wrong type
      { storeId: "credit-store", fromOrderId: "adv-origin", toOrderId: "adv-dest", amountCents: 100 }, // no intentId
      { fromOrderId: "adv-origin", toOrderId: "adv-dest", amountCents: 100, intentId: "adv-x" },       // no storeId
    ];
    for (const payload of badApply) {
      await expect(apply(payload)).rejects.toThrow(/Falta|El importe no es válido|invalid-argument/i);
    }
    await expect(
      release({ storeId: "credit-store", orderId: "adv-dest", intentId: "adv-r", capCents: 0 })
    ).rejects.toThrow(/El tope no es válido/i);
    await expect(
      release({ storeId: "credit-store", orderId: "adv-dest", intentId: "adv-r", capCents: "500" })
    ).rejects.toThrow(/El tope no es válido/i);
    // Zero writes: no ledger entry, no accumulator, no revision bump.
    const origin = (await getDoc(doc(holder.db, "orders/adv-origin"))).data()!;
    const advDest = (await getDoc(doc(holder.db, "orders/adv-dest"))).data()!;
    expect(origin.creditLedger ?? []).toHaveLength(0);
    expect(origin.creditConsumedCents ?? 0).toBe(0);
    expect(origin.revision ?? 0).toBe(0);
    expect(advDest.creditLedger ?? []).toHaveLength(0);
    expect(advDest.creditAppliedCents ?? 0).toBe(0);
    expect(advDest.revision ?? 0).toBe(0);
  });

  it("#176 from==to never self-applies: the money invariant rejects it and nothing moves", async () => {
    const fns = getFunctions(operator.app, "us-east1");
    const [fnHost, fnPort] = (process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001").split(":");
    connectFunctionsEmulator(fns, fnHost, Number(fnPort));
    // adv-origin has a $15 surplus → as a destination it owes $0: an order can
    // never satisfy "surplus ≥ amount" and "owes ≥ amount" at once, so the
    // self-compensation dies on the precondition, not on luck.
    await expect(
      httpsCallable(fns, "applyCredit")({
        storeId: "credit-store", fromOrderId: "adv-origin", toOrderId: "adv-origin", amountCents: 100, intentId: "adv-self",
      })
    ).rejects.toThrow(/solo debe|failed-precondition/i);
    const origin = (await getDoc(doc(holder.db, "orders/adv-origin"))).data()!;
    expect(origin.creditLedger ?? []).toHaveLength(0);
    expect(origin.creditAppliedCents ?? 0).toBe(0);
    expect(origin.creditConsumedCents ?? 0).toBe(0);
  });

  // #524: an order converted into a point's first surtido is HISTORY — its
  // sale and cobro live in the point's cut. It never gives, receives or owes
  // saldo a favor, so the callable (the real authority) refuses it on either
  // side and leaves every document untouched.
  describe("#524 converted orders stay out of the saldo a favor", () => {
    const ids = ["conv-origin", "conv-converted", "conv-converted-origin", "conv-next"];

    beforeAll(async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "orders/conv-origin"), orderDoc("conv-origin", {
          items: [{ productName: "Aro", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "conv-origin_L0" }],
          paymentsReceivedCents: 21500, // overpaid: $215 received on a $100 order → $115 of surplus; the tests move $15 of it
        }));
        // Still "confirmed" and on paper owing $200: only convertedToPointId sets it apart.
        await setDoc(doc(ctx.firestore(), "orders/conv-converted"), orderDoc("conv-converted", { convertedToPointId: "credit-point" }));
        // Unreachable through the app (conversion requires zero money): it pins
        // the ORIGIN side against a drifted document.
        await setDoc(doc(ctx.firestore(), "orders/conv-converted-origin"), orderDoc("conv-converted-origin", {
          items: [{ productName: "Aro", quantity: 1, unitPrice: 100, subtotal: 100, lineId: "conv-converted-origin_L0" }],
          paymentsReceivedCents: 21500, // the same $115 of surplus on paper — it must never move
          convertedToPointId: "credit-point",
        }));
        await setDoc(doc(ctx.firestore(), "orders/conv-next"), orderDoc("conv-next")); // the real debt: $200
      });
    });

    /** Whole documents, before and after: a refused application must not touch a byte. */
    const snapshotOrders = async (): Promise<Record<string, unknown>> =>
      Object.fromEntries(await Promise.all(ids.map(async (id) => [id, (await getDoc(doc(holder.db, "orders", id))).data()] as const)));

    /** The wrapper's rejection exactly as the app receives it: code and text. */
    async function applyFailure(params: Parameters<typeof applyCustomerCreditTx>[0]): Promise<{ code?: string; message: string }> {
      try {
        await applyCustomerCreditTx(params);
      } catch (error) {
        return error as { code?: string; message: string };
      }
      throw new Error("applyCustomerCreditTx should have refused the application");
    }

    it("refuses a converted DESTINATION with failed-precondition and no document changes", async () => {
      const before = await snapshotOrders();
      const failure = await applyFailure({
        entry: entry("conv_dest", 1500, "conv-origin"), orderId: "conv-converted", storeId: "credit-store",
      });
      expect(failure.code).toBe("functions/failed-precondition");
      expect(failure.message).toMatch(/convertido a un punto de venta/);
      expect(await snapshotOrders()).toEqual(before);
    });

    it("refuses a converted ORIGIN the same way and no document changes", async () => {
      const before = await snapshotOrders();
      const failure = await applyFailure({
        entry: entry("conv_src", 1500, "conv-converted-origin"), orderId: "conv-next", storeId: "credit-store",
      });
      expect(failure.code).toBe("functions/failed-precondition");
      expect(failure.message).toMatch(/convertido a un punto de venta/);
      expect(await snapshotOrders()).toEqual(before);
    });

    it("still applies the credit between the two real orders", async () => {
      await applyCustomerCreditTx({ entry: entry("conv_real", 1500, "conv-origin"), orderId: "conv-next", storeId: "credit-store" });
      const next = (await getDoc(doc(holder.db, "orders/conv-next"))).data()!;
      const origin = (await getDoc(doc(holder.db, "orders/conv-origin"))).data()!;
      expect(next.creditAppliedCents).toBe(1500);
      expect(origin.creditConsumedCents).toBe(1500);
      const converted = (await getDoc(doc(holder.db, "orders/conv-converted"))).data()!;
      expect(converted.creditAppliedCents ?? 0).toBe(0);
    });
  });
});
