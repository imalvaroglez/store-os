import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "./auth";
import type { Order } from "../../types";

const tx = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), update: vi.fn() }));
vi.mock("./config", () => ({ getFirebase: () => ({ db: {} }) }));
vi.mock("firebase/firestore", async (original) => ({
  ...await original<typeof import("firebase/firestore")>(),
  doc: vi.fn(() => ({})),
  runTransaction: vi.fn((_db, run) => run(tx)),
}));
import { saveOrderWithStockTx } from "./firestoreData";
import { paymentStatusForOrder } from "../../lib/orders";
import { docReceivedCents } from "../../lib/orderMoney";

const order: Order = {
  id: "deposit-218", storeId: "s1", customerId: "c1", deposit: 0,
  items: [{ productName: "Pieza", quantity: 1, unitPrice: 720, subtotal: 720 }],
  orderStatus: "confirmed", paymentStatus: "unpaid", createdAt: "", updatedAt: "",
};
const user = { uid: "u1", role: "member" } as AppUser;
beforeEach(() => vi.clearAllMocks());

describe("canonical legacy deposit on full saves (#218)", () => {
  it.each([
    { name: "prevents a phantom after a 590 receipt", raw: { deposit: 0, paymentsReceivedCents: 59000 }, requested: 590, expected: 0 },
    { name: "allows repair by lowering an unmaterialized deposit", raw: { deposit: 590, paymentsReceivedCents: 59000 }, requested: 0, expected: 0 },
    { name: "pins even a net-zero accumulator", raw: { deposit: 0, paymentsReceivedCents: 0 }, requested: 590, expected: 0 },
    { name: "freezes a materialized deposit", raw: { deposit: 590, paymentsReceivedCents: 59000, inheritedDepositMaterialized: true }, requested: 0, expected: 590 },
    { name: "freezes a marker even without an accumulator", raw: { deposit: 590, inheritedDepositMaterialized: true }, requested: 720, expected: 590 },
    { name: "allows edits without payment evidence", raw: { deposit: 0 }, requested: 590, expected: 590 },
    { name: "uses raw zero rather than a migrated paid total", raw: { deposit: 0, status: "paid", orderStatus: undefined, paymentsReceivedCents: 59000 }, requested: 720, expected: 0 },
    { name: "defaults an absent raw deposit to zero", raw: { deposit: undefined, paymentsReceivedCents: 59000 }, requested: 590, expected: 0 },
  ])("$name", async ({ raw, requested, expected }) => {
    tx.get.mockResolvedValue({ exists: () => true, data: () => ({ ...order, ...raw }) });
    // #271: a lowering with evidence now carries its signed motive (ignored
    // by the non-lowering cases).
    const result = await saveOrderWithStockTx(user, { ...order, deposit: requested, paymentStatus: "paid" }, 0, "edit", { depositCorrectionNote: "Depósito duplicado: el cobro ya lo cubre" });
    expect(result.order.deposit).toBe(expected);
    expect(result.order.paymentStatus).toBe(paymentStatusForOrder(result.order));
    expect(tx.set.mock.calls[0][1].deposit).toBe(expected);
    if (expected === 0 && raw.paymentsReceivedCents === 59000) expect(docReceivedCents(result.order)).toBe(59000);
    // The signed record lands exactly on the lowering case.
    if (raw.deposit !== undefined && requested < raw.deposit && raw.paymentsReceivedCents !== undefined && !raw.inheritedDepositMaterialized) {
      expect(result.order.depositCorrections).toEqual([
        expect.objectContaining({ from: raw.deposit, to: expected, note: "Depósito duplicado: el cobro ya lo cubre", by: user.uid }),
      ]);
    } else {
      expect(result.order.depositCorrections).toBeUndefined();
    }
  });

  it("preserves an actual legacy deposit after an adjustment-first record", async () => {
    tx.get.mockResolvedValue({ exists: () => true, data: () => ({ ...order, deposit: 590, paymentsReceivedCents: 1000 }) });
    const result = await saveOrderWithStockTx(user, { ...order, deposit: 590 }, 0, "edit");
    expect(docReceivedCents(result.order)).toBe(60000);
  });

  it("allows a new order's deposit without accepting forged evidence", async () => {
    tx.get.mockResolvedValue({ exists: () => false, data: () => undefined });
    const result = await saveOrderWithStockTx(user, { ...order, deposit: 590 }, null, "create");
    expect(result.order.deposit).toBe(590);
  });
});
