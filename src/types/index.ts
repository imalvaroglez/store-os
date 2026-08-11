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

export type ProductPrices = {
  retail?: number;
  wholesale?: number;
  reseller?: number;
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

  // inventory-tiered stores use tiered `prices`.
  prices?: ProductPrices;

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

export type PriceTier = "retail" | "wholesale" | "reseller";

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
  priceTier?: PriceTier;
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
  prices?: ProductPrices;
};

/** A supplier purchase (a "ticket"): one or more lines, a confirmed total. */
export type Purchase = {
  id: string;
  storeId: string;
  supplierId?: string;
  date: string; // purchase date (default today)
  notes?: string;
  lines: PurchaseLine[];
  subtotal: number; // Σ quantity × unitCost (computed)
  totalConfirmed: number; // the total Fer confirms (may differ from subtotal)
  createdAt: string;
  updatedAt: string;
};

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
export const CURRENT_PRODUCT_SCHEMA_VERSION = 1;
