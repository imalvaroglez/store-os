import { describe, it, expect } from "vitest";
import {
  formatMoney,
  publicPrice,
  profit,
  parseAmount,
  pending,
} from "./money";
import type { Product } from "../types";

describe("formatMoney", () => {
  it("formats MXN with thousands separators", () => {
    expect(formatMoney(1250)).toBe("$1,250");
    expect(formatMoney(0)).toBe("$0");
    expect(formatMoney(1000000)).toBe("$1,000,000");
  });
  it("rounds fractional pesos", () => {
    expect(formatMoney(12.6)).toBe("$13");
    expect(formatMoney(12.4)).toBe("$12");
  });
  it("handles undefined/NaN", () => {
    expect(formatMoney(undefined)).toBe("$0");
    expect(formatMoney(NaN)).toBe("$0");
    expect(formatMoney(null)).toBe("$0");
  });
});

describe("publicPrice", () => {
  it("uses single price for on-demand products", () => {
    const p = { price: 500 } as Product;
    expect(publicPrice(p)).toBe(500);
  });
  it("falls back to retail for tiered products", () => {
    const p = { prices: { retail: 900, wholesale: 700, reseller: 600 } } as Product;
    expect(publicPrice(p)).toBe(900);
  });
  it("returns undefined when nothing set", () => {
    expect(publicPrice({})).toBeUndefined();
  });
});

describe("profit", () => {
  it("computes profit per quantity", () => {
    expect(profit(1000, 600, 2)).toBe(800);
  });
  it("is undefined when cost unknown", () => {
    expect(profit(1000, undefined)).toBeUndefined();
  });
});

describe("parseAmount", () => {
  it("parses plain numbers", () => {
    expect(parseAmount("100")).toBe(100);
  });
  it("returns undefined for empty", () => {
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("   ")).toBeUndefined();
  });
  it("strips non-numeric noise", () => {
    expect(parseAmount("$1,200.50")).toBe(1200.5);
  });
  it("returns undefined for garbage", () => {
    expect(parseAmount("abc")).toBeUndefined();
  });
});

describe("pending", () => {
  it("is total minus deposit", () => {
    expect(pending(1000, 300)).toBe(700);
  });
  it("never goes negative", () => {
    expect(pending(500, 800)).toBe(0);
  });
});
