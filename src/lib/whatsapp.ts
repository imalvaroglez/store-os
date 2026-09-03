import type { Store, Product } from "../types";
import type { OrderPricing } from "./pricing";
import { formatMoney } from "./money";

function storefrontBase(phone?: string | null): string {
  const digits = (phone || "").replace(/[^0-9]/g, "");
  return digits ? `https://wa.me/${digits}` : `https://wa.me/`;
}

// Build a wa.me link to ask about a single product from the public catalog.
export function createWhatsAppProductUrl(product: Product, store: Store): string {
  const text = `Hola, quiero pedir: ${product.name}`;
  return `${storefrontBase(store.whatsappPhone)}?text=${encodeURIComponent(text)}`;
}

// General "ask about the store / catalog" link.
export function createWhatsAppStoreUrl(store: Store): string {
  const text = `Hola, me interesa tu catálogo de ${store.name}`;
  return `${storefrontBase(store.whatsappPhone)}?text=${encodeURIComponent(text)}`;
}

// Owner-facing "share my catalog" link. Opens WhatsApp with a message that
// embeds the public catalog URL so the owner can send it to a customer. The
// owner's own phone is intentionally NOT used as the destination — she sends
// to many customers, so wa.me opens in contact-picker mode.
export function createWhatsAppShareCatalogUrl(store: Store, catalogUrl: string): string {
  const text = `Mira mi catálogo de ${store.name}: ${catalogUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
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

export type CartOrderLine = {
  name: string;
  sku: string;
  qty: number;
  inquire?: boolean; // sold-out piece → asked, not bought
};

/**
 * Multi-line cart order in ONE message. Same intro convention as
 * createStorefrontBuyUrl: the editable intro is a PREFIX, each line carries
 * name + SKU, and the catalog URL is appended. A canonical pricing result is
 * optional so legacy single-price stores keep their existing message.
 */
export function buildCartOrderUrl(
  store: StorefrontWhatsAppTarget,
  storeSlug: string,
  lines: CartOrderLine[],
  pricing?: OrderPricing | null,
  customerName?: string
): string {
  const name = customerName?.trim();
  const intro =
    store.storefront?.whatsappBuyIntro?.trim() || (name ? `Hola, soy ${name}, quiero hacer un pedido:` : "Hola, quiero hacer un pedido:");
  const body = lines
    .map((l) => `• ${l.qty}× ${l.name} (${l.sku})${l.inquire ? " — sobre pedido" : ""}`)
    .join("\n");
  // Suppress the identity line only when the intro already carries OUR exact
  // identity phrase ("…soy {name},…") — a bare substring match would let an
  // intro like "Hola, Mar:" swallow the visitor's name.
  const who = name && !intro.includes(`soy ${name},`) ? `\nSoy ${name}.` : "";
  const summary = pricing
    ? `\nTotal de piezas: ${pricing.totalQuantity}\nPrecio aplicable: ${pricing.activeTier.tier.label}\nSubtotal estimado: ${formatMoney(pricing.estimatedSubtotal)} MXN\nEnvío no incluido.\nPrecio y existencia por confirmar por WhatsApp.`
    : "";
  const text = `${intro}\nPedido:\n${body}${summary}${who}\n${productUrl(storeSlug)}`;
  return `${storefrontBase(store.whatsappPhone)}?text=${encodeURIComponent(text)}`;
}
