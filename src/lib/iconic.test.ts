import { describe, expect, it } from "vitest";
import type { Customer, Order } from "../types";
import { ICONIC_MIN_TOTAL, ICONIC_NOTICE_DAYS, iconicStatus } from "./iconic";

// FER-05: Iconic benefit — 30-day mobile windows renewed by qualifying orders,
// plus an optional manual grant. All rules derive from SAVED dates.
//
// Fixed clock: 2026-11-02T18:00:00Z = 12:00 Mexico City (flat UTC-6), so every
// fixture instant lands mid-day MX and calendar-day math stays exact.

const NOW = new Date("2026-11-02T18:00:00.000Z");
const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS).toISOString();

const customer = (patch: Partial<Customer> = {}): Customer => ({
  id: "c1",
  storeId: "s1",
  name: "Mar",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  ...patch,
});

const order = (patch: Partial<Order> = {}): Order => ({
  id: "o1",
  storeId: "s1",
  customerId: "c1",
  items: [{ lineId: "L0", productName: "Collar", quantity: 2, unitPrice: 600, subtotal: 1200 }],
  deposit: 0,
  orderStatus: "delivered",
  paymentStatus: "unpaid",
  createdAt: daysAgo(10),
  updatedAt: daysAgo(10),
  schemaVersion: 2,
  ...patch,
});

describe("iconic activation", () => {
  it("a first order strictly above $1,000 activates Iconic for 30 days from that order", () => {
    const status = iconicStatus(customer(), [order()], NOW);
    expect(status).toEqual({
      active: true,
      since: "2026-10-23", // the order's own saved date (10 days before NOW)
      until: "2026-11-22", // order date + 30 days
      daysLeft: 20, // calendar days from NOW (Nov 2) to the expiry (Nov 22)
      expiringSoon: false,
      manual: false,
      fromOrders: true,
    });
  });

  it("an order captured but not yet paid/delivered counts (capture is the event)", () => {
    const status = iconicStatus(customer(), [order({ orderStatus: "asked", paymentStatus: "unpaid" })], NOW);
    expect(status?.active).toBe(true);
  });

  it("exactly $1,000 does NOT qualify ('supere'); $1,000.01 does", () => {
    const exact = order({ items: [{ lineId: "L0", productName: "Collar", quantity: 1, unitPrice: 1000, subtotal: 1000 }] });
    expect(iconicStatus(customer(), [exact], NOW)).toBeNull();
    const cent = order({ items: [{ lineId: "L0", productName: "Collar", quantity: 1, unitPrice: 1000.01, subtotal: 1000.01 }] });
    expect(iconicStatus(customer(), [cent], NOW)?.active).toBe(true);
    expect(ICONIC_MIN_TOTAL).toBe(1000);
  });

  it("a legacy flat order (no items[]) still qualifies via its saved total", () => {
    const legacy = {
      id: "o_old",
      storeId: "s1",
      customerId: "c1",
      productId: "p1",
      productName: "Aretes",
      quantity: 2,
      price: 600,
      deposit: 0,
      status: "delivered",
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
    } as unknown as Order;
    expect(iconicStatus(customer(), [legacy], NOW)?.active).toBe(true);
  });
});

describe("iconic renewal (30-day mobile window)", () => {
  it("a qualifying order inside the window renews it: new expiry = renewal date + 30 days", () => {
    const activation = order({ id: "o_a", createdAt: daysAgo(25), updatedAt: daysAgo(25) });
    const renewal = order({ id: "o_b", createdAt: daysAgo(5), updatedAt: daysAgo(5) });
    const status = iconicStatus(customer(), [activation, renewal], NOW);
    expect(status?.active).toBe(true);
    expect(status?.since).toBe("2026-10-08"); // original activation date
    expect(status?.until).toBe("2026-11-27"); // 5 days ago + 30 days
  });

  it("a qualifying order AFTER the window lapsed starts a fresh window (re-activation)", () => {
    const old = order({ id: "o_a", createdAt: daysAgo(40), updatedAt: daysAgo(40) });
    const fresh = order({ id: "o_b", createdAt: daysAgo(2), updatedAt: daysAgo(2) });
    const status = iconicStatus(customer(), [old, fresh], NOW);
    expect(status?.active).toBe(true);
    expect(status?.since).toBe("2026-10-31"); // the new window starts at the new order
    expect(status?.until).toBe("2026-11-30");
  });

  it("a lapsed window reports inactive with the date it expired", () => {
    const status = iconicStatus(customer(), [order({ createdAt: daysAgo(40), updatedAt: daysAgo(40) })], NOW);
    expect(status?.active).toBe(false);
    expect(status?.until).toBe("2026-10-23"); // 40 days ago + 30 days
    expect(status?.expiringSoon).toBe(false);
  });

  it("cancelled orders never count: they do not activate nor renew", () => {
    expect(iconicStatus(customer(), [order({ orderStatus: "cancelled" })], NOW)).toBeNull();
    const activation = order({ id: "o_a", createdAt: daysAgo(20), updatedAt: daysAgo(20) });
    const cancelled = order({ id: "o_b", orderStatus: "cancelled", createdAt: daysAgo(5), updatedAt: daysAgo(5) });
    const status = iconicStatus(customer(), [activation, cancelled], NOW);
    expect(status?.until).toBe("2026-11-12"); // activation + 30 days, unchanged
  });
});

describe("iconic manual grant (union with the automatic window)", () => {
  it("a manual validity alone keeps Iconic active", () => {
    const c = customer({ iconic: { since: "2026-10-23", until: "2026-11-22" } });
    const status = iconicStatus(c, [], NOW);
    expect(status?.active).toBe(true);
    expect(status?.manual).toBe(true);
    expect(status?.fromOrders).toBe(false);
    expect(status?.until).toBe("2026-11-22");
  });

  it("effective validity is the latest of manual and automatic windows", () => {
    const c = customer({ iconic: { since: "2026-11-01", until: "2026-11-25" } });
    const status = iconicStatus(c, [order()], NOW); // order window ends 2026-11-22
    expect(status?.until).toBe("2026-11-25");
    expect(status?.manual).toBe(true);
    expect(status?.fromOrders).toBe(true);
  });

  it("a lapsed manual grant is inactive", () => {
    const c = customer({ iconic: { since: "2026-09-01", until: "2026-10-28" } });
    const status = iconicStatus(c, [], NOW);
    expect(status?.active).toBe(false);
  });

  it("invalid or partial manual data is ignored, never thrown", () => {
    expect(iconicStatus(customer({ iconic: { since: "nope", until: "2026-11-22" } }), [], NOW)).toBeNull();
    expect(iconicStatus(customer({ iconic: { since: "2026-11-22", until: "2026-11-01" } }), [], NOW)).toBeNull();
  });
});

describe("advance notice (aviso previo)", () => {
  it("expires within the notice window: 7 calendar days left flags expiringSoon", () => {
    const status = iconicStatus(customer(), [order({ createdAt: daysAgo(23), updatedAt: daysAgo(23) })], NOW);
    expect(ICONIC_NOTICE_DAYS).toBe(7);
    expect(status?.daysLeft).toBe(7);
    expect(status?.active).toBe(true);
    expect(status?.expiringSoon).toBe(true);
  });

  it("expiring today still counts as active with daysLeft 0", () => {
    const status = iconicStatus(customer(), [order({ createdAt: daysAgo(30), updatedAt: daysAgo(30) })], NOW);
    expect(status?.active).toBe(true);
    expect(status?.daysLeft).toBe(0);
    expect(status?.expiringSoon).toBe(true);
  });

  it("the notice window is a parameter: a wider window flags earlier", () => {
    const status = iconicStatus(customer(), [order({ createdAt: daysAgo(10), updatedAt: daysAgo(10) })], NOW);
    expect(status?.expiringSoon).toBe(false); // 20 days left, default 7
    expect(iconicStatus(customer(), [order()], NOW, 21)?.expiringSoon).toBe(true);
  });
});

describe("store isolation and defensive data", () => {
  it("an order from another store never counts, even with the same customerId", () => {
    const foreign = order({ storeId: "s2", items: [{ lineId: "L0", productName: "X", quantity: 1, unitPrice: 1500, subtotal: 1500 }] });
    expect(iconicStatus(customer(), [foreign], NOW)).toBeNull();
  });

  it("a customer with no qualifying history has no Iconic status at all", () => {
    expect(iconicStatus(customer(), [], NOW)).toBeNull();
    const small = order({ items: [{ lineId: "L0", productName: "X", quantity: 1, unitPrice: 999.99, subtotal: 999.99 }] });
    expect(iconicStatus(customer(), [small], NOW)).toBeNull();
  });

  it("orders with unusable dates are skipped instead of producing NaN", () => {
    const corrupt = order({ createdAt: "not-a-date" });
    expect(iconicStatus(customer(), [corrupt], NOW)).toBeNull();
  });
});
