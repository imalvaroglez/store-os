import type { Store, Product } from "../types";

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
