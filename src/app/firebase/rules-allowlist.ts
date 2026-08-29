// Normative allow-lists for the Security Harness (Espec 1).
// Single source of truth consumed by static gates (security-allowlist.gate.test.ts)
// and documented intent for Firestore rules + projection builders.
// Changing a list here is a normative decision; reviewers must approve.

// G-P03: exact fields a public projection may carry. Adding a field here is a
// privacy decision — the gate fails if a projection outputs a key not in this list.
export const PUBLIC_STORE_FIELDS = [
  "storeId", "name", "slug", "type", "whatsappPhone", "storefront",
  // Public tier map + resolved default (owner decision 2026-08-29, carrito
  // público): labels, order and INFORMATIVE minimums. Cost never enters.
  "priceTiers", "defaultTierId",
] as const;
export const PUBLIC_PRODUCT_FIELDS = [
  "storeId", "storeSlug", "productSlug", "name", "sku",
  "publicDescription", "images", "material", "finish", "dimensions", "care",
  "availability", "canInquire", "isFeatured", "isNew", "categories",
  "price",
  // Prices per VISIBLE tier (owner decision 2026-08-29) and the coarse stock
  // signal ("agotado" | "pocas" | "disponible") — never exact counts, never cost.
  "prices", "stockSignal",
] as const;

// G-P02: exact fields the control-plane document adminStores/{storeId} may carry.
// All are control metadata, never business content or client PII.
export const ADMIN_STORE_FIELDS = [
  "storeId", "name", "slug", "type", "ownerUid", "memberUids",
  "pendingInvites", "createdAt", "updatedAt", "retainedPrivacyRequestCount",
] as const;
// Absolute exclusions from adminStores (business content / PII).
export const ADMIN_STORE_EXCLUSIONS = [
  "whatsappPhone", "skuPrefix", "storefront",
] as const;

// G-P08: telemetry SDKs the client must never depend on or import.
export const FORBIDDEN_TELEMETRY_PACKAGES = [
  "@vercel/analytics", "@vercel/speed-insights",
] as const;
// G-P08: same-origin routes that must never be hit at runtime.
export const FORBIDDEN_TELEMETRY_ROUTES = [
  "/__vercel/insights", "/_vercel/insights",
] as const;
