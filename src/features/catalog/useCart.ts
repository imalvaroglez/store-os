import { useCallback, useEffect, useState } from "react";
import {
  addCartLine,
  loadCart,
  pruneCartLines,
  refreshCartLines,
  removeCartLineFrom,
  saveCart,
  setCartLineQty,
  type CartLine,
} from "../../lib/cart";

/** Cart state for one public storefront slug. Memory-first (#276): mutations
 *  compute from the in-memory lines and persist best-effort — a broken
 *  read-only localStorage loses only persistence, never the order being built
 *  (each add used to rebuild from storage and silently truncate the cart). */
export function useCart(slug: string | undefined) {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    setLines(slug ? loadCart(slug) : []);
  }, [slug]);

  const commit = useCallback(
    (build: (current: CartLine[]) => CartLine[]) => {
      if (!slug) return;
      setLines((current) => {
        const next = build(current);
        saveCart(slug, next);
        return next;
      });
    },
    [slug]
  );

  const add = useCallback(
    (item: Omit<CartLine, "qty">, qty = 1) => commit((current) => addCartLine(current, item, qty)),
    [commit]
  );

  const setQty = useCallback(
    (productSlug: string, qty: number) => commit((current) => setCartLineQty(current, productSlug, qty)),
    [commit]
  );

  const remove = useCallback(
    (productSlug: string) => commit((current) => removeCartLineFrom(current, productSlug)),
    [commit]
  );

  const refresh = useCallback(
    (items: Omit<CartLine, "qty">[]) => commit((current) => refreshCartLines(current, items)),
    [commit]
  );

  const prune = useCallback(
    (knownProductSlugs: Set<string>) =>
      commit((current) => {
        const next = pruneCartLines(current, knownProductSlugs);
        return next.length === current.length ? current : next;
      }),
    [commit]
  );

  return { lines, add, setQty, remove, refresh, prune };
}
