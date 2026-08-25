import { describe, expect, it } from "vitest";
import { cartReducer, cartTotal, type CartLine } from "./useCart";
import { createCartCheckoutUrl, cartCheckoutMessage } from "../../../lib/whatsapp";

const line = (o: Partial<CartLine> = {}): CartLine => ({
  productSlug: "arete-x",
  name: "Arete X",
  price: 150,
  ...o,
});

describe("cartReducer", () => {
  it("adds new lines with quantity 1 and merges repeats", () => {
    let items = cartReducer([], { type: "add", line: line() });
    items = cartReducer(items, { type: "add", line: line() });
    items = cartReducer(items, { type: "add", line: line({ productSlug: "b", name: "B", price: 10 }) });
    expect(items).toEqual([
      { productSlug: "arete-x", name: "Arete X", price: 150, quantity: 2 },
      { productSlug: "b", name: "B", price: 10, quantity: 1 },
    ]);
  });

  it("caps quantity at availableQuantity", () => {
    let items = cartReducer([], { type: "add", line: line({ availableQuantity: 1 }) });
    items = cartReducer(items, { type: "add", line: line({ availableQuantity: 1 }) });
    expect(items[0].quantity).toBe(1);
    items = cartReducer(items, { type: "setQty", productSlug: "arete-x", quantity: 5 });
    expect(items[0].quantity).toBe(1);
  });

  it("allows adding a sold-out product (uncapped, 'por surtir')", () => {
    let items = cartReducer([], { type: "add", line: line({ availableQuantity: 0 }) });
    expect(items[0].quantity).toBe(1);
    items = cartReducer(items, { type: "setQty", productSlug: "arete-x", quantity: 7 });
    expect(items[0].quantity).toBe(7);
  });

  it("setQty 0 removes the line", () => {
    let items = cartReducer([], { type: "add", line: line() });
    items = cartReducer(items, { type: "setQty", productSlug: "arete-x", quantity: 0 });
    expect(items).toEqual([]);
  });

  it("remove and clear", () => {
    let items = cartReducer([], { type: "add", line: line() });
    items = cartReducer(items, { type: "remove", productSlug: "arete-x" });
    expect(items).toEqual([]);
    items = cartReducer(items, { type: "add", line: line() });
    items = cartReducer(items, { type: "clear" });
    expect(items).toEqual([]);
  });
});

describe("cartTotal", () => {
  it("sums price × quantity", () => {
    const items = [
      { ...line(), quantity: 2 },
      { ...line({ productSlug: "b", price: 10 }), quantity: 3 },
    ];
    expect(cartTotal(items)).toBe(2 * 150 + 3 * 10);
  });
});

describe("cartCheckoutMessage", () => {
  it("builds a Spanish multi-line summary", () => {
    const msg = cartCheckoutMessage("Ana", [{ name: "Arete X", price: 150, quantity: 2 }], 300);
    expect(msg).toContain("Hola, soy Ana");
    expect(msg).toContain("- 2 × Arete X");
    expect(msg).toContain("Total: $300");
  });
  it("encodes into a wa.me url with the store phone", () => {
    const url = createCartCheckoutUrl("5215512345678", "Ana", [{ name: "A", price: 5, quantity: 1 }], 5);
    expect(url.startsWith("https://wa.me/5215512345678?text=")).toBe(true);
  });
});
