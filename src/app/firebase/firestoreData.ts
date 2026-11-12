import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  setDoc,
  deleteDoc,
  deleteField,
  onSnapshot,
  query,
  where,
  runTransaction,
  increment,
  arrayUnion,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebase } from "./config";
import { reservationDeltasForOrderChange, variantReservationDeltasForOrderChange } from "../../lib/inventory";
import { applyVariantDelta, isVariantProduct, totalStock } from "../../lib/variants";
import { purchaseExpenseAdjustment, purchaseInventoryUpdates } from "../../lib/purchases";
import { effectivePurchaseStatus, recalcPurchaseStatus, type PurchaseExpense } from "../../types";
import { effectiveOrderStatus, migrateOrder, paymentStatusForOrder } from "../../lib/orders";
import { rulesSignature } from "../../lib/pricingRules";
import { deliveryWithBalanceBlocked, uncoveredBalanceCents } from "../../features/orders/installments";
import { deliveryValidationError, orderFullyDelivered } from "../../lib/deliveries";
import {
  INHERITED_DEPOSIT_PAYMENT_ID,
  docReceivedCents,
  inheritedDepositRecord,
  orderMoneyAfterPayments,
  signedAmountCents,
} from "../../features/orders/payments";
import type { AppUser } from "./auth";
import type { AppState, Store, Storefront, Product, ProductVariant, Customer, Order, Category, Supplier, Purchase, OrderPayment, OrderCreditLedgerEntry, LooseExpense, ExpenseAssignment, OrderSaleExpense, SupplyConsumption, StorePackaging, PricingRulesConfig, PricingRule, OrderDelivery } from "../../types";
import { creditAvailableCents, pendingCents } from "../../features/orders/customerCredit";
import { incidentState } from "../../features/orders/incidents";
import { reconcileIncidentMoney } from "../../features/orders/incidentMoney";
import type { OrderIncident, OrderIncidentEvent } from "../../types";
import { formatMoneyExact, publicPrice } from "../../lib/money";
import { tiersForStore, defaultTier } from "../../lib/pricing";

/** Private writes may succeed before this public projection is denied/fails. */
export class PublicCatalogProjectionError extends Error {
  readonly originalError?: unknown;

  constructor(cause?: unknown) {
    super("No se pudo actualizar el catálogo público.");
    this.name = "PublicCatalogProjectionError";
    this.originalError = cause;
  }
}

// Cloud data adapter. The cloud analog of lib/storage.ts: the StoreProvider talks
// to this when signed in. Reads are scoped to the user (super_admin sees all
// stores; a member sees only stores whose memberUids include them). Writes go to
// the entity's own doc; security rules enforce membership server-side.

export const COLLECTIONS = ["stores", "products", "categories", "suppliers", "purchases", "customers", "orders", "expenses"] as const;
type CollectionName = (typeof COLLECTIONS)[number];

/** Load all cloud data visible to the user. */
export async function loadCloudState(user: AppUser): Promise<AppState> {
  const { db } = getFirebase();

  // Super_admins can operate every store, so they need the complete business
  // store docs (WhatsApp, storefront, pricing, and membership). Members remain
  // scoped to stores where they are members.
  let stores: Store[] = [];
  if (user.role === "super_admin") {
    const snap = await getDocs(collection(db, "stores"));
    stores = snap.docs.map((d) => ({ ...(d.data() as Store), id: d.id }));
  } else {
    const q = query(collection(db, "stores"), where("memberUids", "array-contains", user.uid));
    const snap = await getDocs(q);
    stores = snap.docs.map((d) => ({ ...(d.data() as Store), id: d.id }));
  }

  const storeIds = stores.map((s) => s.id);

  // Fetch each entity collection scoped to the accessible stores. For a
  // super_admin this is the full collection (no `in`-query size limit); for
  // members it remains scoped to their store set.
  async function forStores<T extends { storeId: string }>(name: "products" | "categories" | "suppliers" | "purchases" | "customers" | "orders" | "expenses"): Promise<T[]> {
    if (storeIds.length === 0) return [];
    const q = user.role === "super_admin"
      ? collection(db, name)
      : query(collection(db, name), where("storeId", "in", storeIds));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
  }

  const [products, categories, suppliers, purchases, customers, orders, expenses] = await Promise.all([
    forStores<Product>("products"),
    forStores<Category>("categories"),
    forStores<Supplier>("suppliers"),
    forStores<Purchase>("purchases"),
    forStores<Customer>("customers"),
    forStores<Order>("orders"),
    forStores<LooseExpense>("expenses"),
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
    expenses,
  };
}

/** Subscribe to live cloud updates; returns an unsubscribe. */
export function subscribeCloudState(
  user: AppUser,
  onChange: (state: AppState) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const { db } = getFirebase();
  // Both roles subscribe to the stores they can see, then scope entity listeners
  // by those store ids (see below). A super_admin sees every full store doc;
  // members see only their member stores.
  const storesQ =
    user.role === "super_admin"
      ? collection(db, "stores")
      : query(collection(db, "stores"), where("memberUids", "array-contains", user.uid));

  // Re-load everything on any entity change. Watch all four collections so edits
  // made on another device propagate live (not just stores).
  //
  // Scoping: members use `where("storeId", "in", [...])` and must NEVER
  // receive another store's entities over the wire. A super_admin uses the
  // full entity collection, which avoids the Firestore `in` limit.
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
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error("Firestore request failed."));
      }
    }, DEBOUNCE_MS);
  };

  const unsubscribers: Unsubscribe[] = [];
  // If teardown runs before the member's one-shot store read resolves, stop
  // registering listeners (and avoid leaking after teardown).
  let tornDown = false;

  // Stores listener is always live — storesQ is already role-scoped above.
  unsubscribers.push(onSnapshot(storesQ, triggerReload, onError));

  // Members use storeId-filtered listeners because Firestore rules cannot use
  // rules as filters. Super_admins can use full collection listeners because
  // their role is independent of resource data and avoids the `in` limit.
  // If a member is added to a new store mid-session, storesQ fires and the full
  // state reloads; the next subscription is scoped to the new store set.
  function registerEntityListeners(storeIds: string[]) {
    if (tornDown) return;
    if (storeIds.length === 0 && user.role !== "super_admin") return;
    for (const name of ["products", "categories", "suppliers", "purchases", "customers", "orders", "expenses"] as const) {
      const entityQ = user.role === "super_admin"
        ? collection(db, name)
        : query(collection(db, name), where("storeId", "in", storeIds));
      unsubscribers.push(onSnapshot(entityQ, triggerReload, onError));
    }
  }

  // Read accessible stores once, then register scoped listeners.
  getDocs(storesQ)
    .then((snap) => {
      // Both roles receive stores/{id} docs here; the super_admin query is global
      // and the member query is scoped by membership. Both yield store ids.
      registerEntityListeners(snap.docs.map((d) => d.id));
    })
    .catch((error) => {
      onError?.(error instanceof Error ? error : new Error("Firestore request failed."));
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
 * Control-plane projection of a store: adminStores/{id} carries only the
 * allow-listed membership metadata used by rules. Business data stays in
 * stores/{id}; super_admins may access both planes when operating a store.
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
  const out: Record<string, unknown> = { storeId: store.id };
  for (const key of ["name", "slug", "type", "ownerUid", "memberUids", "createdAt", "updatedAt"] as const) {
    if (store[key] !== undefined) out[key] = store[key];
  }
  // Defaults only when the caller passed membership (a full store object):
  // updateStore persists PATCHES now, and a partial patch must never reset the
  // control doc's invites or counters (Firestore merge keeps the stored values).
  if (store.pendingInvites !== undefined) out.pendingInvites = store.pendingInvites;
  else if (store.memberUids !== undefined) out.pendingInvites = [];
  if (store.retainedPrivacyRequestCount !== undefined) out.retainedPrivacyRequestCount = store.retainedPrivacyRequestCount;
  else if (store.memberUids !== undefined) out.retainedPrivacyRequestCount = 0;
  return out;
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
  // Explicitly clearing a customer's assigned tier must remove the old field
  // from a merge write; omitting undefined alone would leave it in Firestore.
  if (name === "customers" && Object.prototype.hasOwnProperty.call(data, "assignedPriceTierId") && data.assignedPriceTierId === undefined) {
    clean.assignedPriceTierId = deleteField();
  }
  // Same rule for a removed manual Iconic grant (FER-05): clearing both dates
  // in the form must actually delete the field, not silently keep the old one.
  if (name === "customers" && Object.prototype.hasOwnProperty.call(data, "iconic") && data.iconic === undefined) {
    clean.iconic = deleteField();
  }
  // #184/#255: un-checking "simplified treatment" on an expense edit must
  // remove the flag from the merge write; stripping undefined alone would
  // keep the stored true and strand the supply stash as "Reconocido".
  if (name === "expenses" && Object.prototype.hasOwnProperty.call(data, "simplifiedOperation") && data.simplifiedOperation === undefined) {
    clean.simplifiedOperation = deleteField();
  }

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

  // Orders are rewritten as canonical snapshots during migration/save. A full
  // replace removes legacy flat fields that merge writes would leave behind.
  await setDoc(doc(db, name, id), clean, name === "orders" ? { merge: false } : { merge: true });
}

/** #253: save ONLY the store's packaging profile. Members reach this through a
 * field-scoped rules exception (packaging + updatedAt and nothing else); the
 * adminStores batch is deliberately skipped — packaging is business content,
 * not membership/control data (G-P02 targets membership-carrying writes). */
export async function saveStorePackaging(
  store: Pick<Store, "id">,
  packaging: StorePackaging,
  updatedAt: string
): Promise<void> {
  const { db } = getFirebase();
  await setDoc(doc(db, "stores", store.id), { packaging: stripUndefined(packaging), updatedAt }, { merge: true });
}

/** #254: save the store's LEVEL rules — same member-reachable, field-scoped
 * path as packaging (#253): every settings field must stay unchanged (rules),
 * and the adminStores control batch is skipped. #280: transactional byTier
 * overlay — the Reglas editor only owns `byTier`, so a tab holding a stale
 * clone can no longer replace the whole `pricingRules` field and delete
 * category tables / product exceptions saved meanwhile elsewhere. */
export async function savePricingRules(
  store: Pick<Store, "id">,
  pricingRules: PricingRulesConfig,
  updatedAt: string
): Promise<void> {
  const { db } = getFirebase();
  const storeRef = doc(db, "stores", store.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(storeRef);
    if (!snap.exists()) throw new Error("No se encontró la tienda.");
    const current = (snap.data().pricingRules ?? {}) as PricingRulesConfig;
    const byTier = pricingRules.byTier ?? {};
    tx.update(storeRef, { pricingRules: stripUndefined({ ...current, byTier }), updatedAt });
  });
}

/** Thrown by saveCategoryPricingRules when the category's saved table changed
 *  since the client loaded it (P0-2): the save is REFUSED, nothing is lost,
 *  and the UI must offer to reload and re-apply. */
export class CategoryRulesConflictError extends Error {
  constructor() {
    super("La tabla de esta categoría cambió en otra sesión. Recárgala y vuelve a aplicar tus cambios.");
    this.name = "CategoryRulesConflictError";
  }
}

/** #289: PRICE-SCOPED product writes. Applies ONLY each product's `prices`
 *  map (+updatedAt) in atomic batches of 400 — stock, cost, photos or any
 *  other field edited while Fer reviewed prices can never be clobbered by a
 *  stale full-object write (that was the upsertProduct hazard). Rules path
 *  unchanged: members update their store's products with storeId untouched. */
export async function applyProductPrices(
  _store: Pick<Store, "id">,
  updates: Array<{ id: string; prices: Record<string, number> }>,
  updatedAt: string
): Promise<void> {
  const { db } = getFirebase();
  for (let start = 0; start < updates.length; start += 400) {
    const batch = writeBatch(db);
    for (const update of updates.slice(start, start + 400)) {
      batch.set(doc(db, "products", update.id), { prices: stripUndefined(update.prices), updatedAt }, { merge: true });
    }
    await batch.commit();
  }
}

/** #280: save ONE category's band table transactionally. The whole
 * `pricingRules` field is replaced (merge:true at the doc level would keep a
 * deleted category alive), so the new value is built from the FRESH doc inside
 * the transaction: `byTier`, `byProduct` and every OTHER category survive by
 * construction, concurrent edits to them can no longer be clobbered by a
 * stale client config, and a `null` rules value really deletes the category.
 * P0-2: `expectedSignature` (rulesSignature of the table the client loaded)
 * is compared against the fresh doc INSIDE the transaction — a same-category
 * concurrent edit no longer silently loses to last-write-wins; the save is
 * rejected with CategoryRulesConflictError instead. Same member-reachable,
 * field-scoped write as savePricingRules. */
export async function saveCategoryPricingRules(
  store: Pick<Store, "id">,
  categoryId: string,
  rules: Record<string, PricingRule> | null,
  updatedAt: string,
  expectedSignature: string
): Promise<void> {
  const { db } = getFirebase();
  const storeRef = doc(db, "stores", store.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(storeRef);
    if (!snap.exists()) throw new Error("No se encontró la tienda.");
    const current = (snap.data().pricingRules ?? {}) as PricingRulesConfig;
    // Normalize: byTier is required by the type but legacy docs written before
    // this normalization can lack it — never persist a config without it.
    current.byTier = current.byTier ?? {};
    const savedNow = current.byCategory?.[categoryId] ?? null;
    if (rulesSignature(savedNow) !== expectedSignature) throw new CategoryRulesConflictError();
    const byCategory = { ...(current.byCategory ?? {}) };
    if (rules === null) delete byCategory[categoryId];
    else byCategory[categoryId] = rules;
    tx.update(storeRef, { pricingRules: stripUndefined({ ...current, byCategory }), updatedAt });
  });
}

/**
 * Single-value storefront text slots whose CLEARED state ("") must delete the
 * remote field. A write with the key omitted (undefined) would silently
 * resurrect the old value after reload (#332): the inline editor keeps "" in
 * the draft precisely so this boundary can turn it into an explicit delete.
 */
const STOREFRONT_TEXT_DELETE_SLOTS = ["shipping", "hours", "notice", "instagram"] as const;

/**
 * Storefront map ready for Firestore: undefined stripped (setDoc rejects it)
 * and cleared text slots deleted. `merge` maps them to deleteField() (the
 * batch writes with merge:true); `replace` just drops the key — a full-replace
 * set() rejects deleteField() and absence IS the deletion. Both end with the
 * field absent remotely (#332).
 */
function storefrontForWrite(storefront: Storefront, mode: "merge" | "replace"): Record<string, unknown> {
  const clean = stripUndefined(storefront) as Record<string, unknown>;
  for (const slot of STOREFRONT_TEXT_DELETE_SLOTS) {
    if (clean[slot] === "") {
      if (mode === "merge") clean[slot] = deleteField();
      else delete clean[slot];
    }
  }
  return clean;
}

/** Save editable storefront text to its private, control, and public projections atomically. */
export async function saveStorefrontBatch(store: Pick<Store, "id" | "slug">, storefront: Storefront, updatedAt: string): Promise<void> {
  const { db } = getFirebase();
  const batch = writeBatch(db);
  const clean = storefrontForWrite(storefront, "merge");
  batch.set(doc(db, "stores", store.id), { storefront: clean, updatedAt }, { merge: true });
  batch.set(doc(db, "adminStores", store.id), { storeId: store.id }, { merge: true });
  batch.set(doc(db, "publicStores", store.slug), { storeId: store.id, storefront: clean }, { merge: true });
  await batch.commit();
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

/** The order changed on another device after this editor loaded it. */
export class StaleOrderError extends Error {
  constructor() {
    super("El pedido cambió en otro dispositivo. Vuelve a entrar para ver la versión reciente.");
    this.name = "StaleOrderError";
  }
}

export type StockAdjustment = { productId: string; quantityOnHand: number };

/**
 * Pure: apply RELATIVE deltas to the canonical quantities read inside the
 * transaction. Products missing from `canonical` (deleted concurrently, or
 * without a quantity) are skipped and reported — same tolerance the local
 * reducer has for products deleted while an order still references them.
 */
export function applyRelativeDeltas(
  canonical: Map<string, number | undefined>,
  deltas: Map<string, number>
): { updates: StockAdjustment[]; skipped: string[] } {
  const updates: StockAdjustment[] = [];
  const skipped: string[] = [];
  for (const [productId, delta] of deltas) {
    const current = canonical.get(productId);
    if (typeof current !== "number") {
      skipped.push(productId);
      continue;
    }
    updates.push({ productId, quantityOnHand: current + delta });
  }
  return { updates, skipped };
}

/**
 * #165/#168 → PO 2026-11-03 (R9): delivering with an uncovered balance is
 * ALLOWED when the operator explicitly confirms it (retroactive capture /
 * cash-on-delivery). Without the confirmation the mutation path rejects the
 * transition (the UI hiding buttons is not the guarantee); WITH it, the save
 * stamps the recorded authorization on the order doc. The message points at
 * the cobros sheet first — the saldo is doc truth, so re-registering an abono
 * that already landed would duplicate money.
 */
export class DeliveryWithBalanceError extends Error {
  constructor(public readonly balanceCents: number) {
    super("No se puede confirmar la entrega: este pedido tiene saldo pendiente. Revisa los cobros del pedido y registra solo el abono que falte.");
    this.name = "DeliveryWithBalanceError";
  }
}

/** Preserve the parent of immutable payment evidence and retained reservations. */
export class OrderEvidenceDeletionError extends Error {
  constructor() {
    super("Este pedido conserva cobros o piezas apartadas y no se puede eliminar. Conserva el pedido para revisar su historial.");
    this.name = "OrderEvidenceDeletionError";
  }
}

/**
 * Stock shortage on the canonical shelf. NOTE (PO 2026-11-03 R8): order saves
 * do NOT hard-block on shelf quantity — plan orders reserve at creation exactly
 * like ordinary ones, and the shelf may go negative (the UI surfaces the
 * existence). Retained for callers that pre-validate.
 */
export class InsufficientStockError extends Error {
  constructor(public readonly shortages: { productId: string; missing: number }[]) {
    super("No hay existencias suficientes para apartar las piezas de este pedido. Surte inventario y vuelve a intentar.");
    this.name = "InsufficientStockError";
  }
}

/**
 * Save an order using canonical stock and an idempotent operation identifier.
 *
 * #165/#168 money guarantees evaluate the ORDER DOC read inside this
 * transaction — never the caller's session: `paymentsReceivedCents` (the
 * transactional accumulator maintained by registerOrderPaymentTx) plus the
 * still-unmaterialized legacy deposit are the truth of received money, so a
 * fresh session with no payment records loaded can no longer undercount them.
 */
export async function saveOrderWithStockTx(
  user: AppUser,
  order: Order,
  expectedRevision: number | null,
  mutationId: string,
  options?: { confirmDeliveredWithBalance?: boolean; depositCorrectionNote?: string }
): Promise<{ order: Order; stock: StockAdjustment[]; variantStock?: Array<{ productId: string; variants: ProductVariant[] }> }> {
  const { db } = getFirebase();
  const orderRef = doc(db, "orders", order.id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    const previous = snap.exists() ? migrateOrder({ ...snap.data(), id: order.id }) : undefined;
    if (previous && previous.storeId !== order.storeId) throw new StaleOrderError();
    if (previous?.lastMutationId === mutationId) return { order: previous, stock: [] };
    if (previous ? expectedRevision == null || (previous.revision ?? 0) !== expectedRevision : expectedRevision != null) {
      throw new StaleOrderError();
    }
    // #168: the money fields belong to the payment path — an order save carries
    // them through VERBATIM from the doc read here, so a full-document write
    // can never wipe a concurrent abono's accumulator (Firestore retries this
    // transaction whenever the doc changed after this read).
    const docData = snap.data() as Record<string, unknown> | undefined;
    // #218: full saves cannot invent legacy money after payment evidence.
    // Use the RAW deposit: migration can inflate it for legacy paid orders.
    const rawDeposit = typeof docData?.deposit === "number" && Number.isFinite(docData.deposit) ? docData.deposit : 0;
    const depositPinned = docData?.inheritedDepositMaterialized === true ? rawDeposit
      : typeof docData?.paymentsReceivedCents === "number" ? Math.min(order.deposit ?? 0, rawDeposit)
      : (order.deposit ?? 0);
    // #271 (PO 2026-11-09): silently LOWERING the deposit on an order that
    // already has payment evidence erased real money from the view (legacy
    // anticipo + adjustment-created accumulator → edit down → $400 gone with
    // no trace). The silent path is gone: a lowering below the doc's raw
    // value requires the operator's motive and lands as a SIGNED correction
    // entry (who / from → to / why / when) — the #218 sanctioned repair now
    // leaves its justification too. The auto-pin above (form above raw →
    // clamps back to the doc's own value) is NOT a lowering: it writes raw.
    const correctionsCarried = Array.isArray(docData?.depositCorrections)
      ? (docData.depositCorrections as Order["depositCorrections"])
      : undefined;
    const depositLoweringWithEvidence =
      typeof docData?.paymentsReceivedCents === "number" &&
      docData?.inheritedDepositMaterialized !== true &&
      (order.deposit ?? 0) < rawDeposit;
    let depositCorrections = correctionsCarried;
    if (depositLoweringWithEvidence) {
      const note = options?.depositCorrectionNote?.trim();
      if (!note) {
        throw new Error(
          "Bajar el anticipo con cobros registrados requiere el motivo de la corrección: queda como registro firmado de quién, cuánto y por qué."
        );
      }
      depositCorrections = [
        ...(correctionsCarried ?? []),
        { from: rawDeposit, to: depositPinned, note, by: user.uid, at: new Date().toISOString() },
      ];
    }
    const next: Order = {
      ...order,
      deposit: depositPinned,
      // A caller can neither erase existing evidence nor invent it on create.
      // Only the canonical doc (or the payment transaction) owns these fields.
      installmentsReservedAt: previous?.installmentsReservedAt,
      lastPaymentId: typeof docData?.lastPaymentId === "string" ? docData.lastPaymentId : undefined,
      paymentsRevision: typeof docData?.paymentsRevision === "number" ? docData.paymentsRevision : undefined,
      paymentsReceivedCents: typeof docData?.paymentsReceivedCents === "number" ? docData.paymentsReceivedCents : undefined,
      inheritedDepositMaterialized: docData?.inheritedDepositMaterialized === true ? true : undefined,
      // #189 (review F1): the credit fields belong to the compensation
      // transactions exactly like the money fields above — an order save
      // carries them through VERBATIM so a full-document write can never wipe
      // a compensation (which would double-charge or invent money depending
      // on which side is edited). Only applyCustomerCreditTx / release-
      // CustomerCreditTx may write them.
      creditAppliedCents: typeof docData?.creditAppliedCents === "number" ? docData.creditAppliedCents : undefined,
      creditConsumedCents: typeof docData?.creditConsumedCents === "number" ? docData.creditConsumedCents : undefined,
      creditLedger: Array.isArray(docData?.creditLedger) ? (docData.creditLedger as Order["creditLedger"]) : undefined,
      // #203: same verbatim discipline — incidents (append-only evidence on
      // this order) belong to the incident transactions, never to a form save.
      incidents: Array.isArray(docData?.incidents) ? (docData.incidents as Order["incidents"]) : undefined,
      // #333: deliveries are append-only evidence owned by registerDeliveryTx;
      // an ordinary save carries them verbatim and can never edit or drop them.
      deliveries: Array.isArray(docData?.deliveries) ? (docData.deliveries as Order["deliveries"]) : undefined,
      // #271: deposit corrections are append-only signed evidence; a form
      // save carries them verbatim (plus its own entry on a justified lowering).
      ...(depositCorrections ? { depositCorrections } : {}),
      // #184: saleExpenses (loose-expense charges and supply consumptions)
      // belong to the expense transactions — same verbatim carry (review F1).
      saleExpenses: Array.isArray(docData?.saleExpenses) ? (docData.saleExpenses as Order["saleExpenses"]) : undefined,
    };
    next.paymentStatus = paymentStatusForOrder(next);
    // Received money per the doc: the stored accumulator plus the deposit in
    // this save (a deposit captured in the same edit also counts) — the
    // conservative max, since records are immutable evidence. The accumulator
    // alone is what TRIGGERS the delivery gate for plan-less orders (#168 F1).
    const docMoney = {
      accumulatorCents: Math.max(previous?.paymentsReceivedCents ?? 0, next.paymentsReceivedCents ?? 0),
      receivedCents: Math.max(docReceivedCents(previous ?? {}), docReceivedCents(next)),
    };
    // #165/#168 F2: converting an ordinary order that already received money
    // marks the reservation immediately — an open ordinary order already held
    // the pieces, so the mark lands with zero stock delta.
    if (next.installments && !previous?.installments && docMoney.receivedCents > 0 && !next.installmentsReservedAt) {
      next.installmentsReservedAt = new Date().toISOString();
    }
    // #165/#168 F1 → PO 2026-11-03 (R9): the transition INTO delivered still
    // fires the gate for a plan order or any order with registered cobros
    // whose doc money does not cover the total — but the operator may now
    // EXPLICITLY confirm delivering with a saldo (retroactive capture /
    // contraentrega). Unconfirmed → reject; confirmed → stamp the recorded
    // authorization. Removing the plan with a saldo changes nothing.
    const delivering =
      effectiveOrderStatus(next) === "delivered" &&
      (!previous || effectiveOrderStatus(previous) !== "delivered");
    if (delivering && deliveryWithBalanceBlocked(next, docMoney)) {
      // #189 (review F2): the recorded saldo is the NET uncovered figure —
      // saldo a favor already applied to this order counts as covered, the
      // same "Pendiente por pagar" every read model shows.
      const saldoCents = uncoveredBalanceCents(next, docMoney);
      if (!options?.confirmDeliveredWithBalance) {
        throw new DeliveryWithBalanceError(saldoCents);
      }
      next.deliveredWithBalanceCents = saldoCents;
      next.deliveredWithBalanceConfirmedAt = new Date().toISOString();
      next.deliveredWithBalanceConfirmedBy = user.uid;
    }
    const deltas = reservationDeltasForOrderChange(previous, next);
    // #124: per-exact-color reservations — a variant line moves its color's
    // stock inside the same transaction (cancel/restore comes free from the
    // delta model). Fail-closed on a missing color: stock never lands on the
    // design level by accident.
    const variantDeltas = variantReservationDeltasForOrderChange(previous, next);
    const canonical = new Map<string, number | undefined>();
    const shortages: { productId: string; missing: number }[] = [];
    for (const [productId, delta] of deltas) {
      const product = await tx.get(doc(db, "products", productId));
      if (product.exists() && product.data().storeId !== order.storeId) throw new Error("El producto pertenece a otra tienda.");
      // #124/M2: a legacy line (no color) on a design that NOW sells by color
      // would take phantom, unsellable stock — fail closed and say which
      // product. Releases still land at the design level (real pieces back on
      // a visible shelf) so an old order can always be cancelled.
      const productIsVariant = product.exists() && isVariantProduct({ variants: (product.data().variants as Product["variants"]) ?? [] });
      if (productIsVariant && delta < 0) {
        const name = (product.data().name as string | undefined) ?? "una pieza";
        throw new Error(`${name} ya se vende por color: elige el color en el artículo del pedido.`);
      }
      let current = product.exists() ? product.data().quantityOnHand as number | undefined : undefined;
      // #124/M2: a legacy-line RELEASE on a variant design lands on its
      // design-level shelf — seeded at 0 when the field was never used, so
      // the release is never dropped into the skipped bucket.
      if (productIsVariant && delta > 0 && typeof current !== "number") current = 0;
      canonical.set(productId, current);
      // Expanding an existing reservation uses the same sufficiency guarantee
      // as its first abono. Releases remain possible even with a prior shortage.
      if (next.installmentsReservedAt && delta < 0 && typeof current === "number" && current + delta < 0) {
        shortages.push({ productId, missing: -(current + delta) });
      }
    }
    if (shortages.length > 0) throw new InsufficientStockError(shortages);
    const { updates } = applyRelativeDeltas(canonical, deltas);
    const at = new Date().toISOString();
    // Variant writes: read the design doc canonically, apply each color delta
    // to the variant's own quantityOnHand, write the whole variants array.
    const variantWrites = new Map<string, unknown[]>();
    const releases = new Map<string, number>();
    for (const vDelta of variantDeltas.values()) {
      const product = await tx.get(doc(db, "products", vDelta.productId));
      if (product.exists() && product.data().storeId !== order.storeId) throw new Error("El producto pertenece a otra tienda.");
      const data = product.exists() ? product.data() as Record<string, unknown> : {};
      const variants = data.variants as Product["variants"];
      const variant = variants?.find((v) => v.id === vDelta.variantId);
      // #124/M3: a vanished color — the release (cancellation) returns REAL
      // pieces somewhere visible: the design-level shelf. A take always fails
      // closed (you cannot reserve a color that no longer exists).
      if (!isVariantProduct({ variants }) || !variant) {
        if (vDelta.delta > 0) {
          // Route through the SINGLE product-level write below (never a second
          // tx.update on the same doc — last-write-wins would lose one).
          const existing = releases.get(vDelta.productId);
          releases.set(vDelta.productId, (existing ?? 0) + vDelta.delta);
          continue;
        }
        throw new Error(isVariantProduct({ variants })
          ? "El color elegido ya no existe en este diseño."
          : "Esa pieza ya no se vende por color; revisa el pedido.");
      }
      if (next.installmentsReservedAt && vDelta.delta < 0) {
        const current = typeof variant.quantityOnHand === "number" ? variant.quantityOnHand : 0;
        if (current + vDelta.delta < 0) {
          throw new InsufficientStockError([{ productId: vDelta.productId, missing: -(current + vDelta.delta) }]);
        }
      }
      let working = variants!;
      const accumulated = variantWrites.get(vDelta.productId) as Product["variants"] | undefined;
      if (accumulated) working = accumulated;
      const nextVariants = applyVariantDelta({ variants: working }, vDelta.variantId, vDelta.delta, at);
      if (!nextVariants) throw new Error("El color elegido ya no existe en este diseño.");
      variantWrites.set(vDelta.productId, nextVariants);
    }
    const saved = { ...next, revision: (previous?.revision ?? 0) + 1, lastMutationId: mutationId, updatedAt: at };
    // Merge vanished-color releases into the same product-level updates (or
    // add them from the canonically-read value).
    const finalUpdates = [...updates];
    for (const [productId, release] of releases) {
      const target = finalUpdates.find((u) => u.productId === productId);
      if (target) target.quantityOnHand += release;
      else {
        const releaseSnap = await tx.get(doc(db, "products", productId));
        const current = typeof (releaseSnap.data() as Record<string, unknown> | undefined)?.quantityOnHand === "number"
          ? ((releaseSnap.data() as Record<string, unknown>).quantityOnHand as number)
          : 0;
        finalUpdates.push({ productId, quantityOnHand: current + release });
      }
    }
    for (const update of finalUpdates) tx.update(doc(db, "products", update.productId), { quantityOnHand: update.quantityOnHand, updatedAt: at });
    for (const [productId, variants] of variantWrites) tx.update(doc(db, "products", productId), { variants, updatedAt: at });
    const { id, ...data } = saved;
    tx.set(orderRef, stripUndefined(data) as Record<string, unknown>, { merge: false });
    // #124/H1-twin: the caller reconciles in-memory state and republishes the
    // public signal from these — the color shelves must ride along.
    const variantStock = [...variantWrites.entries()].map(([productId, variants]) => ({
      productId,
      variants: variants as ProductVariant[],
    }));
    return { order: saved, stock: finalUpdates, ...(variantStock.length > 0 ? { variantStock } : {}) };
  });
}

export type OrderPaymentsResult = { payments: OrderPayment[]; order: Order };

/** Bracket server receipt details with a stable parent version, never cached success. */
export async function fetchOrderPayments(orderId: string): Promise<OrderPaymentsResult> {
  const { db } = getFirebase();
  const ref = doc(db, "orders", orderId);
  const before = await getDocFromServer(ref);
  if (!before.exists()) throw new Error("No se encontró el pedido.");
  const snap = await getDocsFromServer(collection(db, "orders", orderId, "payments"));
  const parent = await getDocFromServer(ref);
  if (!parent.exists()) throw new Error("No se encontró el pedido.");
  if ((before.data().paymentsRevision ?? 0) !== (parent.data().paymentsRevision ?? 0)) {
    throw new Error("Los cobros cambiaron mientras se cargaban. Vuelve a cargar el detalle.");
  }
  return {
    payments: snap.docs.map((d) => ({ ...(d.data() as OrderPayment), id: d.id }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    order: migrateOrder({ ...parent.data(), id: orderId }),
  };
}

/**
 * Register one payment on its order, idempotently (#123). The record id is
 * stable per user intent: a retry first re-reads the doc and returns it without
 * writing, so resends never duplicate. In the SAME transaction, the legacy
 * `deposit` is materialized once as an inherited record (deterministic id)
 * carrying the date/method supplied by the operator — estimated when unknown,
 * never left as "unknown" (PO decision 2026-11-03). Materialization only rides
 * along a real payment, never an adjustment — and the order's doc-level money
 * accumulator `paymentsReceivedCents` absorbs the registration's signed cents
 * (#168), so the document is always the truth of received money. Payment docs
 * are create-only evidence (see firestore.rules); corrections are new signed
 * records, which is why this path never updates an existing PAYMENT doc (the
 * parent order doc only gains the accumulator + reservation fields).
 *
 * #165 → PO 2026-11-03 (R8): plan orders reserve their quantities AT CREATION
 * (same contribution model as ordinary orders), so an abono never moves stock
 * here. The FIRST confirmed positive abono still stamps the
 * `installmentsReservedAt` witness on the order doc — money-backed stock is
 * never released by cancellation alone. Insufficient stock surfaces at order
 * creation, not at payment time.
 */
export async function registerOrderPaymentTx(
  payment: OrderPayment,
  inherited?: { method: "cash" | "transfer"; date: string }
): Promise<OrderPaymentsResult> {
  const { db } = getFirebase();
  const orderRef = doc(db, "orders", payment.orderId);
  let attempts = 0;
  let observed: Record<string, unknown> | undefined;
  const register = () => runTransaction(db, async (tx) => {
    observed = undefined;
    attempts += 1;
    // READ PHASE (Firestore requires every read before any write).
    const paymentsRef = collection(db, "orders", payment.orderId, "payments");
    const paymentRef = doc(paymentsRef, payment.id);
    const orderSnap = await tx.get(orderRef);
    observed = orderSnap.data();
    if (!orderSnap.exists()) throw new Error("No se encontró el pedido.");
    if ((orderSnap.data().storeId ?? "") !== payment.storeId) {
      throw new Error("El pedido pertenece a otra tienda.");
    }
    const order = migrateOrder({ ...orderSnap.data(), id: payment.orderId });
    const existing = await tx.get(paymentRef);
    if (existing.exists()) {
      const receipt = existing.data() as OrderPayment;
      if (receipt.amount !== payment.amount || receipt.kind !== payment.kind || receipt.method !== payment.method
          || (payment.kind === "payment" && receipt.date !== payment.date)
          || (receipt.note ?? "") !== (payment.note ?? "") || receipt.createdBy !== payment.createdBy) {
        throw new Error("Este intento ya tiene otros datos guardados. Revisa los cobros antes de continuar.");
      }
      return { payments: [receipt], order };
    }
    // Inherited deposit materialization (#123, PO 2026-11-03): only a real
    // payment carries it, and the operator-supplied date/method is required.
    const inheritedInput = payment.kind === "payment" ? inherited : undefined;
    const inheritedRef = doc(paymentsRef, INHERITED_DEPOSIT_PAYMENT_ID);
    const inheritedSnap = await tx.get(inheritedRef);
    let inheritedRecord: OrderPayment | null = null;
    if (payment.kind === "payment" && !inheritedSnap.exists()) {
      const deposit = orderSnap.data().deposit;
      const pending = typeof deposit === "number" ? deposit : 0;
      if (pending > 0 && !inheritedInput) {
        throw new Error("Captura la fecha y el método del anticipo previo.");
      }
      inheritedRecord = inheritedDepositRecord(
        payment.orderId,
        payment.storeId,
        pending,
        payment.createdBy,
        inheritedInput as { method: "cash" | "transfer"; date: string }
      );
    }

    // PO 2026-11-03 (R8): plan orders reserve stock AT CREATION like ordinary
    // ones — an abono no longer moves stock. The first positive abono only
    // STAMPS the `installmentsReservedAt` witness (money-backed stock is never
    // released by cancellation alone); no revision bump is needed because the
    // reservation already happened on the order's own save. (`order` comes from
    // the early-return block above.)
    const firstPositiveAbono = payment.kind === "payment" && payment.amount > 0;

    // WRITE PHASE — one atomic commit: evidence, witness, and the doc-level
    // money accumulator (#168). The accumulator folds this registration's
    // signed cents (and the inherited deposit's, exactly once when it
    // materializes) into `paymentsReceivedCents`, so the ORDER DOC is the
    // truth of received money — a fresh session cannot undercount it.
    // Unsafe precision aborts the whole registration (fail-closed on writes).
    let savedCents: number;
    try {
      savedCents = signedAmountCents(payment.amount) + (inheritedRecord ? signedAmountCents(inheritedRecord.amount) : 0);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new Error("El monto del cobro excede la precisión admitida.");
      }
      throw error;
    }
    // #270 (PO 2026-11-09): a subtract adjustment is capped at what THIS order
    // received — `paymentsReceivedCents` never crosses into negative territory
    // (phantom debt that a compensation would drain from a sister order's real
    // saldo a favor). The pending inherited deposit is NOT subtractable: it is
    // not in the accumulator yet. firestore.rules enforces the same invariant
    // server-side; this guard fails with a human, actionable message instead
    // of a raw PERMISSION_DENIED. A legacy negative can only climb (Sumar).
    if (payment.kind === "adjustment" && savedCents < 0) {
      const acc = orderSnap.data().paymentsReceivedCents;
      const current = typeof acc === "number" && Number.isFinite(acc) ? acc : 0;
      if (current + savedCents < 0) {
        throw new Error(
          `El ajuste excede lo recibido en este pedido. Puedes restar hasta ${formatMoneyExact(Math.max(0, current) / 100)}.`
        );
      }
    }
    const money = orderMoneyAfterPayments(orderSnap.data(), savedCents, !!inheritedRecord);
    const previousPaymentsRevision = orderSnap.data().paymentsRevision ?? 0;
    const paymentsRevision = previousPaymentsRevision + 1;
    if (!Number.isSafeInteger(previousPaymentsRevision) || previousPaymentsRevision < 0 || !Number.isSafeInteger(paymentsRevision)) {
      throw new Error("La versión de cobros del pedido no es válida.");
    }
    const receipt = { ...payment, amountCents: signedAmountCents(payment.amount) };
    const saved: OrderPayment[] = [];
    if (inheritedRecord) {
      const evidence = { ...inheritedRecord, amountCents: signedAmountCents(inheritedRecord.amount) };
      tx.set(inheritedRef, stripUndefined(evidence) as Record<string, unknown>);
      saved.push(evidence);
    }
    const witnessAt =
      order.installments && !order.installmentsReservedAt && firstPositiveAbono
        ? new Date().toISOString()
        : undefined;
    tx.update(orderRef, {
      paymentsReceivedCents: increment(savedCents),
      lastPaymentId: payment.id,
      paymentsRevision: increment(1),
      ...(money.inheritedDepositMaterialized ? { inheritedDepositMaterialized: true } : {}),
      ...(witnessAt ? { installmentsReservedAt: witnessAt } : {}),
    });
    tx.set(paymentRef, stripUndefined(receipt) as Record<string, unknown>);
    saved.push(receipt);
    return {
      payments: saved,
      order: {
        ...order, ...money, lastPaymentId: payment.id, paymentsRevision,
        ...(witnessAt ? { installmentsReservedAt: witnessAt } : {}),
      },
    };
  }, { maxAttempts: 5 - attempts });

  while (attempts < 5) {
    observed = undefined;
    try {
      return await register();
    } catch (error) {
      // A concurrent first abono can make the immutable reservation/deposit
      // proof stale before the emulator reports ABORTED. Retry PERMISSION_DENIED
      // only when a SERVER read proves that this transaction's parent changed.
      // Real authorization/content failures stay failures; intent ids are stable.
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "permission-denied" || !observed || attempts >= 5) throw error;
      const latest = await getDocFromServer(orderRef);
      const current = latest.data();
      const changed = current && ["revision", "paymentsReceivedCents", "lastPaymentId", "paymentsRevision", "inheritedDepositMaterialized", "installmentsReservedAt"]
        .some((key) => current[key] !== observed![key]);
      if (!changed) throw error;
    }
  }
  throw new Error("No se pudo registrar el cobro. Revisa los cobros guardados antes de reintentarlo.");
}

/**
 * #189: apply ONE planned compensation between two orders of the same clienta
 * and store, atomically (the #168 accumulator discipline). One commit touches
 * both documents: the destination gains `creditAppliedCents` + the immutable
 * ledger entry (arrayUnion), the origin gains its `creditConsumedCents`
 * mirror — mirrors can never drift. Idempotent on the entry id: a retry that
 * finds it already persisted returns success without applying twice. The
 * amounts are re-validated against the FRESH docs inside the transaction, so
 * a stale plan (concurrent cobro, edited total) aborts instead of inventing
 * money; the caller replans on the next trigger.
 */
export async function applyCustomerCreditTx(params: {
  entry: OrderCreditLedgerEntry;
  /** Destination order: the pending balance being compensated. */
  orderId: string;
  storeId: string;
}): Promise<void> {
  const { db } = getFirebase();
  const { entry, orderId, storeId } = params;
  if (entry.kind !== "application" || !Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0) {
    throw new Error("La compensación a aplicar no es válida.");
  }
  const destRef = doc(db, "orders", orderId);
  const originRef = doc(db, "orders", entry.fromOrderId);
  await runTransaction(db, async (tx) => {
    // READ PHASE (Firestore requires every read before any write).
    const destSnap = await tx.get(destRef);
    const originSnap = await tx.get(originRef);
    if (!destSnap.exists()) throw new Error("No se encontró el pedido a compensar.");
    if (!originSnap.exists()) throw new Error("No se encontró el pedido con el saldo a favor.");
    const destData = destSnap.data() as Record<string, unknown>;
    const originData = originSnap.data() as Record<string, unknown>;
    if ((destData.storeId ?? "") !== storeId || (originData.storeId ?? "") !== storeId) {
      throw new Error("Los pedidos pertenecen a otra tienda.");
    }
    if ((destData.customerId ?? "") !== (originData.customerId ?? "") || !destData.customerId) {
      throw new Error("El saldo a favor solo compensa pedidos de la misma clienta.");
    }
    if (destData.orderStatus === "cancelled" || originData.orderStatus === "cancelled") {
      throw new Error("Un pedido cancelado no participa en la compensación.");
    }
    const ledger = Array.isArray(destData.creditLedger) ? (destData.creditLedger as OrderCreditLedgerEntry[]) : [];
    if (ledger.some((saved) => saved.id === entry.id)) return; // idempotent retry
    // Fresh-doc validation: the planned amount must still fit both sides.
    if (creditAvailableCents(originData) < entry.amountCents) {
      throw new Error("El saldo a favor cambió mientras se aplicaba. Se reintentará con las cifras nuevas.");
    }
    if (pendingCents(destData) < entry.amountCents) {
      throw new Error("El saldo del pedido cambió mientras se aplicaba. Se reintentará con las cifras nuevas.");
    }
    // WRITE PHASE — one atomic commit across both documents.
    tx.update(destRef, {
      creditAppliedCents: increment(entry.amountCents),
      creditLedger: arrayUnion(stripUndefined(entry)),
      updatedAt: entry.at,
    });
    tx.update(originRef, {
      creditConsumedCents: increment(entry.amountCents),
    });
  });
}

/**
 * #189: restitute the credit a CANCELLED order had consumed, atomically. PO
 * decision 2026-11-05: cancelling a valid order that used saldo a favor
 * returns that credit to the clienta. For every origin still owed restitution
 * (net applications − releases from the ledger), the reversal is ONE commit:
 * destination accumulator down, origin mirror down, release entries appended
 * as evidence. Idempotent: re-running after a successful release finds net
 * zero and writes nothing.
 */
export async function releaseCustomerCreditTx(params: {
  orderId: string;
  storeId: string;
  by: string;
  /** "cancellation" (default): only a cancelled order restitutes — the PO
   * rule. "deletion": the order is about to be deleted; its consumed credit
   * is restituted so the origin's mirror never overstates consumption. */
  reason?: "cancellation" | "deletion";
}): Promise<number> {
  const { db } = getFirebase();
  const { orderId, storeId, by, reason = "cancellation" } = params;
  const destRef = doc(db, "orders", orderId);
  // Per-ATTEMPT accumulator: Firestore retries the transaction body on
  // conflicts, so a total accumulated across attempts would over-report.
  let released = 0;
  await runTransaction(db, async (tx) => {
    released = 0;
    const destSnap = await tx.get(destRef);
    if (!destSnap.exists()) return;
    const destData = destSnap.data() as Record<string, unknown>;
    if ((destData.storeId ?? "") !== storeId) return;
    if (reason === "cancellation" && destData.orderStatus !== "cancelled") return;
    const ledger = Array.isArray(destData.creditLedger) ? (destData.creditLedger as OrderCreditLedgerEntry[]) : [];
    const netByOrigin = new Map<string, number>();
    for (const saved of ledger) {
      if (saved.kind !== "application" || !Number.isSafeInteger(saved.amountCents)) continue;
      netByOrigin.set(saved.fromOrderId, (netByOrigin.get(saved.fromOrderId) ?? 0) + saved.amountCents);
    }
    for (const saved of ledger) {
      if (saved.kind !== "release" || !Number.isSafeInteger(saved.amountCents)) continue;
      netByOrigin.set(saved.fromOrderId, (netByOrigin.get(saved.fromOrderId) ?? 0) - saved.amountCents);
    }
    const entries: OrderCreditLedgerEntry[] = [];
    const writes: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
    let appliedDown = 0;
    for (const [fromOrderId, netCents] of netByOrigin) {
      if (netCents <= 0) continue;
      const originRef = doc(db, "orders", fromOrderId);
      const originSnap = await tx.get(originRef);
      if (!originSnap.exists() || (originSnap.data().storeId ?? "") !== storeId) continue;
      entries.push({
        id: `release_${orderId}_${fromOrderId}_${(ledger.filter((e) => e.kind === "release" && e.fromOrderId === fromOrderId).length) + 1}`,
        kind: "release",
        fromOrderId,
        amountCents: netCents,
        at: new Date().toISOString(),
        by,
      });
      writes.push({ ref: originRef, data: { creditConsumedCents: increment(-netCents) } });
      appliedDown += netCents;
      released += netCents;
    }
    if (entries.length === 0) return;
    tx.update(destRef, {
      creditAppliedCents: increment(-appliedDown),
      creditLedger: arrayUnion(...entries.map(stripUndefined)),
      updatedAt: entries[0].at,
    });
    for (const write of writes) tx.update(write.ref, write.data);
  });
  return released;
}

/** Release the canonical reservation and delete the matching revision atomically. */
export async function deleteOrderWithStockTx(
  _user: AppUser,
  orderId: string,
  expectedRevision: number
): Promise<StockAdjustment[] & { variantStock?: Array<{ productId: string; variants: ProductVariant[] }> }> {
  const { db } = getFirebase();
  const orderRef = doc(db, "orders", orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) return [];
    // #203: an order with a confirmed incident still holding quarantined
    // pieces cannot be deleted — the quarantine release lives on this ficha
    // (deleting it would orphan quantityQuarantined forever; review #212 F5).
    const orderIncidents = Array.isArray(snap.data().incidents) ? (snap.data().incidents as OrderIncident[]) : [];
    if (orderIncidents.some((incident) => {
      // repaired keeps the piece held (not released): it must still block.
      const quarantined = (incident.events ?? []).some((event) => event.kind === "confirmed")
        && !(incident.events ?? []).some((event) => event.kind === "provider_replacement" || event.kind === "returned_to_sale" || event.kind === "written_off");
      return quarantined;
    })) {
      throw new Error("El pedido tiene una incidencia con pieza retenida. Líbrala (autorizar venta, baja o reemplazo del proveedor) antes de borrar el pedido.");
    }
    const previous = migrateOrder({ ...snap.data(), id: orderId });
    if ((previous.revision ?? 0) !== expectedRevision) throw new StaleOrderError();
    // A zero accumulator can still have payments and offsetting adjustments.
    // Deleting the parent would orphan immutable evidence and retained stock.
    const data = snap.data();
    if (previous.installmentsReservedAt || "paymentsReceivedCents" in data || data.inheritedDepositMaterialized === true) {
      throw new OrderEvidenceDeletionError();
    }
    const cancelled = { ...previous, orderStatus: "cancelled" as const };
    const deltas = reservationDeltasForOrderChange(previous, cancelled);
    // #124: deleting releases COLOR shelves too — the same delta model, or
    // the exact-color pieces would never return to their shelf.
    const variantDeltas = variantReservationDeltasForOrderChange(previous, cancelled);
    const canonical = new Map<string, number | undefined>();
    for (const productId of deltas.keys()) {
      const product = await tx.get(doc(db, "products", productId));
      if (product.exists() && product.data().storeId !== previous.storeId) throw new Error("El producto pertenece a otra tienda.");
      canonical.set(productId, product.exists() ? product.data().quantityOnHand as number | undefined : undefined);
    }
    const { updates } = applyRelativeDeltas(canonical, deltas);
    const at = new Date().toISOString();
    const variantWrites = new Map<string, ProductVariant[]>();
    const releases = new Map<string, number>();
    for (const vDelta of variantDeltas.values()) {
      const product = await tx.get(doc(db, "products", vDelta.productId));
      if (product.exists() && product.data().storeId !== previous.storeId) throw new Error("El producto pertenece a otra tienda.");
      const data = (product.exists() ? product.data() : {}) as Record<string, unknown>;
      const variants = data.variants as Product["variants"];
      const variant = variants?.find((v) => v.id === vDelta.variantId);
      if (!variant) {
        // Vanished color: return the real pieces to the design-level shelf.
        releases.set(vDelta.productId, (releases.get(vDelta.productId) ?? 0) + vDelta.delta);
        continue;
      }
      const working = (variantWrites.get(vDelta.productId) ?? variants!) as ProductVariant[];
      const nextVariants = applyVariantDelta({ variants: working }, vDelta.variantId, vDelta.delta, at);
      if (nextVariants) variantWrites.set(vDelta.productId, nextVariants);
    }
    const finalUpdates = [...updates];
    for (const [productId, release] of releases) {
      const target = finalUpdates.find((u) => u.productId === productId);
      if (target) target.quantityOnHand += release;
      else {
        const releaseSnap = await tx.get(doc(db, "products", productId));
        const data = (releaseSnap.data() ?? {}) as Record<string, unknown>;
        const current = typeof data.quantityOnHand === "number" ? (data.quantityOnHand as number) : 0;
        finalUpdates.push({ productId, quantityOnHand: current + release });
      }
    }
    for (const update of finalUpdates) tx.update(doc(db, "products", update.productId), { quantityOnHand: update.quantityOnHand, updatedAt: at });
    for (const [productId, variants] of variantWrites) tx.update(doc(db, "products", productId), { variants, updatedAt: at });
    tx.delete(orderRef);
    const variantStock = [...variantWrites.entries()].map(([productId, variants]) => ({ productId, variants: variants as ProductVariant[] }));
    return Object.assign(finalUpdates, variantStock.length > 0 ? { variantStock } : {});
  });
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
 * Atomically receive a purchase into inventory: products get stock and the
 * selected cost policy; legacy is weighted, new journeys use acquisition cost.
 * The purchase gets status "received" + receivedAt — all in ONE
 * Firestore commit. Idempotency guards, checked INSIDE the transaction:
 *   - `receivedAt` already set → already received through the lifecycle
 *   - `status === undefined` → legacy purchase whose stock was applied on save
 * V1 does NOT apply sale-price edits here: a direct products write would skip
 * the public-catalog republish that upsertProduct performs, so prices stay
 * untouched (editable later from the product form).
 */
export async function receivePurchaseTx(purchaseId: string): Promise<ReturnType<typeof purchaseInventoryUpdates>> {
  const { db } = getFirebase();
  // Pre-validate OUTSIDE the transaction: errors thrown inside runTransaction
  // reach the caller with an emptied message on the emulator, so the UI toast
  // would lose the reason. The transaction re-validates canonically below.
  {
    const snap = await getDoc(doc(db, "purchases", purchaseId));
    if (!snap.exists()) throw new Error("No se encontró la compra.");
    const purchase = snap.data() as Purchase;
    if (purchase.receivedAt != null || purchase.status === undefined) throw new PurchaseAlreadyReceived();
    if (purchase.costingMethod === "latest_purchase" && recalcPurchaseStatus(purchase) !== "ready") {
      throw new Error("Revisa los productos y los totales de cada ticket antes de recibir.");
    }
    for (const supplierId of new Set((purchase.tickets ?? []).map((ticket) => ticket.supplierId).filter((id): id is string => !!id))) {
      let supplier;
      try { supplier = await getDoc(doc(db, "suppliers", supplierId)); }
      catch { throw new Error("No se pudo consultar uno de los proveedores de esta tienda."); }
      if (!supplier.exists() || supplier.data().storeId !== purchase.storeId) throw new Error("Uno de los proveedores no pertenece a esta tienda.");
    }
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
  return runTransaction(db, async (tx) => {
    const purchaseRef = doc(db, "purchases", purchaseId);
    const snap = await tx.get(purchaseRef);
    if (!snap.exists()) throw new Error("No se encontró la compra.");
    const purchase = snap.data() as Purchase;
    if (purchase.receivedAt != null || purchase.status === undefined) {
      throw new PurchaseAlreadyReceived();
    }
    const at = new Date().toISOString();
    for (const supplierId of new Set((purchase.tickets ?? []).map((ticket) => ticket.supplierId).filter((id): id is string => !!id))) {
      const supplier = await tx.get(doc(db, "suppliers", supplierId));
      if (!supplier.exists() || supplier.data().storeId !== purchase.storeId) throw new Error("Uno de los proveedores no pertenece a esta tienda.");
    }
    const productRefs = new Map<string, ReturnType<typeof doc>>();
    const productDocs = new Map<string, Product>();
    for (const line of purchase.lines) {
      if (!line.productId) throw new Error("Hay líneas sin producto vinculado.");
      if (productRefs.has(line.productId)) continue;
      const ref = doc(db, "products", line.productId);
      productRefs.set(line.productId, ref);
      const snapP = await tx.get(ref);
      if (!snapP.exists()) throw new Error(`No se encontró el producto de la línea "${line.name}".`);
      // Entity writes omit the id field; use the canonical document identity
      // so applyPurchaseLines can match this product to its purchase lines.
      const product = { ...snapP.data(), id: snapP.id } as Product;
      if (product.storeId !== purchase.storeId) {
        throw new Error(`El producto de la línea "${line.name}" pertenece a otra tienda.`);
      }
      productDocs.set(line.productId, product);
    }
    const result = purchaseInventoryUpdates([...productDocs.values()], purchase);
    for (const [productId, update] of result.stockUpdates) {
      tx.update(productRefs.get(productId)!, {
        quantityOnHand: update.quantityOnHand,
        cost: update.cost,
        updatedAt: at,
      });
    }
    // #124 (decisión 2): color lines adjust their own shelf and cost — one
    // commit with the rest of the reception, the variants array atomically
    // replacing the doc's (re-read canonically above).
    if (result.variantUpdates) {
      for (const [productId, update] of result.variantUpdates) {
        tx.update(productRefs.get(productId)!, { variants: update.variants, updatedAt: at });
      }
    }
    tx.update(purchaseRef, {
      status: "received", receivedAt: at, updatedAt: at,
      ...(result.costAllocations ? { costAllocations: result.costAllocations } : {}),
    });
    return result;
  });
}

/**
 * Append ONE post-reception expense adjustment to a received journey purchase
 * (FER-02, #126). Append-only evidence: the update touches exactly
 * `saleCostAdjustments` + `updatedAt` — the fields the security rules allow on
 * received evidence. Sale categories get their exact per-piece allocation;
 * nothing here changes stock, product costs, tickets or the original
 * costAllocations. Returns the canonical updated purchase for app state.
 */
export async function appendPurchaseExpenseTx(
  purchaseId: string,
  expense: PurchaseExpense
): Promise<Purchase> {
  const { db } = getFirebase();
  const purchaseRef = doc(db, "purchases", purchaseId);
  const snap = await getDoc(purchaseRef);
  if (!snap.exists()) throw new Error("No se encontró la compra.");
  const purchase = snap.data() as Purchase;
  if (effectivePurchaseStatus(purchase) !== "received" || purchase.receivedAt == null) {
    throw new Error("Solo se pueden agregar gastos a compras ya recibidas.");
  }
  if (purchase.costingMethod !== "latest_purchase") {
    throw new Error("Esta compra no admite gastos posteriores a su recepción.");
  }
  const at = new Date().toISOString();
  // May throw a Spanish validation error (amount, identity) before any write.
  const entry = purchaseExpenseAdjustment({ ...purchase, id: snap.id }, expense, at);
  return runTransaction(db, async (tx) => {
    const txSnap = await tx.get(purchaseRef);
    if (!txSnap.exists()) throw new Error("No se encontró la compra.");
    const current = txSnap.data() as Purchase;
    if (effectivePurchaseStatus(current) !== "received" || current.costingMethod !== "latest_purchase") {
      throw new Error("Esta compra ya no admite gastos posteriores.");
    }
    const saleCostAdjustments = [...(current.saleCostAdjustments ?? []), entry];
    tx.update(purchaseRef, { saleCostAdjustments, updatedAt: at });
    // Canonical document for the in-memory state (entity writes omit the id).
    return { ...current, id: txSnap.id, saleCostAdjustments, updatedAt: at };
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
/** #124: one color's PUBLIC signal — coarse like the design-level one
 * (never a count), derived from the variant's own shelf. */
function variantPublicStockSignal(v: ProductVariant): "agotado" | "pocas" | "disponible" {
  const qty = v.quantityOnHand;
  if (typeof qty !== "number") return "disponible";
  if (qty <= 0) return "agotado";
  if (typeof v.lowStockAt === "number" && qty <= v.lowStockAt) return "pocas";
  return "disponible";
}

/** #124: the public color list of a design — one product, N colors, each with
 * its photo; NEVER per-color counts or costs (same policy as the rest of the
 * projection). */
function publicVariants(product: Product) {
  if (!isVariantProduct(product)) return undefined;
  return product.variants!.map((v) => ({
    id: v.id,
    color: v.color,
    imageUrl: v.photos?.find((photo) => photo.isPrimary)?.url ?? v.photos?.[0]?.url ?? null,
    stockSignal: variantPublicStockSignal(v),
  }));
}

export function publicStockSignal(p: Product): "agotado" | "pocas" | "disponible" {
  // #124: a design sold by color signals over the SUM of its colors.
  const qty = isVariantProduct(p) ? totalStock(p) : p.quantityOnHand;
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
  // No own tier map → no per-tier prices (review F3): tiersForStore's canonical
  // fallback must not leak a prices map for stores that declare none.
  if (!store?.priceTiers || !product.prices) return undefined;
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
    // Undefined-stripped and ""-deleted via the shared write shape: local
    // state can carry undefineds (setDoc rejects them outright) and a cleared
    // slot must end up ABSENT here too, exactly like the editor batch (#332).
    storefront: sf ? storefrontForWrite(sf, "replace") : null,
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
    sku: product.sku ?? null, // public (Clave); the cart line needs it for the WhatsApp order
    publicDescription: product.publicDescription ?? null,
    imageUrl: primaryImage(product),
    images: [...(product.images ?? [])]
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.order - b.order)
      .slice(0, 5)
      .map(({ url, alt, width, height }) => ({ url, alt: alt ?? null, width: width ?? null, height: height ?? null })),
    availability: product.availability ?? "available",
    finish: product.finish ?? null,
    isFeatured: product.isFeatured ?? false,
    isNew: product.isNew ?? false,
    canInquire: product.canInquire ?? false,
    categoryIds: product.categoryIds ?? [],
    sortOrder: product.sortOrder ?? 0,
    stockSignal: publicStockSignal(product),
  };
  const variants = publicVariants(product);
  if (variants) summary.variants = variants;
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
  const variants = publicVariants(product);
  if (variants) detail.variants = variants;
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
/**
 * Pure builder for the publicCatalogs/{slug} doc: active categories + published
 * product summaries. Extracted from projectPublicForStore so the targeted
 * stock-signal republish (#229) reuses the exact same shape.
 */
export function buildPublicCatalogDoc(
  store: Store,
  products: Product[],
  categories: Category[]
): Record<string, unknown> {
  const published = products
    .filter((p) => p.storeId === store.id && isPublished(p))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
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
  return {
    storeSlug: store.slug,
    storeId: store.id, // anonymous product route resolves the detail doc id from here
    categories: activeCats,
    products: published.map((p) => projectPublicProductSummary(p, store.slug, store)),
  };
}

/**
 * #229: canonical stock moved (purchase reception, order reservation/release)
 * and the public availability signal must follow without a manual "Republicar
 * catálogo". Targeted and READ-FREE: the caller passes the post-change
 * canonical products, so the catalog summary doc is rebuilt locally (1 write)
 * and each changed published product's detail doc is patched (1 write each).
 * Idempotent: recomputed from post-transaction values — a retry writes the
 * same thing and never re-applies a stock delta. A failure here must NOT
 * revert the reception/order (callers run it via persistInBackground).
 */
export async function republishStockSignals(
  store: Store,
  products: Product[],
  categories: Category[],
  changedProductIds: string[]
): Promise<void> {
  const { db } = getFirebase();
  await setDoc(doc(db, "publicCatalogs", store.slug), buildPublicCatalogDoc(store, products, categories));
  const changed = new Set(changedProductIds);
  const writes: Promise<unknown>[] = [];
  for (const p of products) {
    if (p.storeId !== store.id || !changed.has(p.id) || !isPublished(p) || !p.slug) continue;
    writes.push(
      setDoc(
        doc(db, "publicProducts", publicProductId(store.id, p.slug)),
        { stockSignal: publicStockSignal(p) },
        { merge: true }
      )
    );
  }
  await Promise.all(writes);
}

export async function projectPublicForStore(
  store: Store,
  products: Product[],
  categories: Category[]
): Promise<void> {
  const { db } = getFirebase();

  // 1. Storefront (identity + content + contact). Write this first: contact
  // links depend on publicStores, and a later projection read must not leave
  // the phone stale if it fails or is denied.
  await setDoc(doc(db, "publicStores", store.slug), projectPublicStore(store));

  const writes: Promise<unknown>[] = [];

  // 2. Catalog: active categories + published product summaries.
  writes.push(
    setDoc(doc(db, "publicCatalogs", store.slug), buildPublicCatalogDoc(store, products, categories))
  );
  const published = products.filter((p) => p.storeId === store.id && isPublished(p));

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

/**
 * #203: open an incident on an order — appends the incident (with its
 * `opened` event) atomically. No inventory effect yet: the piece is still
 * with the clienta. Idempotent by incident id.
 */
export async function openIncidentTx(params: {
  orderId: string;
  storeId: string;
  incident: OrderIncident;
}): Promise<Order> {
  const { db } = getFirebase();
  const { orderId, storeId, incident } = params;
  const orderRef = doc(db, "orders", orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error("No se encontró el pedido.");
    const data = snap.data() as Record<string, unknown>;
    if ((data.storeId ?? "") !== storeId) throw new Error("El pedido pertenece a otra tienda.");
    if (data.orderStatus === "cancelled") throw new Error("Un pedido cancelado no admite incidencias.");
    const incidents = Array.isArray(data.incidents) ? [...(data.incidents as OrderIncident[])] : [];
    if (incidents.some((existing) => existing.id === incident.id)) return migrateOrder({ ...data, id: orderId });
    if (!incident.events?.some((event) => event.kind === "opened")) {
      throw new Error("La incidencia debe abrirse con su evento de registro.");
    }
    incidents.push(incident);
    const updatedAt = new Date().toISOString();
    tx.update(orderRef, { incidents: stripUndefined(incidents), updatedAt });
    return migrateOrder({ ...data, id: orderId, incidents, updatedAt });
  });
}

/**
 * #203: append ONE event to an incident and apply its effects atomically.
 * Validity is derived from the FRESH order document (the incident's own
 * history), so a repeated or out-of-order action aborts instead of inventing
 * state. Inventory effects, when the event has them, land in the SAME commit:
 * - confirmed: the damaged piece enters quarantine (not sellable) and the
 *   replacement leaves stock at its real cost (shortage aborts the event).
 * - repaired / provider_replacement / returned_to_sale: quarantine → sellable.
 * - written_off: the piece leaves quarantine (identifiable loss, no cash).
 * - refund_executed / provider_compensation: evidence only (money and its
 *   valuation belong to #123/#128-#129, never duplicated here).
 * `resolution`/`replacement` ride along ONLY for resolution_agreed.
 */
export async function applyIncidentEventTx(params: {
  orderId: string;
  storeId: string;
  incidentId: string;
  event: OrderIncidentEvent;
  resolution?: OrderIncident["resolution"];
  replacement?: OrderIncident["replacement"];
}): Promise<{ order: Order }> {
  const { db } = getFirebase();
  const { orderId, storeId, incidentId, event, resolution, replacement } = params;
  const orderRef = doc(db, "orders", orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error("No se encontró el pedido.");
    const data = snap.data() as Record<string, unknown>;
    if ((data.storeId ?? "") !== storeId) throw new Error("El pedido pertenece a otra tienda.");
    const incidents = Array.isArray(data.incidents) ? (data.incidents as OrderIncident[]) : [];
    const index = incidents.findIndex((existing) => existing.id === incidentId);
    if (index < 0) throw new Error("No se encontró la incidencia.");
    if (incidents.some((existing) => existing.events?.some((saved) => saved.id === event.id))) {
      return { order: migrateOrder({ ...data, id: orderId }) }; // idempotent retry
    }
    const incident = incidents[index];
    const state = incidentState(incident);
    const quantity = Math.max(1, Math.round(incident.quantity || 1));
    // ── Validity from derived state (fail closed on nonsense sequences). ──
    const kind = event.kind;
    if (kind === "resolution_agreed" && (state.resolution || !state.opened)) {
      throw new Error("Esta incidencia ya tiene una resolución acordada.");
    }
    // #203 r2: the AUTHORITATIVE money reconciliation happens HERE, against
    // the fresh order doc — the UI's numbers are only an estimate. The stored
    // resolution carries the sale adjustment (piece/difference at historical
    // price) and the reconciled refund obligation; refunds already committed
    // by other incidents reduce this one, so the same balance is never
    // committed twice.
    if (kind === "resolution_agreed" && resolution) {
      // F1 (r3 review): the HISTORICAL unit price is persisted on EVERY
      // resolution — sibling adjustments (upgrades included) must enter every
      // reconciliation, and orderMoney already prefers this field.
      resolution.saleAdjustmentUnitCents = incident.originalUnitPriceCents;
    }
    const needsDestination = kind === "resolution_agreed"
      && (resolution?.kind === "refund"
        || (resolution?.kind === "replacement_with_difference"
          && (replacement?.chargeDifference ?? false)
          && (replacement?.unitPriceCents ?? 0) < incident.originalUnitPriceCents));
    if (needsDestination) {
      // The clienta's explicit choice is REQUIRED server-side (r3): a refund
      // or a charged difference in her favor never defaults silently. An
      // ABSORBED difference moves no money to her — no destination needed.
      if (resolution?.destination !== "refund_pending" && resolution?.destination !== "credit_accepted") {
        throw new Error("Elige con la clienta el destino del importe: reembolso pendiente o crédito para sus pedidos.");
      }
      const destination = resolution.destination;
      const draft = { ...incident, resolution: { ...resolution, kind: resolution.kind }, ...(replacement ? { replacement } : {}) };
      const money = reconcileIncidentMoney(migrateOrder({ ...data, id: orderId }), draft);
      // Both operations carry the HISTORICAL unit price; how it enters the
      // sale adjustment depends on the kind (orderMoney decides).
      resolution.saleAdjustmentUnitCents = incident.originalUnitPriceCents;
      resolution.refundOwedCents = money.refundOwedCents(destination);
      resolution.destination = destination;
    }
    // #212 F2 defense in depth: a replacement resolution MUST name the real
    // piece leaving stock — no stock-less defaults, no invented costs.
    if (kind === "resolution_agreed" && (resolution?.kind === "replacement_equivalent" || resolution?.kind === "replacement_with_difference")
      && !replacement?.productId) {
      throw new Error("Elige la pieza que entregas como reemplazo.");
    }
    if (kind === "confirmed" && (!state.resolution || state.confirmed)) {
      throw new Error("Confirma la resolución con la clienta antes de registrar recepción y entrega.");
    }
    if (kind === "repaired" && !state.confirmed) {
      throw new Error("Confirma la recepción de la pieza antes de repararla.");
    }
    if (["provider_replacement", "returned_to_sale", "written_off"].includes(kind)
      && state.pieceLocation !== "quarantined" && state.pieceLocation !== "repaired_held") {
      throw new Error("La pieza no está en cuarentena; registra primero su recepción.");
    }
    if (kind === "refund_executed") {
      if (!state.confirmed) throw new Error("Confirma la recepción de la pieza y entrega del reembolso antes de liquidarlo.");
      // Committed GROSS (never the pending remainder — returned is subtracted
      // exactly once below). Legacy transition: unit price × quantity.
      const owed = typeof incident.resolution?.refundOwedCents === "number"
        ? Math.max(0, incident.resolution.refundOwedCents)
        : (typeof incident.resolution?.refundUnitPriceCents === "number" && incident.resolution.refundUnitPriceCents > 0
          ? incident.resolution.refundUnitPriceCents * Math.max(1, Math.round(incident.quantity || 1))
          : 0);
      const returned = incidentsReturnedCentsOf(incident);
      const amount = typeof event.detail?.refundExecutedCents === "number" ? event.detail.refundExecutedCents : 0;
      if (amount <= 0) throw new Error("El importe devuelto debe ser mayor que cero.");
      if (amount > owed - returned) {
        throw new Error(`Solo quedan ${Math.max(0, owed - returned) / 100} pesos por devolver de este reembolso.`);
      }
    }
    if (kind === "provider_compensation" && !state.confirmed) {
      throw new Error("Confirma la incidencia antes de registrar al proveedor.");
    }
    if (kind === "provider_compensation" && (incident.events ?? []).some((saved) => saved.kind === "provider_compensation")) {
      throw new Error("La compensación del proveedor ya está registrada en esta incidencia.");
    }
    // #203 r2-criterio 1: at confirm (the piece is physically back), the
    // applied credit that covered the reconciled value is RESTITUTED to its
    // origins — that is how the clienta's money becomes available again in
    // #189 (the reconcile effect re-applies it). Reads happen before writes.
    const creditReleases: Array<{ originRef: ReturnType<typeof doc>; cents: number; entry: OrderCreditLedgerEntry }> = [];
    let restitutionTotal = 0;
    if (kind === "confirmed") {
      const money = reconcileIncidentMoney(migrateOrder({ ...data, id: orderId }), incident);
      let remaining = money.restitutionCents;
      const ledger = Array.isArray(data.creditLedger) ? (data.creditLedger as OrderCreditLedgerEntry[]) : [];
      const netByOrigin = new Map<string, number>();
      for (const saved of ledger) {
        if (saved.kind === "application" && Number.isSafeInteger(saved.amountCents)) netByOrigin.set(saved.fromOrderId, (netByOrigin.get(saved.fromOrderId) ?? 0) + saved.amountCents);
        if (saved.kind === "release" && Number.isSafeInteger(saved.amountCents)) netByOrigin.set(saved.fromOrderId, (netByOrigin.get(saved.fromOrderId) ?? 0) - saved.amountCents);
      }
      for (const [fromOrderId, netCents] of netByOrigin) {
        if (remaining <= 0) break;
        if (netCents <= 0) continue;
        const originRef = doc(db, "orders", fromOrderId);
        const originSnap = await tx.get(originRef);
        // PO directive (r4): a NEEDED origin that is missing, foreign or
        // inconsistent ABORTS the whole confirmation — never a silent skip.
        // The clienta's credit would vanish with no signal; fail closed and
        // explain so the operator can repair the data first.
        if (!originSnap.exists()) {
          throw new Error(`No se encontró el pedido origen del saldo a favor (${fromOrderId}). Repara ese pedido antes de confirmar: la devolución necesita devolverle su crédito.`);
        }
        const originData = originSnap.data() as Record<string, unknown>;
        if ((originData.storeId ?? "") !== storeId) {
          throw new Error("El pedido origen del saldo a favor pertenece a otra tienda. Revisa la ficha antes de confirmar.");
        }
        // F4: cap against the origin's REAL mirror so a release can never
        // drive creditConsumed negative (manual-repair scenarios included).
        const originConsumed = typeof originData.creditConsumedCents === "number" && Number.isSafeInteger(originData.creditConsumedCents)
          ? Math.max(0, originData.creditConsumedCents)
          : 0;
        if (originConsumed <= 0) {
          throw new Error(`El pedido origen del saldo a favor no refleja el crédito consumido (${fromOrderId}). Revisa sus cobros de saldo antes de confirmar.`);
        }
        const release = Math.min(netCents, remaining, originConsumed);
        if (release <= 0) continue;
        remaining -= release;
        creditReleases.push({
          originRef,
          cents: release,
          entry: { id: `rel_${event.id}_${fromOrderId}`, kind: "release", fromOrderId, amountCents: release, at: event.at, by: event.by },
        });
        restitutionTotal += release;
      }
    }

    // ── Inventory effects (same commit; shortages abort the whole event).
    // Firestore requires EVERY read before ANY write: both product reads
    // happen first, then both writes.
    const quarantineProduct = incident.productId ? doc(db, "products", incident.productId) : null;
    if (kind === "confirmed") {
      // The PERSISTED resolution/replacement drive the confirm (parameters
      // only ride along with resolution_agreed) — the fresh doc is the truth
      // (review #212 F9: doc-first, never the incoming parameter).
      const agreed = incident.resolution ?? resolution;
      const target = agreed && agreed.kind !== "refund"
        ? (incident.replacement ?? replacement)
        : undefined;
      // #212 F4: wait_restock hands the restocked piece over at confirm — the
      // SAME piece leaves stock at its real stored cost, shortage included.
      const effectiveTarget = agreed?.kind === "wait_restock"
        ? (target ?? { productId: incident.productId, productName: incident.productName, unitPriceCents: incident.originalUnitPriceCents, unitCostCents: 0, chargeDifference: false })
        : target;
      if (quarantineProduct) {
        const productSnap = await tx.get(quarantineProduct);
        if (productSnap.exists() && (productSnap.data().storeId ?? "") !== storeId) {
          throw new Error("El producto pertenece a otra tienda.");
        }
      }
      let replacementRef: ReturnType<typeof doc> | null = null;
      if (effectiveTarget?.productId) {
        replacementRef = doc(db, "products", effectiveTarget.productId);
        const replacementSnap = await tx.get(replacementRef);
        if (!replacementSnap.exists()) throw new Error("No se encontró el producto de reemplazo.");
        if ((replacementSnap.data().storeId ?? "") !== storeId) throw new Error("El reemplazo pertenece a otra tienda.");
        const onHand = typeof replacementSnap.data().quantityOnHand === "number" ? replacementSnap.data().quantityOnHand : 0;
        if (onHand < quantity) throw new Error(`Solo hay ${onHand} pieza(s) disponible(s) del reemplazo.`);
      }
      if (quarantineProduct) {
        tx.update(quarantineProduct, { quantityQuarantined: increment(quantity), updatedAt: event.at });
      }
      if (replacementRef) {
        tx.update(replacementRef, { quantityOnHand: increment(-quantity), updatedAt: event.at });
      }
    }
    // #203 r2: repairing does NOT release the piece — it stays in quarantine
    // until Fer explicitly authorizes the return to sale (or writes it off).
    if ((kind === "provider_replacement" || kind === "returned_to_sale") && quarantineProduct) {
      tx.update(quarantineProduct, { quantityQuarantined: increment(-quantity), quantityOnHand: increment(quantity), updatedAt: event.at });
    }
    if (kind === "written_off" && quarantineProduct) {
      tx.update(quarantineProduct, { quantityQuarantined: increment(-quantity), updatedAt: event.at });
    }
    // #203 r2: an executed refund at confirm can never exceed the committed
    // obligation (authoritative, recomputed above at agreement time).
    if (kind === "confirmed" && typeof event.detail?.refundExecutedCents === "number") {
      if (!Number.isSafeInteger(event.detail.refundExecutedCents) || event.detail.refundExecutedCents < 0) {
        throw new Error("El importe devuelto no es válido.");
      }
      const owed = typeof incident.resolution?.refundOwedCents === "number"
        ? Math.max(0, incident.resolution.refundOwedCents)
        : (typeof incident.resolution?.refundUnitPriceCents === "number" && incident.resolution.refundUnitPriceCents > 0
          ? incident.resolution.refundUnitPriceCents * Math.max(1, Math.round(incident.quantity || 1))
          : 0);
      if (event.detail.refundExecutedCents > owed) {
        throw new Error(`El reembolso comprometido es de ${owed / 100} pesos; no se puede devolver más.`);
      }
    }

    // ── Order doc: append the event (and the agreed resolution, once). ──
    const updated: OrderIncident = {
      ...incident,
      ...(kind === "resolution_agreed" && resolution ? { resolution } : {}),
      ...(kind === "resolution_agreed" && replacement ? { replacement } : {}),
      events: [...(incident.events ?? []), event],
    };
    const nextIncidents = incidents.map((existing, i) => (i === index ? updated : existing));
    const updatedAt = event.at;
    if (restitutionTotal > 0) {
      for (const release of creditReleases) {
        tx.update(release.originRef, { creditConsumedCents: increment(-release.cents) });
      }
      tx.update(orderRef, {
        incidents: stripUndefined(nextIncidents),
        updatedAt,
        creditAppliedCents: increment(-restitutionTotal),
        creditLedger: arrayUnion(...creditReleases.map((release) => stripUndefined(release.entry))),
      });
    } else {
      tx.update(orderRef, { incidents: stripUndefined(nextIncidents), updatedAt });
    }
    return { order: migrateOrder({ ...data, id: orderId, incidents: nextIncidents, updatedAt }) };
  });
}

/** Σ money actually handed back (executed refunds) for this incident. */
function incidentsReturnedCentsOf(incident: OrderIncident): number {
  return (incident.events ?? []).reduce(
    (sum: number, event: OrderIncidentEvent) =>
      sum + ((event.kind === "confirmed" || event.kind === "refund_executed") && typeof event.detail?.refundExecutedCents === "number" && Number.isSafeInteger(event.detail.refundExecutedCents) ? event.detail.refundExecutedCents : 0),
    0
  );
}


/**
 * #184: assign part of a loose expense to a purchase or an order, atomically.
 * Validation against FRESH docs: the pending balance must cover the amount;
 * a purchase target must be OPEN (a received purchase's historical cost
 * allocations are never silently recalculated — asignar allí exige #202);
 * an order target must belong to the same store. Order assignments charge
 * the order via append-only `saleExpenses` (profit-only, never the sale
 * total nor the clienta's balance) in the SAME commit as the expense doc.
 * Idempotent by assignment id.
 */
export async function assignExpenseTx(params: {
  expenseId: string;
  storeId: string;
  assignment: ExpenseAssignment;
  /** For purchase targets: the purchase expense entry to append (native
   * sourcing path reuses the existing allocation machinery). */
  purchaseExpense?: { id: string; category: "sourcing_transport" | "other"; amount: number; description?: string; includeInInventoryCost?: boolean };
}): Promise<void> {
  const { db } = getFirebase();
  const { expenseId, storeId, assignment, purchaseExpense } = params;
  const expenseRef = doc(db, "expenses", expenseId);
  await runTransaction(db, async (tx) => {
    const expenseSnap = await tx.get(expenseRef);
    if (!expenseSnap.exists()) throw new Error("No se encontró el gasto.");
    const data = expenseSnap.data() as Record<string, unknown>;
    if ((data.storeId ?? "") !== storeId) throw new Error("El gasto pertenece a otra tienda.");
    const expense = { ...data, id: expenseId } as LooseExpense;
    const assignments = [...(expense.assignments ?? [])];
    if (assignments.some((existing) => existing.id === assignment.id)) return; // idempotent
    const { pendingAssignmentCents } = await import("../../lib/expenses");
    if (assignment.amountCents <= 0 || !Number.isSafeInteger(assignment.amountCents)) {
      throw new Error("El importe de la asignación debe ser mayor que cero.");
    }
    if (expense.supply) {
      throw new Error("Los suministros se distribuyen consumiéndolos, no asignándolos a compras o pedidos.");
    }
    if (pendingAssignmentCents(expense) < assignment.amountCents) {
      throw new Error(`Solo quedan ${pendingAssignmentCents(expense) / 100} pesos por asignar de este gasto.`);
    }
    const updatedAt = assignment.at;
    if (assignment.target.kind === "purchase") {
      const purchaseRef = doc(db, "purchases", assignment.target.purchaseId);
      const purchaseSnap = await tx.get(purchaseRef);
      if (!purchaseSnap.exists()) throw new Error("No se encontró la compra.");
      const purchaseData = purchaseSnap.data() as Record<string, unknown>;
      if ((purchaseData.storeId ?? "") !== storeId) throw new Error("La compra pertenece a otra tienda.");
      if (purchaseData.status === "received" || effectivePurchaseStatus(purchaseData as Purchase) === "received") {
        throw new Error("La compra ya está recibida: su costo histórico no se recalcula. Asigna el gasto por la vía de venta o registra el ajuste del periodo.");
      }
      const existingExpenses = Array.isArray(purchaseData.sourcingExpenses) ? (purchaseData.sourcingExpenses as unknown[]) : [];
      const nextExpenses = [...existingExpenses, ...(purchaseExpense ? [purchaseExpense] : [])];
      tx.update(purchaseRef, { sourcingExpenses: nextExpenses, updatedAt });
    } else {
      const orderRef = doc(db, "orders", assignment.target.orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) throw new Error("No se encontró el pedido.");
      const orderData = orderSnap.data() as Record<string, unknown>;
      if ((orderData.storeId ?? "") !== storeId) throw new Error("El pedido pertenece a otra tienda.");
      const charge: OrderSaleExpense = {
        id: `asg_${assignment.id}`,
        at: assignment.at,
        by: assignment.by,
        amountCents: assignment.amountCents,
        description: expense.description,
        expenseId,
        ...(assignment.allocations?.length ? { allocations: assignment.allocations } : {}),
      };
      tx.update(orderRef, { saleExpenses: arrayUnion(stripUndefined(charge)), updatedAt: assignment.at });
    }
    assignments.push(assignment);
    tx.update(expenseRef, { assignments: stripUndefined(assignments), updatedAt });
  });
}

/**
 * #184: consume supply units and charge the linked order, atomically.
 * Availability is validated against the FRESH expense doc (quantity can never
 * go negative); the charge is quantity × unit cost in exact cents and lands
 * on the order as append-only `saleExpenses` evidence. Idempotent by
 * consumption id.
 */
export async function consumeSupplyTx(params: {
  expenseId: string;
  storeId: string;
  consumption: SupplyConsumption;
  description?: string;
}): Promise<void> {
  const { db } = getFirebase();
  const { expenseId, storeId, consumption, description } = params;
  const expenseRef = doc(db, "expenses", expenseId);
  await runTransaction(db, async (tx) => {
    const expenseSnap = await tx.get(expenseRef);
    if (!expenseSnap.exists()) throw new Error("No se encontró el suministro.");
    const data = expenseSnap.data() as Record<string, unknown>;
    if ((data.storeId ?? "") !== storeId) throw new Error("El suministro pertenece a otra tienda.");
    const expense = { ...data, id: expenseId } as LooseExpense;
    if (!expense.supply) throw new Error("Este gasto no es un suministro.");
    if ((expense.supply.consumptions ?? []).some((existing) => existing.id === consumption.id)) return; // idempotent
    const { supplyAvailableQuantity, supplyChargeCents } = await import("../../lib/expenses");
    if (consumption.quantity <= 0 || !Number.isSafeInteger(consumption.quantity)) {
      throw new Error("La cantidad a consumir debe ser mayor que cero.");
    }
    if (supplyAvailableQuantity(expense) < consumption.quantity) {
      throw new Error(`Solo quedan ${supplyAvailableQuantity(expense)} disponibles de este suministro.`);
    }
    // Firestore requires every read before any write: the order (when linked)
    // is read first, then both writes land in one commit.
    let orderRef: ReturnType<typeof doc> | null = null;
    if (consumption.orderId) {
      orderRef = doc(db, "orders", consumption.orderId);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) throw new Error("No se encontró el pedido.");
      const orderData = orderSnap.data() as Record<string, unknown>;
      if ((orderData.storeId ?? "") !== storeId) throw new Error("El pedido pertenece a otra tienda.");
    }
    const updatedAt = consumption.at;
    const nextSupply = {
      ...expense.supply,
      consumptions: [...(expense.supply.consumptions ?? []), consumption],
    };
    tx.update(expenseRef, { supply: stripUndefined(nextSupply), updatedAt });
    if (orderRef) {
      const charge: OrderSaleExpense = {
        id: `sup_${consumption.id}`,
        at: consumption.at,
        by: consumption.by,
        amountCents: supplyChargeCents(consumption, expense),
        description: description ?? expense.description,
        expenseId,
        supplyConsumptionId: consumption.id,
      };
      tx.update(orderRef, { saleExpenses: arrayUnion(stripUndefined(charge)), updatedAt: consumption.at });
    }
  });
}

/**
 * #333: register ONE delivery event — append-only, id-idempotent evidence of
 * pieces handed to the clienta. Validity derives from the FRESH order doc:
 * an event may never deliver more than the still-pending pieces (concurrent
 * deliveries abort instead of over-delivering), and a cancelled order admits
 * none. The event NEVER touches money or stock: the reservation already took
 * the pieces when the order was confirmed, and cobros keep their own dates.
 * When the event completes the order, the SAME commit moves it to "delivered"
 * — honoring the #165/#168 gate (an uncovered saldo demands the operator's
 * explicit confirmation and is stamped as evidence).
 */
export async function registerDeliveryTx(params: {
  orderId: string;
  storeId: string;
  delivery: OrderDelivery;
  confirmDeliveredWithBalance?: boolean;
}): Promise<Order> {
  const { db } = getFirebase();
  const { orderId, storeId, delivery } = params;
  const user = getFirebase().auth.currentUser;
  if (!user) throw new Error("Se necesita sesión para registrar entregas.");
  const orderRef = doc(db, "orders", orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error("No se encontró el pedido.");
    const data = snap.data() as Record<string, unknown>;
    if ((data.storeId ?? "") !== storeId) throw new Error("El pedido pertenece a otra tienda.");
    if (data.orderStatus === "cancelled") throw new Error("Un pedido cancelado no admite entregas.");
    const deliveries = Array.isArray(data.deliveries) ? [...(data.deliveries as OrderDelivery[])] : [];
    // Idempotent retry: the same intent id already landed — nothing to do.
    if (deliveries.some((existing) => existing.id === delivery.id)) {
      return migrateOrder({ ...data, id: orderId });
    }
    const fresh = migrateOrder({ ...data, id: orderId });
    const validation = deliveryValidationError(fresh, delivery);
    if (validation) throw new Error(validation);
    deliveries.push(delivery);
    const next: Record<string, unknown> = {
      deliveries: stripUndefined(deliveries),
      updatedAt: new Date().toISOString(),
    };
    if (orderFullyDelivered({ ...fresh, deliveries: [...deliveries] })) {
      // Same gate as a delivered save (#165/#168): an uncovered saldo needs
      // the operator's explicit confirmation, stamped as evidence.
      const docMoney = {
        accumulatorCents: fresh.paymentsReceivedCents ?? 0,
        receivedCents: docReceivedCents(fresh),
      };
      if (deliveryWithBalanceBlocked(fresh, docMoney)) {
        if (!params.confirmDeliveredWithBalance) {
          throw new DeliveryWithBalanceError(uncoveredBalanceCents(fresh, docMoney));
        }
        next.deliveredWithBalanceCents = uncoveredBalanceCents(fresh, docMoney);
        next.deliveredWithBalanceConfirmedAt = new Date().toISOString();
        next.deliveredWithBalanceConfirmedBy = user.uid;
      }
      next.orderStatus = "delivered";
    }
    tx.update(orderRef, next);
    return migrateOrder({ ...data, id: orderId, ...next });
  });
}
