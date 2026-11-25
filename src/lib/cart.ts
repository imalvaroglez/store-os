import type { StoreType } from "../types";
import { publicAvailabilitySignal } from "./publicAvailability";

// Public cart (storefront). Persisted per store slug in localStorage — a
// visitor accumulates pieces across reloads without any backend. Lines carry
// only public data, including the public tier prices needed for an estimated
// subtotal; the owner still confirms price and availability in WhatsApp.

export type CartLine = {
  productSlug: string; // stable PUBLIC key (the slug survives renames of the doc id)
  name: string;
  sku: string;
  qty: number;
  image?: string;
  inquire?: boolean; // sold-out piece: ask instead of buy
  /** #461: the exact color×talla this line picked no longer exists in the
   * public catalog — ask the visitor to choose again; never substitute. */
  missingOption?: true;
  /** Public per-tier unit prices. Powers the estimated subtotal; never charged. */
  unitPrices?: Record<string, number>;
  /** Legacy single public price, kept for catalogs without tier pricing. */
  unitPrice?: number;
};

export type PublicCartItemSource = {
  productSlug: string;
  name: string;
  sku?: string | null;
  image?: string | null;
  imageUrl?: string | null;
  price?: number;
  prices?: Record<string, number>;
  stockSignal?: string;
  inquire?: boolean;
  availability?: string | null;
  variants?: {
    id: string;
    color: string;
    imageUrl?: string | null;
    stockSignal: string;
    /** #461: sellable sizes of this color — a combination line per size. */
    sizes?: { id: string; size: string; stockSignal: string }[];
  }[];
};

/** Normalize summary/detail projections into the shared cart shape. */
export function cartItemFromPublicProduct(product: PublicCartItemSource): Omit<CartLine, "qty"> {
  return {
    productSlug: product.productSlug,
    name: product.name,
    sku: product.sku ?? product.productSlug,
    image: product.image ?? product.imageUrl ?? undefined,
    unitPrices: product.prices,
    ...(typeof product.price === "number" ? { unitPrice: product.price } : {}),
    inquire: product.inquire ?? product.stockSignal === "agotado",
  };
}

/** Refresh every exact color/combination key too, including carts saved before
 * a restock. Metadata and inquiry intent follow current public signals;
 * quantities stay. #461: a color with sizes sells ONLY per combination — the
 * color alone is not a line («Plateado · 6» never appears as an option). */
export function cartItemsForPublicProduct(product: PublicCartItemSource, storeType?: StoreType): Omit<CartLine, "qty">[] {
  const signal = publicAvailabilitySignal(product, storeType);
  const base = cartItemFromPublicProduct({ ...product, inquire: signal === "agotado" });
  return [base, ...(product.variants ?? []).flatMap((variant) => {
    const designGone = (storeType !== "inventory_tiered" && signal === "agotado") || variant.stockSignal === "agotado";
    if (!variant.sizes?.length) {
      return [{
        ...base,
        productSlug: `${product.productSlug}~${variant.id}`,
        name: `${product.name} · ${variant.color}`,
        image: variant.imageUrl ?? base.image,
        inquire: designGone,
      }];
    }
    return variant.sizes.map((size) => ({
      ...base,
      productSlug: `${product.productSlug}~${variant.id}~${size.id}`,
      name: `${product.name} · ${variant.color} · ${size.size}`,
      image: variant.imageUrl ?? base.image,
      inquire: designGone || size.stockSignal === "agotado",
    }));
  })];
}

const SCHEMA_VERSION = 1;
const key = (slug: string) => `store-os:cart:${slug}`;
const nameKey = (slug: string) => `store-os:cart-name:${slug}`;

/** Visitor's name for the WhatsApp order, persisted next to the cart. */
export function loadCartName(slug: string): string {
  try {
    return localStorage.getItem(nameKey(slug)) ?? "";
  } catch {
    return "";
  }
}

export function saveCartName(slug: string, name: string): void {
  try {
    if (name.trim()) localStorage.setItem(nameKey(slug), name.trim());
    else localStorage.removeItem(nameKey(slug));
  } catch {
    /* storage unavailable: the name just won't persist */
  }
}

export function loadCart(slug: string): CartLine[] {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { v?: number; lines?: CartLine[] };
    if (parsed.v !== SCHEMA_VERSION || !Array.isArray(parsed.lines)) return [];
    return parsed.lines.filter(
      (l) => l && typeof l.productSlug === "string" && typeof l.name === "string" && typeof l.qty === "number"
    );
  } catch {
    return []; // corrupt JSON: discard and start clean
  }
}

export function saveCart(slug: string, lines: CartLine[]): void {
  // #276: a broken read-only localStorage (Safari "block all cookies", quota)
  // must never take the whole storefront down — same tolerance as loadCart.
  // The cart keeps working in memory; only persistence is lost.
  try {
    localStorage.setItem(key(slug), JSON.stringify({ v: SCHEMA_VERSION, lines }));
  } catch {
    /* best-effort persistence */
  }
}

/** #276: pure line builders over an explicit BASE — useCart computes from its
 * in-memory state so a broken (read-only) localStorage never truncates the
 * order: persistence is best-effort, memory is the truth while mounted. */
export function addCartLine(lines: CartLine[], item: Omit<CartLine, "qty">, qty = 1): CartLine[] {
  const existing = lines.find((l) => l.productSlug === item.productSlug);
  return existing
    ? lines.map((l) => (l.productSlug === item.productSlug ? { ...l, qty: l.qty + qty } : l))
    : [...lines, { ...item, qty }];
}

/** Set a quantity; 0 or less removes the line. */
export function setCartLineQty(lines: CartLine[], productSlug: string, qty: number): CartLine[] {
  return qty <= 0
    ? lines.filter((l) => l.productSlug !== productSlug)
    : lines.map((l) => (l.productSlug === productSlug ? { ...l, qty } : l));
}

export function removeCartLineFrom(lines: CartLine[], productSlug: string): CartLine[] {
  return lines.filter((l) => l.productSlug !== productSlug);
}

export function addToCart(
  slug: string,
  item: Omit<CartLine, "qty">,
  qty = 1
): CartLine[] {
  const next = addCartLine(loadCart(slug), item, qty);
  saveCart(slug, next);
  return next;
}

/** Set a quantity; 0 or less removes the line. */
export function setCartQty(slug: string, productSlug: string, qty: number): CartLine[] {
  const next = setCartLineQty(loadCart(slug), productSlug, qty);
  saveCart(slug, next);
  return next;
}

export function removeCartLine(slug: string, productSlug: string): CartLine[] {
  const next = removeCartLineFrom(loadCart(slug), productSlug);
  saveCart(slug, next);
  return next;
}

/** Refresh public metadata on persisted lines without changing quantities.
 * #461: an exact selection (color or combination) that no longer exists keeps
 * its line and quantity but carries `missingOption` — the bag asks the visitor
 * to choose again instead of silently substituting or dropping it. */
export function refreshCartLines(
  lines: CartLine[],
  items: Omit<CartLine, "qty">[]
): CartLine[] {
  const bySlug = new Map(items.map((item) => [item.productSlug, item]));
  return lines.map((line) => {
    const item = bySlug.get(line.productSlug);
    if (!item) {
      // Base design lines are pruned upstream by their design slug; only an
      // exact selection can outlive its option while the design stays public.
      return line.productSlug.includes("~") ? { ...line, missingOption: true } : line;
    }
    const next = { ...line, ...item, qty: line.qty };
    delete next.missingOption; // back (or still) sellable: any stale mark clears
    return next;
  });
}

export function refreshCart(slug: string, items: Omit<CartLine, "qty">[]): CartLine[] {
  const next = refreshCartLines(loadCart(slug), items);
  saveCart(slug, next);
  return next;
}

/** Drop lines whose piece no longer exists in the public projection.
 * #137: a variant line carries its design slug as `slug~variantId` — prune by
 * the BASE slug so chosen colors survive while the design stays visible. */
export function pruneCartLines(lines: CartLine[], knownProductSlugs: Set<string>): CartLine[] {
  return lines.filter((l) => knownProductSlugs.has(l.productSlug.split("~")[0]));
}

export function cartPieces(lines: { qty: number }[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}
