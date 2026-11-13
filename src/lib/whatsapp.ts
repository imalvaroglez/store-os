import type { Store, Product } from "../types";
import type { CartRequestSummary, OrderPricing } from "./pricing";
import { formatMoney, formatMoneyExact } from "./money";

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
// Every storefront WhatsApp message appends immutable context (name, URL,
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

/** Buy/inquire about a specific product. Intro (editable) + name + URL. */
export function createStorefrontBuyUrl(
  store: StorefrontWhatsAppTarget,
  storeSlug: string,
  product: StorefrontProductRef
): string {
  const intro = store.storefront?.whatsappBuyIntro?.trim() || "Hola, me interesa esta pieza:";
  const intent = product.intent === "inquire" ? "Quiero preguntar por esta pieza." : "Quiero comprar esta pieza.";
  const text = `${intro}\n${intent}\nProducto: ${product.name}\n${productUrl(storeSlug, product.productSlug)}`;
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
  qty: number;
  inquire?: boolean; // sold-out piece → asked, not bought
  /** #305: public category name (from the catalog projection) for grouping;
   * absent → "Sin categoría". */
  category?: string;
};

/**
 * Multi-line cart order in ONE message. Same intro convention as
 * createStorefrontBuyUrl: the editable intro is a PREFIX, each line carries
 * name + quantity, and the catalog URL is appended. A canonical pricing result is
 * optional so legacy single-price stores keep their existing message.
 */
export function buildCartOrderUrl(
  store: StorefrontWhatsAppTarget,
  storeSlug: string,
  lines: CartOrderLine[],
  pricing?: OrderPricing | null,
  customerName?: string,
  /** #305: request summary (habitual + identity estimate). When
   * present it REPLACES the old single-price summary, so the message can
   * never contradict the cart. */
  request?: CartRequestSummary | null
): string {
  const name = customerName?.trim();
  // The owner-editable intro goes verbatim; the DEFAULT intro embeds the
  // visitor's name — escape it there too (user text in a WhatsApp message).
  const intro =
    store.storefront?.whatsappBuyIntro?.trim()
    || (name ? `Hola, soy ${name.replace(/([*_~`])/g, "\\$1")}, quiero hacer un pedido:` : "Hola, quiero hacer un pedido:");
  // #305: group by category (when known from the public projection), keep
  // order stable, and escape WhatsApp markdown in catalog/user text.
  const esc = (text: string) => text.replace(/([*_~`])/g, "\\$1");
  const groups = new Map<string, CartOrderLine[]>();
  for (const line of lines) {
    const key = line.category?.trim() || "Sin categoría";
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const body = [...groups.entries()]
    .map(([category, group]) => {
      const items = group
        .map((l) => `• ${l.qty}× ${esc(l.name)}${l.inquire ? " — sobre pedido" : ""}`)
        .join("\n");
      return groups.size > 1 ? `*${esc(category.toUpperCase())}*\n${items}` : items;
    })
    .join("\n\n");
  // Suppress the identity line only when the intro already carries OUR exact
  // identity phrase ("…soy {name},…") — a bare substring match would let an
  // intro like "Hola, Mar:" swallow the visitor's name.
  const who = name && !intro.includes(`soy ${name},`) ? `\nSoy ${esc(name)}.` : "";
  const summary = request
    ? [
        `*${request.totalQuantity} ${request.totalQuantity === 1 ? "pieza" : "piezas"} en total*`,
        // Exact cents + MXN, identical to the drawer rows (1.13.1): the
        // message can never round away a cent the client just saw on screen.
        `Subtotal estimado: ${formatMoneyExact(request.habitualSubtotal)} MXN`,
        // Match the drawer, omitting an estimate when any price is missing.
        ...(request.identityTier && request.identitySubtotal != null
          ? [`¿Eres ${esc(request.identityTier.label)}? Subtotal estimado: ${formatMoneyExact(request.identitySubtotal)} MXN`]
          : []),
        "Precios, beneficio y disponibilidad sujetos a confirmación.",
        "Envío no incluido.",
      ].join("\n")
    : pricing
      ? `\nTotal de piezas: ${pricing.totalQuantity}\nPrecio aplicable: ${pricing.activeTier.tier.label}\nSubtotal estimado: ${formatMoney(pricing.estimatedSubtotal)} MXN\nEnvío no incluido.\nPrecio y existencia por confirmar por WhatsApp.`
      : "";
  const text = `${intro}\nPedido:\n${body}\n\n${summary}${who}\n${productUrl(storeSlug)}`;
  return `${storefrontBase(store.whatsappPhone)}?text=${encodeURIComponent(text)}`;
}
