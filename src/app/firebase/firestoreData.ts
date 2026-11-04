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
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebase } from "./config";
import { reservationDeltasForOrderChange } from "../../lib/inventory";
import { purchaseExpenseAdjustment, purchaseInventoryUpdates } from "../../lib/purchases";
import { effectivePurchaseStatus, recalcPurchaseStatus, type PurchaseExpense } from "../../types";
import { effectiveOrderStatus, migrateOrder } from "../../lib/orders";
import { deliveryWithBalanceBlocked, orderTotalCents } from "../../features/orders/installments";
import {
  INHERITED_DEPOSIT_PAYMENT_ID,
  docReceivedCents,
  inheritedDepositRecord,
  orderMoneyAfterPayments,
  signedAmountCents,
} from "../../features/orders/payments";
import type { AppUser } from "./auth";
import type { AppState, Store, Storefront, Product, Customer, Order, Category, Supplier, Purchase, OrderPayment } from "../../types";
import { publicPrice } from "../../lib/money";
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

export const COLLECTIONS = ["stores", "products", "categories", "suppliers", "purchases", "customers", "orders"] as const;
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
  async function forStores<T extends { storeId: string }>(name: "products" | "categories" | "suppliers" | "purchases" | "customers" | "orders"): Promise<T[]> {
    if (storeIds.length === 0) return [];
    const q = user.role === "super_admin"
      ? collection(db, name)
      : query(collection(db, name), where("storeId", "in", storeIds));
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

  // Members use storeId-filtered listeners because Firestore rules cannot use
  // rules as filters. Super_admins can use full collection listeners because
  // their role is independent of resource data and avoids the `in` limit.
  // If a member is added to a new store mid-session, storesQ fires and the full
  // state reloads; the next subscription is scoped to the new store set.
  function registerEntityListeners(storeIds: string[]) {
    if (tornDown) return;
    if (storeIds.length === 0 && user.role !== "super_admin") return;
    for (const name of ["products", "categories", "suppliers", "purchases", "customers", "orders"] as const) {
      const entityQ = user.role === "super_admin"
        ? collection(db, name)
        : query(collection(db, name), where("storeId", "in", storeIds));
      unsubscribers.push(onSnapshot(entityQ, triggerReload));
    }
  }

  // Read accessible stores once, then register scoped listeners.
  getDocs(storesQ)
    .then((snap) => {
      // Both roles receive stores/{id} docs here; the super_admin query is global
      // and the member query is scoped by membership. Both yield store ids.
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

/** Save editable storefront text to its private, control, and public projections atomically. */
export async function saveStorefrontBatch(store: Pick<Store, "id" | "slug">, storefront: Storefront, updatedAt: string): Promise<void> {
  const { db } = getFirebase();
  const batch = writeBatch(db);
  const cleanStorefront = stripUndefined(storefront);
  batch.set(doc(db, "stores", store.id), { storefront: cleanStorefront, updatedAt }, { merge: true });
  batch.set(doc(db, "adminStores", store.id), { storeId: store.id }, { merge: true });
  batch.set(doc(db, "publicStores", store.slug), { storeId: store.id, storefront: cleanStorefront }, { merge: true });
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
  options?: { confirmDeliveredWithBalance?: boolean }
): Promise<{ order: Order; stock: StockAdjustment[] }> {
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
    const next: Order = {
      ...order,
      // A caller can neither erase existing evidence nor invent it on create.
      // Only the canonical doc (or the payment transaction) owns these fields.
      installmentsReservedAt: previous?.installmentsReservedAt,
      lastPaymentId: typeof docData?.lastPaymentId === "string" ? docData.lastPaymentId : undefined,
      paymentsRevision: typeof docData?.paymentsRevision === "number" ? docData.paymentsRevision : undefined,
      paymentsReceivedCents: typeof docData?.paymentsReceivedCents === "number" ? docData.paymentsReceivedCents : undefined,
      inheritedDepositMaterialized: docData?.inheritedDepositMaterialized === true ? true : undefined,
    };
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
      const saldoCents = orderTotalCents(next) - docMoney.receivedCents;
      if (!options?.confirmDeliveredWithBalance) {
        throw new DeliveryWithBalanceError(saldoCents);
      }
      next.deliveredWithBalanceCents = saldoCents;
      next.deliveredWithBalanceConfirmedAt = new Date().toISOString();
      next.deliveredWithBalanceConfirmedBy = user.uid;
    }
    const deltas = reservationDeltasForOrderChange(previous, next);
    const canonical = new Map<string, number | undefined>();
    const shortages: { productId: string; missing: number }[] = [];
    for (const [productId, delta] of deltas) {
      const product = await tx.get(doc(db, "products", productId));
      if (product.exists() && product.data().storeId !== order.storeId) throw new Error("El producto pertenece a otra tienda.");
      const current = product.exists() ? product.data().quantityOnHand as number | undefined : undefined;
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
    const saved = { ...next, revision: (previous?.revision ?? 0) + 1, lastMutationId: mutationId, updatedAt: at };
    for (const update of updates) tx.update(doc(db, "products", update.productId), { quantityOnHand: update.quantityOnHand, updatedAt: at });
    const { id, ...data } = saved;
    tx.set(orderRef, stripUndefined(data) as Record<string, unknown>, { merge: false });
    return { order: saved, stock: updates };
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

/** Release the canonical reservation and delete the matching revision atomically. */
export async function deleteOrderWithStockTx(
  _user: AppUser,
  orderId: string,
  expectedRevision: number
): Promise<StockAdjustment[]> {
  const { db } = getFirebase();
  const orderRef = doc(db, "orders", orderId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) return [];
    const previous = migrateOrder({ ...snap.data(), id: orderId });
    if ((previous.revision ?? 0) !== expectedRevision) throw new StaleOrderError();
    // A zero accumulator can still have payments and offsetting adjustments.
    // Deleting the parent would orphan immutable evidence and retained stock.
    const data = snap.data();
    if (previous.installmentsReservedAt || "paymentsReceivedCents" in data || data.inheritedDepositMaterialized === true) {
      throw new OrderEvidenceDeletionError();
    }
    const deltas = reservationDeltasForOrderChange(previous, { ...previous, orderStatus: "cancelled" });
    const canonical = new Map<string, number | undefined>();
    for (const productId of deltas.keys()) {
      const product = await tx.get(doc(db, "products", productId));
      if (product.exists() && product.data().storeId !== previous.storeId) throw new Error("El producto pertenece a otra tienda.");
      canonical.set(productId, product.exists() ? product.data().quantityOnHand as number | undefined : undefined);
    }
    const { updates } = applyRelativeDeltas(canonical, deltas);
    const at = new Date().toISOString();
    for (const update of updates) tx.update(doc(db, "products", update.productId), { quantityOnHand: update.quantityOnHand, updatedAt: at });
    tx.delete(orderRef);
    return updates;
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

  // 1. Storefront (identity + content + contact). Write this first: contact
  // links depend on publicStores, and a later projection read must not leave
  // the phone stale if it fails or is denied.
  await setDoc(doc(db, "publicStores", store.slug), projectPublicStore(store));

  const writes: Promise<unknown>[] = [];

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
