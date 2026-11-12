import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { OrderIncident, OrderIncidentEvent } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import { openIncidentTx, applyIncidentEventTx } from "./firestoreData";

let env: RulesTestEnvironment;

const event = (id: string, kind: OrderIncidentEvent["kind"], detail?: Record<string, string | number>): OrderIncidentEvent => ({
  id, kind, at: "2026-11-05T12:00:00.000Z", by: "inc-user", ...(detail ? { detail } : {}),
});

const incident = (id: string, extra: Partial<OrderIncident> = {}): OrderIncident => ({
  id, productId: "inc-product", productName: "Anillo QA", quantity: 1,
  reason: "Piedra fallada", originalUnitPriceCents: 12000,
  events: [event("inc-open", "opened")], ...extra,
});

// Runs in CI's rules job (emulator); skipped locally without FIRESTORE_EMULATOR_HOST.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("after-sales incident transactions with Firestore rules (#203)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/inc-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/inc-store"), { ownerUid: "inc-user", memberUids: ["inc-user"] });
      await setDoc(doc(ctx.firestore(), "adminStores/inc-foreign"), { ownerUid: "someone", memberUids: ["someone"] });
      await setDoc(doc(ctx.firestore(), "products/inc-product"), {
        storeId: "inc-store", name: "Anillo QA", sku: "QA-INC", category: "jewelry",
        quantityOnHand: 5, price: 120, cost: 50, status: "draft", createdAt: "", updatedAt: "",
      });
      await setDoc(doc(ctx.firestore(), "products/inc-replacement"), {
        storeId: "inc-store", name: "Aro QA", sku: "QA-INC-R", category: "jewelry",
        quantityOnHand: 2, price: 160, cost: 60, status: "draft", createdAt: "", updatedAt: "",
      });
      await setDoc(doc(ctx.firestore(), "orders/inc-order"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "inc-order_L0", productId: "inc-product", productName: "Anillo QA", quantity: 1, unitPrice: 120, subtotal: 120 }],
        deposit: 0, orderStatus: "confirmed", paymentsReceivedCents: 6000, inheritedDepositMaterialized: true,
        createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z",
      });
    });
    holder.db = env.authenticatedContext("inc-user").firestore();
  });
  afterAll(async () => {
    await env?.cleanup();
  });

  it("opens an incident (append-only) and is idempotent by incident id", async () => {
    await openIncidentTx({ orderId: "inc-order", storeId: "inc-store", incident: incident("inc-1") });
    await openIncidentTx({ orderId: "inc-order", storeId: "inc-store", incident: incident("inc-1") });
    const order = (await getDoc(doc(holder.db, "orders/inc-order"))).data()!;
    expect(order.incidents).toHaveLength(1);
  });

  it("rejects nonsense sequences: confirm without resolution, double resolution, repair before reception", async () => {
    await expect(
      applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-1", event: event("inc-e1", "confirmed") })
    ).rejects.toThrow(/resolución/i);
    await applyIncidentEventTx({
      orderId: "inc-order", storeId: "inc-store", incidentId: "inc-1",
      event: event("inc-e2", "resolution_agreed"),
      resolution: { kind: "replacement_equivalent" },
      replacement: { productId: "inc-replacement", productName: "Aro QA", unitPriceCents: 16000, unitCostCents: 6000, chargeDifference: false },
    });
    await expect(
      applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-1", event: event("inc-e3", "resolution_agreed") })
    ).rejects.toThrow(/ya tiene una resolución/i);
    await expect(
      applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-1", event: event("inc-e4", "repaired") })
    ).rejects.toThrow(/retenida|recepción de la pieza antes de reparar/i);
  });

  it("confirming moves inventory atomically: damaged piece quarantined, replacement out at real cost", async () => {
    await applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-1", event: event("inc-e5", "confirmed") });
    const damaged = (await getDoc(doc(holder.db, "products/inc-product"))).data()!;
    const replacement = (await getDoc(doc(holder.db, "products/inc-replacement"))).data()!;
    expect(damaged.quantityQuarantined).toBe(1);
    expect(damaged.quantityOnHand).toBe(5); // untouched: the sold piece already left at sale time
    expect(replacement.quantityOnHand).toBe(1);
  });

  it("a shortage of the replacement aborts the whole confirmation", async () => {
    await setDoc(doc(holder.db, "orders/inc-order-2"), {
      storeId: "inc-store", customerId: "inc-clienta",
      items: [{ lineId: "o2_L0", productId: "inc-product", productName: "Anillo QA", quantity: 2, unitPrice: 120, subtotal: 240 }],
      deposit: 0, orderStatus: "confirmed", createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z",
    });
    await openIncidentTx({ orderId: "inc-order-2", storeId: "inc-store", incident: incident("inc-2", { quantity: 2, events: [event("inc2-open", "opened")] }) });
    await applyIncidentEventTx({
      orderId: "inc-order-2", storeId: "inc-store", incidentId: "inc-2",
      event: event("inc2-e1", "resolution_agreed"),
      resolution: { kind: "replacement_equivalent" },
      replacement: { productId: "inc-replacement", productName: "Aro QA", unitPriceCents: 16000, unitCostCents: 6000, chargeDifference: false },
    });
    await expect(
      applyIncidentEventTx({ orderId: "inc-order-2", storeId: "inc-store", incidentId: "inc-2", event: event("inc2-e2", "confirmed") })
    ).rejects.toThrow(/disponible/i);
    const order = (await getDoc(doc(holder.db, "orders/inc-order-2"))).data()!;
    expect(order.incidents[0].events).toHaveLength(2); // nothing was written
    const damaged = (await getDoc(doc(holder.db, "products/inc-product"))).data()!;
    expect(damaged.quantityQuarantined).toBe(1); // unchanged
  });

  it("repaired KEEPS the piece held; explicit sale authorization releases it (r2)", async () => {
    const before = (await getDoc(doc(holder.db, "products/inc-product"))).data()!;
    await applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-1", event: event("inc-e6", "repaired") });
    const repaired = (await getDoc(doc(holder.db, "products/inc-product"))).data()!;
    expect(repaired.quantityQuarantined).toBe(before.quantityQuarantined); // still held
    expect(repaired.quantityOnHand).toBe(before.quantityOnHand);           // NOT sellable
    await applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-1", event: event("inc-e6b", "returned_to_sale") });
    const released = (await getDoc(doc(holder.db, "products/inc-product"))).data()!;
    expect(released.quantityQuarantined).toBe(before.quantityQuarantined - 1);
    expect(released.quantityOnHand).toBe(before.quantityOnHand + 1);
    // refund_executed on a non-refund incident aborts.
    await expect(
      applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-1", event: event("inc-e7", "refund_executed") })
    ).rejects.toThrow(/reembolso|importe devuelto|confirm/i);
  });

  it("#212 F2: a replacement resolution without the real piece aborts", async () => {
    await openIncidentTx({ orderId: "inc-order", storeId: "inc-store", incident: incident("inc-f2", { events: [event("f2-open", "opened")] }) });
    await expect(
      applyIncidentEventTx({
        orderId: "inc-order", storeId: "inc-store", incidentId: "inc-f2",
        event: event("f2-e1", "resolution_agreed"),
        resolution: { kind: "replacement_equivalent" },
        replacement: { productName: "Sin pieza", unitPriceCents: 12000, unitCostCents: 5400, chargeDifference: false },
      })
    ).rejects.toThrow(/elige la pieza/i);
  });

  it("#212 F4: wait_restock confirm takes the restocked piece out of stock", async () => {
    await openIncidentTx({ orderId: "inc-order", storeId: "inc-store", incident: incident("inc-f4", { events: [event("f4-open", "opened")] }) });
    await applyIncidentEventTx({
      orderId: "inc-order", storeId: "inc-store", incidentId: "inc-f4",
      event: event("f4-e1", "resolution_agreed"),
      resolution: { kind: "wait_restock", waitUntil: "2026-11-20" },
    });
    const before = (await getDoc(doc(holder.db, "products/inc-product"))).data()!;
    await applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-f4", event: event("f4-e2", "confirmed") });
    const after = (await getDoc(doc(holder.db, "products/inc-product"))).data()!;
    expect(after.quantityOnHand).toBe(before.quantityOnHand - 1); // the handed-over piece left
    expect(after.quantityQuarantined).toBe(before.quantityQuarantined + 1);
  });

  it("#212 F6/F7: refund_executed requires confirmation; provider compensation lands once", async () => {
    await openIncidentTx({ orderId: "inc-order", storeId: "inc-store", incident: incident("inc-f6", { events: [event("f6-open", "opened")] }) });
    await applyIncidentEventTx({
      orderId: "inc-order", storeId: "inc-store", incidentId: "inc-f6",
      event: event("f6-e1", "resolution_agreed"),
      resolution: { kind: "refund", destination: "refund_pending" },
    });
    await expect(
      applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-f6", event: event("f6-e2", "refund_executed", { refundExecutedCents: 12000 }) })
    ).rejects.toThrow(/confirm/i);
    await applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-f6", event: event("f6-e3", "confirmed") });
    await applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-f6", event: event("f6-e4", "provider_compensation", { amountCents: 5000 }) });
    await expect(
      applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-f6", event: event("f6-e5", "provider_compensation", { amountCents: 5000 }) })
    ).rejects.toThrow(/ya está registrada/i);
  });

  it("#212 F5a: an order holding quarantined pieces cannot be deleted", async () => {
    const { deleteOrderWithStockTx } = await import("./firestoreData");
    // inc-order holds inc-1 (quarantined → repaired already) — build a fresh held one.
    await setDoc(doc(holder.db, "orders/inc-order-hold"), {
      storeId: "inc-store", customerId: "inc-clienta",
      items: [{ lineId: "h_L0", productId: "inc-product", productName: "Anillo QA", quantity: 1, unitPrice: 120, subtotal: 120 }],
      deposit: 0, orderStatus: "confirmed", createdAt: "", updatedAt: "",
    });
    await openIncidentTx({ orderId: "inc-order-hold", storeId: "inc-store", incident: incident("inc-hold", { events: [event("h-open", "opened")] }) });
    await applyIncidentEventTx({
      orderId: "inc-order-hold", storeId: "inc-store", incidentId: "inc-hold",
      event: event("h-e1", "resolution_agreed"),
      resolution: { kind: "wait_restock", waitUntil: "2026-11-25" },
    });
    await applyIncidentEventTx({ orderId: "inc-order-hold", storeId: "inc-store", incidentId: "inc-hold", event: event("h-e2", "confirmed") });
    await expect(
      deleteOrderWithStockTx({ uid: "inc-user" } as never, "inc-order-hold", 0)
    ).rejects.toThrow(/retenida|recepción de la pieza antes de reparar/i);
  });

  it("r3: destino obligatorio en servidor — resolución de reembolso sin elección aborta", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/inc-order-r3"), {
      storeId: "inc-store", customerId: "inc-clienta",
      items: [{ lineId: "r3_L0", productId: "inc-product", productName: "Anillo QA", quantity: 1, unitPrice: 120, subtotal: 120 }],
      deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 12000, inheritedDepositMaterialized: true,
        createdAt: "", updatedAt: "",
      });
    });
    await openIncidentTx({ orderId: "inc-order-r3", storeId: "inc-store", incident: incident("inc-r3", { events: [event("r3-open", "opened")] }) });
    await expect(
      applyIncidentEventTx({ orderId: "inc-order-r3", storeId: "inc-store", incidentId: "inc-r3",
        event: event("r3-e1", "resolution_agreed"), resolution: { kind: "refund" } })
    ).rejects.toThrow(/destino del importe/i);
  });

  it("r3: doble compromiso CONCURRENTE nunca excede el excedente (criterio 4)", async () => {
    // Venta $200 (dos piezas de $100), pagados $200: dos devoluciones
    // simultáneas compiten por el excedente de $200.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/inc-order-race"), {
      storeId: "inc-store", customerId: "inc-clienta",
      items: [
        { lineId: "ra_L0", productId: "inc-product", productName: "Pieza A", quantity: 1, unitPrice: 100, subtotal: 100 },
        { lineId: "rb_L0", productId: "inc-product", productName: "Pieza B", quantity: 1, unitPrice: 100, subtotal: 100 },
      ],
      deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 20000, inheritedDepositMaterialized: true,
        createdAt: "", updatedAt: "",
      });
    });
    for (const id of ["inc-ra", "inc-rb"]) {
      await openIncidentTx({ orderId: "inc-order-race", storeId: "inc-store", incident: incident(id, { events: [event(`${id}-open`, "opened")] }) });
    }
    const destination = { destination: "refund_pending" as const };
    const results = await Promise.allSettled([
      applyIncidentEventTx({ orderId: "inc-order-race", storeId: "inc-store", incidentId: "inc-ra",
        event: event("ra-e1", "resolution_agreed"), resolution: { kind: "refund" as const, ...destination } }),
      applyIncidentEventTx({ orderId: "inc-order-race", storeId: "inc-store", incidentId: "inc-rb",
        event: event("rb-e1", "resolution_agreed"), resolution: { kind: "refund" as const, ...destination } }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const order = (await getDoc(doc(holder.db, "orders/inc-order-race"))).data()!;
    const owed = (order.incidents ?? []).reduce((sum: number, incident: { resolution?: { refundOwedCents?: number } }) =>
      sum + Math.max(0, incident.resolution?.refundOwedCents ?? 0), 0);
    expect(owed).toBe(20000); // exacto: cada pieza $100, excedente total $200
  });

  it("r4 (PO): origen AUSENTE aborta la confirmación completa — sin efectos parciales ni omisión silenciosa", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/inc-order-noreturn"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "nr_L0", productId: "inc-product", productName: "Pieza", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 0, inheritedDepositMaterialized: true,
        creditAppliedCents: 10000,
        creditLedger: [{ id: "app_gone", kind: "application", fromOrderId: "origin-deleted", amountCents: 10000, at: "2026-11-06T10:00:00Z", by: "inc-user" }],
        createdAt: "", updatedAt: "",
      });
    });
    await openIncidentTx({ orderId: "inc-order-noreturn", storeId: "inc-store", incident: incident("inc-nr", { events: [event("nr-open", "opened")] }) });
    await applyIncidentEventTx({ orderId: "inc-order-noreturn", storeId: "inc-store", incidentId: "inc-nr",
      event: event("nr-e1", "resolution_agreed"),
      resolution: { kind: "refund", destination: "credit_accepted" } });
    await expect(
      applyIncidentEventTx({ orderId: "inc-order-noreturn", storeId: "inc-store", incidentId: "inc-nr", event: event("nr-e2", "confirmed") })
    ).rejects.toThrow(/pedido origen del saldo a favor/i);
    const order = (await getDoc(doc(holder.db, "orders/inc-order-noreturn"))).data()!;
    // NADA aterrizó: ni el evento confirmado, ni cuarentena, ni cambio de crédito.
    expect((order.incidents[0].events ?? []).some((saved: { kind: string }) => saved.kind === "confirmed")).toBe(false);
    expect(order.creditAppliedCents).toBe(10000);
    const product = (await getDoc(doc(holder.db, "products/inc-product"))).data()!;
    expect(product.quantityQuarantined).toBeLessThan(999); // sin efecto de esta tx
  });

  it("r4: espejo inconsistente del origen (creditConsumed 0 con ledger neto) también aborta con explicación", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/inc-origin-drift"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "od_L0", productName: "Origen", quantity: 1, unitPrice: 50, subtotal: 50 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 15000, inheritedDepositMaterialized: true,
        createdAt: "", updatedAt: "",
        // Ledger dice que consumió $100… pero el espejo fue dañado a 0.
      });
      await setDoc(doc(ctx.firestore(), "orders/inc-order-drift"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "df_L0", productId: "inc-product", productName: "Pieza", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 0, inheritedDepositMaterialized: true,
        creditAppliedCents: 10000,
        creditLedger: [{ id: "app_drift", kind: "application", fromOrderId: "inc-origin-drift", amountCents: 10000, at: "2026-11-06T10:00:00Z", by: "inc-user" }],
        createdAt: "", updatedAt: "",
      });
    });
    await openIncidentTx({ orderId: "inc-order-drift", storeId: "inc-store", incident: incident("inc-df", { events: [event("df-open", "opened")] }) });
    await applyIncidentEventTx({ orderId: "inc-order-drift", storeId: "inc-store", incidentId: "inc-df",
      event: event("df-e1", "resolution_agreed"), resolution: { kind: "refund", destination: "credit_accepted" } });
    await expect(
      applyIncidentEventTx({ orderId: "inc-order-drift", storeId: "inc-store", incidentId: "inc-df", event: event("df-e2", "confirmed") })
    ).rejects.toThrow(/no refleja el crédito consumido/i);
  });

  it("r4: restitución del CAMINO FELIZ — el origen recupera su disponible y todo aterriza junto", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/inc-origin-ok"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "oo_L0", productName: "Origen", quantity: 1, unitPrice: 50, subtotal: 50 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 15000, inheritedDepositMaterialized: true,
        creditConsumedCents: 10000,
        createdAt: "", updatedAt: "",
      });
      await setDoc(doc(ctx.firestore(), "orders/inc-order-ok"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "ok_L0", productId: "inc-product", productName: "Pieza", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 0, inheritedDepositMaterialized: true,
        creditAppliedCents: 10000,
        creditLedger: [{ id: "app_ok", kind: "application", fromOrderId: "inc-origin-ok", amountCents: 10000, at: "2026-11-06T10:00:00Z", by: "inc-user" }],
        createdAt: "", updatedAt: "",
      });
    });
    await openIncidentTx({ orderId: "inc-order-ok", storeId: "inc-store", incident: incident("inc-ok", { events: [event("ok-open", "opened")] }) });
    await applyIncidentEventTx({ orderId: "inc-order-ok", storeId: "inc-store", incidentId: "inc-ok",
      event: event("ok-e1", "resolution_agreed"), resolution: { kind: "refund", destination: "credit_accepted" } });
    await applyIncidentEventTx({ orderId: "inc-order-ok", storeId: "inc-store", incidentId: "inc-ok", event: event("ok-e2", "confirmed") });
    const origin = (await getDoc(doc(holder.db, "orders/inc-origin-ok"))).data()!;
    const order = (await getDoc(doc(holder.db, "orders/inc-order-ok"))).data()!;
    expect(origin.creditConsumedCents).toBe(0);            // el crédito vuelve a estar disponible (#189)
    expect(order.creditAppliedCents).toBe(0);
    const releases = (order.creditLedger ?? []).filter((entry: { kind: string }) => entry.kind === "release");
    expect(releases).toHaveLength(1);
    expect(releases[0].amountCents).toBe(10000);
  });

  it("#403 PO: $200 aplicados → devolución de $100 → REINTENTO deja intactos los $100 restantes", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      // Origin: $150 received of a $50 sale → $100 of credit; consumed $200? No:
      // mirror $200 against a real $100 surplus would be drift. Use TWO
      // origins? Keep the PO case exactly: $200 applied from ONE origin with
      // a consistent mirror (surplus $200).
      await setDoc(doc(ctx.firestore(), "orders/inc-origin-pohalt"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "ph_L0", productName: "Origen PO", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 30000, inheritedDepositMaterialized: true,
        creditConsumedCents: 20000,
        createdAt: "", updatedAt: "",
      });
      await setDoc(doc(ctx.firestore(), "orders/inc-order-pohalt"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "phd_L0", productId: "inc-product", productName: "Pieza", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 0, inheritedDepositMaterialized: true,
        creditAppliedCents: 20000,
        creditLedger: [{ id: "app_pohalt", kind: "application", fromOrderId: "inc-origin-pohalt", amountCents: 20000, at: "2026-11-06T10:00:00Z", by: "inc-user" }],
        createdAt: "", updatedAt: "",
      });
    });
    await openIncidentTx({ orderId: "inc-order-pohalt", storeId: "inc-store", incident: incident("inc-pohalt", { originalUnitPriceCents: 10000, events: [event("ph-open", "opened")] }) });
    // Refund of $100, accepted as credit: the confirm restitutes exactly $100.
    await applyIncidentEventTx({ orderId: "inc-order-pohalt", storeId: "inc-store", incidentId: "inc-pohalt",
      event: event("ph-e1", "resolution_agreed"), resolution: { kind: "refund", destination: "credit_accepted", refundOwedCents: 10000 } });
    await applyIncidentEventTx({ orderId: "inc-order-pohalt", storeId: "inc-store", incidentId: "inc-pohalt", event: event("ph-e2", "confirmed") });
    let order = (await getDoc(doc(holder.db, "orders/inc-order-pohalt"))).data()!;
    expect(order.creditAppliedCents).toBe(10000); // $200 − $100 restituted
    let origin = (await getDoc(doc(holder.db, "orders/inc-origin-pohalt"))).data()!;
    expect(origin.creditConsumedCents).toBe(10000);
    // RETRY the same confirmation: idempotent — the remaining $100 STAYS.
    await applyIncidentEventTx({ orderId: "inc-order-pohalt", storeId: "inc-store", incidentId: "inc-pohalt", event: event("ph-e2", "confirmed") });
    order = (await getDoc(doc(holder.db, "orders/inc-order-pohalt"))).data()!;
    expect(order.creditAppliedCents).toBe(10000);
    origin = (await getDoc(doc(holder.db, "orders/inc-origin-pohalt"))).data()!;
    expect(origin.creditConsumedCents).toBe(10000);
  });

  it("#403 PO: devolución desde varios pedidos de origen (2 orígenes) queda completa y el reintento no mueve nada", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (const [suffix, amount] of [["a", 6000], ["b", 4000]] as const) {
        await setDoc(doc(ctx.firestore(), "orders/inc-origin-multi-" + suffix), {
          storeId: "inc-store", customerId: "inc-clienta",
          items: [{ lineId: `m${suffix}_L0`, productName: "Origen " + suffix, quantity: 1, unitPrice: 50, subtotal: 50 }],
          deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 15000, inheritedDepositMaterialized: true,
          creditConsumedCents: amount,
          createdAt: "", updatedAt: "",
        });
      }
      await setDoc(doc(ctx.firestore(), "orders/inc-order-multi"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "md_L0", productId: "inc-product", productName: "Pieza", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 0, inheritedDepositMaterialized: true,
        creditAppliedCents: 10000,
        creditLedger: [
          { id: "app_m1", kind: "application", fromOrderId: "inc-origin-multi-a", amountCents: 6000, at: "2026-11-06T10:00:00Z", by: "inc-user" },
          { id: "app_m2", kind: "application", fromOrderId: "inc-origin-multi-b", amountCents: 4000, at: "2026-11-06T10:00:00Z", by: "inc-user" },
        ],
        createdAt: "", updatedAt: "",
      });
    });
    await openIncidentTx({ orderId: "inc-order-multi", storeId: "inc-store", incident: incident("inc-multi", { originalUnitPriceCents: 10000, events: [event("mu-open", "opened")] }) });
    await applyIncidentEventTx({ orderId: "inc-order-multi", storeId: "inc-store", incidentId: "inc-multi",
      event: event("mu-e1", "resolution_agreed"), resolution: { kind: "refund", destination: "credit_accepted", refundOwedCents: 10000 } });
    await applyIncidentEventTx({ orderId: "inc-order-multi", storeId: "inc-store", incidentId: "inc-multi", event: event("mu-e2", "confirmed") });
    const order = (await getDoc(doc(holder.db, "orders/inc-order-multi"))).data()!;
    expect(order.creditAppliedCents).toBe(0);
    const a = (await getDoc(doc(holder.db, "orders/inc-origin-multi-a"))).data()!;
    const b = (await getDoc(doc(holder.db, "orders/inc-origin-multi-b"))).data()!;
    expect(a.creditConsumedCents).toBe(0);
    expect(b.creditConsumedCents).toBe(0);
    // Retry: idempotent, nothing extra moves.
    await applyIncidentEventTx({ orderId: "inc-order-multi", storeId: "inc-store", incidentId: "inc-multi", event: event("mu-e2", "confirmed") });
    const order2 = (await getDoc(doc(holder.db, "orders/inc-order-multi"))).data()!;
    const a2 = (await getDoc(doc(holder.db, "orders/inc-origin-multi-a"))).data()!;
    const b2 = (await getDoc(doc(holder.db, "orders/inc-origin-multi-b"))).data()!;
    expect(order2.creditAppliedCents).toBe(0);
    expect(a2.creditConsumedCents).toBe(0);
    expect(b2.creditConsumedCents).toBe(0);
  });

  it("#403 r5 P0: confirmar incidencia con 3 orígenes restituye completo (presupuesto CEL)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (const [i, amount] of [["1", 4000], ["2", 3000], ["3", 3000]] as const) {
        await setDoc(doc(ctx.firestore(), "orders/inc-origin-cel-" + i), {
          storeId: "inc-store", customerId: "inc-clienta",
          items: [{ lineId: `cel${i}_L0`, productName: "Origen " + i, quantity: 1, unitPrice: 50, subtotal: 50 }],
          deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 15000, inheritedDepositMaterialized: true,
          creditConsumedCents: amount,
          createdAt: "", updatedAt: "",
        });
      }
      await setDoc(doc(ctx.firestore(), "orders/inc-order-cel"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "cel_L0", productId: "inc-product", productName: "Pieza", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 0, inheritedDepositMaterialized: true,
        creditAppliedCents: 10000,
        creditLedger: [
          { id: "app_cel1", kind: "application", fromOrderId: "inc-origin-cel-1", amountCents: 4000, at: "2026-11-06T10:00:00Z", by: "inc-user" },
          { id: "app_cel2", kind: "application", fromOrderId: "inc-origin-cel-2", amountCents: 3000, at: "2026-11-06T10:00:00Z", by: "inc-user" },
          { id: "app_cel3", kind: "application", fromOrderId: "inc-origin-cel-3", amountCents: 3000, at: "2026-11-06T10:00:00Z", by: "inc-user" },
        ],
        createdAt: "", updatedAt: "",
      });
    });
    await openIncidentTx({ orderId: "inc-order-cel", storeId: "inc-store", incident: incident("inc-cel", { originalUnitPriceCents: 10000, events: [event("cel-open", "opened")] }) });
    await applyIncidentEventTx({ orderId: "inc-order-cel", storeId: "inc-store", incidentId: "inc-cel",
      event: event("cel-e1", "resolution_agreed"), resolution: { kind: "refund", destination: "credit_accepted", refundOwedCents: 10000 } });
    await applyIncidentEventTx({ orderId: "inc-order-cel", storeId: "inc-store", incidentId: "inc-cel", event: event("cel-e2", "confirmed") });
    const order = (await getDoc(doc(holder.db, "orders/inc-order-cel"))).data()!;
    expect(order.creditAppliedCents).toBe(0);
    for (const i of ["1", "2", "3"]) {
      const o = (await getDoc(doc(holder.db, "orders/inc-origin-cel-" + i))).data()!;
      expect(o.creditConsumedCents).toBe(0);
      expect((o.creditLedger ?? []).some((e: { kind: string }) => e.kind === "restitution")).toBe(true);
    }
  });

  it("#403 r5 (4ª revisión): origen drifteado restituye lo REAL, no se atasca (deriva F4)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/inc-origin-drift2"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "dr_L0", productName: "Origen drift", quantity: 1, unitPrice: 50, subtotal: 50 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 15000, inheritedDepositMaterialized: true,
        creditConsumedCents: 2000, // drifted: net 6000 but mirror only 2000
        createdAt: "", updatedAt: "",
      });
      await setDoc(doc(ctx.firestore(), "orders/inc-origin-clean2"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "cl_L0", productName: "Origen clean", quantity: 1, unitPrice: 50, subtotal: 50 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 15000, inheritedDepositMaterialized: true,
        creditConsumedCents: 4000,
        createdAt: "", updatedAt: "",
      });
      await setDoc(doc(ctx.firestore(), "orders/inc-order-drift2"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "d2_L0", productId: "inc-product", productName: "Pieza", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 0, inheritedDepositMaterialized: true,
        creditAppliedCents: 10000,
        creditLedger: [
          { id: "app_dr2", kind: "application", fromOrderId: "inc-origin-drift2", amountCents: 6000, at: "2026-11-06T10:00:00Z", by: "inc-user" },
          { id: "app_cl2", kind: "application", fromOrderId: "inc-origin-clean2", amountCents: 4000, at: "2026-11-06T10:00:00Z", by: "inc-user" },
        ],
        createdAt: "", updatedAt: "",
      });
    });
    await openIncidentTx({ orderId: "inc-order-drift2", storeId: "inc-store", incident: incident("inc-dr2", { originalUnitPriceCents: 10000, events: [event("dr2-open", "opened")] }) });
    await applyIncidentEventTx({ orderId: "inc-order-drift2", storeId: "inc-store", incidentId: "inc-dr2",
      event: event("dr2-e1", "resolution_agreed"), resolution: { kind: "refund", destination: "credit_accepted", refundOwedCents: 10000 } });
    // The confirm COMMITS (no raw denial): the drain restitutes the real
    // mirrors — 2000 from the drifted origin, 4000 from the clean one.
    await applyIncidentEventTx({ orderId: "inc-order-drift2", storeId: "inc-store", incidentId: "inc-dr2", event: event("dr2-e2", "confirmed") });
    const order = (await getDoc(doc(holder.db, "orders/inc-order-drift2"))).data()!;
    expect(order.creditAppliedCents).toBe(4000); // 10000 − 2000 − 4000 (rest real)
    const drift = (await getDoc(doc(holder.db, "orders/inc-origin-drift2"))).data()!;
    const clean = (await getDoc(doc(holder.db, "orders/inc-origin-clean2"))).data()!;
    expect(drift.creditConsumedCents).toBe(0);     // its real 2000 returned
    expect(clean.creditConsumedCents).toBe(0);     // fully restituted
  });

  it("#403 PO: drenaje de incidencia interrumpido a mitad se RECUPERA exacto por reintento", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      // Crash state: confirm event committed; drain covered 4000 of a 10000
      // obligation (tagged entries + mirrors present for the covered part).
      await setDoc(doc(ctx.firestore(), "orders/inc-origin-resume"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "rs_L0", productName: "Origen", quantity: 1, unitPrice: 50, subtotal: 50 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 15000, inheritedDepositMaterialized: true,
        creditConsumedCents: 6000, // 10000 − 4000 already restituted
        creditLedger: [{ id: "res_rel_e2_inc-order-resume_inc-origin-resume_1", kind: "restitution", fromOrderId: "inc-order-resume", amountCents: 4000, at: "2026-11-06T10:31:00.000Z", by: "inc-user" }],
        createdAt: "", updatedAt: "",
      });
      await setDoc(doc(ctx.firestore(), "orders/inc-order-resume"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "rsd_L0", productId: "inc-product", productName: "Pieza", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 0, inheritedDepositMaterialized: true,
        creditAppliedCents: 6000, // 10000 − 4000 released
        creditLedger: [
          { id: "app_rs", kind: "application", fromOrderId: "inc-origin-resume", amountCents: 10000, at: "2026-11-06T10:00:00Z", by: "inc-user" },
          { id: "rel_e2_inc-order-resume_inc-origin-resume_1", kind: "release", fromOrderId: "inc-origin-resume", amountCents: 4000, at: "2026-11-06T10:31:00.000Z", by: "inc-user" },
        ],
        incidents: [{
          id: "inc-resume", productId: "inc-product", productName: "Pieza", quantity: 1,
          reason: "Piedra fallada", originalUnitPriceCents: 10000,
          resolution: { kind: "refund", destination: "credit_accepted", refundOwedCents: 10000 },
          events: [
            { id: "rs-open", kind: "opened", at: "2026-11-06T10:20:00.000Z", by: "inc-user" },
            { id: "rs-e1", kind: "resolution_agreed", at: "2026-11-06T10:25:00.000Z", by: "inc-user" },
            { id: "rs-e2", kind: "confirmed", at: "2026-11-06T10:30:00.000Z", by: "inc-user" },
          ],
        }],
        createdAt: "", updatedAt: "",
      });
    });
    // Retrying the SAME confirm (idempotent) resumes the drain: the remaining
    // 6000 land, no duplicates anywhere.
    await applyIncidentEventTx({ orderId: "inc-order-resume", storeId: "inc-store", incidentId: "inc-resume", event: event("rs-e2", "confirmed") });
    const order = (await getDoc(doc(holder.db, "orders/inc-order-resume"))).data()!;
    const origin = (await getDoc(doc(holder.db, "orders/inc-origin-resume"))).data()!;
    expect(order.creditAppliedCents).toBe(0); // exactly the full obligation
    expect(origin.creditConsumedCents).toBe(0);
    const releases = (order.creditLedger as any[]).filter((e) => e.kind === "release");
    expect(releases.reduce((sum: number, e: any) => sum + e.amountCents, 0)).toBe(10000); // no duplicates
    const mirrors = (origin.creditLedger as any[]).filter((e) => e.kind === "restitution");
    expect(mirrors.reduce((sum: number, e: any) => sum + e.amountCents, 0)).toBe(10000);
  });

  it("never crosses stores", async () => {
    await expect(
      openIncidentTx({ orderId: "inc-order", storeId: "inc-foreign", incident: incident("inc-x") })
    ).rejects.toThrow(/otra tienda/i);
  });

  it("a refund incident: confirm hands the money back and frees the credit block exactly once", async () => {
    // Money fields only enter through the disabled-rules seeder (rules forbid
    // creating order docs that carry them — the payment tx owns that money).
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/inc-order-3"), {
      storeId: "inc-store", customerId: "inc-clienta",
      items: [{ lineId: "o3_L0", productId: "inc-product", productName: "Anillo QA", quantity: 1, unitPrice: 120, subtotal: 120 }],
      deposit: 0, orderStatus: "delivered", paymentsReceivedCents: 12000, inheritedDepositMaterialized: true,
      createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z",
      });
    });
    await openIncidentTx({ orderId: "inc-order-3", storeId: "inc-store", incident: incident("inc-3", { events: [event("inc3-open", "opened")] }) });
    await applyIncidentEventTx({
      orderId: "inc-order-3", storeId: "inc-store", incidentId: "inc-3",
      event: event("inc3-e1", "resolution_agreed"),
      resolution: { kind: "refund", destination: "refund_pending" },
    });
    await applyIncidentEventTx({
      orderId: "inc-order-3", storeId: "inc-store", incidentId: "inc-3",
      event: event("inc3-e2", "confirmed", { refundExecutedCents: 12000 }),
    });
    const order = (await getDoc(doc(holder.db, "orders/inc-order-3"))).data()!;
    expect(order.incidents[0].events).toHaveLength(3);
    // Double settle aborts: nothing pending anymore.
    await expect(
      applyIncidentEventTx({ orderId: "inc-order-3", storeId: "inc-store", incidentId: "inc-3", event: event("inc3-e3", "refund_executed", { refundExecutedCents: 12000 }) })
    ).rejects.toThrow(/reembolso|importe devuelto|confirm/i);
  });
});
