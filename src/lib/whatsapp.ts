import type { Store, Product } from "../types";
import { formatMoney } from "./money";

// Build a wa.me link to ask about a single product from the public catalog.
export function createWhatsAppProductUrl(product: Product, store: Store): string {
  const phone = (store.whatsappPhone || "").replace(/[^0-9]/g, "");
  const name = product.name;
  const text = `Hola, quiero pedir: ${name}`;
  const base = phone ? `https://wa.me/${phone}` : `https://wa.me/`;
  return `${base}?text=${encodeURIComponent(text)}`;
}

// General "ask about the store / catalog" link.
export function createWhatsAppStoreUrl(store: Store): string {
  const phone = (store.whatsappPhone || "").replace(/[^0-9]/g, "");
  const text = `Hola, me interesa tu catálogo de ${store.name}`;
  return phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// Owner-facing "share my catalog" link. Opens WhatsApp with a message that
// embeds the public catalog URL so the owner can send it to a customer. The
// owner's own phone is intentionally NOT used as the destination — she sends
// to many customers, so wa.me opens in contact-picker mode.
export function createWhatsAppShareCatalogUrl(store: Store, catalogUrl: string): string {
  const text = `Mira mi catálogo de ${store.name}: ${catalogUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// --- Public cart checkout message ---

export type CartMessageItem = { name: string; price: number; quantity: number };

/** Cart summary sent to the store's WhatsApp at public checkout. */
export function cartCheckoutMessage(customerName: string, items: CartMessageItem[], total: number): string {
  const lines = items
    .map((i) => `- ${i.quantity} × ${i.name} (${formatMoney(i.price * i.quantity)})`)
    .join("\n");
  return `Hola, soy ${customerName}. Quiero pedir:\n${lines}\nTotal: ${formatMoney(total)}`;
}

export function createCartCheckoutUrl(
  whatsappPhone: string | null | undefined,
  customerName: string,
  items: CartMessageItem[],
  total: number
): string {
  const digits = (whatsappPhone || "").replace(/[^0-9]/g, "");
  const base = digits ? `https://wa.me/${digits}` : `https://wa.me/`;
  return `${base}?text=${encodeURIComponent(cartCheckoutMessage(customerName, items, total))}`;
}

// --- Olivia storefront messages ---
//
// Every storefront WhatsApp message appends immutable context (name, SKU, URL,
// intent) so Fer's editable "intro" can never accidentally strip the info needed
// to identify the piece. The intro is a prefix only.

export type StorefrontWhatsAppTarget = {
  whatsappPhone?: string | null;
  storefront?: {
    whatsappBuyIntro?: string;
    whatsappResaleIntro?: string;
  } | null;
};

export type StorefrontProductRef = {
  name: string;
  sku: string;
  productSlug?: string;
  intent?: "buy" | "inquire";
};

function storefrontBase(phone?: string | null): string {
  const digits = (phone || "").replace(/[^0-9]/g, "");
  return digits ? `https://wa.me/${digits}` : `https://wa.me/`;
}

function productUrl(storeSlug: string, productSlug?: string): string {
  const origin =
    typeof window !== "undefined" && window.location
      ? window.location.origin
      : "";
  if (!productSlug) return `${origin}/catalogo/${storeSlug}`;
  return `${origin}/catalogo/${storeSlug}/producto/${productSlug}`;
}

/** Buy/inquire about a specific product. Intro (editable) + name + SKU + URL. */
export function createStorefrontBuyUrl(
  store: StorefrontWhatsAppTarget,
  storeSlug: string,
  product: StorefrontProductRef
): string {
  const intro = store.storefront?.whatsappBuyIntro?.trim() || "Hola, me interesa esta pieza:";
  const intent = product.intent === "inquire" ? "Quiero preguntar por esta pieza." : "Quiero comprar esta pieza.";
  const text = `${intro}\n${intent}\nProducto: ${product.name}\nClave: ${product.sku}\n${productUrl(storeSlug, product.productSlug)}`;
  return `${storefrontBase(store.whatsappPhone)}?text=${encodeURIComponent(text)}`;
}

/** General "ask about the store" contact. */
export function createStorefrontContactUrl(
  store: StorefrontWhatsAppTarget,
  storeSlug: string
): string {
  const text = `Hola, me interesa tu catálogo.\n${productUrl(storeSlug)}`;
  return `${storefrontBase(store.whatsappPhone)}?text=${encodeURIComponent(text)}`;
}

/** Resale program CTA. Intro (editable) + intent. */
export function createStorefrontResaleUrl(
  store: StorefrontWhatsAppTarget,
  storeSlug: string
): string {
  const intro = store.storefront?.whatsappResaleIntro?.trim() || "Hola, quiero información sobre el programa de reventa.";
  const text = `${intro}\n${productUrl(storeSlug)}`;
  return `${storefrontBase(store.whatsappPhone)}?text=${encodeURIComponent(text)}`;
}
