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
      // #364: a design sold per exact color — the shelf lives on the variants.
      await setDoc(doc(ctx.firestore(), "products/inc-design"), {
        storeId: "inc-store", name: "Diseño Luna", sku: "QA-LUNA", category: "jewelry",
        price: 150, cost: 40, status: "draft", createdAt: "", updatedAt: "",
        variants: [
          { id: "v-red", color: "Rojo", skuSuffix: "R", quantityOnHand: 2, createdAt: "", updatedAt: "" },
          { id: "v-blue", color: "Azul", skuSuffix: "A", quantityOnHand: 0, createdAt: "", updatedAt: "" },
        ],
      });
      await setDoc(doc(ctx.firestore(), "orders/inc-order-v"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "v_L0", productId: "inc-design", productName: "Diseño Luna", variantId: "v-blue", variantColor: "Azul", quantity: 1, unitPrice: 150, subtotal: 150 }],
        deposit: 0, orderStatus: "confirmed", paymentsReceivedCents: 15000, inheritedDepositMaterialized: true,
        createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z",
      });
      await setDoc(doc(ctx.firestore(), "orders/inc-order-va"), {
        storeId: "inc-store", customerId: "inc-clienta",
        items: [{ lineId: "va_L0", productId: "inc-product", productName: "Anillo QA", quantity: 1, unitPrice: 120, subtotal: 120 }],
        deposit: 0, orderStatus: "confirmed", paymentsReceivedCents: 6000, inheritedDepositMaterialized: true,
        createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z",
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

  // #380: the r4 credit-restitution scenarios (origin absent, drifted mirror,
  // happy-path release) moved to customerCredit.emulator.test.ts — the
  // incident confirm now restitutes through the trusted releaseCredit
  // callable, which needs the FUNCTIONS emulator this firestore-only session
  // does not start. Their contracts evolved with the architecture: the
  // confirmation commits, the restitution lands atomically right after, and
  // any shortfall (missing/drifted origin) is loud and self-heals on retry
  // instead of aborting the whole confirmation.

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

  // ── #364: incidents on color designs move the COLOR shelf ────────────────

  const designVariant = async (id: string) => {
    const design = (await getDoc(doc(holder.db, "products/inc-design"))).data()!;
    return design.variants.find((v: { id: string }) => v.id === id);
  };

  it("#364 confirmar un reemplazo por color mueve el estante del color, no el del diseño", async () => {
    await openIncidentTx({ orderId: "inc-order-va", storeId: "inc-store", incident: incident("inc-c1") });
    await applyIncidentEventTx({
      orderId: "inc-order-va", storeId: "inc-store", incidentId: "inc-c1",
      event: event("c1-e1", "resolution_agreed"),
      resolution: { kind: "replacement_equivalent" },
      replacement: { productId: "inc-design", productName: "Diseño Luna", variantId: "v-red", variantColor: "Rojo", unitPriceCents: 15000, unitCostCents: 4000, chargeDifference: false },
    });
    const confirmed = await applyIncidentEventTx({ orderId: "inc-order-va", storeId: "inc-store", incidentId: "inc-c1", event: event("c1-e2", "confirmed") });
    const red = await designVariant("v-red");
    const blue = await designVariant("v-blue");
    const design = (await getDoc(doc(holder.db, "products/inc-design"))).data()!;
    expect(red.quantityOnHand).toBe(1); // the handed-over color left its shelf
    expect(blue.quantityOnHand).toBe(0); // the other color untouched
    expect(design.quantityOnHand).toBeUndefined(); // design-level shelf NEVER moves
    expect(confirmed.changedProductIds).toContain("inc-design");
  });

  it("#364 reemplazo por color sin color resuelto (legado): error accionable, sin mover nada", async () => {
    await openIncidentTx({ orderId: "inc-order-va", storeId: "inc-store", incident: incident("inc-c2") });
    await applyIncidentEventTx({
      orderId: "inc-order-va", storeId: "inc-store", incidentId: "inc-c2",
      event: event("c2-e1", "resolution_agreed"),
      resolution: { kind: "replacement_equivalent" },
      // Legacy shape: no variantId on a design sold per color.
      replacement: { productId: "inc-design", productName: "Diseño Luna", unitPriceCents: 15000, unitCostCents: 4000, chargeDifference: false },
    });
    await expect(
      applyIncidentEventTx({ orderId: "inc-order-va", storeId: "inc-store", incidentId: "inc-c2", event: event("c2-e2", "confirmed") })
    ).rejects.toThrow(/color/i);
    const red = await designVariant("v-red");
    const order = (await getDoc(doc(holder.db, "orders/inc-order-va"))).data()!;
    expect(red.quantityOnHand).toBe(1); // untouched by the aborted confirm
    expect(order.incidents.find((i: { id: string }) => i.id === "inc-c2").events).toHaveLength(2);
  });

  it("#364 la existencia del reemplazo se mide por color, no por diseño", async () => {
    await openIncidentTx({ orderId: "inc-order-va", storeId: "inc-store", incident: incident("inc-c3") });
    await applyIncidentEventTx({
      orderId: "inc-order-va", storeId: "inc-store", incidentId: "inc-c3",
      event: event("c3-e1", "resolution_agreed"),
      resolution: { kind: "replacement_equivalent" },
      // v-blue has 0 — the design has 1 in another color, which must NOT count.
      replacement: { productId: "inc-design", productName: "Diseño Luna", variantId: "v-blue", variantColor: "Azul", unitPriceCents: 15000, unitCostCents: 4000, chargeDifference: false },
    });
    await expect(
      applyIncidentEventTx({ orderId: "inc-order-va", storeId: "inc-store", incidentId: "inc-c3", event: event("c3-e2", "confirmed") })
    ).rejects.toThrow(/disponible|Azul/i);
    const blue = await designVariant("v-blue");
    expect(blue.quantityOnHand).toBe(0);
  });

  it("#364 volver a venta devuelve la pieza a su color (no al estante del diseño)", async () => {
    const variantIncident = incident("inc-v1", {
      productId: "inc-design", productName: "Diseño Luna", variantId: "v-blue", variantColor: "Azul",
    });
    await openIncidentTx({ orderId: "inc-order-v", storeId: "inc-store", incident: variantIncident });
    await applyIncidentEventTx({
      orderId: "inc-order-v", storeId: "inc-store", incidentId: "inc-v1",
      event: event("v1-e1", "resolution_agreed"),
      resolution: { kind: "refund", destination: "refund_pending" },
    });
    await applyIncidentEventTx({ orderId: "inc-order-v", storeId: "inc-store", incidentId: "inc-v1", event: event("v1-e2", "confirmed") });
    let design = (await getDoc(doc(holder.db, "products/inc-design"))).data()!;
    expect(design.quantityQuarantined).toBe(1); // design-level informational aggregate
    const released = await applyIncidentEventTx({ orderId: "inc-order-v", storeId: "inc-store", incidentId: "inc-v1", event: event("v1-e3", "returned_to_sale") });
    const blue = await designVariant("v-blue");
    design = (await getDoc(doc(holder.db, "products/inc-design"))).data()!;
    expect(blue.quantityOnHand).toBe(1); // sellable again ON ITS COLOR
    expect(design.quantityOnHand).toBeUndefined(); // the invisible shelf never moved
    expect(design.quantityQuarantined).toBe(0);
    expect(released.changedProductIds).toContain("inc-design");
  });

  it("#364 color desaparecido: error accionable, sin asignar otro color ni alterar existencias", async () => {
    const staleIncident = incident("inc-v2", {
      productId: "inc-design", productName: "Diseño Luna", variantId: "v-gone", variantColor: "Vapor",
    });
    await openIncidentTx({ orderId: "inc-order-v", storeId: "inc-store", incident: staleIncident });
    await applyIncidentEventTx({
      orderId: "inc-order-v", storeId: "inc-store", incidentId: "inc-v2",
      event: event("v2-e1", "resolution_agreed"),
      resolution: { kind: "refund", destination: "refund_pending" },
    });
    await applyIncidentEventTx({ orderId: "inc-order-v", storeId: "inc-store", incidentId: "inc-v2", event: event("v2-e2", "confirmed") });
    await expect(
      applyIncidentEventTx({ orderId: "inc-order-v", storeId: "inc-store", incidentId: "inc-v2", event: event("v2-e3", "returned_to_sale") })
    ).rejects.toThrow(/color.*ya no existe|no se puede devolver/i);
    const design = (await getDoc(doc(holder.db, "products/inc-design"))).data()!;
    expect(design.quantityQuarantined).toBe(1); // still held — nothing altered
    expect(design.quantityOnHand).toBeUndefined();
    const red = await designVariant("v-red");
    const blue = await designVariant("v-blue");
    expect(red.quantityOnHand).toBe(1);
    expect(blue.quantityOnHand).toBe(1);
  });
});

// #461 (dictamen QA 23-nov, crítico 4): la posventa también razona por la
// COMBINACIÓN exacta. El reemplazo exige la talla cuando el color se vende
// por talla y descuenta su combinación; la pieza devuelta vuelve a SU talla;
// una talla que ya no existe o una talla faltante fallan cerrado.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("posventa por combinación color × talla (#461 — dictamen QA)", () => {
  let envSizes: RulesTestEnvironment;
  const STORE = "inc461-store";
  const PRODUCT = "inc461-design";
  const sizeLine = (quantity = 1, withSize = true) => ({
    lineId: "l6", productId: PRODUCT, productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado",
    ...(withSize ? { variantSizeId: "d6", variantSize: "6" } : {}),
    quantity, unitPrice: 400, subtotal: 400 * quantity,
  });
  const orderDoc = (withSize = true) => ({
    storeId: STORE, customerId: "clienta",
    items: [sizeLine(1, withSize)],
    deposit: 0, orderStatus: "confirmed", paymentsReceivedCents: 40000, inheritedDepositMaterialized: true,
    createdAt: "2026-11-23T10:00:00Z", updatedAt: "2026-11-23T10:00:00Z",
  });
  const sizedIncident = (id: string, extra: Partial<OrderIncident> = {}): OrderIncident => ({
    id, lineId: "l6", productId: PRODUCT, productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d6", variantSize: "6",
    quantity: 1, reason: "Piedra fallada", originalUnitPriceCents: 40000,
    events: [event("open-" + id, "opened")], ...extra,
  });

  async function seed() {
    await envSizes.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/inc461-user"), { role: "member" });
      await setDoc(doc(db, "adminStores/" + STORE), { ownerUid: "inc461-user", memberUids: ["inc461-user"] });
      await setDoc(doc(db, "products/" + PRODUCT), {
        storeId: STORE, name: "Anillo Sol", sku: "SOL", category: "jewelry", price: 400, cost: 100, status: "draft", createdAt: "", updatedAt: "",
        variants: [
          { id: "v_gold", color: "Dorado", skuSuffix: "D", sku: "SOL-D", cost: 100, createdAt: "", updatedAt: "",
            sizes: [
              { id: "d6", size: "6", sku: "SOL-D-6", cost: 100, quantityOnHand: 3, createdAt: "", updatedAt: "" },
              { id: "d5", size: "5", sku: "SOL-D-5", cost: 100, quantityOnHand: 2, createdAt: "", updatedAt: "" },
            ] },
          { id: "v_silver", color: "Plateado", skuSuffix: "P", sku: "SOL-P", cost: 90, quantityOnHand: 4, createdAt: "", updatedAt: "" },
        ],
      });
      await setDoc(doc(db, "orders/ord-sz-repl"), orderDoc());
      await setDoc(doc(db, "orders/ord-sz-return"), orderDoc());
      await setDoc(doc(db, "orders/ord-sz-legacy"), orderDoc(false));
    });
    holder.db = envSizes.authenticatedContext("inc461-user").firestore();
  }

  beforeAll(async () => {
    envSizes = await initializeTestEnvironment({
      projectId: "store-os-dev",
      firestore: { rules: readFileSync("firestore.rules", "utf8") },
    });
  });
  afterAll(async () => { await envSizes.cleanup(); });

  const readShelves = async () => {
    const data = (await getDoc(doc(holder.db, "products/" + PRODUCT))).data()! as { quantityOnHand?: number; quantityQuarantined?: number; variants: any[] };
    const gold = data.variants.find((v) => v.id === "v_gold");
    return {
      d6: gold.sizes.find((s: any) => s.id === "d6")?.quantityOnHand as number | undefined,
      d5: gold.sizes.find((s: any) => s.id === "d5")?.quantityOnHand as number | undefined,
      goldColorLevel: gold.quantityOnHand as number | undefined,
      silver: data.variants.find((v) => v.id === "v_silver").quantityOnHand as number,
      designLevel: data.quantityOnHand as number | undefined,
      quarantined: data.quantityQuarantined as number | undefined,
    };
  };
  const agree = async (orderId: string, incidentId: string, idPrefix: string, resolution: OrderIncident["resolution"], replacement?: OrderIncident["replacement"]) => {
    await openIncidentTx({ orderId, storeId: STORE, incident: sizedIncident(incidentId, orderId === "ord-sz-legacy" ? { variantSizeId: undefined, variantSize: undefined } : {}) });
    await applyIncidentEventTx({ orderId, storeId: STORE, incidentId, event: event(idPrefix + "-e1", "resolution_agreed"), resolution, replacement });
  };

  it("confirmar un reemplazo sin talla en un color que se vende por talla: error accionable, sin mover nada", async () => {
    await seed();
    await agree("ord-sz-repl", "sz-1", "sz1", { kind: "replacement_equivalent" }, { productId: PRODUCT, productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado", unitPriceCents: 40000, unitCostCents: 10000, chargeDifference: false });
    await expect(
      applyIncidentEventTx({ orderId: "ord-sz-repl", storeId: STORE, incidentId: "sz-1", event: event("sz1-e2", "confirmed") })
    ).rejects.toThrow(/talla/i);
    const shelves = await readShelves();
    expect(shelves.d6).toBe(3);
    expect(shelves.d5).toBe(2);
    expect(shelves.quarantined ?? 0).toBe(0);
  });

  it("confirmar el reemplazo con talla descuenta ESA combinación; su hermana, el otro color y el diseño quedan intactos", async () => {
    await seed();
    await agree("ord-sz-repl", "sz-2", "sz2", { kind: "replacement_equivalent" }, { productId: PRODUCT, productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d5", variantSize: "5", unitPriceCents: 40000, unitCostCents: 10000, chargeDifference: false });
    const confirmed = await applyIncidentEventTx({ orderId: "ord-sz-repl", storeId: STORE, incidentId: "sz-2", event: event("sz2-e2", "confirmed") });
    expect(confirmed.changedProductIds).toContain(PRODUCT);
    const shelves = await readShelves();
    expect(shelves.d5).toBe(1); // la talla entregada salió de SU estante
    expect(shelves.d6).toBe(3); // la talla devuelta no se descuenta dos veces
    expect(shelves.silver).toBe(4);
    expect(shelves.goldColorLevel).toBeUndefined();
    expect(shelves.designLevel).toBeUndefined();
    expect(shelves.quarantined).toBe(1);
  });

  it("la existencia del reemplazo se mide por combinación: la 6 con 3 no presta piezas a la 5 con 2", async () => {
    await seed();
    await agree("ord-sz-repl", "sz-3", "sz3", { kind: "replacement_with_difference" }, { productId: PRODUCT, productName: "Anillo Sol", variantId: "v_gold", variantColor: "Dorado", variantSizeId: "d5", variantSize: "5", unitPriceCents: 40000, unitCostCents: 10000, chargeDifference: false });
    // Se necesitan 3 de la talla 5 y sólo hay 2.
    const order = (await getDoc(doc(holder.db, "orders/ord-sz-repl"))).data()!;
    const incidents = order.incidents as OrderIncident[];
    incidents.find((i) => i.id === "sz-3")!.quantity = 3;
    await envSizes.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "orders/ord-sz-repl"), { incidents }, { merge: true }));
    await expect(
      applyIncidentEventTx({ orderId: "ord-sz-repl", storeId: STORE, incidentId: "sz-3", event: event("sz3-e2", "confirmed") })
    ).rejects.toThrow(/disponible|talla 5/i);
    expect((await readShelves()).d5).toBe(2);
  });

  it("esperar reposición entrega la MISMA combinación de la incidencia", async () => {
    await seed();
    await agree("ord-sz-repl", "sz-4", "sz4", { kind: "wait_restock", waitUntil: "2026-12-01" });
    await applyIncidentEventTx({ orderId: "ord-sz-repl", storeId: STORE, incidentId: "sz-4", event: event("sz4-e2", "confirmed") });
    const shelves = await readShelves();
    expect(shelves.d6).toBe(2);
    expect(shelves.d5).toBe(2);
    expect(shelves.goldColorLevel).toBeUndefined();
  });

  it("volver a venta devuelve la pieza a SU talla, no a la hermana ni al campo del color", async () => {
    await seed();
    await agree("ord-sz-return", "sz-5", "sz5", { kind: "refund", destination: "refund_pending" });
    await applyIncidentEventTx({ orderId: "ord-sz-return", storeId: STORE, incidentId: "sz-5", event: event("sz5-e2", "confirmed") });
    const released = await applyIncidentEventTx({ orderId: "ord-sz-return", storeId: STORE, incidentId: "sz-5", event: event("sz5-e3", "returned_to_sale") });
    expect(released.changedProductIds).toContain(PRODUCT);
    const shelves = await readShelves();
    expect(shelves.d6).toBe(4);
    expect(shelves.d5).toBe(2);
    expect(shelves.goldColorLevel).toBeUndefined();
    expect(shelves.quarantined).toBe(0);
  });

  it("la talla de la incidencia ya no existe: error accionable, sin inventar otra talla ni mover existencias", async () => {
    await seed();
    await agree("ord-sz-return", "sz-6", "sz6", { kind: "refund", destination: "refund_pending" }, undefined);
    await applyIncidentEventTx({ orderId: "ord-sz-return", storeId: STORE, incidentId: "sz-6", event: event("sz6-e2", "confirmed") });
    // La ficha quitó la talla 6 después de la devolución.
    const data = (await getDoc(doc(holder.db, "products/" + PRODUCT))).data()! as { variants: any[] };
    const variants = data.variants.map((v) => (v.id === "v_gold" ? { ...v, sizes: v.sizes.filter((s: any) => s.id !== "d6") } : v));
    await envSizes.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "products/" + PRODUCT), { variants }, { merge: true }));
    await expect(
      applyIncidentEventTx({ orderId: "ord-sz-return", storeId: STORE, incidentId: "sz-6", event: event("sz6-e3", "returned_to_sale") })
    ).rejects.toThrow(/talla.*ya no existe|no se puede devolver/i);
    const after = await readShelves();
    expect(after.d5).toBe(2);
    expect(after.goldColorLevel).toBeUndefined(); // nada cayó en el campo del color
    expect(after.quarantined).toBe(1); // sigue retenida: nada se alteró
  });

  it("pieza vendida sin talla en un color que ya se vende por talla: al volver a venta queda «sin talla» en el color, sin inventar la talla", async () => {
    await seed();
    await agree("ord-sz-legacy", "sz-7", "sz7", { kind: "refund", destination: "refund_pending" });
    await applyIncidentEventTx({ orderId: "ord-sz-legacy", storeId: STORE, incidentId: "sz-7", event: event("sz7-e2", "confirmed") });
    await applyIncidentEventTx({ orderId: "ord-sz-legacy", storeId: STORE, incidentId: "sz-7", event: event("sz7-e3", "returned_to_sale") });
    const shelves = await readShelves();
    expect(shelves.d6).toBe(3);
    expect(shelves.d5).toBe(2);
    expect(shelves.goldColorLevel).toBe(1); // a la vista para repartir desde la ficha
    expect(shelves.quarantined).toBe(0);
  });

  it("revisión 23-nov: una solución acordada SIN talla puede acordarse de nuevo cuando el color ya vende por talla; una válida no", async () => {
    await seed();
    const withoutSize = { productId: PRODUCT, productName: "Anillo Sol", unitPriceCents: 40000, unitCostCents: 10000, chargeDifference: false, variantId: "v_gold", variantColor: "Dorado" };
    await agree("ord-sz-repl", "sz-8", "sz8", { kind: "replacement_equivalent" }, withoutSize);
    await expect(
      applyIncidentEventTx({ orderId: "ord-sz-repl", storeId: STORE, incidentId: "sz-8", event: event("sz8-e2", "confirmed") })
    ).rejects.toThrow(/se acordó sin talla.*Vuelve a acordar/);
    // Se acuerda de nuevo, ahora con la talla que se entregará.
    await applyIncidentEventTx({
      orderId: "ord-sz-repl", storeId: STORE, incidentId: "sz-8", event: event("sz8-e3", "resolution_agreed"),
      resolution: { kind: "replacement_equivalent" },
      replacement: { ...withoutSize, variantSizeId: "d5", variantSize: "5" },
    });
    await applyIncidentEventTx({ orderId: "ord-sz-repl", storeId: STORE, incidentId: "sz-8", event: event("sz8-e4", "confirmed") });
    expect((await readShelves()).d5).toBe(1);
    // Una solución que sí se puede entregar no se vuelve a acordar (append-only como siempre).
    await expect(
      applyIncidentEventTx({ orderId: "ord-sz-repl", storeId: STORE, incidentId: "sz-8", event: event("sz8-e5", "resolution_agreed"), resolution: { kind: "refund", destination: "refund_pending" } })
    ).rejects.toThrow(/ya tiene una resolución acordada|ya tiene|confirmad/i);
  });
});
