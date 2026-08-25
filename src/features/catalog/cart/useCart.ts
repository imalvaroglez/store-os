import { useReducer } from "react";

// Public-catalog cart: one visitor session, one store. In-memory only — a cart
// lost on refresh is acceptable (the WhatsApp message and the created order are
// the durable artifacts). Unit-tested in cart.test.ts.

export type CartLine = {
  productSlug: string;
  name: string;
  price: number;
  imageUrl?: string | null;
  // On-hand as shown in the catalog (stale). Caps quantity in the UI; the
  // submitPublicOrder callable re-checks authoritatively.
  availableQuantity?: number;
};

export type CartItem = CartLine & { quantity: number };

export const MAX_QTY = 999;

type CartAction =
  | { type: "add"; line: CartLine }
  | { type: "setQty"; productSlug: string; quantity: number }
  | { type: "remove"; productSlug: string }
  | { type: "clear" };

function cap(line: CartLine, quantity: number): number {
  // Cap only against a POSITIVE on-hand count. Zero (sold out) does NOT cap:
  // the item enters as "por surtir" and the store reviews availability.
  const max = line.availableQuantity != null && line.availableQuantity > 0
    ? Math.min(line.availableQuantity, MAX_QTY)
    : MAX_QTY;
  return Math.max(0, Math.min(max, Math.round(quantity)));
}

export function cartReducer(items: CartItem[], action: CartAction): CartItem[] {
  switch (action.type) {
    case "add": {
      const existing = items.find((i) => i.productSlug === action.line.productSlug);
      if (!existing) {
        const qty = cap(action.line, 1);
        return qty > 0 ? [...items, { ...action.line, quantity: qty }] : items;
      }
      return items.map((i) =>
        i.productSlug === action.line.productSlug
          ? { ...i, ...action.line, quantity: cap(action.line, i.quantity + 1) }
          : i
      );
    }
    case "setQty":
      return items.flatMap((i) => {
        if (i.productSlug !== action.productSlug) return [i];
        const qty = cap(i, action.quantity);
        return qty > 0 ? [{ ...i, quantity: qty }] : []; // 0 removes
      });
    case "remove":
      return items.filter((i) => i.productSlug !== action.productSlug);
    case "clear":
      return [];
  }
}

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.price * i.quantity, 0);
}

export function useCart() {
  const [items, dispatch] = useReducer(cartReducer, []);
  return {
    items,
    add: (line: CartLine) => dispatch({ type: "add", line }),
    setQty: (productSlug: string, quantity: number) =>
      dispatch({ type: "setQty", productSlug, quantity }),
    remove: (productSlug: string) => dispatch({ type: "remove", productSlug }),
    clear: () => dispatch({ type: "clear" }),
    count: items.reduce((n, i) => n + i.quantity, 0),
    total: cartTotal(items),
  };
}
