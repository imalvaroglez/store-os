// Public cart (storefront). Persisted per store slug in localStorage — a
// visitor accumulates pieces across reloads without any backend. Lines carry
// ONLY public data (id, name, sku); prices never enter the cart — the owner
// confirms the price in the WhatsApp chat.

export type CartLine = {
  productId: string;
  name: string;
  sku: string;
  qty: number;
  image?: string;
  inquire?: boolean; // sold-out piece: ask instead of buy
};

const SCHEMA_VERSION = 1;
const key = (slug: string) => `store-os:cart:${slug}`;

export function loadCart(slug: string): CartLine[] {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { v?: number; lines?: CartLine[] };
    if (parsed.v !== SCHEMA_VERSION || !Array.isArray(parsed.lines)) return [];
    return parsed.lines.filter(
      (l) => l && typeof l.productId === "string" && typeof l.name === "string" && typeof l.qty === "number"
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
  item: { productId: string; name: string; sku: string; image?: string },
  qty = 1
): CartLine[] {
  const lines = loadCart(slug);
  const existing = lines.find((l) => l.productId === item.productId);
  const next = existing
    ? lines.map((l) => (l.productId === item.productId ? { ...l, qty: l.qty + qty } : l))
    : [...lines, { ...item, qty }];
  saveCart(slug, next);
  return next;
}

/** Set a quantity; 0 or less removes the line. */
export function setCartQty(slug: string, productId: string, qty: number): CartLine[] {
  const current = loadCart(slug);
  const next =
    qty <= 0
      ? current.filter((l) => l.productId !== productId)
      : current.map((l) => (l.productId === productId ? { ...l, qty } : l));
  saveCart(slug, next);
  return next;
}

export function removeCartLine(slug: string, productId: string): CartLine[] {
  const next = loadCart(slug).filter((l) => l.productId !== productId);
  saveCart(slug, next);
  return next;
}

/** Drop lines whose piece no longer exists in the public projection. */
export function pruneCartLines(lines: CartLine[], knownProductIds: Set<string>): CartLine[] {
  return lines.filter((l) => knownProductIds.has(l.productId));
}

export function cartPieces(lines: { qty: number }[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}
