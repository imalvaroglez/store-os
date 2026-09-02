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
  /** Public per-tier unit prices. Powers the estimated subtotal; never charged. */
  unitPrices?: Record<string, number>;
};

export type PublicCartItemSource = {
  productSlug: string;
  name: string;
  sku?: string | null;
  image?: string | null;
  imageUrl?: string | null;
  prices?: Record<string, number>;
  stockSignal?: string;
  inquire?: boolean;
};

/** Normalize summary/detail projections into the shared cart shape. */
export function cartItemFromPublicProduct(product: PublicCartItemSource): Omit<CartLine, "qty"> {
  return {
    productSlug: product.productSlug,
    name: product.name,
    sku: product.sku ?? product.productSlug,
    image: product.image ?? product.imageUrl ?? undefined,
    unitPrices: product.prices,
    inquire: product.inquire ?? product.stockSignal === "agotado",
  };
}

const SCHEMA_VERSION = 1;
const key = (slug: string) => `store-os:cart:${slug}`;

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
  localStorage.setItem(key(slug), JSON.stringify({ v: SCHEMA_VERSION, lines }));
}

export function addToCart(
  slug: string,
  item: Omit<CartLine, "qty">,
  qty = 1
): CartLine[] {
  const lines = loadCart(slug);
  const existing = lines.find((l) => l.productSlug === item.productSlug);
  const next = existing
    ? lines.map((l) => (l.productSlug === item.productSlug ? { ...l, qty: l.qty + qty } : l))
    : [...lines, { ...item, qty }];
  saveCart(slug, next);
  return next;
}

/** Set a quantity; 0 or less removes the line. */
export function setCartQty(slug: string, productSlug: string, qty: number): CartLine[] {
  const current = loadCart(slug);
  const next =
    qty <= 0
      ? current.filter((l) => l.productSlug !== productSlug)
      : current.map((l) => (l.productSlug === productSlug ? { ...l, qty } : l));
  saveCart(slug, next);
  return next;
}

export function removeCartLine(slug: string, productSlug: string): CartLine[] {
  const next = loadCart(slug).filter((l) => l.productSlug !== productSlug);
  saveCart(slug, next);
  return next;
}

/** Refresh public metadata on persisted lines without changing quantities. */
export function refreshCartLines(
  lines: CartLine[],
  items: Omit<CartLine, "qty">[]
): CartLine[] {
  const bySlug = new Map(items.map((item) => [item.productSlug, item]));
  return lines.map((line) => {
    const item = bySlug.get(line.productSlug);
    return item ? { ...line, ...item, qty: line.qty } : line;
  });
}

export function refreshCart(slug: string, items: Omit<CartLine, "qty">[]): CartLine[] {
  const next = refreshCartLines(loadCart(slug), items);
  saveCart(slug, next);
  return next;
}

/** Drop lines whose piece no longer exists in the public projection. */
export function pruneCartLines(lines: CartLine[], knownProductSlugs: Set<string>): CartLine[] {
  return lines.filter((l) => knownProductSlugs.has(l.productSlug));
}

export function cartPieces(lines: { qty: number }[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}
