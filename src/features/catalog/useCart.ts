import { useCallback, useEffect, useState } from "react";
import { addToCart, clearCart, loadCart, pruneCartLines, refreshCart, removeCartLine, saveCart, setCartQty, type CartLine } from "../../lib/cart";

/** Cart state for one public storefront slug. The cart is intentionally local
 *  to the browser; order submission is validated by the Firebase callable. */
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

  const refresh = useCallback(
    (items: Omit<CartLine, "qty">[]) => {
      if (!slug) return;
      setLines(refreshCart(slug, items));
    },
    [slug]
  );

  const prune = useCallback(
    (knownProductSlugs: Set<string>) => {
      if (!slug) return;
      const current = loadCart(slug);
      const next = pruneCartLines(current, knownProductSlugs);
      if (next.length === current.length) return;
      saveCart(slug, next);
      setLines(next);
    },
    [slug]
  );

  const clear = useCallback(() => {
    if (!slug) return;
    clearCart(slug);
    setLines([]);
  }, [slug]);

  return { lines, add, setQty, remove, refresh, prune, clear };
}
