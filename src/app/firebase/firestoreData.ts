import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  runTransaction,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebase } from "./config";
import { applyPurchaseLines } from "../../lib/inventory";
import type { AppUser } from "./auth";
import type { AppState, Store, Product, Customer, Order, Category, Supplier, Purchase } from "../../types";
import { publicPrice } from "../../lib/money";
import { tiersForStore, defaultTier } from "../../lib/pricing";

// Cloud data adapter. The cloud analog of lib/storage.ts: the StoreProvider talks
// to this when signed in. Reads are scoped to the user (super_admin sees all
// stores; a member sees only stores whose memberUids include them). Writes go to
// the entity's own doc; security rules enforce membership server-side.

export const COLLECTIONS = ["stores", "products", "categories", "suppliers", "purchases", "customers", "orders"] as const;
type CollectionName = (typeof COLLECTIONS)[number];

/** Load all cloud data visible to the user. */
export async function loadCloudState(user: AppUser): Promise<AppState> {
  const { db } = getFirebase();

  // Stores: super_admin reads the CONTROL plane (adminStores) — never the
  // business docs, so platform administration cannot leak tenant PII (G-P02).
  // adminStores carries only control metadata, so the Store objects built here
  // are control-shaped (no whatsappPhone/storefront/skuPrefix); that is the
  // intended super_admin view. Members read their full `stores` business docs.
  let stores: Store[] = [];
  if (user.role === "super_admin") {
    const snap = await getDocs(collection(db, "adminStores"));
    stores = snap.docs.map((d) => adminStoreToStore(d.data(), d.id));
  } else {
    const q = query(collection(db, "stores"), where("memberUids", "array-contains", user.uid));
    const snap = await getDocs(q);
    stores = snap.docs.map((d) => ({ ...(d.data() as Store), id: d.id }));
  }

  const storeIds = stores.map((s) => s.id);

  // Fetch each entity collection scoped to the accessible stores. For super_admin
  // that's effectively all; for members it stays within their stores (and avoids
  // permission-denied on other stores' docs).
  async function forStores<T extends { storeId: string }>(name: "products" | "categories" | "suppliers" | "purchases" | "customers" | "orders"): Promise<T[]> {
    if (storeIds.length === 0) return [];
    const q = query(collection(db, name), where("storeId", "in", storeIds));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
  }

  const [products, categories, suppliers, purchases, customers, orders] = await Promise.all([
    forStores<Product>("products"),
    forStores<Category>("categories"),
    forStores<Supplier>("suppliers"),
    forStores<Purchase>("purchases"),
    forStores<Customer>("customers"),
    forStores<Order>("orders"),
  ]);

  return {
    stores,
    activeStoreId: stores[0]?.id ?? null,
    products,
    categories,
    suppliers,
    purchases,
    customers,
    orders,
  };
}

/** Subscribe to live cloud updates; returns an unsubscribe. */
export function subscribeCloudState(
  user: AppUser,
  onChange: (state: AppState) => void
): Unsubscribe {
  const { db } = getFirebase();
  // Both roles subscribe to the stores they can see, then scope entity listeners
  // by those store ids (see below). super_admin reads the adminStores control
  // plane (G-P02); members read their member `stores` business docs. The store
  // ids from either feed the `where("storeId","in",[...])` filter every entity
  // listener needs (rules are not filters).
  const storesQ =
    user.role === "super_admin"
      ? collection(db, "adminStores")
      : query(collection(db, "stores"), where("memberUids", "array-contains", user.uid));

  // Re-load everything on any entity change. Watch all four collections so edits
  // made on another device propagate live (not just stores).
  //
  // Scoping: firestore.rules allows `list: if isSignedIn()` on
  // products/customers/orders — the CLIENT must scope with
  // `where("storeId", "in", [...])`, matching loadCloudState. A super_admin sees
  // every store, so bare collection listeners are correct for them. A member must
  // NEVER receive other stores' entities over the wire: we read their member
  // stores once at subscribe time and filter entity listeners to those store ids.
  // If the member is added to a NEW store mid-session, the scoped storesQ
  // listener fires → triggerReload → loadCloudState re-reads everything (now
  // including the new store), so the data still arrives via the full reload path.
  let timer: ReturnType<typeof setTimeout> | null = null;
  // ponytail: trailing debounce is enough — we don't need leading-edge delivery.
  // 150ms coalesces the near-simultaneous fires from a multi-collection write
  // into one loadCloudState call.
  const DEBOUNCE_MS = 150;
  const triggerReload = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      try {
        onChange(await loadCloudState(user));
      } catch {
        /* ignore transient errors */
      }
    }, DEBOUNCE_MS);
  };

  const unsubscribers: Unsubscribe[] = [];
  // If teardown runs before the member's one-shot store read resolves, stop
  // registering listeners (and avoid leaking after teardown).
  let tornDown = false;

  // Stores listener is always live — storesQ is already role-scoped above.
  unsubscribers.push(onSnapshot(storesQ, triggerReload));

  // Entity listeners: BOTH roles read their accessible stores once, then
  // register storeId-filtered listeners. A bare collection(products) listener is
  // NOT possible: firestore.rules gate each entity on
  // isMember(resource.data.storeId), a resource.data-dependent rule, and Firestore
  // rejects any query whose `where()` can't validate that rule ("rules are not
  // filters"). So every entity listener MUST carry `where("storeId", "in", [...])`
  // — for super_admin that's the stores they own/are members of (read from the
  // adminStores control plane), for a member their member stores. A user with no
  // stores subscribes to no entity listeners (nothing to watch). If they are
  // added to a new store mid-session, the storesQ listener fires → triggerReload
  // → loadCloudState re-reads everything including the new store.
  function registerEntityListeners(storeIds: string[]) {
    if (tornDown) return;
    if (storeIds.length === 0) return;
    for (const name of ["products", "categories", "suppliers", "purchases", "customers", "orders"] as const) {
      const entityQ = query(collection(db, name), where("storeId", "in", storeIds));
      unsubscribers.push(onSnapshot(entityQ, triggerReload));
    }
  }

  // Read accessible stores once, then register scoped listeners.
  getDocs(storesQ)
    .then((snap) => {
      // For super_admin, storesQ is the adminStores control plane (docs keyed by
      // storeId); for members it's their member `stores` docs. Both yield store ids.
      registerEntityListeners(snap.docs.map((d) => d.id));
    })
    .catch(() => {
      /* ignore — storesQ listener still drives reloads on subsequent changes */
    });

  return () => {
    tornDown = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const fn of unsubscribers) fn();
  };
}

/**
 * Control-plane projection of a store: adminStores/{id} carries ONLY allow-listed
 * control metadata (never business content like whatsappPhone/storefront), so a
 * super_admin `list` of adminStores cannot leak tenant PII (G-P02). This is the
 * only shape the rules read for membership/ownership (isMember/isOwner).
 */
/**
 * Deep-clone with all `undefined` values removed (recursively), including those
 * nested inside plain objects and arrays. Firestore rejects `undefined` at any
 * depth ("Unsupported field value"). Arrays keep their order; objects with all
 * values undefined become empty objects (kept, not dropped — Firestore accepts
 * {} and null fine; we strip only the offending undefined values, not the keys
 * that hold them, to avoid silently reshaping nested docs).
 */
export function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

export function projectAdminStore(store: { id: string } & Record<string, unknown>) {
  return {
    storeId: store.id,
    name: store.name,
    slug: store.slug,
    type: store.type,
    ownerUid: store.ownerUid,
    memberUids: store.memberUids,
    pendingInvites: store.pendingInvites ?? [],
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
    retainedPrivacyRequestCount: store.retainedPrivacyRequestCount ?? 0,
  };
}

/**
 * Build a control-shaped Store from an adminStores doc (for loadCloudState's
 * super_admin path). Business fields (whatsappPhone, storefront, skuPrefix) are
 * absent by design — super_admin sees the control plane only (G-P02).
 */
function adminStoreToStore(data: unknown, id: string): Store {
  const d = data as Record<string, unknown>;
  return {
    id,
    name: (d.name as string) ?? "",
    slug: (d.slug as string) ?? "",
    type: (d.type as Store["type"]) ?? "on_demand",
    createdAt: (d.createdAt as string) ?? "",
    updatedAt: (d.updatedAt as string) ?? "",
    ownerUid: d.ownerUid as string | undefined,
    memberUids: d.memberUids as string[] | undefined,
    pendingInvites: d.pendingInvites as string[] | undefined,
  };
}

/** Upsert a single entity doc. */
export async function saveEntity(
  _user: AppUser,
  name: CollectionName,
  entity: { id: string } & Record<string, unknown>
): Promise<void> {
  const { db } = getFirebase();
  const { id, ...data } = entity;
  // Firestore rejects `undefined` field values ("Unsupported field value") —
  // including those nested in objects/arrays, e.g. a purchase line carrying
  // `price: undefined` (inventory_tiered) or `prices: undefined` (on_demand)
  // from the F3 price-edit fields. Strip undefined RECURSIVELY so any depth is
  // safe. One guard for every entity/call site (products, purchases, etc.).
  const clean = stripUndefined(data) as Record<string, unknown>;

  // G-P02: a store write MUST also write its adminStores control doc in the SAME
  // batched write — the rules resolve membership/ownership exclusively from
  // adminStores, so a stores doc without a sibling adminStores doc has no members.
  // This single chokepoint covers every store write (create, update, invite,
  // remove, transfer) since they all flow through saveEntity("stores", ...).
  if (name === "stores") {
    const batch = writeBatch(db);
    batch.set(doc(db, "stores", id), clean, { merge: true });
    batch.set(doc(db, "adminStores", id), projectAdminStore({ ...clean, id }), { merge: true });
    await batch.commit();
    return;
  }

  await setDoc(doc(db, name, id), clean, { merge: true });
}

/** Delete a single entity doc. */
export async function deleteEntity(
  _user: AppUser,
  name: CollectionName,
  id: string
): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, name, id));
}

// --- Public catalog projection (3-doc model) ---
//
// Anonymous visitors read THREE projection collections, each carrying ONLY
// public-safe fields (private data — cost, profit, notes, inventory, membership
// — is never written here, so the model is leak-proof by construction):
//
//   publicStores/{slug}    identity + storefront content + contact (1 read)
//   publicCatalogs/{slug}  active categories + lightweight product summaries
//                          powering the grid (1 read) — the storefront visit is
//                          these two reads total.
//   publicProducts/{storeId}__{productSlug}  full single-product detail (+1 read
//                          when a visitor opens a piece).
//
// Product doc ids encode store+slug so the public product route can resolve a
// piece without a scan, and so a rename never strands a public doc.

/** Thrown when a slug is already claimed by another store. */
export class SlugTakenError extends Error {
  constructor(public slug: string) {
    super(`El identificador "${slug}" ya está en uso.`);
    this.name = "SlugTakenError";
  }
}

/**
 * Atomically claim a slug for a store. Uses create-only semantics inside a
 * transaction: if `slugs/{slug}` already exists for a DIFFERENT store, the
 * claim fails with SlugTakenError. Same store re-claiming its own slug is a
 * no-op (idempotent).
 */
export async function claimSlug(slug: string, storeId: string): Promise<void> {
  const { db } = getFirebase();
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "slugs", slug);
    const existing = await tx.get(ref);
    if (existing.exists()) {
      const owner = existing.data()?.storeId as string | undefined;
      if (owner && owner !== storeId) throw new SlugTakenError(slug);
      return; // same store already owns it
    }
    const uid = getFirebase().auth.currentUser?.uid;
    if (!uid) throw new Error("Debes iniciar sesión para reservar un identificador.");
    tx.set(ref, { storeId, ownerUid: uid, claimedAt: Date.now() });
  });
}

/** Release a slug reservation (on rename/delete). */
export async function releaseSlug(slug: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, "slugs", slug)).catch(() => {});
}

/** receivePurchase already done — NOT an error (idempotency signal). */
export class PurchaseAlreadyReceived extends Error {
  constructor() {
    super("La compra ya fue recibida.");
  }
}

/**
 * Atomically receive a purchase into inventory: products get stock + weighted
 * average cost, the purchase gets status "received" + receivedAt — all in ONE
 * Firestore commit. Idempotency guards, checked INSIDE the transaction:
 *   - `receivedAt` already set → already received through the lifecycle
 *   - `status === undefined` → legacy purchase whose stock was applied on save
 * V1 does NOT apply sale-price edits here: a direct products write would skip
 * the public-catalog republish that upsertProduct performs, so prices stay
 * untouched (editable later from the product form).
 */
export async function receivePurchaseTx(purchaseId: string): Promise<void> {
  const { db } = getFirebase();
  // Pre-validate OUTSIDE the transaction: errors thrown inside runTransaction
  // reach the caller with an emptied message on the emulator, so the UI toast
  // would lose the reason. The transaction re-validates canonically below.
  {
    const snap = await getDoc(doc(db, "purchases", purchaseId));
    if (!snap.exists()) throw new Error("No se encontró la compra.");
    const purchase = snap.data() as Purchase;
    if (purchase.receivedAt != null || purchase.status === undefined) throw new PurchaseAlreadyReceived();
    for (const line of purchase.lines) {
      if (!line.productId) throw new Error("Hay líneas sin producto vinculado.");
      let pSnap;
      try {
        pSnap = await getDoc(doc(db, "products", line.productId));
      } catch {
        // Reading a MISSING doc fails the isMember(resource.data...) rule with
        // a raw evaluation error — indistinguishable from a denial, and for the
        // operator it means the same thing: the product isn't there.
        throw new Error(`No se encontró el producto de la línea "${line.name}".`);
      }
      if (!pSnap.exists()) throw new Error(`No se encontró el producto de la línea "${line.name}".`);
      if ((pSnap.data() as Product).storeId !== purchase.storeId) {
        throw new Error(`El producto de la línea "${line.name}" pertenece a otra tienda.`);
      }
    }
  }
  await runTransaction(db, async (tx) => {
    const purchaseRef = doc(db, "purchases", purchaseId);
    const snap = await tx.get(purchaseRef);
    if (!snap.exists()) throw new Error("No se encontró la compra.");
    const purchase = snap.data() as Purchase;
    if (purchase.receivedAt != null || purchase.status === undefined) {
      throw new PurchaseAlreadyReceived();
    }
    const at = new Date().toISOString();
    const productRefs = new Map<string, ReturnType<typeof doc>>();
    const productDocs = new Map<string, Product>();
    for (const line of purchase.lines) {
      if (!line.productId) throw new Error("Hay líneas sin producto vinculado.");
      if (productRefs.has(line.productId)) continue;
      const ref = doc(db, "products", line.productId);
      productRefs.set(line.productId, ref);
      const snapP = await tx.get(ref);
      if (!snapP.exists()) throw new Error(`No se encontró el producto de la línea "${line.name}".`);
      const product = snapP.data() as Product;
      if (product.storeId !== purchase.storeId) {
        throw new Error(`El producto de la línea "${line.name}" pertenece a otra tienda.`);
      }
      productDocs.set(line.productId, product);
    }
    const stockUpdates = applyPurchaseLines(
      [...productDocs.values()].filter(Boolean),
      purchase.lines
    );
    for (const [productId, update] of stockUpdates) {
      tx.update(productRefs.get(productId)!, {
        quantityOnHand: update.quantityOnHand,
        cost: update.cost,
        updatedAt: at,
      });
    }
    tx.update(purchaseRef, { status: "received", receivedAt: at, updatedAt: at });
  });
}

/**
 * Bulk-create private draft products and save the purchase that links them in
 * ONE writeBatch (max 499 products + the purchase). Any failure leaves
 * everything untouched. No public projection is written (products are private
 * drafts; publishing is a later, explicit act).
 */
export async function createDraftProductsForPurchaseTx(
  products: Product[],
  purchase: Purchase
): Promise<void> {
  if (products.length > 499) {
    throw new Error("Son demasiados productos para un solo lote (máximo 499).");
  }
  const { db } = getFirebase();
  const batch = writeBatch(db);
  for (const product of products) {
    const { id, ...data } = product;
    batch.set(doc(db, "products", id), stripUndefined(data) as Record<string, unknown>, { merge: true });
  }
  const { id: purchaseId, ...purchaseData } = purchase;
  batch.set(doc(db, "purchases", purchaseId), stripUndefined(purchaseData) as Record<string, unknown>, { merge: true });
  await batch.commit();
}

/** Public product doc id: storeId + product slug (stable across renames). */
export function publicProductId(storeId: string, productSlug: string): string {
  return `${storeId}__${productSlug}`;
}

/** Primary gallery image URL (first isPrimary, else first image), for the grid. */
function primaryImage(product: Product): string | null {
  const imgs = product.images;
  if (imgs && imgs.length > 0) {
    const primary = imgs.find((i) => i.isPrimary) ?? imgs[0];
    return primary.url ?? null;
  }
  return product.imageUrl ?? null;
}

/** Coarse stock signal for the public catalog: NEVER an exact count. */
export function publicStockSignal(p: Product): "agotado" | "pocas" | "disponible" {
  const qty = p.quantityOnHand;
  if (typeof qty !== "number") return "disponible"; // on-demand / not tracked
  if (qty <= 0) return "agotado";
  if (typeof p.lowStockAt === "number" && qty <= p.lowStockAt) return "pocas";
  return "disponible";
}

/** Prices per VISIBLE tier (owner decision 2026-08-29: the tier map is public;
 *  cost is not). Undefined for stores/projections without a tier map. */
function publicPricesByTier(
  product: Product,
  store?: Pick<Store, "priceTiers" | "defaultTierId">
): Record<string, number> | undefined {
  if (!store || !product.prices) return undefined;
  const prices: Record<string, number> = {};
  for (const t of tiersForStore(store)) {
    const value = product.prices[t.id];
    if (typeof value === "number") prices[t.id] = value;
  }
  return Object.keys(prices).length ? prices : undefined;
}

type PublicPricingSource = Pick<Store, "priceTiers" | "defaultTierId">;

/** Public storefront projection: identity + storefront content + contact + tiers. */
export function projectPublicStore(store: Store) {
  const sf = store.storefront;
  return {
    storeId: store.id,
    name: store.name,
    slug: store.slug,
    type: store.type,
    whatsappPhone: store.whatsappPhone ?? null,
    storefront: sf ?? null,
    // Visible tiers with their (informative) minimums; null for stores that
    // never set tiers so stale clients fall back to the single price.
    priceTiers: store.priceTiers
      ? tiersForStore(store).map((t) => ({
          id: t.id,
          label: t.label,
          order: t.order,
          ...(t.minPieces != null ? { minPieces: t.minPieces } : {}),
          ...(t.minAmount != null ? { minAmount: t.minAmount } : {}),
        }))
      : null,
    // Only stores with their own tier map advertise a default; legacy stores
    // keep null so clients fall back to the single resolved price.
    defaultTierId: store.priceTiers ? (defaultTier(store)?.id ?? null) : null,
  };
}

/**
 * Lightweight product summary for the grid (lives inside publicCatalogs). No
 * private fields. Exposes a SINGLE resolved `price` (the store's default tier
 * for inventory stores) — never the full tier map or private prices.
 */
export function projectPublicProductSummary(
  product: Product,
  storeSlug: string,
  pricing?: PublicPricingSource
) {
  const summary: Record<string, unknown> = {
    storeSlug,
    storeId: product.storeId,
    productSlug: product.slug ?? null,
    name: product.name,
    publicDescription: product.publicDescription ?? null,
    imageUrl: primaryImage(product),
    availability: product.availability ?? "available",
    isFeatured: product.isFeatured ?? false,
    isNew: product.isNew ?? false,
    canInquire: product.canInquire ?? false,
    categoryIds: product.categoryIds ?? [],
    sortOrder: product.sortOrder ?? 0,
    stockSignal: publicStockSignal(product),
  };
  const resolved = publicPrice(product, pricing?.defaultTierId);
  if (typeof resolved === "number") summary.price = resolved;
  const prices = publicPricesByTier(product, pricing);
  if (prices) summary.prices = prices;
  return summary;
}

/**
 * Full public product detail (publicProducts/{storeId}__{slug}). Includes the
 * gallery, material/finish/dimensions/care, categories, and price — never cost,
 * wholesale/reseller, notes, or inventory counts.
 */
export function projectPublicProductDetail(
  product: Product,
  storeSlug: string,
  categories: Category[],
  pricing?: PublicPricingSource
) {
  const named = (product.categoryIds ?? [])
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is Category => !!c)
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug }));

  const detail: Record<string, unknown> = {
    storeId: product.storeId,
    storeSlug,
    productSlug: product.slug ?? null,
    name: product.name,
    sku: product.sku ?? product.id,
    publicDescription: product.publicDescription ?? null,
    images: (product.images ?? []).map((i) => ({
      url: i.url,
      alt: i.alt ?? null,
      width: i.width ?? null,
      height: i.height ?? null,
      isPrimary: i.isPrimary,
    })),
    material: product.material ?? null,
    finish: product.finish ?? null,
    dimensions: product.dimensions ?? null,
    care: product.care ?? null,
    availability: product.availability ?? "available",
    canInquire: product.canInquire ?? false,
    isFeatured: product.isFeatured ?? false,
    isNew: product.isNew ?? false,
    categories: named,
    stockSignal: publicStockSignal(product),
  };
  const resolved = publicPrice(product, pricing?.defaultTierId);
  if (typeof resolved === "number") detail.price = resolved;
  const prices = publicPricesByTier(product, pricing);
  if (prices) detail.prices = prices;
  return detail;
}

export function isPublished(p: Product): boolean {
  if (!p.slug) return false; // sin slug no hay doc público direccionable: card muerta
  return p.status ? p.status === "published" : p.isPublic;
}

/**
 * Rebuild the full public projection for one store: publicStores, publicCatalogs
 * (active categories + published product summaries), and a publicProducts detail
 * doc per published product. Prunes stale publicProducts no longer published.
 * Idempotent.
 */
export async function projectPublicForStore(
  store: Store,
  products: Product[],
  categories: Category[]
): Promise<void> {
  const { db } = getFirebase();
  const writes: Promise<unknown>[] = [];

  // 1. Storefront (identity + content + contact).
  writes.push(setDoc(doc(db, "publicStores", store.slug), projectPublicStore(store)));

  // 2. Catalog: active categories + published product summaries.
  const published = products.filter((p) => p.storeId === store.id && isPublished(p));
  const activeCats = categories
    .filter((c) => c.storeId === store.id && c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description ?? null,
      imageUrl: c.imageUrl ?? null,
      sortOrder: c.sortOrder,
    }));
  writes.push(
    setDoc(
      doc(db, "publicCatalogs", store.slug),
      {
        storeSlug: store.slug,
        storeId: store.id, // anonymous product route resolves the detail doc id from here
        categories: activeCats,
        products: published
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          .map((p) => projectPublicProductSummary(p, store.slug, store)),
      },
      {}
    )
  );

  // 3. Per-product detail docs for published products.
  const keepIds = new Set<string>();
  for (const p of published) {
    const id = publicProductId(store.id, p.slug!); // isPublished already guarantees a slug
    keepIds.add(id);
    writes.push(
      setDoc(doc(db, "publicProducts", id), projectPublicProductDetail(p, store.slug, categories, store))
    );
  }

  // Prune stale detail docs: any publicProducts/{storeId}__* not in keepIds.
  const snap = await getDocs(
    query(collection(db, "publicProducts"), where("storeSlug", "==", store.slug))
  );
  for (const d of snap.docs) {
    if (!keepIds.has(d.id)) writes.push(deleteDoc(d.ref));
  }

  await Promise.all(writes);
}

/** Remove a store's entire public projection (storefront + catalog + products + slug). */
export async function unprojectPublicForStore(store: Store): Promise<void> {
  const { db } = getFirebase();
  const writes: Promise<unknown>[] = [];
  writes.push(deleteDoc(doc(db, "publicStores", store.slug)));
  writes.push(deleteDoc(doc(db, "publicCatalogs", store.slug)));
  writes.push(releaseSlug(store.slug));
  const snap = await getDocs(query(collection(db, "publicProducts"), where("storeSlug", "==", store.slug)));
  for (const d of snap.docs) writes.push(deleteDoc(d.ref));
  await Promise.all(writes);
}

/**
 * Upsert one product's public projection (detail doc + catalog summary). If the
 * product is not published, remove its detail doc and rebuild the catalog summary
 * so the grid drops it. Rebuilds the whole publicCatalogs doc because summaries
 * are a single array field — cheaper than arrayUnion/arrayRemove gymnastics at
 * this scale, and only runs on product save.
 */
export async function upsertPublicProduct(
  product: Product,
  storeSlug: string,
  allStoreProducts: Product[],
  categories: Category[],
  pricing?: PublicPricingSource
): Promise<void> {
  const { db } = getFirebase();
  const id = product.slug ? publicProductId(product.storeId, product.slug) : null;

  if (!isPublished(product)) {
    if (id) await deleteDoc(doc(db, "publicProducts", id)).catch(() => {});
  } else if (id) {
    await setDoc(doc(db, "publicProducts", id), projectPublicProductDetail(product, storeSlug, categories, pricing));
  }

  // Refresh the catalog summaries for this store.
  await rebuildPublicCatalog(storeSlug, product.storeId, allStoreProducts, pricing);
}

/** Remove one product's public detail doc by store + slug. Best-effort. */
export async function removePublicProductDoc(storeId: string, productSlug: string): Promise<void> {
  const { db } = getFirebase();
  await deleteDoc(doc(db, "publicProducts", publicProductId(storeId, productSlug))).catch(() => {});
}

/**
 * Rebuild ONLY the catalog summaries (no per-product detail writes), used after a
 * delete so the grid drops the removed piece without re-writing its detail doc.
 */
export async function rebuildPublicCatalog(
  storeSlug: string,
  storeId: string,
  products: Product[],
  pricing?: PublicPricingSource
): Promise<void> {
  const { db } = getFirebase();
  const published = products.filter((p) => p.storeId === storeId && isPublished(p));
  await setDoc(
    doc(db, "publicCatalogs", storeSlug),
    {
      storeSlug,
      products: published
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((p) => projectPublicProductSummary(p, storeSlug, pricing)),
    },
    { merge: true }
  );
}
