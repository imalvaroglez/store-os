import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore, newCustomer } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  CheckboxField,
  Dialog,
  IconButton,
  Money,
  SearchSelect,
  SelectField,
  StatRow,
  TextArea,
  TextField,
  ProductImage,
  useToast,
} from "../../design-system";
import { customersForStore } from "../../lib/selectors";
import { defaultTier, tiersForStore } from "../../lib/pricing";
import { isVariantProduct } from "../../lib/variants";
import { formatMoney, parseAmount, sanitizeDecimalInput, sanitizeIntegerInput } from "../../lib/money";
import { effectiveOrderStatus, orderItems, orderTotals, paymentStatusForOrder, tierWarning } from "../../lib/orders";
import { attributeProjectedShortageToLines, orderWillHoldPieces } from "../../lib/inventory";
import { orderAmountCents } from "../../lib/orderMoney";
import { itemsProfitBreakdown } from "../../lib/saleProfit";
import { uid } from "../../lib/ids";
import { DeliveryWithBalanceError, StaleOrderError } from "../../app/firebase/firestoreData";
import { orderDraftKey, loadOrderDraft, saveOrderDraft, clearOrderDraft, type OrderDraftSnapshot } from "./orderDraft";
import { groupOrderLines } from "./orderGrouping";
import { ORDER_STATUS_LABELS } from "./orderStatus";
import {
  INSTALLMENT_FREQUENCY_LABELS,
  installmentDueDate,
  splitInstallmentCents,
  validateInstallmentPlanInput,
  type InstallmentFrequency,
} from "./installments";
import { CustomerForm } from "../customers/CustomerForm";
import { CURRENT_ORDER_SCHEMA_VERSION } from "../../types";
import type { Customer, Order, OrderItem, OrderStatus, Product } from "../../types";

type DraftLine = OrderItem & {
  key: string;
  quantityText: string;
  unitPriceText: string;
  costText: string;
  productQuery: string;
};

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = (
  Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]
).map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] }));

function lineFromItem(item?: OrderItem): DraftLine {
  const quantity = item?.quantity ?? 1;
  const unitPrice = item?.unitPrice ?? 0;
  return {
    key: uid("line"),
    lineId: item?.lineId,
    priceSource: item ? (item.priceSource ?? "manual") : "automatic",
    categorySnapshot: item?.categorySnapshot,
    productId: item?.productId,
    variantId: item?.variantId,
    variantColor: item?.variantColor,
    variantSku: item?.variantSku,
    productName: item?.productName ?? "",
    productQuery: item?.productName ?? "",
    quantity,
    quantityText: String(quantity),
    priceTier: item?.priceTier,
    unitPrice,
    unitPriceText: item ? String(unitPrice) : "",
    subtotal: quantity * unitPrice,
    cost: item?.cost,
    costText: item?.cost == null ? "" : String(item.cost),
  };
}

function numberFromText(value: string): number {
  return Math.max(0, parseAmount(value) ?? 0);
}

// "T00:00:00" is load-bearing: a bare yyyy-mm-dd parses as UTC and shows the
// previous day in Mexico (UTC-6) — the same trap OrderCard documents.
function formatPlanDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function OrderForm({
  order,
  isNew = false,
  onDone,
  onCancel,
}: {
  order: Order;
  isNew?: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { state, activeStore, upsertOrder, draftOwnerId } = useStore();
  const toast = useToast();
  const isTiered = activeStore?.type === "inventory_tiered";
  const tiers = tiersForStore(activeStore);
  const defaultPriceTier = defaultTier(activeStore)?.id ?? tiers[0]?.id;
  const customers = activeStore ? customersForStore(state.customers, activeStore.id) : [];
  const products = activeStore ? state.products.filter((p) => p.storeId === activeStore.id) : [];
  const initialItems = orderItems(order);
  // Offline draft (E1): restore a capture interrupted by a lost connection or
  // an accidental close — clearly labeled, discardable, and never restored over
  // a newer save from another device.
  const draftKey = useMemo(() => orderDraftKey(order.storeId, order.id, isNew, draftOwnerId), [order.storeId, order.id, isNew, draftOwnerId]);
  const draftCandidate = useMemo(() => loadOrderDraft(draftKey, order, true), [draftKey]);
  const completedDraft = !isNew && !!draftCandidate?.mutationId && draftCandidate.mutationId === order.lastMutationId;
  const restoredDraft = useMemo(() => completedDraft ? null : loadOrderDraft(draftKey, order, isNew), [draftKey]); // once per editor mount
  const [conflictingDraft, setConflictingDraft] = useState(() =>
    !isNew && !restoredDraft && !completedDraft ? draftCandidate : null
  );
  useEffect(() => {
    if (completedDraft && !clearOrderDraft(draftKey)) toast.error("No se pudo borrar el borrador de este dispositivo.");
    // The candidate is evaluated once, when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  const [draftRestored, setDraftRestored] = useState(!!restoredDraft);
  const [lines, setLines] = useState<DraftLine[]>(() =>
    restoredDraft?.lines as DraftLine[] ?? (initialItems.length ? initialItems.map(lineFromItem) : [lineFromItem()])
  );
  const [customerId, setCustomerId] = useState(restoredDraft?.customerId ?? order.customerId);
  const [customerQuery, setCustomerQuery] = useState(
    () => restoredDraft?.customerQuery ?? customers.find((c) => c.id === order.customerId)?.name ?? ""
  );
  const hasPaymentEvidence = order.inheritedDepositMaterialized === true || typeof order.paymentsReceivedCents === "number";
  // #271 (PO 2026-11-09): lowering the anticipo with payment evidence needs a
  // SIGNED motive — a silent edit erased real money from the view.
  const [depositCorrectionNote, setDepositCorrectionNote] = useState("");
  const [deposit, setDeposit] = useState(hasPaymentEvidence ? String(order.deposit ?? 0) : restoredDraft?.deposit ?? String(order.deposit ?? 0));
  // #165 installment capture. Nothing is defaulted: the count, the frequency
  // and the first due date are the operator's agreement, per order.
  const [installmentsOn, setInstallmentsOn] = useState(
    restoredDraft?.installmentsOn ?? !!order.installments
  );
  const [cuotasText, setCuotasText] = useState(
    restoredDraft?.cuotasText ?? (order.installments ? String(order.installments.count) : "")
  );
  const [frequency, setFrequency] = useState<InstallmentFrequency | "">(
    (restoredDraft?.frequency as InstallmentFrequency | undefined) ?? order.installments?.frequency ?? ""
  );
  const [firstDueDate, setFirstDueDate] = useState(
    restoredDraft?.firstDueDate ?? order.installments?.firstDueDate ?? ""
  );
  const [promisedDate, setPromisedDate] = useState(restoredDraft?.promisedDate ?? order.promisedDate ?? "");
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(
    restoredDraft?.orderStatus ?? effectiveOrderStatus(order)
  );
  const [notes, setNotes] = useState(restoredDraft?.notes ?? order.notes ?? "");
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // R9 (PO 2026-11-03): delivering with an uncovered saldo waits here for the
  // operator's explicit confirmation; the confirmed save records the evidence.
  const [pendingDeliveryCents, setPendingDeliveryCents] = useState<number | null>(null);
  const pendingOrderRef = useRef<Order | null>(null);
  // #271: the delivery-with-balance retry replays the SAME save — the deposit
  // correction motive must survive it.
  const pendingDepositNoteRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const expectedRevision = useRef(restoredDraft?.expectedRevision !== undefined ? restoredDraft.expectedRevision : isNew ? null : (order.revision ?? 0));
  const mutationId = useRef(restoredDraft?.mutationId ?? uid("mutation"));
  const mutationPayload = useRef(restoredDraft?.mutationPayload ?? "");
  const draftSaved = useRef(!!restoredDraft);
  const loadedUpdatedAt = useRef(restoredDraft?.orderUpdatedAt ?? order.updatedAt);

  // Persist the draft on every real change. The first-render snapshot doubles
  // as the baseline: an untouched editor never (re)writes a draft, so simply
  // opening an order never raises the "recovered draft" banner next time.
  const snapshotDraft = () =>
    JSON.stringify({ orderUpdatedAt: loadedUpdatedAt.current, orderId: restoredDraft?.orderId ?? order.id, orderCreatedAt: restoredDraft?.orderCreatedAt ?? order.createdAt, expectedRevision: expectedRevision.current, mutationId: mutationId.current, mutationPayload: mutationPayload.current, customerId, customerQuery, lines, deposit, promisedDate, orderStatus, notes, installmentsOn, cuotasText, frequency, firstDueDate });
  const baselineSnapshot = useRef(snapshotDraft());
  const discardedDraft = useRef(false);
  useEffect(() => {
    const current = snapshotDraft();
    if (conflictingDraft) return;
    if (discardedDraft.current) {
      discardedDraft.current = false;
      baselineSnapshot.current = current;
      return;
    }
    if (current === baselineSnapshot.current) return; // untouched
    draftSaved.current = saveOrderDraft(draftKey, {
      ...(JSON.parse(current) as Omit<OrderDraftSnapshot, "savedAt">),
      savedAt: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, customerId, customerQuery, lines, deposit, promisedDate, orderStatus, notes, installmentsOn, cuotasText, frequency, firstDueDate, conflictingDraft]);

  function discardDraft() {
    if (!clearOrderDraft(draftKey)) {
      toast.error("No se pudo descartar el borrador en este dispositivo.");
      return;
    }
    discardedDraft.current = true;
    setDraftRestored(false);
    setLines(initialItems.length ? initialItems.map(lineFromItem) : [lineFromItem()]);
    setCustomerId(order.customerId);
    setCustomerQuery(customers.find((c) => c.id === order.customerId)?.name ?? "");
    setDeposit(String(order.deposit ?? 0));
    setInstallmentsOn(!!order.installments);
    setCuotasText(order.installments ? String(order.installments.count) : "");
    setFrequency(order.installments?.frequency ?? "");
    setFirstDueDate(order.installments?.firstDueDate ?? "");
    setPromisedDate(order.promisedDate ?? "");
    setOrderStatus(effectiveOrderStatus(order));
    setNotes(order.notes ?? "");
  }

  // OLI-011 (#91): the fresh line lands on TOP and takes the focus — Fer
  // captures 40–50 lines per order without scrolling or reaching for the mouse.
  const newProductInput = useRef<HTMLInputElement | null>(null);
  const focusNewLine = useRef(false);

  useLayoutEffect(() => {
    if (!focusNewLine.current) return;
    focusNewLine.current = false;
    const input = newProductInput.current;
    input?.focus({ preventScroll: true });
    input?.scrollIntoView?.({ block: "center", behavior: "auto" });
  }, [lines]);

  function addLine() {
    focusNewLine.current = true;
    // Capture order stays stable in the data (first captured = first saved);
    // only the VIEW is a stack — the fresh line renders on top (see below).
    const fresh = lineFromItem();
    setEnteringKey(fresh.key);
    setLines((current) => [...current, fresh]);
  }

  // OLI-008 (#92): the customer's assigned tier drives automatic pricing;
  // manually-priced lines keep their price (priceSource === "manual").
  const [pendingCustomer, setPendingCustomer] = useState<Customer | null>(null);
  const [orderTierOverride, setOrderTierOverride] = useState("");
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const assignedTier = selectedCustomer?.assignedPriceTierId;
  const missingTier = isTiered && !!assignedTier && !tiers.some((tier) => tier.id === assignedTier) && !orderTierOverride;
  const currentTier = orderTierOverride || assignedTier || defaultPriceTier;

  function applyCustomer(customer: Customer, reprice: boolean) {
    const tier = customer.assignedPriceTierId ?? defaultPriceTier;
    const tierAvailable = !isTiered || tiers.some((candidate) => candidate.id === tier);
    if (reprice) setLines((current) => current.map((line) => {
      if (line.priceSource !== "automatic" || !line.productId) return line;
      const product = products.find((item) => item.id === line.productId);
      const price = isTiered ? (tierAvailable ? product?.prices?.[tier ?? ""] : undefined) : product?.price;
      return { ...line, priceTier: isTiered ? tier : undefined, unitPriceText: price == null ? "" : String(price), unitPrice: price ?? 0 };
    }));
    setOrderTierOverride("");
    setCustomerId(customer.id);
    setCustomerQuery(customer.name);
    setPendingCustomer(null);
  }

  function chooseCustomer(customer: Customer) {
    if (customer.id === customerId) { setCustomerQuery(customer.name); return; }
    if (customerId && lines.some((line) => line.productName.trim())) setPendingCustomer(customer);
    else applyCustomer(customer, true);
  }

  function resolveMissingTier(tier: string) {
    setOrderTierOverride(tier);
    setLines((current) => current.map((line) => {
      if (line.priceSource !== "automatic" || !line.productId) return line;
      const price = products.find((product) => product.id === line.productId)?.prices?.[tier];
      return { ...line, priceTier: tier, unitPriceText: price == null ? "" : String(price), unitPrice: price ?? 0 };
    }));
  }

  // OLI-012 (#93): category review mode with per-line focus recovery.
  const [reviewing, setReviewing] = useState(false);
  // The just-added line plays the theme's riseIn entrance once (mount only).
  const [enteringKey, setEnteringKey] = useState<string | null>(null);
  const [focusLine, setFocusLine] = useState<string | null>(null);
  // #325: shortage hops land on the QUANTITY input — that is where Fer fixes
  // the faltante; review-mode "Editar" jumps keep the product selector.
  const [focusPrefersQuantity, setFocusPrefersQuantity] = useState(false);
  const productInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const quantityInputs = useRef<Record<string, HTMLInputElement | null>>({});
  useLayoutEffect(() => {
    if (reviewing || !focusLine) return;
    const input = (focusPrefersQuantity ? quantityInputs.current[focusLine] : undefined) ?? productInputs.current[focusLine];
    input?.focus({ preventScroll: true });
    input?.scrollIntoView?.({ block: "center", behavior: "auto" });
    setFocusLine(null);
    setFocusPrefersQuantity(false);
  }, [reviewing, focusLine, focusPrefersQuantity]);

  const customerOptions = customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    detail: customer.phone ?? customer.instagram,
    keywords: [customer.phone, customer.instagram].filter(Boolean).join(" "),
  }));
  const productOptions = products.map((product) => {
    const price = isTiered ? product.prices?.[currentTier ?? ""] : product.price;
    return {
      value: product.id,
      label: product.name,
      detail: [
        price == null ? "Sin precio" : formatMoney(price),
        isTiered && typeof product.quantityOnHand === "number" ? `Existencia ${product.quantityOnHand}` : "",
      ].filter(Boolean).join(" · "),
      keywords: [product.sku, product.category].filter(Boolean).join(" "),
    };
  });
  const totals = useMemo(() => {
    try {
      return orderTotals({
        ...order,
        items: lines.map((line) => ({
          productId: line.productId,
          ...(line.variantId ? { variantId: line.variantId, variantColor: line.variantColor, variantSku: line.variantSku } : {}),
          productName: line.productName,
          quantity: Math.max(0, Math.round(numberFromText(line.quantityText))),
          priceTier: line.priceTier,
          unitPrice: numberFromText(line.unitPriceText),
          subtotal: orderAmountCents(numberFromText(line.unitPriceText), Math.max(0, Math.round(numberFromText(line.quantityText)))) / 100,
          cost: line.cost,
        })),
        deposit: numberFromText(deposit),
      });
    } catch (error) {
      if (error instanceof RangeError) return null;
      throw error;
    }
  }, [deposit, lines, order]);
  // #309 + #325: per-line shortage from the SHARED canonical derivation —
  // PROJECTED onto the draft in progress. The SAVED order's holds return to
  // the shelf first, and the gate uses the DRAFT's lifecycle state: a draft
  // being cancelled holds nothing and must not read as shortage (review P2).
  // Editor summary, line badges and, after Guardar, the card's "Faltan N"
  // badge all show the SAME totals — and the faltante appears the moment Fer
  // raises a line, not after saving. The FIRST line with pieces claims the
  // dimension's FULL missing count. Observability only; never mutates.
  const draftWillHold = useMemo(
    () => orderWillHoldPieces({ ...order, orderStatus }),
    [order, orderStatus]
  );
  const lineShortage = useMemo(
    () =>
      attributeProjectedShortageToLines(
        lines.map((line) => ({
          key: line.key,
          ...(line.productId ? { productId: line.productId } : {}),
          ...(line.variantId ? { variantId: line.variantId } : {}),
          quantity: Math.max(0, Math.round(numberFromText(line.quantityText))),
        })),
        order,
        draftWillHold,
        products
      ),
    [lines, order, draftWillHold, products]
  );
  const shortagePieces = [...lineShortage.values()].reduce((sum, missing) => sum + missing, 0);
  // #325: "Ver faltantes" hops through EVERY short line, not just the first.
  const shortageKeys = lines.filter((line) => (lineShortage.get(line.key) ?? 0) > 0).map((line) => line.key);
  const [shortageHop, setShortageHop] = useState(0);
  const focusNextShortage = () => {
    if (shortageKeys.length === 0) return;
    setFocusPrefersQuantity(true);
    setFocusLine(shortageKeys[shortageHop % shortageKeys.length]);
    setShortageHop((hop) => hop + 1);
  };
  // The label reports the stop the LAST click landed on (or the first one
  // before any click) — not the next stop, which read as "already saw both".
  const shortageStop = shortageKeys.length
    ? (shortageHop === 0 ? 0 : (shortageHop - 1) % shortageKeys.length) + 1
    : 0;
  const firstShortageKey = shortageKeys[0];

  // Full-cost profit preview (FER-03): precio − costo − gastos de venta por
  // pieza. Only lines with content enter the estimate; an empty placeholder
  // line is not "sin costo". An unsafe amount throws RangeError here too —
  // swallow it exactly like `totals` does so the form stays mounted and the
  // existing warning (plus the disabled Guardar) covers the operator.
  const profitView = useMemo(() => {
    try {
      return itemsProfitBreakdown(
        lines
          .filter((line) => line.productId || line.productName.trim())
          .map((line) => ({
            ...(line.productId ? { productId: line.productId } : {}),
            ...(line.variantId ? { variantId: line.variantId, variantColor: line.variantColor, variantSku: line.variantSku } : {}),
            productName: line.productName,
            quantity: Math.max(0, Math.round(numberFromText(line.quantityText))),
            unitPrice: numberFromText(line.unitPriceText),
            subtotal: 0,
            ...(line.cost != null && line.cost >= 0 ? { cost: line.cost } : {}),
          })),
        order.storeId,
        state.purchases,
      );
    } catch (error) {
      if (error instanceof RangeError) return null;
      throw error;
    }
  }, [lines, order.storeId, state.purchases]);

  // #165: the agreement preview — derived live from the order total ÷ cuotas
  // with exact cents, dates derived from the first due date + frequency. Shown
  // BEFORE saving so the operator confirms exactly what was agreed.
  const planPreview = useMemo(() => {
    if (!installmentsOn || !totals) return null;
    try {
      const input = validateInstallmentPlanInput({
        countText: cuotasText,
        frequency,
        firstDueDate,
        totalCents: orderAmountCents(totals.estimatedTotal),
      });
      const amounts = splitInstallmentCents(orderAmountCents(totals.estimatedTotal), input.count);
      return {
        ...input,
        amounts,
        dueDates: amounts.map((_, i) => installmentDueDate(input.firstDueDate, input.frequency, i)),
      };
    } catch {
      return null; // incomplete capture: no preview, no invented agreement
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installmentsOn, cuotasText, frequency, firstDueDate, totals?.estimatedTotal]);

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function selectProduct(line: DraftLine, product: Product | undefined) {
    if (!product) {
      updateLine(line.key, { productId: undefined, productName: line.productQuery.trim(), productQuery: line.productQuery });
      return;
    }
    const manualTier = isTiered && line.priceSource === "manual" && !!line.priceTier;
    const priceTier = manualTier ? line.priceTier : currentTier;
    const tierPrice = isTiered ? product.prices?.[priceTier ?? ""] : product.price;
    // Missing tier → undefined forces manual capture (#92). A tier without a
    // configured price keeps the line's current price instead of dropping to
    // $0 (#93's fallback) — but never masks the missing-tier case.
    const currentPrice = numberFromText(line.unitPriceText);
    const unitPrice = missingTier && !manualTier ? undefined : tierPrice ?? (currentPrice > 0 ? currentPrice : undefined);
    const category = state.categories.find((item) => item.storeId === order.storeId && item.id === product.categoryIds?.[0]);
    const categorySnapshot = line.productId === product.id ? line.categorySnapshot : category ? { id: category.id, name: category.name } : undefined;
    updateLine(line.key, {
      productId: product.id,
      priceSource: manualTier ? "manual" : "automatic",
      // #124: the color choice belongs to the new product; a design sold by
      // color starts unchosen (mandatory) and per-color cost lands on pick.
      variantId: undefined,
      variantColor: undefined,
      variantSku: undefined,
      categorySnapshot,
      productName: product.name,
      productQuery: product.name,
      priceTier: isTiered ? priceTier : undefined,
      unitPrice: unitPrice ?? 0,
      unitPriceText: unitPrice == null ? "" : String(unitPrice),
      cost: product.cost,
      costText: product.cost == null ? "" : String(product.cost),
    });
  }

  /** #124: choosing the exact color — snapshots color/clave and adopts the
   * color's own cost (decision 2) while the price stays the design's. */
  function selectVariant(line: DraftLine, variantId: string) {
    const product = products.find((item) => item.id === line.productId);
    if (!product) return;
    const variant = product.variants?.find((v) => v.id === variantId);
    if (!variant) {
      updateLine(line.key, { variantId: undefined, variantColor: undefined, variantSku: undefined });
      return;
    }
    updateLine(line.key, {
      variantId: variant.id,
      variantColor: variant.color,
      variantSku: variant.sku ?? (variant.skuSuffix ? `${product.sku ?? ""}-${variant.skuSuffix}` : undefined),
      ...(variant.cost != null ? { cost: variant.cost, costText: String(variant.cost) } : {}),
    });
  }

  function changeProductQuery(line: DraftLine, value: string) {
    const product = products.find((candidate) => candidate.name === value || candidate.id === value);
    if (product) selectProduct(line, product);
    else updateLine(line.key, { productId: undefined, categorySnapshot: undefined, productName: value, productQuery: value, ...(line.productId ? { priceSource: "automatic", priceTier: undefined, unitPriceText: "" } : {}) });  }

  function changeTier(line: DraftLine, value: string) {
    const product = products.find((candidate) => candidate.id === line.productId);
    const unitPrice = product?.prices?.[value];
    updateLine(line.key, { priceTier: value, priceSource: "manual", unitPrice: unitPrice ?? 0, unitPriceText: unitPrice == null ? "" : String(unitPrice) });
  }

  async function submit() {
    if (savingRef.current || conflictingDraft) return;
    if (!totals) { toast.error("Revisa los importes o cantidades demasiado grandes."); return; }
    if (!customerId || customerQuery !== selectedCustomer?.name) {      toast.error("Elige una clienta para guardar el pedido.");
      return;
    }
    if (missingTier) {
      toast.error("Elige un nivel de precio disponible.");
      return;
    }
    // #124 (decisión 5): la venta identifica el color exacto — sin color no
    // se puede reservar la existencia correcta.
    for (const [index, line] of lines.entries()) {
      const product = line.productId ? products.find((item) => item.id === line.productId) : undefined;
      if (product && isVariantProduct(product) && line.productId && !line.variantId) {
        toast.error(`Elige el color del artículo ${index + 1} (${product.name}).`);
        return;
      }
    }
    const normalizedItems: OrderItem[] = [];
    for (const line of lines) {
      const productName = line.productName.trim();
      const quantity = parseAmount(line.quantityText);
      const unitPrice = parseAmount(line.unitPriceText);
      if (!productName || !quantity || !Number.isSafeInteger(quantity) || quantity <= 0) {
        toast.error("Cada línea necesita un nombre y una cantidad entera positiva.");
        return;
      }
      if (unitPrice == null || unitPrice < 0) {
        toast.error("Revisa los precios de las líneas.");
        return;
      }
      const cost = parseAmount(line.costText);
      // Persist the tier the SELECT showed (line.priceTier ?? default), so the
      // saved snapshot never disagrees with what was on screen.
      const tier = isTiered ? line.priceTier ?? currentTier : undefined;
      normalizedItems.push({
        // A new line adopts its draft key as its permanent identity; an edited
        // line keeps the lineId it was loaded with.
        lineId: line.lineId ?? line.key,
        ...(line.productId ? { productId: line.productId } : {}),
        ...(line.variantId ? { variantId: line.variantId, variantColor: line.variantColor, variantSku: line.variantSku } : {}),
        priceSource: line.productId ? (line.priceSource ?? "manual") : "manual",
        ...(line.categorySnapshot ? { categorySnapshot: line.categorySnapshot } : {}),
        productName,
        quantity,
        ...(tier ? { priceTier: tier } : {}),
        unitPrice,
        subtotal: orderAmountCents(unitPrice, quantity) / 100,
        ...(cost != null ? { cost } : {}),
      });
    }
    if (deposit.trim() && parseAmount(deposit) == null) {
      toast.error("Revisa el anticipo.");
      return;
    }
    if (hasPaymentEvidence && numberFromText(deposit) > (order.deposit ?? 0)) {
      toast.error("El anticipo no puede subir cuando el pedido ya tiene cobros. Registra un cobro.");
      return;
    }
    const loweringWithEvidence =
      hasPaymentEvidence &&
      order.inheritedDepositMaterialized !== true &&
      numberFromText(deposit) < (order.deposit ?? 0);
    if (loweringWithEvidence && !depositCorrectionNote.trim()) {
      toast.error("Escribe el motivo de la corrección del anticipo: queda como registro firmado de quién, cuánto y por qué.");
      return;
    }
    // #165: validate the whole agreement before saving anything. Errors are
    // the operator's exact reason, in Spanish.
    let installments: Order["installments"];
    if (installmentsOn) {
      try {
        const input = validateInstallmentPlanInput({
          countText: cuotasText,
          frequency,
          firstDueDate,
          totalCents: orderAmountCents(totals.estimatedTotal),
        });
        installments = {
          ...input,
          // Preserve the original agreement moment across edits (evidence).
          agreedAt: order.installments?.agreedAt ?? new Date().toISOString(),
          agreedBy: order.installments?.agreedBy ?? draftOwnerId,
        };
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Revisa el plan de pagos.");
        return;
      }
    }
    // No separate down payment exists (decision iii): a NEW plan order starts
    // with zero anticipo and money arrives as registered cobros. An existing
    // order's stored deposit is evidence and is never zeroed here.
    const paid = installmentsOn && isNew ? 0 : orderAmountCents(numberFromText(deposit)) / 100;
    const customerName = customerId === order.customerId && order.customerName
      ? order.customerName
      : customers.find((customer) => customer.id === customerId)?.name;
    const next: Order = {
      id: restoredDraft?.orderId ?? order.id,
      storeId: order.storeId,
      customerId,
      ...(customerName ? { customerName } : {}),
      items: normalizedItems,
      deposit: paid,
      orderStatus,
      paymentStatus: paymentStatusForOrder({ ...order, items: normalizedItems, deposit: paid }),
      ...(promisedDate ? { promisedDate } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      // #165: the plan + its one-shot reservation mark + edit evidence travel
      // with the order; dropping them on edit would un-reserve by accident.
      ...(installments ? { installments } : {}),
      ...(order.installmentsReservedAt ? { installmentsReservedAt: order.installmentsReservedAt } : {}),
      ...(order.installmentsHistory?.length ? { installmentsHistory: order.installmentsHistory } : {}),
      schemaVersion: CURRENT_ORDER_SCHEMA_VERSION,
      createdAt: restoredDraft?.orderCreatedAt ?? order.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const payload = JSON.stringify({ ...next, updatedAt: "" });
    if (mutationPayload.current !== payload) mutationId.current = uid("mutation");
    mutationPayload.current = payload;
    draftSaved.current = saveOrderDraft(draftKey, {
      ...(JSON.parse(snapshotDraft()) as Omit<OrderDraftSnapshot, "savedAt">),
      savedAt: new Date().toISOString(),
    });
    await persist(next, false, loweringWithEvidence ? depositCorrectionNote.trim() : undefined);
  }

  /** Shared persistence tail: one place for the success path and the
   * delivery-with-balance confirmation (PO 2026-11-03 R9). */
  async function persist(next: Order, confirmDeliveredWithBalance = false, depositCorrectionNote?: string) {
    try {
      savingRef.current = true;
      setSaving(true);
      await upsertOrder(next, {
        expectedRevision: expectedRevision.current,
        mutationId: mutationId.current,
        ...(confirmDeliveredWithBalance ? { confirmDeliveredWithBalance: true } : {}),
        ...(depositCorrectionNote ? { depositCorrectionNote } : {}),
      });
      const cleared = clearOrderDraft(draftKey);
      setDepositCorrectionNote("");
      pendingDepositNoteRef.current = null;
      toast.success("Pedido guardado");
      if (!cleared) toast.error("No se pudo borrar el borrador de este dispositivo.");
      setPendingDeliveryCents(null);
      onDone();
    } catch (error) {
      if (error instanceof StaleOrderError) {
        toast.error(error.message);
        return; // keep the editor open — the operator reconciles from the fresh copy
      }
      // R9: delivering with an uncovered saldo needs an explicit confirmation
      // that gets RECORDED on the order (retroactive / contraentrega flows).
      if (error instanceof DeliveryWithBalanceError) {
        pendingOrderRef.current = next;
        pendingDepositNoteRef.current = depositCorrectionNote ?? null;
        setPendingDeliveryCents(error.balanceCents);
        return;
      }
      // The capture is NOT lost: it lives on as a local draft (persisted by the
      // effect above) and will be offered again on the next visit.
      toast.error(draftSaved.current ? "No se pudo guardar el pedido. Tu captura quedó como borrador en este dispositivo." : "No se pudo guardar el pedido ni conservar el borrador. Mantén esta pantalla abierta y vuelve a intentar.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <fieldset disabled={saving} className="space-y-6">
      {conflictingDraft && (
        <div className="rounded-lg bg-warning/10 p-3 space-y-3">
          <p>Hay una captura anterior basada en una versión distinta del pedido. Revísala antes de descartarla.</p>
          <details>
            <summary>Ver captura anterior</summary>
            <p>Cliente: {conflictingDraft.customerQuery || "Sin cliente"}</p>
            <ul>{(conflictingDraft.lines as DraftLine[]).map((line) => (
              <li key={line.key}>{line.quantityText} × {line.productName || "Producto sin nombre"} · ${line.unitPriceText}</li>
            ))}</ul>
            {conflictingDraft.notes && <p>Notas: {conflictingDraft.notes}</p>}
          </details>
          <Button variant="ghost" onClick={() => { if (clearOrderDraft(draftKey)) setConflictingDraft(null); else toast.error("No se pudo descartar el borrador en este dispositivo."); }}>Descartar captura anterior</Button>
        </div>
      )}
      {draftRestored && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-warning/10 p-3">
          <p className="text-sm text-on-surface">
            <span className="font-medium">Borrador recuperado</span> de tu última captura en este
            dispositivo. Todavía no está guardado en la nube.
          </p>
          <Button variant="ghost" size="sm" onClick={discardDraft}>Descartar</Button>
        </div>
      )}
      <div className="space-y-2">
        <SearchSelect
          label="Cliente"
          placeholder="Busca por nombre o teléfono"
          value={customerQuery}
          options={customerOptions}
          onChange={(value) => {
            setCustomerQuery(value);
            // An exact, UNIQUE name in this store binds the client (typing the
            // full name is the natural flow); anything else clears the pick so
            // a duplicate name can never silently reassign the order.
            const matches = customers.filter((customer) => customer.name === value);
            if (matches.length === 1) chooseCustomer(matches[0]);
          }}
          onSelect={(option) => {
            const customer = customers.find((item) => item.id === option.value);
            if (!customer) return;
            chooseCustomer(customer);
          }}
        />
        <Button variant="ghost" size="sm" onClick={() => setNewCustomerOpen(true)}>+ Nuevo cliente</Button>
        {isTiered && selectedCustomer && !missingTier && <p className="text-sm text-ink-soft" aria-live="polite">Precio para este pedido: <strong className="text-ink">{tiers.find((tier) => tier.id === currentTier)?.label ?? "Precio de la tienda"}</strong>. Se aplica a los productos nuevos; los precios ajustados a mano se conservan.</p>}
        {missingTier && <p className="text-danger">El nivel de precio de esta clienta ya no está disponible. Elige uno para este pedido.</p>}
        {isTiered && assignedTier && !tiers.some((tier) => tier.id === assignedTier) && (
          <SelectField label="Nivel de precio para el pedido" value={orderTierOverride} onChange={resolveMissingTier} options={[{ value: "", label: "Selecciona un nivel" }, ...tiers.map((tier) => ({ value: tier.id, label: tier.label }))]} />
        )}
      </div>

      {shortagePieces > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="warning">
            {shortagePieces === 1 ? "Falta 1 pieza" : `Faltan ${shortagePieces} piezas`} en {lineShortage.size}{" "}
            {lineShortage.size === 1 ? "producto" : "productos"}
          </Badge>
          {!reviewing && firstShortageKey && (
            <Button variant="ghost" size="sm" onClick={focusNextShortage}>
              {shortageKeys.length > 1 ? `Ver faltantes (${shortageStop}/${shortageKeys.length})` : "Ver faltantes"}
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant={reviewing ? "secondary" : "primary"} aria-pressed={!reviewing} onClick={() => setReviewing(false)}>Capturar</Button>
        <Button variant={reviewing ? "primary" : "secondary"} aria-pressed={reviewing} onClick={() => setReviewing(true)}>Revisar por categoría</Button>
      </div>
      {reviewing ? (
        <div className="space-y-4">
          {groupOrderLines(lines).map((group, index) => (
            <Card key={`${group.name}-${index}`} className="space-y-3 p-4">
              <h2 className="font-semibold text-on-surface">{group.name}</h2>
              {group.lines.map((line) => {
                const missing = lineShortage.get(line.key) ?? 0;
                return (
                  <div key={line.key} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <OrderLinePhoto products={products} productId={line.productId} variantId={line.variantId} className="h-10 w-10 shrink-0" />
                      <span className="min-w-0 break-words">{line.quantityText} × {line.productName || "Producto sin nombre"}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {missing > 0 && <Badge tone="warning">Falta {missing}</Badge>}
                      <Button variant="ghost" size="sm" aria-label={`Editar ${line.productName || "producto sin nombre"}`} onClick={() => { setFocusLine(line.key); setReviewing(false); }}>Editar</Button>
                    </span>
                  </div>
                );
              })}
            </Card>
          ))}
        </div>
      ) : <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="serif-display text-lg font-semibold text-ink">Productos</h2>
          </div>
          <Button variant="secondary" size="sm" onClick={addLine}>+ Agregar línea</Button>
        </div>
        {lines.map((line, captureIndex) => ({ line, captureIndex })).reverse().map(({ line, captureIndex }) => {
          const currentQuantity = Math.max(0, Math.round(numberFromText(line.quantityText)));
          const currentPrice = numberFromText(line.unitPriceText);
          let lineSubtotal: number | null;
          try { lineSubtotal = orderAmountCents(currentPrice, currentQuantity) / 100; }
          catch (error) {
            if (!(error instanceof RangeError)) throw error;
            lineSubtotal = null;
          }
          const selectedTier = tiers.find((tier) => tier.id === line.priceTier);
          const warning = selectedTier ? tierWarning({ quantity: currentQuantity, subtotal: lineSubtotal ?? 0 }, selectedTier) : null;
          return (
            <Card
              key={line.key}
              className={`space-y-4 p-4 md:p-5 shadow-none${line.key === enteringKey ? " animate-[riseIn_var(--motion-base)_var(--ease-smooth)]" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                {/* Article numbers follow CAPTURE order (stable per article);
                    the stack view shows the newest on top without renumbering. */}
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-soft">Artículo {captureIndex + 1}</span>
                  {(lineShortage.get(line.key) ?? 0) > 0 && <Badge tone="warning">Falta {lineShortage.get(line.key)}</Badge>}
                </span>
                {lines.length > 1 && (
                  <IconButton
                    variant="ghost"
                    aria-label={`Eliminar artículo ${captureIndex + 1}`}
                    onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                    className="text-lg"
                  >
                    ×
                  </IconButton>
                )}
              </div>
              {/* #310: thumbnail travels WITH the selector (aligned row) —
                  the photo no longer hangs below the product field. */}
              <div className="flex items-start gap-3">
                <OrderLinePhoto products={products} productId={line.productId} variantId={line.variantId} className="h-14 w-14 shrink-0" />
                <div className="min-w-0 flex-1">
                  <SearchSelect
                    inputRef={(input) => {
                      productInputs.current[line.key] = input;
                      if (captureIndex === lines.length - 1) newProductInput.current = input; // addLine focuses the newest (rendered on top)
                    }}
                    label="Producto"
                    placeholder="Busca o escribe un producto"
                    value={line.productQuery}
                    options={productOptions}
                    emptyLabel="No aparece en el catálogo; puedes dejarlo como producto personalizado."
                    onChange={(value) => changeProductQuery(line, value)}
                    onSelect={(option) => {
                      const product = products.find((item) => item.id === option.value);
                      if (product) selectProduct(line, product);
                    }}
                  />
                </div>
              </div>
              {(() => {
                // #124: designs sold by color REQUIRE the exact color (decision 5).
                const product = products.find((item) => item.id === line.productId);
                if (!product || !isVariantProduct(product)) return null;
                return (
                  <SelectField
                    label="Color"
                    value={line.variantId ?? ""}
                    onChange={(value) => selectVariant(line, value)}
                    options={[
                      { value: "", label: "Elige el color…" },
                      ...product.variants!.map((variant) => ({
                        value: variant.id,
                        label:
                          variant.color +
                          (typeof variant.quantityOnHand === "number" ? ` (existencia ${variant.quantityOnHand})` : "") +
                          (variant.sku ? ` · ${variant.sku}` : ""),
                      })),
                    ]}
                  />
                );
              })()}
              {line.priceSource === "manual" && <p className="text-xs text-on-surface-soft">Precio ajustado manualmente.</p>}
              {line.productId && !line.unitPriceText && <p className="text-danger">Falta capturar el precio de este producto.</p>}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(7rem,0.65fr)_minmax(9rem,1fr)_minmax(10rem,1fr)_minmax(8rem,0.9fr)]">
                <TextField
                  label="Cantidad"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  inputRef={(input) => {
                    quantityInputs.current[line.key] = input;
                  }}
                  value={line.quantityText}
                  onChange={(event) => {
                    const value = sanitizeIntegerInput(event.target.value);
                    updateLine(line.key, { quantityText: value, quantity: parseAmount(value) ?? 0 });
                  }}
                />
                <TextField
                  label="Precio unitario"
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.]?[0-9]*"
                  value={line.unitPriceText}
                  onChange={(event) => {
                    const value = sanitizeDecimalInput(event.target.value);
                    updateLine(line.key, { unitPriceText: value, unitPrice: numberFromText(value), priceSource: "manual" });
                  }}
                />
                {isTiered && (
                  <div className="col-span-2 md:col-span-1">
                    <SelectField
                      label="Nivel de precio"
                      value={line.priceTier ?? currentTier ?? ""}
                      onChange={(value) => changeTier(line, value)}
                      options={tiers.map((tier) => ({ value: tier.id, label: tier.label }))}
                    />
                  </div>
                )}
                {!isTiered && <div className="hidden md:block" aria-hidden />}
                {/* #310: subtotal rides the same aligned row (4th column) — the
                    one-line box below was a whole extra block per article. */}
                <div className="col-span-2 flex min-h-[2.75rem] items-center md:col-span-1">
                  <StatRow label="Subtotal">{lineSubtotal == null ? "—" : <Money exact amount={lineSubtotal} />}</StatRow>
                </div>
              </div>
              {/* No cost INPUT here: cost is catalog data that rides along in the
                  line snapshot to feed the saved order's estimated profit — it is
                  not something the operator captures, and an editable field with
                  no visible effect was noise (field feedback, dev trial). */}
              {warning && <Badge tone="warning">{warning}</Badge>}
            </Card>
          );
        })}
      </div>}

      <CheckboxField
        label="Pagos por partes"
        hint="Cuotas y fechas acordadas en este pedido, sin intereses. La pieza se aparta con el primer abono y se entrega al liquidar."
        checked={installmentsOn}
        onChange={setInstallmentsOn}
      />
      {installmentsOn && (
        <Card className="space-y-3 p-4 md:p-5 shadow-none">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField
              label="Número de cuotas"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={cuotasText}
              onChange={(event) => setCuotasText(sanitizeIntegerInput(event.target.value))}
            />
            <SelectField
              label="Frecuencia"
              value={frequency}
              onChange={(value) => setFrequency(value as InstallmentFrequency)}
              placeholder="Selecciona la frecuencia"
              options={(Object.keys(INSTALLMENT_FREQUENCY_LABELS) as InstallmentFrequency[]).map((value) => ({
                value,
                label: INSTALLMENT_FREQUENCY_LABELS[value],
              }))}
            />
            <TextField
              label="Primera fecha de vencimiento"
              type="date"
              value={firstDueDate}
              onChange={(event) => setFirstDueDate(event.target.value)}
            />
          </div>
          {planPreview && totals ? (
            <div className="space-y-2" aria-label="Acuerdo de pagos">
              <p className="text-sm font-medium text-on-surface">
                {planPreview.count} {planPreview.count === 1 ? "cuota" : "cuotas"} ·{" "}
                {INSTALLMENT_FREQUENCY_LABELS[planPreview.frequency]}
              </p>
              <ul className="max-h-48 overflow-y-auto divide-y divide-edge" aria-label="Calendario de cuotas">
                {planPreview.amounts.map((amountCents, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-1 text-sm">
                    <span className="min-w-0 text-on-surface-soft">
                      Cuota {i + 1} · {formatPlanDate(planPreview.dueDates[i])}
                    </span>
                    <span className="serif-display tnum shrink-0">
                      <Money exact amount={amountCents / 100} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-on-surface-soft">
                Última fecha: {formatPlanDate(planPreview.dueDates[planPreview.dueDates.length - 1])}. La suma del
                plan es exactamente el total: <Money exact amount={totals.estimatedTotal} />.
              </p>
            </div>
          ) : (
            <p className="text-xs text-on-surface-soft">
              Captura cuotas, frecuencia y primera fecha para ver el acuerdo antes de guardar.
            </p>
          )}
        </Card>
      )}
      <div className="grid grid-cols-2 gap-2">
        {!installmentsOn && (
          <TextField
            label="Anticipo"
            disabled={order.inheritedDepositMaterialized === true}
            hint={order.inheritedDepositMaterialized === true ? "El anticipo ya está registrado en el historial de cobros." : undefined}
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.]?[0-9]*"
            value={deposit}
            onChange={(event) => setDeposit(sanitizeDecimalInput(event.target.value))}
          />
        )}
        <TextField label="Fecha prometida" type="date" value={promisedDate} onChange={(event) => setPromisedDate(event.target.value)} />
      </div>
      {hasPaymentEvidence &&
        order.inheritedDepositMaterialized !== true &&
        numberFromText(deposit) < (order.deposit ?? 0) && (
          <div className="space-y-1 rounded-xl bg-surface p-3 ring-1 ring-edge">
            <p className="text-xs text-on-surface-soft">
              Estás bajando el anticipo de un pedido con cobros registrados. La corrección queda como registro
              firmado (quién, de cuánto a cuánto, por qué); el dinero ya recibido no se borra en silencio.
            </p>
            <TextField
              label="Motivo de la corrección del anticipo"
              value={depositCorrectionNote}
              onChange={(event) => setDepositCorrectionNote(event.target.value)}
              placeholder="p. ej. anticipo capturado por error, era $100"
            />
          </div>
        )}
      <SelectField label="Estado del pedido" value={orderStatus} onChange={setOrderStatus} options={STATUS_OPTIONS} />
      <TextArea label="Notas" value={notes} onChange={(event) => setNotes(event.target.value)} />

      <div className="sticky bottom-3 z-10 rounded-xl border border-edge bg-paper/95 p-4 shadow-lift backdrop-blur">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <StatRow label="Piezas">{totals?.pieces ?? "—"}</StatRow>
          <StatRow label="Total">{totals ? <Money exact amount={totals.estimatedTotal} /> : "—"}</StatRow>
          <StatRow label="Recibido">{totals ? <Money exact amount={totals.paid} /> : "—"}</StatRow>
          <StatRow label="Saldo" tone={totals && totals.balance > 0 ? "danger" : "success"}>{totals ? <Money exact amount={totals.balance} /> : "—"}</StatRow>
          <StatRow
            label="Ganancia"
            tone={profitView?.profitCents != null && profitView.profitCents < 0 ? "danger" : "default"}
          >{profitView?.profitCents == null ? "—" : <Money exact amount={profitView.profitCents / 100} />}</StatRow>
        </div>
        {profitView?.profitCents != null && profitView.linesWithoutCost > 0 && (
          <p className="text-xs text-on-surface-soft mt-1">
            {profitView.linesWithoutCost} {profitView.linesWithoutCost === 1 ? "línea sin costo no cuenta" : "líneas sin costo no cuentan"} en la ganancia.
          </p>
        )}
        {!totals && <p className="text-danger">Revisa los importes o cantidades demasiado grandes.</p>}
      </div>

        {/*
          #234: the save action must be reachable WITHOUT scrolling — a 1-line
          order had "Guardar pedido" ~4 viewports down on mobile. The action row
          sticks above the bottom nav while the form scrolls (md: the row stays
          in its natural place at the end).
        */}
        <div className="fixed inset-x-0 bottom-[3.75rem] md:static md:inset-auto z-20 mt-4 border-t border-edge bg-paper/95 backdrop-blur px-4 py-2.5 shadow-lift md:border-0 md:bg-transparent md:px-0 md:py-0 md:shadow-none md:backdrop-blur-none" aria-label="Acciones del pedido">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1 md:hidden">
              <p className="text-xs text-ink-soft">Total {totals ? <Money exact amount={totals.estimatedTotal} /> : "—"}</p>
              <p className="text-xs truncate">Saldo {totals ? <Money exact amount={totals.balance} /> : "—"}</p>
            </div>
            {onCancel && <Button variant="ghost" full onClick={onCancel}>Cancelar</Button>}
            <Button full size="lg" onClick={submit} disabled={saving || !!conflictingDraft || !customerId || lines.length === 0 || !totals}>Guardar pedido</Button>
            {!customerId && (
              <p className="text-xs text-on-surface-soft -mt-2">Elige o crea una clienta para poder guardar.</p>
            )}
          </div>
        </div>
        {/* Room so the fixed bar (mobile) never covers the last form fields. */}
        <div className="h-16 md:hidden" aria-hidden="true" />

      <Dialog open={!!pendingCustomer} title="Cambiar cliente" onClose={() => { setPendingCustomer(null); setCustomerQuery(selectedCustomer?.name ?? ""); }} footer={<div className="flex w-full flex-col gap-2">
        <Button full onClick={() => pendingCustomer && applyCustomer(pendingCustomer, true)}>Aplicar precios de {pendingCustomer?.name}</Button>
        <Button full variant="secondary" onClick={() => pendingCustomer && applyCustomer(pendingCustomer, false)}>Conservar importes</Button>
        <Button full variant="ghost" onClick={() => { setPendingCustomer(null); setCustomerQuery(selectedCustomer?.name ?? ""); }}>Cancelar</Button>
      </div>}>
        <p>Los precios ajustados a mano se conservan.</p>
      </Dialog>
      <Dialog open={newCustomerOpen} title="Nuevo cliente" onClose={() => setNewCustomerOpen(false)}>
        <CustomerForm
          customer={{
            ...(activeStore ? newCustomer(activeStore.id) : newCustomer(order.storeId)),
            // #219 (UX menor): what Fer already typed seeds the new ficha —
            // a phone-like query becomes the phone, anything else the name.
            ...(customerQuery.trim()
              ? /^\+?[\d\s().-]{8,}$/.test(customerQuery.trim())
                ? { phone: customerQuery.trim() }
                : { name: customerQuery.trim() }
              : {}),
          }}
          onDone={() => setNewCustomerOpen(false)}
          onSaved={(customer) => {
            // Creating a customer inline IS the explicit choice to switch:
            // skip the confirmation dialog (which would strand the switch when
            // the editor was restored from a draft of another customer).
            applyCustomer(customer, true);
          }}
        />
      </Dialog>
      </fieldset>
      {pendingDeliveryCents != null && (
        <Dialog
          open
          title="Entregar con saldo pendiente"
          onClose={() => setPendingDeliveryCents(null)}
        >
          <p className="text-sm text-on-surface-soft space-y-2">
            Este pedido quedará entregado con un saldo de{" "}
            <Money exact amount={pendingDeliveryCents / 100} /> por cobrar. La entrega queda
            registrada a tu nombre como autorización explícita. Si la clienta paga al entregar
            (contraentrega), registra el cobro después de guardar.
          </p>
          <div className="flex gap-2 pt-4">
            <Button variant="secondary" full disabled={saving} onClick={() => setPendingDeliveryCents(null)}>
              Volver a revisar
            </Button>
            <Button
              full
              disabled={saving}
              onClick={() => {
                const order = pendingOrderRef.current;
                if (order) void persist(order, true, pendingDepositNoteRef.current ?? undefined);
              }}
            >
              Entregar con saldo
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function OrderLinePhoto({ products, productId, variantId, className = "h-20 w-20" }: { products: Product[]; productId?: string; variantId?: string; className?: string }) {
  const product = products.find((candidate) => candidate.id === productId);
  if (!product) return null;
  // #124: a chosen color shows ITS photo (the exact piece leaving the shelf).
  const variant = variantId ? product.variants?.find((v) => v.id === variantId) : undefined;
  const variantCover = variant?.photos?.find((image) => image.isPrimary) ?? variant?.photos?.[0];
  const cover = variantCover ?? product.images?.find((image) => image.isPrimary) ?? product.images?.[0];
  const src = cover?.url ?? product.imageUrl;
  return (
    <ProductImage
      src={src}
      alt={src ? `Foto de ${product.name}` : `Foto no disponible de ${product.name}`}
      size="thumb"
      className={className}
    />
  );
}
