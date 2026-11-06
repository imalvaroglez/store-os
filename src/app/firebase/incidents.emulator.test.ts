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
    ).rejects.toThrow(/cuarentena/i);
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

  it("repaired releases the quarantine back into sellable stock; refund_executed settles once", async () => {
    await applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-1", event: event("inc-e6", "repaired") });
    const damaged = (await getDoc(doc(holder.db, "products/inc-product"))).data()!;
    expect(damaged.quantityQuarantined).toBe(0);
    expect(damaged.quantityOnHand).toBe(6);
    // refund_executed on a non-refund incident aborts.
    await expect(
      applyIncidentEventTx({ orderId: "inc-order", storeId: "inc-store", incidentId: "inc-1", event: event("inc-e7", "refund_executed") })
    ).rejects.toThrow(/reembolso|confirm/i);
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
      resolution: { kind: "refund", refundUnitPriceCents: 12000 },
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
    ).rejects.toThrow(/cuarentena/i);
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
      resolution: { kind: "refund", refundUnitPriceCents: 12000 },
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
    ).rejects.toThrow(/reembolso|confirm/i);
  });
});
