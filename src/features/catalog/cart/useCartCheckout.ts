import { submitPublicOrder } from "../../../app/firebase/submitPublicOrder";
import type { useCart } from "./useCart";

// Shared checkout glue for both storefronts: submits the cart to the
// submitPublicOrder callable and clears it on success. Rejects with the
// callable's Spanish message for the CartSheet to show inline. A plain
// function (not a hook) — storefronts call it after their early returns.
export function cartCheckout(
  storeSlug: string,
  cart: ReturnType<typeof useCart>
): (name: string, phone: string) => Promise<void> {
  return async (name: string, phone: string) => {
    await submitPublicOrder(
      storeSlug,
      name,
      phone,
      cart.items.map((i) => ({ productSlug: i.productSlug, quantity: i.quantity }))
    );
    cart.clear();
  };
}
