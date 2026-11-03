import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";
import type { Order, OrderPayment } from "../../types";

const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: holder.db }) }));
import {
  DeliveryWithBalanceError,
  OrderEvidenceDeletionError,
  deleteOrderWithStockTx,
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
      await setDoc(doc(ctx.firestore(), "products/p-conv"), { storeId: "tx-store", quantityOnHand: 1 });
    });
    holder.db = env.authenticatedContext("tx-user").firestore();
  });
  afterAll(async () => { await env?.cleanup(); });

  it("a plan order reserves AT CREATION exactly like an ordinary one (PO 2026-11-03 R8)", async () => {
    await saveOrderWithStockTx(user, makeOrder("plan-order", "p-plan", 2, { installments: plan }), null, "create-1");
    expect(await stock("p-plan")).toBe(3); // apartadas desde la creación
    await saveOrderWithStockTx(user, makeOrder("ordinary-order", "p-plan", 1), null, "create-2");
    expect(await stock("p-plan")).toBe(2);
  });

  it("abonos never move stock; the first positive one stamps the money-backed witness (R8)", async () => {
    const saved = await registerOrderPaymentTx(payment("pay_a", 100));
    expect(saved.payments).toHaveLength(1);
    expect(await stock("p-plan")).toBe(2); // sin movimiento de stock (R8)
    expect((await orderDoc("plan-order"))?.installmentsReservedAt).toBeTruthy();
    expect((await orderDoc("plan-order"))?.revision).toBe(1); // sin bump: la reserva ya vivió en la creación

    // Double click: same intent id → recognized, no second write.
    await registerOrderPaymentTx(payment("pay_a", 100));
    expect(await stock("p-plan")).toBe(2);
    expect(await paymentCount("plan-order")).toBe(1);

    // A later abono does not touch stock either — the doc accumulator grows.
    await registerOrderPaymentTx(payment("pay_b", 500));
    expect(await stock("p-plan")).toBe(2);
    expect(await paymentCount("plan-order")).toBe(2);
    expect((await orderDoc("plan-order"))?.paymentsReceivedCents).toBe(60000);

    // Concurrent abonos that together liquidan: both register, no stock effect.
    await Promise.all([
      registerOrderPaymentTx(payment("pay_c", 600)),
      registerOrderPaymentTx(payment("pay_d", 600)),
    ]);
    expect(await stock("p-plan")).toBe(2);
    expect(await paymentCount("plan-order")).toBe(4); // a + b + c + d = $1,800
    expect((await orderDoc("plan-order"))?.paymentsReceivedCents).toBe(180000);
  });

  it("cancelling a reserved plan order does not release the pieces (money was received)", async () => {
    const current = (await orderDoc("plan-order"))!;
    const cancelled = makeOrder("plan-order", "p-plan", 2, {
      installments: plan,
      installmentsReservedAt: current.installmentsReservedAt,
      orderStatus: "cancelled",
      revision: current.revision,
    });
    await saveOrderWithStockTx(user, cancelled, current.revision, "cancel-1");
    expect(await stock("p-plan")).toBe(2); // sigue apartada
  });

  it("delivers a liquidated plan order from a session with NO records — the doc accumulator is the truth", async () => {
    const current = (await orderDoc("plan-order"))!;
    const owing = makeOrder("plan-order", "p-plan", 2, {
      installments: plan,
      installmentsReservedAt: current.installmentsReservedAt,
      orderStatus: "ready",
      revision: current.revision,
    });
    await saveOrderWithStockTx(user, owing, current.revision, "ready-1");
    const ready = (await orderDoc("plan-order"))!;
    const delivering = { ...owing, revision: ready.revision, orderStatus: "delivered" as const };

    // plan-order is fully liquidated on the doc ($1,800 of cobros = total):
    // #168 — there is no session view anymore; the delivery confirmation reads
    // the accumulated money from the order document itself.
    const result = await saveOrderWithStockTx(user, delivering, ready.revision, "deliver-liquidated");
    expect(result.order.orderStatus).toBe("delivered");
    expect(await stock("p-plan")).toBe(2); // entregado conserva el consumo
  });

  it("removing the plan with saldo does not enable delivering in the same save (#168 F1)", async () => {
    // A plan order with $100 of $900 received (reserved at the first abono).
    await saveOrderWithStockTx(user, makeOrder("gate-order", "p-plan", 1, { installments: plan }), null, "gate-create");
    expect(await stock("p-plan")).toBe(1); // apartada desde la creación (R8)
    await registerOrderPaymentTx(payment("pay_g", 100, "gate-order"));
    expect(await stock("p-plan")).toBe(1); // el abono no mueve stock
    expect((await orderDoc("gate-order"))?.paymentsReceivedCents).toBe(10000);

    // Unchecking "Pagos por partes" + Estado=Entregado in the SAME save must
    // still hit the delivery gate: money was received against these pieces.
    const marked = (await orderDoc("gate-order"))!;
    const planRemoved = makeOrder("gate-order", "p-plan", 1, { revision: marked.revision, orderStatus: "delivered" });
    await expect(
      saveOrderWithStockTx(user, planRemoved, marked.revision, "gate-deliver")
    ).rejects.toBeInstanceOf(DeliveryWithBalanceError);
    expect((await orderDoc("gate-order"))?.orderStatus).toBe("asked"); // sin cambio
    expect(await stock("p-plan")).toBe(1); // las piezas siguen apartadas

    // Liquidando (doc acumulado ≥ total) la entrega SÍ procede, ya sin plan.
    await registerOrderPaymentTx(payment("pay_h", 800, "gate-order"));
    const liquidated = (await orderDoc("gate-order"))!;
    const deliver = makeOrder("gate-order", "p-plan", 1, { revision: liquidated.revision, orderStatus: "delivered" });
    const ok = await saveOrderWithStockTx(user, deliver, liquidated.revision, "gate-deliver-2");
    expect(ok.order.orderStatus).toBe("delivered");
    expect(await stock("p-plan")).toBe(1); // entregado conserva el consumo
  });

  it("delivering with saldo is allowed ONLY with the recorded confirmation (PO 2026-11-03 R9)", async () => {
    await saveOrderWithStockTx(user, makeOrder("confirm-order", "p-plan", 1, { installments: plan }), null, "confirm-create");
    await registerOrderPaymentTx(payment("pay_q", 100, "confirm-order"));
    const marked = (await orderDoc("confirm-order"))!;
    const delivering = makeOrder("confirm-order", "p-plan", 1, {
      revision: marked.revision, orderStatus: "delivered",
      installmentsReservedAt: marked.installmentsReservedAt,
    });
    // Without confirmation the gate still rejects — never a silent pass.
    await expect(
      saveOrderWithStockTx(user, delivering, marked.revision, "confirm-deliver-1")
    ).rejects.toBeInstanceOf(DeliveryWithBalanceError);
    // With the explicit confirmation the delivery lands AND is recorded.
    const confirmed = await saveOrderWithStockTx(user, delivering, marked.revision, "confirm-deliver-2", {
      confirmDeliveredWithBalance: true,
    });
    expect(confirmed.order.orderStatus).toBe("delivered");
    expect(confirmed.order.deliveredWithBalanceCents).toBeGreaterThan(0);
    expect(confirmed.order.deliveredWithBalanceConfirmedBy).toBe(user.uid);
  });

  it("converting an order that already received money keeps the pieces apartadas (#168 F2/C1)", async () => {
    // Ordinary open order (already holds 1 piece) that received a cobro: the
    // accumulator lives on the DOC, so a session that never loaded the cobros
    // still sees the money and marks the reservation. Own product: independent
    // of the p-plan ledger shared by the earlier tests.
    const ordinary = makeOrder("convert-order", "p-conv", 1);
    await saveOrderWithStockTx(user, ordinary, null, "convert-create");
    expect(await stock("p-conv")).toBe(0); // 1 − 1 de la orden ordinaria
    await registerOrderPaymentTx(payment("seed_1", 400, "convert-order"));
    const snapshot = (await orderDoc("convert-order"))!;
    expect(snapshot.paymentsReceivedCents).toBe(40000);
    const converted = makeOrder("convert-order", "p-conv", 1, {
      installments: plan,
      revision: snapshot.revision,
    });
    const result = await saveOrderWithStockTx(user, converted, snapshot.revision, "convert-plan");
    expect(result.order.installmentsReservedAt).toBeTruthy();
    expect(await stock("p-conv")).toBe(0); // sin liberar: ya había dinero
  });

  it("converting an order whose only received money is the legacy deposit also marks (#168 F2)", async () => {
    // Manual line (no productId → no stock involvement) with a stored deposit.
    const depositOrder = makeOrder("convert-deposit", "", 0, {
      items: [{ lineId: "l1", productName: "Encargo manual", quantity: 1, unitPrice: 500, subtotal: 500 }],
      deposit: 400,
    });
    await saveOrderWithStockTx(user, depositOrder, null, "convert-dep-create");
    const snapshot = (await orderDoc("convert-deposit"))!;
    const converted = makeOrder("convert-deposit", "", 0, {
      items: depositOrder.items,
      deposit: 400,
      installments: plan,
      revision: snapshot.revision,
    });
    const result = await saveOrderWithStockTx(user, converted, snapshot.revision, "convert-dep-plan");
    expect(result.order.installmentsReservedAt).toBeTruthy(); // depósito = dinero recibido
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
    // The rejected payment must not move anyone's stock.
    expect(await stock("p-plan")).toBe(-1); // ledger: 5 −2 plan −1 ordinary −1 gate −1 confirm
  });

  it("keeps reserved stock and evidence through edits, plan removal and rejected deletion (#171 C2/C4)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/p-res-edit"), { storeId: "tx-store", quantityOnHand: 3 });
    });
    const created = await saveOrderWithStockTx(user, makeOrder("res-edit", "p-res-edit", 2, { installments: plan }), null, "res-create");
    await registerOrderPaymentTx(payment("res-first", 100, "res-edit"));
    const reserved = (await orderDoc("res-edit"))!;
    expect(await stock("p-res-edit")).toBe(1);
    // A stale form can omit the mark; the canonical document must preserve it.
    const tooLarge = { ...created.order, items: makeOrder("res-edit", "p-res-edit", 4).items };
    await expect(saveOrderWithStockTx(user, tooLarge, reserved.revision, "res-too-large")).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await stock("p-res-edit")).toBe(1);
    expect((await orderDoc("res-edit"))?.revision).toBe(reserved.revision);
    expect(await paymentCount("res-edit")).toBe(1);

    const expanded = await saveOrderWithStockTx(user, { ...created.order, items: makeOrder("res-edit", "p-res-edit", 3).items }, reserved.revision, "res-expand");
    expect(await stock("p-res-edit")).toBe(0);
    expect(expanded.order.installmentsReservedAt).toBe(reserved.installmentsReservedAt);
    const cancelled = await saveOrderWithStockTx(user, { ...expanded.order, installments: undefined, installmentsReservedAt: undefined, orderStatus: "cancelled" }, expanded.order.revision!, "res-no-plan");
    expect(cancelled.order.installmentsReservedAt).toBe(reserved.installmentsReservedAt);
    expect(await stock("p-res-edit")).toBe(0);
    await expect(deleteOrderWithStockTx(user, "res-edit", cancelled.order.revision!)).rejects.toBeInstanceOf(OrderEvidenceDeletionError);
    await expect(deleteDoc(doc(holder.db, "orders/res-edit"))).rejects.toThrow();
    // A raw client cannot first erase the fields and then delete the parent.
    await expect(updateDoc(doc(holder.db, "orders/res-edit"), { installmentsReservedAt: deleteField(), paymentsReceivedCents: deleteField() })).rejects.toThrow();
    await expect(updateDoc(doc(holder.db, "orders/res-edit"), { installmentsReservedAt: "replacement" })).rejects.toThrow();
    expect((await orderDoc("res-edit"))?.revision).toBe(cancelled.order.revision);
    expect(await stock("p-res-edit")).toBe(0);
    expect(await paymentCount("res-edit")).toBe(1);
  });

  it("preserves a net-zero payment history when deleting an ordinary order (#171 C2)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/p-res-zero"), { storeId: "tx-store", quantityOnHand: 5 });
    });
    const created = await saveOrderWithStockTx(user, makeOrder("res-zero-history", "p-res-zero", 1), null, "zero-create");
    await registerOrderPaymentTx(payment("zero-paid", 100, "res-zero-history"));
    await registerOrderPaymentTx({ ...payment("zero-adjust", -100, "res-zero-history"), kind: "adjustment", note: "Corrección del cobro" });
    expect((await orderDoc("res-zero-history"))?.paymentsReceivedCents).toBe(0);
    await expect(deleteOrderWithStockTx(user, "res-zero-history", created.order.revision!)).rejects.toBeInstanceOf(OrderEvidenceDeletionError);
    await expect(deleteDoc(doc(holder.db, "orders/res-zero-history"))).rejects.toThrow();
    await expect(updateDoc(doc(holder.db, "orders/res-zero-history"), { paymentsReceivedCents: deleteField() })).rejects.toThrow();
    expect(await paymentCount("res-zero-history")).toBe(2);
  });

  it("concurrent expansions compete for canonical stock without overselling (#171 C4)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/p-res-race"), { storeId: "tx-store", quantityOnHand: 5 });
    });
    for (const id of ["res-race-a", "res-race-b"]) {
      await saveOrderWithStockTx(user, makeOrder(id, "p-res-race", 2, { installments: plan }), null, `${id}-create`);
      await registerOrderPaymentTx(payment(`${id}-pay`, 100, id));
    }
    expect(await stock("p-res-race")).toBe(1);
    const results = await Promise.allSettled(["res-race-a", "res-race-b"].map(async (id) => {
      const current = (await orderDoc(id))!;
      return saveOrderWithStockTx(user, makeOrder(id, "p-res-race", 3, { installments: plan }), current.revision, `${id}-expand`);
    }));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(InsufficientStockError);
    expect(await stock("p-res-race")).toBe(0);
    expect(await paymentCount("res-race-a")).toBe(1);
    expect(await paymentCount("res-race-b")).toBe(1);
  });

  it("ignores caller-invented money and reservation fields on creation (#171)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "products/p-res-forged"), { storeId: "tx-store", quantityOnHand: 5 });
    });
    const saved = await saveOrderWithStockTx(user, makeOrder("res-forged", "p-res-forged", 1, {
      installments: plan, installmentsReservedAt: "invented", paymentsReceivedCents: 90000, inheritedDepositMaterialized: true,
    }), null, "res-forged-create");
    expect(saved.order.installmentsReservedAt).toBeUndefined();
    expect(saved.order.paymentsReceivedCents).toBeUndefined();
    expect(saved.order.inheritedDepositMaterialized).toBeUndefined();
    expect(await stock("p-res-forged")).toBe(4); // R8: la creación aparta 1 pieza
    expect(await paymentCount("res-forged")).toBe(0);
    await expect(saveOrderWithStockTx(user, { ...saved.order, orderStatus: "delivered", paymentsReceivedCents: 90000 }, saved.order.revision!, "res-forged-deliver")).rejects.toBeInstanceOf(DeliveryWithBalanceError);
    expect((await orderDoc("res-forged"))?.orderStatus).toBe("asked");
    expect(await stock("p-res-forged")).toBe(4);
  });

});
