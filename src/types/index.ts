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
  // Cloud-only membership fields (absent from local-only state):
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
  // #253: packaging materials + per-level profiles. Estimated costs are
  // display/planning inputs — real charges always come from consuming the
  // linked supply (#184), never from these numbers. Absent = not configured.
  packaging?: StorePackaging;
  // #254: suggested-price rules per level (product > category > general).
  // Absent = no suggestions beyond the legacy single-markup assistant.
  pricingRules?: PricingRulesConfig;
};

/** #253: a packaging material Fer buys (bolsa, cartoncito, moño…). */
export type PackagingMaterial = {
  id: string;
  name: string;
  /** Estimated cost per unit in pesos; optional while real costs are refined. */
  estimatedCost?: number;
  /** Linked consumable supply (expenses doc id); absent = suggestion without consumption. */
  supplyExpenseId?: string;
};

/** Units of a material: per piece sold (perPiece) or once per order (perOrder). */
export type PackagingLine = { materialId: string; units: number };

/** Packaging profile for one price level (tier id keyed in StorePackaging.byTier). */
export type TierPackaging = {
  /** Consumed PER PIECE sold at this level (e.g. bag x1, backing card x1). */
  perPiece: PackagingLine[];
  /** Consumed ONCE per order at this level (bolsa rosa, moño, paleta). */
  perOrder: PackagingLine[];
};

export type StorePackaging = {
  materials: PackagingMaterial[];
  byTier: Record<string, TierPackaging>;
};

/** #254 — how a suggested price is derived for one price level. */
export type PriceRounding = "none" | "1" | "5" | "10";

export type PricingRule =
  /** Percentage over the level's base cost (e.g. +100 → cost × 2). */
  | { kind: "markup"; percent: number; rounding?: PriceRounding }
  /** Fixed increment in pesos over the base cost. */
  | { kind: "fixed"; amount: number; rounding?: PriceRounding }
  /** Cost-band table: the ACQUISITION cost picks the band, the band carries
   * the final price for this level. Bands are [min, max) — half-open, so a
   * piece costing exactly the limit belongs to the NEXT band. */
  | { kind: "bands"; bands: Array<{ min: number; max?: number; price: number }>; rounding?: PriceRounding };

export type PricingRulesConfig = {
  /** General rule per price level (tier id keyed). OPTIONAL in stored docs:
   * a store whose first pricing config is a category table (Estrategia)
   * legitimately carries only `byCategory` — cloneConfig normalizes at
   * runtime; the type must not lie about real documents (#289 misión 5a). */
  byTier?: Record<string, PricingRule>;
  /** Category override: categoryId → tier → rule. */
  byCategory?: Record<string, Record<string, PricingRule>>;
  /** Product exception: productId → tier → rule. Wins over everything. */
  byProduct?: Record<string, Record<string, PricingRule>>;
};

// Control-plane projection of a store. It remains the canonical source for
// membership and ownership rules; the platform super_admin separately reads
// the full stores/{id} business document when operating a store.
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
  mobileImageUrl?: string;
  imageAlt?: string;
  // Intrinsic size of each uploaded image (px) so the public hero reserves
  // its box before the bytes arrive.
  imageWidth?: number;
  imageHeight?: number;
  mobileImageWidth?: number;
  mobileImageHeight?: number;
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
// the public catalog but never deletes price keys from products. The minimums
// are INFORMATIVE for the public cart (shown with the tier, never enforced in
// the client — the owner confirms qualification in the chat).
export type PriceTierDef = {
  id: string;
  label: string;
  order: number;
  hidden?: boolean;
  minPieces?: number; // qualifies by total cart pieces (e.g. Girly: 5)
  minAmount?: number; // qualifies by Σ qty × THE TIER'S OWN price (e.g. Iconic: 1000)
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

/**
 * #124 (PO 2026-11-09): one COLOR variety of a design. A product that
 * carries `variants` sells per exact color: stock, cost and clave live on
 * the variant; the sale price stays per design (shared across colors).
 * Photos: at least one per variant or the design cannot publish.
 */
export type ProductVariant = {
  id: string;
  /** Color shown to clients ("Dorado", "Plateado"). */
  color: string;
  /** Editable key suffix; full clave = design sku + "-" + suffix. */
  skuSuffix?: string;
  /** Materialized full clave (distinct in purchases, tickets, returns). */
  sku?: string;
  /** >=1 photo per variant (PO decision 1) — gallery, first is primary. */
  photos?: ProductImage[];
  /** Per-color acquisition cost; starts from the design's cost (decision 2). */
  cost?: number;
  quantityOnHand?: number;
  lowStockAt?: number;
  createdAt: string;
  updatedAt: string;
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
  /** #203: pieces in quarantine (damaged returns) — NOT sellable until
   * Fer explicitly authorizes returning them to sale, repairs or writes them
   * off. Displayed separately from available stock. */
  quantityQuarantined?: number;
  lowStockAt?: number;

  // #124: color varieties of a design. Non-empty = variant product: the
  // product-level quantityOnHand/cost/sku are NOT used for selling; each
  // color owns its stock/cost/clave, prices stay shared per design.
  variants?: ProductVariant[];

  // Schema version for the idempotent migration. Absent = not yet migrated.
  schemaVersion?: number;

  createdAt: string;
  updatedAt: string;
};

export type Customer = {
  segment?: "regular" | "entrepreneur";
  assignedPriceTierId?: string;
  // FER-05 Iconic benefit: a manually granted validity (day-granularity ISO
  // dates). The automatic window derives from saved orders (see lib/iconic);
  // this grant only ever ADDS to it, it never blocks the automatic renewal.
  iconic?: { since: string; until: string };
  id: string;
  storeId: string;
  name: string;
  phone?: string;
  instagram?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type OrderStatus =
  | "asked"
  | "quoted"
  | "confirmed"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export type LegacyOrderStatus = "asked" | "confirmed" | "to_buy" | "bought" | "arrived" | "delivered" | "paid";
export type PaymentStatus = "unpaid" | "partial" | "paid";

export type OrderItem = {
  /** Stable line identity: expense allocations (E5+) and category grouping (E3)
   * reference lines by id, surviving reorders and edits. Deterministic
   * `${orderId}_L${index}` on legacy migration; uid() on new lines. */
  lineId?: string;
  /** OLI-008: "manual" lines keep their price when the customer/tier changes. */
  priceSource?: "automatic" | "manual";
  /** OLI-012: frozen category at capture time, powers grouping and the ticket. */
  categorySnapshot?: { id: string; name: string };
  productId?: string;
  // #124: the exact color this line sold/reserves. Snapshots keep tickets
  // and history readable even if the variety is later edited or removed.
  variantId?: string;
  variantColor?: string;
  variantSku?: string;
  productName: string;
  quantity: number;
  priceTier?: string;
  unitPrice: number;
  subtotal: number;
  cost?: number;
};

/** How often cuotas come due on an installment plan (#165). */
export type InstallmentFrequency = "weekly" | "biweekly" | "monthly";

/**
 * The per-order installment agreement (#165). Chosen on the ORDER (never on
 * the product). Cuota amounts are NOT stored: they are suggested from the
 * order's current total ÷ count with exact cents at display time, so the plan
 * never carries stale money and no campaign default (count, frequency or
 * price) exists in code, data or UI.
 */
export type OrderInstallmentPlan = {
  /** Number of cuotas — operator-chosen per order, validated 1–99. */
  count: number;
  frequency: InstallmentFrequency;
  /** First due date (YYYY-MM-DD); later dates derive from the frequency. */
  firstDueDate: string;
  /** When/who agreed the plan — evidence for post-payment edits. Optional so
   * a migrated legacy plan never invents provenance it does not have. */
  agreedAt?: string;
  agreedBy?: string;
};

/** A replaced plan, kept verbatim as evidence when the agreement changes. */
export type PastInstallmentPlan = OrderInstallmentPlan & { replacedAt: string };

export type Order = {
  revision?: number;
  lastMutationId?: string;
  id: string;
  storeId: string;
  customerId: string;
  customerName?: string;
  items: OrderItem[];
  deposit: number;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  promisedDate?: string;
  notes?: string;
  schemaVersion?: number;
  createdAt: string;
  updatedAt: string;
  // Installment plan (#165). Absent = ordinary order (behavior unchanged).
  installments?: OrderInstallmentPlan;
  /** Witness set when the FIRST confirmed positive abono landed (PO 2026-11-03
   * R8: plan orders reserve stock AT CREATION like ordinary ones; this mark now
   * only certifies the reservation is money-backed — money-backed stock is
   * never released by cancellation alone). */
  installmentsReservedAt?: string;
  /** Replaced plans, oldest first — evidence, never rewritten. */
  installmentsHistory?: PastInstallmentPlan[];
  /** #168: Σ signed cents of this order's payment records (cobros positive,
   * adjustments signed), maintained by registerOrderPaymentTx in the SAME
   * transaction as each record — the money truth of the ORDER DOC. Gates and
   * displays read this, never the session's records: a fresh session can no
   * longer undercount received money. Absent = no records were ever written. */
  paymentsReceivedCents?: number;
  /** Monotonic receipt version; orders late responses without comparing money. */
  paymentsRevision?: number;
  /** New payment evidence linked atomically to the accumulator by rules. */
  lastPaymentId?: string;
  /** #168: set (same transaction) once the legacy `deposit` materialized as
   * the inherited payment record, so the doc never counts that deposit twice
   * (accumulator + pending deposit). */
  inheritedDepositMaterialized?: boolean;
  /** #271 (PO 2026-11-09): signed evidence of every deposit correction made
   * with payment evidence in the doc — who, how much (from → to), why, when.
   * Append-only like the rest of the money evidence; carried verbatim by
   * ordinary saves. A lowering without its entry is denied by the rules. */
  depositCorrections?: OrderDepositCorrection[];
  /** #333: verifiable evidence of pieces handed to the clienta. Append-only
   * (one entry per delivery event, id-idempotent); carried verbatim by
   * ordinary saves. Quantities never touch money or stock on their own — the
   * reservation already took the pieces when the order was confirmed. */
  deliveries?: OrderDelivery[];
  /** PO 2026-11-03 R9: evidence stamped when the operator explicitly confirmed
   * delivering with an uncovered balance (retroactive / cash-on-delivery
   * flows). The delivery gate still fires by default — this is the recorded
   * authorization, never a silent pass. */
  deliveredWithBalanceCents?: number;
  deliveredWithBalanceConfirmedAt?: string;
  deliveredWithBalanceConfirmedBy?: string;

  /** #189: credit from a sister order applied TO this order (Σ ledger
   * entries, maintained transactionally — the #168 accumulator pattern).
   * Reduces what the clienta owes here; it is NOT received money. */
  creditAppliedCents?: number;
  /** #189 mirror on the ORIGIN order: its surplus already consumed by sister
   * orders. Written in the same transaction as the destination's application. */
  creditConsumedCents?: number;
  /** #189 append-only evidence of applications/releases on this order. */
  creditLedger?: OrderCreditLedgerEntry[];
  /** #203 after-sales incidents opened on this order (append-only events;
   * derived money effects flow through customerCredit — never a second
   * balance). Absent = no incidents. */
  incidents?: OrderIncident[];
  /** #184: direct sale-side charges on this order (loose expenses assigned
   * here and supply consumptions). Append-only evidence; reduces the order's
   * profit, never its sale total or the clienta's balance. */
  saleExpenses?: OrderSaleExpense[];

  // Read-only compatibility for one migration pass and old local fixtures.
  // New writes never include these fields.
  productId?: string;
  productName?: string;
  quantity?: number;
  cost?: number;
  price?: number;
  priceTier?: string;
  status?: LegacyOrderStatus;
};

/** How money was received. "unknown" is ONLY for the inherited legacy deposit
 * (decision i on #123): real receptions always carry cash or transfer. */
export type OrderPaymentMethod = "cash" | "transfer" | "unknown";

/** #271 (PO 2026-11-09): one SIGNED deposit correction — the lowering of a
 * still-unmaterialized deposit on an order that already has payment
 * evidence. `from`/`to` are the deposit's decimal pesos before/after; `note`
 * is the operator's mandatory motive. Append-only evidence. */
export type OrderDepositCorrection = {
  from: number;
  to: number;
  note: string;
  by: string;
  at: string;
};

/** #333: pieces of one order line handed to the clienta in a delivery event.
 * Keyed by the exact stock dimension (variant-aware), like the reservation. */
export type OrderDeliveryLine = {
  productId: string;
  variantId?: string;
  /** Integer pieces delivered in THIS event; strictly positive. */
  quantity: number;
};

/** #333: one delivery event — append-only, id-idempotent evidence.
 * `deliveredAt` is the EFFECTIVE local date the operator confirms
 * (America/Mexico_City, YYYY-MM-DD — a late capture keeps the real date);
 * `recordedAt`/`by` are the audit trail that distinguishes them. */
export type OrderDelivery = {
  /** Stable per intent: a retry after an error reuses the same id (idempotent
   * append) and never duplicates the event. */
  id: string;
  orderId: string;
  storeId: string;
  deliveredAt: string;
  recordedAt: string;
  by: string;
  lines: OrderDeliveryLine[];
};

/** #189: one compensation event between orders of the same clienta/store.
 * Immutable evidence on the DESTINATION order: corrections are new entries,
 * never edits (the #123 payment-records discipline).
 * - application: `amountCents` moved from `fromOrderId`'s surplus onto this
 *   order's pending balance.
 * - release: a cancellation restituted a previously applied amount back to
 *   `fromOrderId`. */
/** #203: what Fer agreed with the clienta to solve an incident. */
export type IncidentResolutionKind =
  /** Default: equivalent piece, no additional charge (#203 decision). */
  | "replacement_equivalent"
  /** Another/better piece with a price difference: charged to the clienta or
   * absorbed by the store as atención comercial (recorded, never silent). */
  | "replacement_with_difference"
  /** The clienta waits for restock with an agreed date. */
  | "wait_restock"
  /** The clienta takes the money back (pending until actually refunded). */
  | "refund";

/** #184: one direct sale-side charge on an order (loose expense assignment
 * or supply consumption). Exact cents; append-only. */
export type OrderSaleExpense = {
  id: string;
  at: string;
  by: string;
  amountCents: number;
  description?: string;
  /** Origin for traceability: the loose expense (and its supply, if any). */
  expenseId: string;
  supplyConsumptionId?: string;
  /** Optional manual split across this order's lines (Σ = amountCents). */
  allocations?: Array<{ lineId: string; amountCents: number }>;
};

export type OrderIncidentEvent = {
  id: string;
  at: string;
  by: string;
  kind:
    /** Problem registered: piece, quantity, reason (payload on the incident). */
    | "opened"
    /** Resolution agreed with the clienta (payload: resolution). */
    | "resolution_agreed"
    /** Confirmed jointly: damaged piece received (quarantined) + solution
     * delivered (replacement stock out at its real cost / refund executed /
     * wait confirmed). Payload: quantities and costs. */
    | "confirmed"
    /** Fer repaired the piece: quarantine → sellable again. */
    | "repaired"
    /** Provider delivered a replacement for the damaged piece: quarantine → sellable. */
    | "provider_replacement"
    /** Provider compensated the store (amount recorded; valuation is #128/#129). */
    | "provider_compensation"
    /** Fer authorized writing the piece off (identifiable for the monthly close). */
    | "written_off"
    /** Fer explicitly authorized returning the piece to sale. */
    | "returned_to_sale"
    /** #203: the pending refund was actually handed back to the clienta
     * (releases the credit block exactly once; detail.refundExecutedCents). */
    | "refund_executed";
  /** Event-specific evidence (amounts in exact cents, ids, motive). */
  detail?: Record<string, string | number>;
};

export type OrderIncident = {
  id: string;
  /** Line of the origin order the incident is about. */
  lineId?: string;
  productId?: string;
  /** #124/#203: the exact color the incident is about (kept from the line). */
  variantId?: string;
  variantColor?: string;
  variantSku?: string;
  productName: string;
  quantity: number;
  reason: string;
  /** The line's HISTORICAL unit price frozen at open (exact cents) — evidence
   * and the basis for any price-difference adjustment. */
  originalUnitPriceCents: number;
  /** What was agreed with the clienta (set by the resolution_agreed event). */
  resolution?: {
    kind: IncidentResolutionKind;
    /** wait_restock: agreed date (YYYY-MM-DD). */
    waitUntil?: string;
    /** LEGACY (pre-reconcile): the piece's historical price — read only while
     * synthetic transition data exists; new writes never set it. */
    refundUnitPriceCents?: number;
    /** The piece's HISTORICAL unit price, exact cents — drives the SALE
     * adjustment (the piece leaves the sale). NEVER the refund amount. */
    saleAdjustmentUnitCents?: number;
    /** Refund obligation TOTAL in exact cents (reconciled money, transaction
     * authoritative). Zero when nothing is refundable or the clienta chose
     * credit. Kept distinct from the sale adjustment by design. */
    refundOwedCents?: number;
    /** Clienta's explicit choice for the reconciled difference: pending refund
     * or accepted credit (only accepted credit may auto-compensate, #189). */
    destination?: "refund_pending" | "credit_accepted";
  };
  /** The replacement piece when the resolution is a replacement. */
  replacement?: {
    productId?: string;
    productName: string;
    unitPriceCents: number;
    /** Real cost of the piece leaving stock, exact cents. */
    unitCostCents: number;
    chargeDifference: boolean;
    /** #364: the exact color handed over, REQUIRED when the replacement is a
     * design sold per color — its shelf moves at confirm. Absent on legacy
     * incidents (pre-colors); confirming those fails closed with an
     * actionable error instead of guessing a color. */
    variantId?: string;
    variantColor?: string;
    variantSku?: string;
  };
  /** append-only history; every state is DERIVED from it, never stored twice. */
  events: OrderIncidentEvent[];
};

export type OrderCreditLedgerEntry = {
  /** Stable per intent: a retry after an error reuses it (idempotent apply). */
  id: string;
  kind: "application" | "release";
  /** Origin of the credit (the overpaid sister order). */
  fromOrderId: string;
  amountCents: number;
  at: string;
  by: string;
};

/** One money reception registered on an order (#123). Immutable evidence:
 * corrections/refunds are NEW records with a signed amount, never edits. */
export type OrderPayment = {
  /** Stable per user intent: a retry after an error reuses it so the Firestore
   * create is recognized as the same operation (idempotent registration). */
  id: string;
  orderId: string;
  storeId: string;
  /** Real reception date (YYYY-MM-DD). Absent = genuinely unknown (inherited
   * deposit); never invented. */
  date?: string;
  method: OrderPaymentMethod;
  kind: "payment" | "adjustment";
  /** Signed decimal money units; negative = refund / correction down. */
  amount: number;
  /** Exact rounded cents on new evidence; old records remain readable. */
  amountCents?: number;
  /** Why the record exists. Required on adjustments (evidence). */
  note?: string;
  createdAt: string;
  createdBy: string;
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
  /** Stable line identity for expense allocations (E5+) and import matching. */
  lineId?: string;
  ticketId?: string;
  productId: string;
  /** #124 (decisión 2): the exact color this line bought — reception adjusts
   * THAT color's cost and shelf. Absent = whole-product line (legacy). */
  variantId?: string;
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

export type PurchaseExpenseCategory =
  | "sourcing_transport"
  | "customer_delivery"
  | "individual_packaging"
  | "shared_packaging"
  | "other";

export type PurchaseExpense = {
  id: string;
  category: PurchaseExpenseCategory;
  amount: number;
  description?: string;
  includeInInventoryCost?: boolean;
};

/**
 * Sale-side expense categories (FER-02): consumed while SELLING (delivery to a
 * client, per-piece or shared packaging), not while acquiring stock. They are
 * allocated per piece as a sale-cost estimate and never folded into the
 * inventory cost — they will be charged when the piece sells (FER-03), so
 * counting them in Product.cost today would double count tomorrow.
 */
export const SALE_EXPENSE_CATEGORIES: readonly PurchaseExpenseCategory[] = [
  "customer_delivery",
  "individual_packaging",
  "shared_packaging",
];

/** A sale-side expense, unless the operator explicitly moved it to inventory. */
export function isSaleExpense(expense: PurchaseExpense): boolean {
  return SALE_EXPENSE_CATEGORIES.includes(expense.category) && expense.includeInInventoryCost !== true;
}

export type PurchaseTicket = {
  id: string;
  supplierId?: string;
  supplierName?: string;
  folio?: string;
  totalConfirmed: number;
  discount?: number;
  shipping?: number;
  tax?: number;
  documentPath?: string;
  documentFingerprint?: string;
};

export type PurchaseCostAllocation = {
  lineId: string;
  merchandiseCents: number;
  supplierAdjustmentCents: number;
  sourcingExpenseCents: number;
  /** Sale-side expense cents allocated to this line. Intentionally EXCLUDED
   * from totalCents: sale expenses are a sale-cost estimate, never inventory. */
  saleExpenseCents?: number;
  totalCents: number;
};

/** Per-line allocation of a post-reception expense adjustment (FER-02). */
export type PurchaseSaleCostAllocation = { lineId: string; saleExpenseCents: number };

/**
 * An expense appended AFTER reception (FER-02). Append-only evidence: the
 * original tickets, lines, totals and cost allocations stay untouched. Sale
 * categories carry their own exact per-line allocation; no adjustment ever
 * changes stock or product costs.
 */
export type PurchaseExpenseAdjustment = {
  id: string;
  at: string;
  category: PurchaseExpenseCategory;
  amount: number;
  description?: string;
  allocations?: PurchaseSaleCostAllocation[];
};

/** #184: a loose expense — a real outlay registered WITHOUT a purchase,
 * lot or order attached (Decisión B ampliada, PO 2026-11-05). Classification
 * decides its treatment; assignments are explicit and traceable; the pending
 * balance (importe − Σ asignaciones) is DERIVED, never stored. */
export type LooseExpenseCategory =
  /** Mercancía y costos de adquisición → assign to an OPEN purchase (native
   * sourcing-expense path); transporte para surtir distributes across pieces. */
  | "merchandise"
  /** Venta y entrega → charge orders (preparation, packaging, delivery). */
  | "sale_delivery"
  /** Suministros: materials for gradual consumption (bags, boxes). */
  | "supplies"
  /** Operación: recognized in its period, no association required. */
  | "operation"
  /** Servicios tecnológicos de StoreOS, when a real charge exists. */
  | "storeos_services";

export const LOOSE_EXPENSE_CATEGORY_LABEL: Record<LooseExpenseCategory, string> = {
  merchandise: "Mercancía y costos de adquisición",
  sale_delivery: "Venta y entrega",
  supplies: "Suministros",
  operation: "Operación",
  storeos_services: "Servicios de StoreOS",
};

export type ExpenseAssignmentTarget =
  | { kind: "purchase"; purchaseId: string }
  | { kind: "order"; orderId: string };

/** One explicit assignment: amount in exact cents + how it was distributed. */
export type ExpenseAssignment = {
  id: string;
  at: string;
  by: string;
  target: ExpenseAssignmentTarget;
  /** units (default for homogeneous) | value-proportional | manual. */
  mode: "units" | "value" | "manual";
  amountCents: number;
  /** Per-piece distribution evidence (purchase lineIds / order lineIds). */
  allocations?: Array<{ lineId: string; amountCents: number }>;
};

/** One supply consumption: quantity units leave the stash; the exact cost is
 * charged to the order when Fer links it (criterio 5: 100 bolsas / $15 →
 * $0.15 por bolsa; una bolsa que cubre 3 artículos puede repartirse). */
export type SupplyConsumption = {
  id: string;
  at: string;
  by: string;
  quantity: number;
  orderId?: string;
  /** Optional split across the order's lines (manual, exact, Σ = charge). */
  allocations?: Array<{ lineId: string; amountCents: number }>;
};

export type LooseExpense = {
  id: string;
  storeId: string;
  /** Original amount in decimal pesos — never rewritten. */
  amount: number;
  date: string;
  description?: string;
  category: LooseExpenseCategory;
  assignments?: ExpenseAssignment[];
  /** Supplies only: the stash and its gradual consumption. */
  supply?: { quantityInitial: number; consumptions: SupplyConsumption[] };
  /** Criterio 6: simplified treatment — recognized as period expense; the
   * amount never re-enters real costs when selling. */
  simplifiedOperation?: boolean;
  createdAt: string;
  updatedAt: string;
};

export const PURCHASE_EXPENSE_CATEGORY_LABEL: Record<PurchaseExpenseCategory, string> = {
  sourcing_transport: "Traslado para surtir",
  customer_delivery: "Entrega a clienta",
  individual_packaging: "Empaque individual",
  shared_packaging: "Bolsa compartida",
  other: "Otro gasto",
};

/** A supplier purchase (a "ticket"): one or more lines, a confirmed total. */
export type Purchase = {
  id: string;
  storeId: string;
  name?: string;
  tickets?: PurchaseTicket[];
  costingMethod?: "latest_purchase";
  costAllocations?: PurchaseCostAllocation[];
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
  // Costs around sourcing/preparing the order, kept separate from the
  // supplier document total and product unit costs (allocation is FER-02).
  sourcingExpenses?: PurchaseExpense[];
  // Expenses appended after reception (FER-02); never mutated once written.
  saleCostAdjustments?: PurchaseExpenseAdjustment[];
  createdAt: string;
  updatedAt: string;
};

/** Legacy purchases (no status) already applied stock when saved. */
export function effectivePurchaseStatus(p: Purchase): PurchaseStatus {
  return p.status ?? "received";
}

/**
 * The ONE totals calculation (spec §1): total = merchandise − discount +
 * shipping + additional tax. The editor and recalcPurchaseStatus must both
 * consume this — the discount-sign bug came from the two drifting apart.
 */
export function purchaseTotals(p: Purchase): { merchandise: number; calculated: number } {
  const merchandise = p.lines.reduce((s, l) => s + l.quantity * (l.unitCost ?? 0), 0);
  const adjustments = p.tickets?.length
    ? p.tickets.reduce((sum, ticket) => sum + (ticket.shipping ?? 0) + (ticket.tax ?? 0) - (ticket.discount ?? 0), 0)
    : (p.shipping ?? 0) + (p.tax ?? 0) - (p.discount ?? 0);
  return { merchandise, calculated: merchandise + adjustments };
}

export function purchaseTicketTotals(p: Purchase, ticketId: string): { merchandise: number; calculated: number } {
  const ticket = p.tickets?.find((item) => item.id === ticketId);
  const merchandise = p.lines.filter((line) => line.ticketId === ticketId)
    .reduce((sum, line) => sum + line.quantity * (line.unitCost ?? 0), 0);
  return { merchandise, calculated: merchandise - (ticket?.discount ?? 0) + (ticket?.shipping ?? 0) + (ticket?.tax ?? 0) };
}

export function purchaseConfirmedTotal(p: Pick<Purchase, "totalConfirmed" | "tickets">): number {
  return p.tickets?.length
    ? p.tickets.reduce((sum, ticket) => sum + (Number.isFinite(ticket.totalConfirmed) ? ticket.totalConfirmed : 0), 0)
    : Number.isFinite(p.totalConfirmed) ? p.totalConfirmed : 0;
}

/** Sum additional sourcing costs in integer cents; absent data is a legacy zero. */
export function purchaseSourcingExpenseTotal(p: Pick<Purchase, "sourcingExpenses">): number {
  const cents = (p.sourcingExpenses ?? []).reduce((sum, expense) => {
    if (!Number.isFinite(expense.amount) || expense.amount <= 0) return sum;
    return sum + Math.round(expense.amount * 100);
  }, 0);
  return cents / 100;
}

/** Late expenses appended after reception; absent data is a legacy zero. */
export function purchaseAdjustmentTotal(p: Pick<Purchase, "saleCostAdjustments">): number {
  const cents = (p.saleCostAdjustments ?? []).reduce((sum, entry) => {
    if (!Number.isFinite(entry.amount) || entry.amount <= 0) return sum;
    return sum + Math.round(entry.amount * 100);
  }, 0);
  return cents / 100;
}

/** Actual registered outlay is the confirmed supplier amount plus every expense. */
export function purchaseRecordedTotal(p: Pick<Purchase, "totalConfirmed" | "sourcingExpenses" | "tickets" | "saleCostAdjustments">): number {
  const supplierTotal = purchaseConfirmedTotal(p);
  return supplierTotal + purchaseSourcingExpenseTotal(p) + purchaseAdjustmentTotal(p);
}

/**
 * The unit cost implied by the document's printed amount once its semantics
 * are resolved. Undefined when the line carries no interpreted amount — the
 * single source for pickProduct so linking never loses imported money.
 */
export function derivedUnitCost(l: PurchaseLine): number | undefined {
  if (l.sourceAmount == null || !l.sourceAmountType || l.sourceAmountType === "unknown") return undefined;
  return l.sourceAmountType === "unit" ? l.sourceAmount : l.sourceAmount / (l.quantity || 1);
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
export function recalcPurchaseStatus(p: Purchase): PurchaseStatus {
  if (effectivePurchaseStatus(p) === "received") return "received";
  if (p.lines.length === 0) return "draft";
  const unknownAmount = p.lines.some((l) => l.sourceAmountType === "unknown");
  const unlinked = p.lines.some((l) => !l.productId);
  if (p.tickets) {
    const ticketIds = new Set(p.tickets.map((ticket) => ticket.id));
    const invalid = ticketIds.size !== p.tickets.length || p.tickets.length === 0
      || p.lines.some((line) => !ticketIds.has(line.ticketId ?? "") || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitCost) || line.unitCost < 0)
      || p.tickets.some((ticket) => {
        const totals = purchaseTicketTotals(p, ticket.id);
        return !p.lines.some((line) => line.ticketId === ticket.id)
          || !Number.isFinite(ticket.totalConfirmed) || ticket.totalConfirmed < 0
          || [ticket.discount ?? 0, ticket.shipping ?? 0, ticket.tax ?? 0].some((amount) => !Number.isFinite(amount) || amount < 0)
          || (ticket.discount ?? 0) - totals.merchandise > 0.005
          || Math.abs(totals.calculated - ticket.totalConfirmed) > 0.005;
      });
    return invalid || unlinked || unknownAmount ? "needs_review" : "ready";
  }
  const { calculated } = purchaseTotals(p);
  // The confirmed total is THE paid amount. Missing/non-finite (legacy data)
  // never auto-reconciles to the calculated total — it reads as 0 so a
  // mismatch forces review instead of hiding the difference.
  const totalPaid = Number.isFinite(p.totalConfirmed) ? p.totalConfirmed : 0;
  const mismatch = Math.abs(calculated - totalPaid);
  const mismatchConfirmed = p.confirmedMismatchAmount != null && Math.abs(mismatch - p.confirmedMismatchAmount) < 0.005;
  // A negative calculated total (e.g. a document whose discount exceeds its
  // subtotal) is never confirmable — the operator must fix the numbers.
  const negativeTotal = calculated < -0.005;
  if (unknownAmount || unlinked || negativeTotal || (!mismatchConfirmed && mismatch > 0.5)) return "needs_review";
  return "ready";
}

// Administrative state held in memory from the authenticated Firestore session.
export type AppState = {
  stores: Store[];
  activeStoreId: string | null;
  products: Product[];
  categories: Category[];
  suppliers: Supplier[];
  purchases: Purchase[];
  customers: Customer[];
  orders: Order[];
  /** #184 loose expenses (registration, assignment, supplies). */
  expenses: LooseExpense[];
};

// Catalog business rules (single source of truth).
export const MAX_PRODUCT_IMAGES = 5;
export const MAX_PRODUCT_CATEGORIES = 3; // 1 primary + up to 2 secondary
export const CURRENT_PRODUCT_SCHEMA_VERSION = 2;
export const CURRENT_ORDER_SCHEMA_VERSION = 2;
