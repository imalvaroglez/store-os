import { useCallback, useEffect, useState } from "react";
import { addToCart, loadCart, removeCartLine, setCartQty, type CartLine } from "../../lib/cart";

/** Cart state for one public storefront slug. Local-first: localStorage is the
 *  source of truth and every mutation returns the next lines from cart.ts, so
 *  the UI never drifts from what a reload would show. */
export function useCart(slug: string | undefined) {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    setLines(slug ? loadCart(slug) : []);
  }, [slug]);

  const add = useCallback(
    (item: Omit<CartLine, "qty">, qty = 1) => {
      if (!slug) return;
      setLines(addToCart(slug, item, qty));
    },
    [slug]
  );

  const setQty = useCallback(
    (productSlug: string, qty: number) => {
      if (!slug) return;
      setLines(setCartQty(slug, productSlug, qty));
    },
    [slug]
  );

  const remove = useCallback(
    (productSlug: string) => {
      if (!slug) return;
      setLines(removeCartLine(slug, productSlug));
    },
    [slug]
  );

  return { lines, add, setQty, remove };
}
