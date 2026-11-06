import { describe, expect, it } from "vitest";
import {
  INHERITED_DEPOSIT_PAYMENT_ID,
  buildAdjustmentRecord,
  buildPaymentRecord,
  docReceivedCents,
  inheritedDepositRecord,
  mergePayments,
  orderMoneyAfterPayments,
  orderPaymentsFor,
  paymentSummary,
  paymentsCents,
  signedAmountCents,
} from "./payments";
import type { Order, OrderPayment } from "../../types";

const order = (overrides: Partial<Order> = {}): Order => ({
  id: "o1",
  storeId: "s1",
  customerId: "c1",
  items: [{ lineId: "l1", productName: "Arracada", quantity: 1, unitPrice: 1000, subtotal: 1000 }],
  deposit: 0,
  orderStatus: "confirmed",
  paymentStatus: "unpaid",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

const payment = (overrides: Partial<OrderPayment> = {}): OrderPayment => ({
  id: "p1",
  orderId: "o1",
  storeId: "s1",
  date: "2026-11-01",
  method: "cash",
  kind: "payment",
  amount: 200,
  createdAt: "2026-11-01T12:00:00.000Z",
  createdBy: "u1",
  ...overrides,
});

describe("building a payment record from the form", () => {
  it("coerces the raw amount through parseAmount and keeps the stable intent id", () => {
    const record = buildPaymentRecord(
      order(),
      { kind: "payment", id: "pay_a", method: "cash", amountText: " $1,010 " },
      "u1",
      "2026-11-02T10:00:00.000Z"
    );
    expect(record).toMatchObject({
      id: "pay_a",
      orderId: "o1",
      storeId: "s1",
      method: "cash",
      kind: "payment",
      amount: 1010,
      date: "2026-11-02",
      createdBy: "u1",
    });
  });

  it("accepts transfer with an explicit reception date and an optional note", () => {
    const record = buildPaymentRecord(
      order(),
      { kind: "payment", id: "pay_b", method: "transfer", date: "2026-10-31", amountText: "1010", note: " SPEI " },
      "u1",
      "2026-11-02T10:00:00.000Z"
    );
    expect(record.amount).toBe(1010);
    expect(record.date).toBe("2026-10-31");
    expect(record.note).toBe("SPEI");
  });

  it("rejects an empty or unparseable amount", () => {
    for (const bad of ["", "  ", "abc"]) {
      expect(() =>
        buildPaymentRecord(order(), { kind: "payment", id: "p", method: "cash", amountText: bad }, "u1")
      ).toThrow(/monto/i);
    }
  });

  it("rejects zero and negative payment amounts (those are adjustments, not cobros)", () => {
    for (const bad of ["0", "-50"]) {
      expect(() =>
        buildPaymentRecord(order(), { kind: "payment", id: "p", method: "cash", amountText: bad }, "u1")
      ).toThrow(/mayor a cero/i);
    }
  });

  it("rejects an invalid method and a malformed date without inventing data", () => {
    expect(() =>
      buildPaymentRecord(
        order(),
        { kind: "payment", id: "p", method: "unknown" as unknown as "cash", amountText: "10" },
        "u1"
      )
    ).toThrow(/método/i);
    expect(() =>
      buildPaymentRecord(order(), { kind: "payment", id: "p", method: "cash", date: "31-12-2026", amountText: "10" }, "u1")
    ).toThrow(/fecha/i);
  });
});

describe("received and balance (issue #123 case)", () => {
  it("$1,010 transfer + $200 cash keeps $1,210 received and the exact balance", () => {
    const o = order(); // total $1,000
    const payments = [
      payment({ id: "p1", method: "transfer", amount: 1010, date: "2026-10-31", createdAt: "2026-10-31T12:00:00.000Z" }),
      payment({ id: "p2", method: "cash", amount: 200, date: "2026-11-01" }),
    ];
    const summary = paymentSummary({ ...o, items: [{ lineId: "l1", productName: "Caja adviento", quantity: 1, unitPrice: 1500, subtotal: 1500 }] }, payments);
    expect(summary.totalCents).toBe(150000);
    expect(summary.receivedCents).toBe(121000);
    expect(summary.balanceCents).toBe(29000);
  });

  it("$400 over a $1,000 order leaves a $600 balance", () => {
    const summary = paymentSummary(order(), [payment({ amount: 400 })]);
    expect(summary.totalCents).toBe(100000);
    expect(summary.receivedCents).toBe(40000);
    expect(summary.balanceCents).toBe(60000);
  });

  it("sums in exact cents — never floating point", () => {
    const payments = [payment({ amount: 0.1 }), payment({ amount: 0.2 })];
    expect(paymentsCents(payments)).toBe(30);
  });

  it("ignores corrupt non-finite amounts instead of writing NaN", () => {
    const payments = [payment({ amount: Number.NaN }), payment({ amount: 5 })];
    expect(paymentsCents(payments)).toBe(500);
  });

  it("treats an amount beyond safe cents precision as corrupt (excluded, no RangeError)", () => {
    // #168 F5: a garbage stored amount must never crash the render with the
    // RangeError orderAmountCents throws — it is excluded, like any corrupt data.
    const payments = [payment({ amount: 9.5e13 }), payment({ amount: 5 })];
    expect(paymentsCents(payments)).toBe(500);
  });
});

describe("doc-level money truth (#168: the accumulator on the order document)", () => {
  it("docReceivedCents reads the accumulator — no session records involved", () => {
    expect(docReceivedCents(order({ paymentsReceivedCents: 150000 }))).toBe(150000);
  });

  it("an unmaterialized legacy deposit still counts on top of the accumulator", () => {
    expect(docReceivedCents(order({ deposit: 400, paymentsReceivedCents: 10000 }))).toBe(50000);
  });

  it("once materialized (marker set) the deposit is never counted twice", () => {
    // The accumulator already contains the inherited record's cents.
    expect(docReceivedCents(order({ deposit: 400, paymentsReceivedCents: 50000, inheritedDepositMaterialized: true }))).toBe(50000);
  });

  it("absent accumulator + zero deposit reads as zero; corrupt fields read as zero, never NaN", () => {
    expect(docReceivedCents(order())).toBe(0);
    expect(docReceivedCents(order({ paymentsReceivedCents: Number.NaN, deposit: Number.NaN }))).toBe(0);
  });

  it("orderMoneyAfterPayments adds the saved cents and flips the materialization marker once", () => {
    const money = orderMoneyAfterPayments(order({ deposit: 400 }), 20000, true);
    expect(money).toEqual({ paymentsReceivedCents: 20000, inheritedDepositMaterialized: true });
    // A later abono adds on top; the marker stays set.
    const later = orderMoneyAfterPayments({ paymentsReceivedCents: 20000, inheritedDepositMaterialized: true }, 10000, false);
    expect(later).toEqual({ paymentsReceivedCents: 30000, inheritedDepositMaterialized: true });
    // No inherited materialization → the marker is not invented.
    expect(orderMoneyAfterPayments(order(), 10000, false)).toEqual({ paymentsReceivedCents: 10000 });
  });
});

describe("total changes with registered payments (decision iv)", () => {
  it("keeps the payments intact and recomputes the balance against the new total", () => {
    const payments = [payment({ amount: 400 })];
    // The total drops to $300 after the edit; the $400 stays as evidence.
    const lowered = paymentSummary(
      order({ items: [{ lineId: "l1", productName: "Arracada", quantity: 1, unitPrice: 300, subtotal: 300 }] }),
      payments
    );
    expect(lowered.receivedCents).toBe(40000);
    expect(lowered.balanceCents).toBe(-10000); // a favor de la clienta
    expect(lowered.records).toHaveLength(1);
  });
});

describe("adjustments keep the evidence (decision iii)", () => {
  it("builds a signed adjustment with a required note", () => {
    const record = buildAdjustmentRecord(order(), { kind: "adjustment", id: "adj1", direction: "subtract", amountText: "150", note: " Devolución en efectivo " }, "u1", "2026-11-02T10:00:00.000Z");
    expect(record).toMatchObject({ id: "adj1", kind: "adjustment", method: "unknown", amount: -150, note: "Devolución en efectivo", date: "2026-11-02" });
  });

  it("rejects a zero adjustment or one without a note", () => {
    expect(() => buildAdjustmentRecord(order(), { kind: "adjustment", id: "a", direction: "subtract", amountText: "0", note: "motivo" }, "u1")).toThrow(/cero/i);
    expect(() => buildAdjustmentRecord(order(), { kind: "adjustment", id: "a", direction: "subtract", amountText: "10", note: "  " }, "u1")).toThrow(/motivo/i);
  });

  it("a refund subtracts from received without deleting any record", () => {
    const payments = [payment({ amount: 400 }), payment({ id: "adj", kind: "adjustment", amount: -150, note: "Devolución", method: "unknown", date: undefined, createdAt: "2026-11-03T12:00:00.000Z" })];
    const summary = paymentSummary(order(), payments);
    expect(summary.receivedCents).toBe(25000);
    expect(summary.balanceCents).toBe(75000);
    expect(summary.records).toHaveLength(2);
    expect(summary.records.map((p) => p.id)).toEqual(["p1", "adj"]);
  });
});

describe("inherited deposit (decision i)", () => {
  it("an unmaterialized legacy deposit counts as received, flagged as pending", () => {
    const summary = paymentSummary(order({ deposit: 400 }), []);
    expect(summary.receivedCents).toBe(40000);
    expect(summary.inheritedPendingCents).toBe(40000);
    expect(summary.records).toHaveLength(0);
  });

  it("builds the inherited record with the operator-supplied date/method (PO 2026-11-03)", () => {
    const record = inheritedDepositRecord("o1", "s1", 400, "u1", { method: "cash", date: "2026-10-20" }, "2026-11-02T10:00:00.000Z");
    expect(record).toMatchObject({
      id: INHERITED_DEPOSIT_PAYMENT_ID,
      orderId: "o1",
      storeId: "s1",
      date: "2026-10-20",
      method: "cash",
      kind: "payment",
      amount: 400,
    });
  });

  it("rejects materialization without a real method or a valid date", () => {
    expect(() => inheritedDepositRecord("o1", "s1", 400, "u1", { method: "unknown" as unknown as "cash", date: "2026-10-20" })).toThrow(/método del anticipo/i);
    expect(() => inheritedDepositRecord("o1", "s1", 400, "u1", { method: "cash", date: "" })).toThrow(/fecha del anticipo/i);
    expect(() => inheritedDepositRecord("o1", "s1", 400, "u1", { method: "cash", date: "20-10-2026" })).toThrow(/fecha del anticipo/i);
  });

  it("returns null for a zero deposit so nothing phantom is registered", () => {
    expect(inheritedDepositRecord("o1", "s1", 0, "u1", { method: "cash", date: "2026-10-20" })).toBeNull();
  });

  it("once materialized, the deposit counts once — never twice", () => {
    const inherited = payment({
      id: INHERITED_DEPOSIT_PAYMENT_ID,
      method: "unknown",
      amount: 400,
      date: undefined,
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    const more = payment({ id: "p2", amount: 100, createdAt: "2026-11-02T00:00:00.000Z" });
    const summary = paymentSummary(order({ deposit: 400 }), [inherited, more]);
    expect(summary.inheritedPendingCents).toBe(0);
    expect(summary.receivedCents).toBe(50000); // 400 inherited + 100, not 900
  });
});

describe("store isolation", () => {
  it("payments never cross stores or orders", () => {
    const mine = payment({ id: "mine", orderId: "o1", storeId: "s1", amount: 100 });
    const foreignStore = payment({ id: "f1", orderId: "o1", storeId: "s2", amount: 999 });
    const foreignOrder = payment({ id: "f2", orderId: "o2", storeId: "s1", amount: 888 });
    const scoped = orderPaymentsFor([mine, foreignStore, foreignOrder], "o1", "s1");
    expect(scoped.map((p) => p.id)).toEqual(["mine"]);
  });

  it("a foreign payment never reaches another order's summary", () => {
    const summary = paymentSummary(order(), [payment({ orderId: "o2", storeId: "s1", amount: 999 })]);
    expect(summary.receivedCents).toBe(0);
  });
});

describe("merging loaded payments", () => {
  it("dedupes by id, replacing instead of duplicating", () => {
    const a = payment({ id: "p1", amount: 100 });
    const b = payment({ id: "p2", amount: 200 });
    const replaced = payment({ id: "p1", amount: 150 });
    expect(mergePayments([a, b], [replaced, b])).toEqual([replaced, b]);
    const fresh = payment({ id: "p3", amount: 300 });
    expect(mergePayments([a, b], [fresh])).toHaveLength(3);
  });
});


describe("safe transactional payment totals (#171)", () => {
  it("normalizes sub-cent negative amounts to integer zero for Firestore", () => {
    expect(Object.is(signedAmountCents(-1e-7), -0)).toBe(false);
  });
  it("rejects overflow rather than persisting an imprecise balance", () => {
    expect(() => orderMoneyAfterPayments({ paymentsReceivedCents: Number.MAX_SAFE_INTEGER }, 1, false)).toThrow(RangeError);
  });
  it("rejects corrupt accumulated cents and fractional deltas instead of silently repairing money", () => {
    for (const acc of [Number.NaN, Number.POSITIVE_INFINITY, 0.5]) {
      expect(() => orderMoneyAfterPayments({ paymentsReceivedCents: acc }, 100, false)).toThrow(RangeError);
    }
    expect(() => orderMoneyAfterPayments({}, 0.5, false)).toThrow(RangeError);
  });
});


describe("canonical balance while receipt details load", () => {
  it("keeps received money from the order instead of showing zero for an empty session", () => {
    expect(paymentSummary(order({ paymentsReceivedCents: 40000 }), []).receivedCents).toBe(40000);
  });
});


describe("explicit adjustment direction (#218)", () => {
  it.each([["subtract", "150", -150], ["add", "80", 80]] as const)("%s signs a positive amount", (direction, amountText, expected) => {
    expect(buildAdjustmentRecord(order(), { kind: "adjustment", id: "a", direction, amountText, note: "Corrección" }, "u1").amount).toBe(expected);
  });
  it.each(["-150", "+80", "0", "-0", "1-2"])("rejects signed or nonpositive input %s", (amountText) => {
    expect(() => buildAdjustmentRecord(order(), { kind: "adjustment", id: "a", direction: "subtract", amountText, note: "Corrección" }, "u1")).toThrow();
  });
});
