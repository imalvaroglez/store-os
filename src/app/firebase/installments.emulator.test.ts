import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order, OrderPayment } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import {
  DeliveryWithBalanceError,
  InsufficientStockError,
  registerOrderPaymentTx,
  saveOrderWithStockTx,
} from "./firestoreData";

let env: RulesTestEnvironment;
const user = { uid: "tx-user", role: "member" } as any;

const plan = { count: 6, frequency: "monthly" as const, firstDueDate: "2026-11-15", agreedAt: "2026-11-01", agreedBy: "tx-user" };

const makeOrder = (id: string, productId: string, quantity: number, overrides: Partial<Order> = {}): Order => ({
  id, storeId: "tx-store", customerId: "c1",
  items: [{ lineId: "l1", productId, productName: "Caja adviento", quantity, unitPrice: 900, subtotal: quantity * 900 }],
  deposit: 0, orderStatus: "asked", paymentStatus: "unpaid", schemaVersion: 2,
  createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z",
  ...overrides,
});

const payment = (id: string, amount: number, orderId = "plan-order"): OrderPayment => ({
  id, orderId, storeId: "tx-store", date: "2026-11-02", method: "cash", kind: "payment",
  amount, createdAt: "2026-11-02T10:00:00.000Z", createdBy: "tx-user",
});

const stock = async (id: string) => (await getDoc(doc(holder.db, "products", id))).data()?.quantityOnHand as number;
const orderDoc = async (id: string) => (await getDoc(doc(holder.db, "orders", id))).data();
const paymentCount = async (orderId: string) => (await getDocs(collection(holder.db, "orders", orderId, "payments"))).size;

// Runs in CI's rules job (emulator); skipped locally per the no-emulators rule.
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("installment reservation and delivery (#165)", () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: "store-os-dev", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/tx-user"), { role: "member" });
      await setDoc(doc(ctx.firestore(), "adminStores/tx-store"), { ownerUid: "tx-user", memberUids: ["tx-user"] });
      await setDoc(doc(ctx.firestore(), "products/p-plan"), { storeId: "tx-store", quantityOnHand: 5 });
      await setDoc(doc(ctx.firestore(), "products/p-short"), { storeId: "tx-store", quantityOnHand: 1 });
    });
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => { await env?.cleanup(); });

  it("a plan without abonos never reserves — ordinary orders still do", async () => {
    await saveOrderWithStockTx(user, makeOrder("plan-order", "p-plan", 2, { installments: plan }), null, "create-1");
    expect(await stock("p-plan")).toBe(5); // nothing apartado yet
    await saveOrderWithStockTx(user, makeOrder("ordinary-order", "p-plan", 1), null, "create-2");
    expect(await stock("p-plan")).toBe(4); // early reservation intact
  });

  it("the first abono reserves ONCE: retry, second abono and concurrency never re-reserve", async () => {
    const saved = await registerOrderPaymentTx(payment("pay_a", 100));
    expect(saved).toHaveLength(1);
    expect(await stock("p-plan")).toBe(2); // 4 − 2 piezas del pedido a plazos
    expect((await orderDoc("plan-order"))?.installmentsReservedAt).toBeTruthy();
    expect((await orderDoc("plan-order"))?.revision).toBe(2); // create=1, reserva=2

    // Double click: same intent id → recognized, no second write.
    await registerOrderPaymentTx(payment("pay_a", 100));
    expect(await stock("p-plan")).toBe(2);
    expect(await paymentCount("plan-order")).toBe(1);

    // A later abono does not touch stock again.
    await registerOrderPaymentTx(payment("pay_b", 500));
    expect(await stock("p-plan")).toBe(2);
    expect(await paymentCount("plan-order")).toBe(2);

    // Concurrent abonos that together liquidan: both register, one reservation.
    await Promise.all([
      registerOrderPaymentTx(payment("pay_c", 600)),
      registerOrderPaymentTx(payment("pay_d", 600)),
    ]);
    expect(await stock("p-plan")).toBe(2);
    expect(await paymentCount("plan-order")).toBe(4); // a + b + c + d = $1,800
  });

  it("insufficient stock at the first abono aborts explicitly: no negative stock, no payment, no silent reservation", async () => {
    await saveOrderWithStockTx(user, makeOrder("short-order", "p-short", 2, { installments: plan }), null, "create-3");
    expect(await stock("p-short")).toBe(1); // plan sin abonos no reserva
    await expect(registerOrderPaymentTx(payment("pay_s", 100, "short-order"))).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await stock("p-short")).toBe(1);
    expect(await paymentCount("short-order")).toBe(0);
    expect((await orderDoc("short-order"))?.installmentsReservedAt).toBeUndefined();
  });

  it("cancelling a reserved plan order does not release the pieces (money was received)", async () => {
    const current = (await orderDoc("plan-order"))!;
    const cancelled = makeOrder("plan-order", "p-plan", 2, {
      installments: plan,
      installmentsReservedAt: current.installmentsReservedAt,
      orderStatus: "cancelled",
      revision: current.revision,
    });
    await saveOrderWithStockTx(user, cancelled, current.revision, "cancel-1", []);
    expect(await stock("p-plan")).toBe(2); // sigue apartada
  });

  it("blocks the delivery confirmation while money is owed — on the mutation path", async () => {
    const current = (await orderDoc("plan-order"))!;
    const owing = makeOrder("plan-order", "p-plan", 2, {
      installments: plan,
      installmentsReservedAt: current.installmentsReservedAt,
      orderStatus: "ready",
      revision: current.revision,
    });
    await saveOrderWithStockTx(user, owing, current.revision, "ready-1", []);
    const ready = (await orderDoc("plan-order"))!;
    const delivering = { ...owing, revision: ready.revision, orderStatus: "delivered" as const };

    // Vista de sesión SIN cobros (p. ej. otra dispositivo): saldo $1,800 →
    // la confirmación de entrega se rechaza en el propio camino de mutación.
    await expect(
      saveOrderWithStockTx(user, delivering, ready.revision, "deliver-1", [])
    ).rejects.toBeInstanceOf(DeliveryWithBalanceError);
    expect((await orderDoc("plan-order"))?.orderStatus).toBe("ready"); // sin cambio

    // Liquidado (los 4 cobros reales suman $1,800): la entrega se CONFIRMA
    // manualmente — liquidar por sí solo no marca nada como entregado.
    const liquidated = [payment("pay_a", 100), payment("pay_b", 500), payment("pay_c", 600), payment("pay_d", 600)];
    const result = await saveOrderWithStockTx(user, delivering, ready.revision, "deliver-2", liquidated);
    expect(result.order.orderStatus).toBe("delivered");
    expect(await stock("p-plan")).toBe(2); // entregado conserva el consumo
  });

  it("converting an order that already received money keeps the pieces apartadas", async () => {
    // Orden ordinaria abierta (ya reservó 1 pieza) con un cobro registrado.
    const ordinary = makeOrder("convert-order", "p-plan", 1);
    await saveOrderWithStockTx(user, ordinary, null, "convert-create");
    expect(await stock("p-plan")).toBe(1); // 2 − 1 de la orden ordinaria
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "orders/convert-order/payments/seed_1"), payment("seed_1", 400, "convert-order"));
    });
    const snapshot = (await orderDoc("convert-order"))!;
    const converted = makeOrder("convert-order", "p-plan", 1, {
      installments: plan,
      revision: snapshot.revision,
    });
    const result = await saveOrderWithStockTx(user, converted, snapshot.revision, "convert-plan", [payment("seed_1", 400, "convert-order")]);
    expect(result.order.installmentsReservedAt).toBeTruthy();
    expect(await stock("p-plan")).toBe(1); // sin liberar: ya había dinero
  });

  it("a member of another store cannot reserve through the payment path", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "adminStores/other-store"), { ownerUid: "tx-other", memberUids: ["tx-other"] });
      await setDoc(doc(ctx.firestore(), "orders/foreign-plan"), {
        storeId: "other-store", items: [{ productId: "p-plan", productName: "X", quantity: 1, unitPrice: 100, subtotal: 100 }],
        deposit: 0, createdAt: "", updatedAt: "", installments: plan,
      });
    });
    const foreign = payment("pay_f", 50, "foreign-plan");
    await expect(registerOrderPaymentTx({ ...foreign, storeId: "other-store" })).rejects.toThrow();
    expect(await stock("p-plan")).toBe(1);
  });
});
