// Store OS data model. Verbatim from the product brief.
// Code/types in English; UI labels in Spanish (Mexico).

export type StoreType = "on_demand" | "inventory_tiered";

export type Store = {
  id: string;
  name: string;
  slug: string;
  type: StoreType;
  whatsappPhone?: string;
  // Operational: the prefix used when auto-suggesting product SKUs (Clave).
  // Per-store so the capability is reusable; absent until set. When missing,
  // SKU suggestion derives from the store slug.
  skuPrefix?: string;
  createdAt: string;
  updatedAt: string;
  // Cloud-only membership fields (absent in local demo mode):
  ownerUid?: string;
  memberUids?: string[];
  pendingInvites?: string[]; // emails invited but not yet signed up
  // Editable public storefront content. Absent on legacy stores until migrated;
  // screens fall back to defaults via emptyStorefront().
  storefront?: Storefront;
  // Scalable pricing (business content — lives in `stores`, never adminStores).
  // Absent = store not yet migrated; tiersForStore falls back to the canonical 3.
  priceTiers?: PriceTierDef[];
  defaultTierId?: string; // public price tier; absent = first tier by order
  pricingRule?: { kind: "markup"; percent: number }; // suggested-price assistant
};

// Control-plane projection of a store (G-P02). Canonical document read by
// super_admin for platform administration. Carries ONLY control metadata;
// never business content (whatsappPhone/skuPrefix/storefront) or client PII.
// See src/app/firebase/rules-allowlist.ts ADMIN_STORE_FIELDS.
export type AdminStore = {
  storeId: string;
  name: string;
  slug: string;
  type: StoreType;
  ownerUid: string;
  memberUids: string[];
  pendingInvites?: string[];
  createdAt: string;
  updatedAt: string;
  retainedPrivacyRequestCount?: number; // counter of ARCO requests still in retention (Espec 2 §9.3)
};

// Structured, editable storefront content shown on /catalogo/:slug. No free-form
// page builder: each field maps to a fixed section. Fer edits these without code.
export type StorefrontSection = {
  heading?: string;
  body?: string;
  imageUrl?: string;
};

export type FAQItem = { q: string; a: string };

export type Storefront = {
  logoUrl?: string;
  hero?: StorefrontSection;
  benefits?: string[]; // short bullet lines under the hero
  story?: StorefrontSection; // "Nuestra historia"
  resale?: StorefrontSection; // "Vende con Olivia" program
  notice?: string; // aviso general / banner line
  faq?: FAQItem[];
  shipping?: string; // entregas / envíos
  payments?: string[]; // métodos de pago aceptados
  policies?: string; // políticas básicas
  hours?: string; // horarios de atención
  instagram?: string; // usuario o enlace
  // Commercial rules:
  whatsappBuyIntro?: string; // editable intro only; context (name/SKU/URL) is appended
  whatsappResaleIntro?: string;
  showSoldOut?: boolean; // whether agotados appear in the public catalog
  seo?: StorefrontSeo;
};

export type StorefrontSeo = {
  title?: string;
  description?: string;
  ogImageUrl?: string; // Open Graph share image (Storage URL)
};

// Category: a private, per-store grouping. `id` is storeId__slug so categories are
// unique within a store but slugs can repeat across stores. Active categories
// surface in the storefront; inactive ones are hidden but keep their products.
export type Category = {
  id: string; // `${storeId}__${slug}`
  storeId: string;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductCategory = "perfume" | "sneakers" | "cap" | "jewelry" | "other";

// A store-defined price level (scalable-pricing). ids are stable forever;
// labels are cosmetic and editable. `hidden` removes the tier from forms and
// the public catalog but never deletes price keys from products.
export type PriceTierDef = {
  id: string;
  label: string;
  order: number;
  hidden?: boolean;
};

// A gallery image. Exactly one is primary (the cover/thumbnail). Stored optimized
// in Storage; the projection carries only url + alt + isPrimary + order + dims.
export type ProductImage = {
  id: string;
  url: string; // public Storage URL
  storagePath: string; // products/{storeId}/{productId}/{imgId}.jpg
  alt?: string;
  width?: number;
  height?: number;
  order: number;
  isPrimary: boolean;
};

export type ProductStatus = "draft" | "published" | "archived";
export type ProductAvailability = "available" | "low_stock" | "sold_out";

export type Product = {
  id: string;
  storeId: string;
  name: string;
  // Kept optional only for legacy documents; migration fills it before publish.
  sku?: string;

  // Legacy single category (kept for migration + back-compat; superseded by
  // categoryIds below once migrated). Old code reads this; new code writes both.
  category: ProductCategory;
  categoryIds?: string[]; // [primary, ...up to 2 secondary]; primary required to publish

  slug?: string; // stable public slug; survives renames; suffixed on collision

  imageUrl?: string; // legacy single image; mirrored from gallery[primary].url
  images?: ProductImage[]; // gallery, 1–5; one isPrimary
  publicDescription?: string;
  privateNotes?: string;

  // Public material/finish details (shown on the product page).
  material?: string;
  finish?: string; // color / acabado
  dimensions?: string; // medidas
  care?: string; // cuidados

  status?: ProductStatus; // default "published" for legacy; "draft" is never public
  availability?: ProductAvailability;
  isPublic: boolean; // legacy visibility flag; status==="published" replaces it going forward
  isNew?: boolean;
  isFeatured?: boolean;
  canInquire?: boolean; // allow "pedir información" even when sold out
  sortOrder?: number;

  // on-demand stores use a single `price`.
  cost?: number;
  price?: number;

  // inventory-tiered stores use tiered `prices` keyed by PriceTierDef.id
  // (open map: stores define their own levels).
  prices?: Record<string, number>;

  quantityOnHand?: number;
  lowStockAt?: number;

  // Schema version for the idempotent migration. Absent = not yet migrated.
  schemaVersion?: number;

  createdAt: string;
  updatedAt: string;
};

export type Customer = {
  id: string;
  storeId: string;
  name: string;
  phone?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderStatus =
  | "asked"
  | "confirmed"
  | "to_buy"
  | "bought"
  | "arrived"
  | "delivered"
  | "paid";

export type Order = {
  id: string;
  storeId: string;
  customerId: string;
  productId?: string;
  productName: string;
  quantity: number;
  cost?: number;
  price: number;
  deposit: number;
  status: OrderStatus;
  promisedDate?: string;
  notes?: string;
  priceTier?: string; // tier id snapshot at order time
  createdAt: string;
  updatedAt: string;
};

/** A supplier Fer buys stock from. Per-store, like Category. */
export type Supplier = {
  id: string;
  storeId: string;
  name: string;
  contact?: string; // phone / where to find them
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

/** One line of a purchase ticket: a product bought, how many, at what unit cost. */
export type PurchaseLine = {
  productId: string;
  name: string; // snapshot at purchase time
  quantity: number;
  unitCost: number;
  // Sale-price edits made from the purchase line (F3). Optional so existing
  // purchases (and applyPurchaseLines) are unaffected. Persisted onto the
  // product when the purchase is saved. inventory_tiered uses `prices`;
  // on_demand uses `price`.
  price?: number;
  prices?: Record<string, number>; // tierId → price (inventory_tiered)
  // purchase-pdf-import: as read from the document, before any interpretation.
  variant?: string;
  sourceAmount?: number; // the printed amount, semantics unresolved
  sourceAmountType?: "unit" | "line" | "unknown";
  matchStatus?: "unmatched" | "matched" | "new_product" | "needs_review";
};

/**
 * Purchase lifecycle. `receivePurchase` is the ONLY operation that touches
 * inventory. Legacy purchases (created before the lifecycle) have
 * `status: undefined` and MUST be treated as already received.
 */
export type PurchaseStatus = "draft" | "needs_review" | "ready" | "received";

/** A supplier purchase (a "ticket"): one or more lines, a confirmed total. */
export type Purchase = {
  id: string;
  storeId: string;
  supplierId?: string;
  date: string; // purchase date (default today)
  // purchase-ux2: true while `date` came from an inferred PDF date label
  // (year guessed as the most recent past occurrence). Any manual date edit
  // turns it off.
  dateInferred?: boolean;
  notes?: string;
  lines: PurchaseLine[];
  subtotal: number; // Σ quantity × unitCost (computed)
  totalConfirmed: number; // the total Fer confirms (may differ from subtotal)
  // purchase-pdf-import: the supplier's order document, when the purchase was
  // built by importing a PDF. Private (members-only Storage path) — we store
  // the PATH, never a download URL (those carry a reusable token).
  documentPath?: string;
  documentFingerprint?: string; // SHA-256, duplicate-import detection
  supplierOrder?: string; // folio/número de pedido del proveedor
  supplierName?: string; // supplier candidate detected in the PDF ("Colore")
  origin?: "manual" | "pdf";
  status?: PurchaseStatus; // undefined = legacy (already applied stock on save)
  receivedAt?: string; // set by receivePurchase; idempotency mark
  // The admin explicitly confirmed receiving with this unexplained difference.
  // Any later edit to the draft must clear it (invalidate the confirmation).
  confirmedMismatchAmount?: number;
  discount?: number;
  shipping?: number;
  tax?: number;
  createdAt: string;
  updatedAt: string;
};

/** Legacy purchases (no status) already applied stock when saved. */
export function effectivePurchaseStatus(p: Purchase): PurchaseStatus {
  return p.status ?? "received";
}

/**
 * The ONE totals calculation (spec §1): total = mercancía − descuento +
 * envío + impuesto adicional. The editor and recalcPurchaseStatus must both
 * consume this — the discount-sign bug came from the two drifting apart.
 */
export function purchaseTotals(p: Purchase): { merchandise: number; calculated: number } {
  const merchandise = p.lines.reduce((s, l) => s + l.quantity * (l.unitCost ?? 0), 0);
  const adjustments = (p.shipping ?? 0) + (p.tax ?? 0) - (p.discount ?? 0);
  return { merchandise, calculated: merchandise + adjustments };
}

/** Calculated per-line review state (never persisted). Fixed precedence. */
export type PurchaseLineStatus = "amount_review" | "unlinked" | "new_product" | "linked";

export function lineStatus(l: PurchaseLine): PurchaseLineStatus {
  if (l.sourceAmountType === "unknown") return "amount_review";
  if (!l.productId) return "unlinked";
  if (l.matchStatus === "new_product") return "new_product";
  return "linked";
}

/**
 * Recompute a draft's review status from its own data — the single authority.
 * needs_review: unresolved source-amount semantics, an unlinked line, or an
 * unconfirmed total mismatch. ready: everything resolved. draft: nothing to
 * review yet.
 */
export function recalcPurchaseStatus(
  p: Purchase,
  opts: { totalPaid: number }
): PurchaseStatus {
  if (effectivePurchaseStatus(p) === "received") return "received";
  if (p.lines.length === 0) return "draft";
  const unknownAmount = p.lines.some((l) => l.sourceAmountType === "unknown");
  const unlinked = p.lines.some((l) => !l.productId);
  const { calculated } = purchaseTotals(p);
  const mismatch = Math.abs(calculated - opts.totalPaid);
  const mismatchConfirmed = p.confirmedMismatchAmount != null && Math.abs(mismatch - p.confirmedMismatchAmount) < 0.005;
  if (unknownAmount || unlinked || (!mismatchConfirmed && mismatch > 0.5)) return "needs_review";
  return "ready";
}

// Whole app state persisted to localStorage.
export type AppState = {
  stores: Store[];
  activeStoreId: string | null;
  products: Product[];
  categories: Category[];
  suppliers: Supplier[];
  purchases: Purchase[];
  customers: Customer[];
  orders: Order[];
};

// Catalog business rules (single source of truth).
export const MAX_PRODUCT_IMAGES = 5;
export const MAX_PRODUCT_CATEGORIES = 3; // 1 primary + up to 2 secondary
export const CURRENT_PRODUCT_SCHEMA_VERSION = 2;
