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
  useToast,
} from "../../design-system";
import { customersForStore } from "../../lib/selectors";
import { defaultTier, tiersForStore } from "../../lib/pricing";
import { formatMoney, parseAmount, sanitizeDecimalInput, sanitizeIntegerInput } from "../../lib/money";
import { effectiveOrderStatus, orderItems, orderTotals, paymentStatusForOrder, tierWarning } from "../../lib/orders";
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
  const [deposit, setDeposit] = useState(restoredDraft?.deposit ?? String(order.deposit ?? 0));
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
    setLines((current) => [lineFromItem(), ...current]);
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
  const [focusLine, setFocusLine] = useState<string | null>(null);
  const productInputs = useRef<Record<string, HTMLInputElement | null>>({});
  useLayoutEffect(() => {
    if (reviewing || !focusLine) return;
    const input = productInputs.current[focusLine];
    input?.focus({ preventScroll: true });
    input?.scrollIntoView?.({ block: "center", behavior: "auto" });
    setFocusLine(null);
  }, [reviewing, focusLine]);

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
        items: lines.map((line) => ({
          productId: line.productId,
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
  }, [deposit, lines]);
  // Full-cost profit preview (FER-03): precio − costo − gastos de venta por
  // pieza. Only lines with content enter the estimate; an empty placeholder
  // line is not "sin costo".
  const profitView = useMemo(() => itemsProfitBreakdown(
    lines
      .filter((line) => line.productId || line.productName.trim())
      .map((line) => ({
        ...(line.productId ? { productId: line.productId } : {}),
        productName: line.productName,
        quantity: Math.max(0, Math.round(numberFromText(line.quantityText))),
        unitPrice: numberFromText(line.unitPriceText),
        subtotal: 0,
        ...(line.cost != null && line.cost >= 0 ? { cost: line.cost } : {}),
      })),
    order.storeId,
    state.purchases,
  ), [lines, order.storeId, state.purchases]);

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
    if (!customerId || customerQuery !== selectedCustomer?.name) {      toast.error("Elige un cliente para guardar el pedido.");
      return;
    }
    if (missingTier) {
      toast.error("Elige un nivel de precio disponible.");
      return;
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
    await persist(next);
  }

  /** Shared persistence tail: one place for the success path and the
   * delivery-with-balance confirmation (PO 2026-11-03 R9). */
  async function persist(next: Order, confirmDeliveredWithBalance = false) {
    try {
      savingRef.current = true;
      setSaving(true);
      await upsertOrder(next, {
        expectedRevision: expectedRevision.current,
        mutationId: mutationId.current,
        ...(confirmDeliveredWithBalance ? { confirmDeliveredWithBalance: true } : {}),
      });
      const cleared = clearOrderDraft(draftKey);
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

      <div className="flex flex-wrap gap-2">
        <Button variant={reviewing ? "secondary" : "primary"} aria-pressed={!reviewing} onClick={() => setReviewing(false)}>Capturar</Button>
        <Button variant={reviewing ? "primary" : "secondary"} aria-pressed={reviewing} onClick={() => setReviewing(true)}>Revisar por categoría</Button>
      </div>
      {reviewing ? (
        <div className="space-y-4">
          {groupOrderLines(lines).map((group, index) => (
            <Card key={`${group.name}-${index}`} className="space-y-3 p-4">
              <h2 className="font-semibold text-on-surface">{group.name}</h2>
              {group.lines.map((line) => (
                <div key={line.key} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 break-words">{line.quantityText} × {line.productName || "Producto sin nombre"}</span>
                  <Button variant="ghost" size="sm" aria-label={`Editar ${line.productName || "producto sin nombre"}`} onClick={() => { setFocusLine(line.key); setReviewing(false); }}>Editar</Button>
                </div>
              ))}
            </Card>
          ))}
        </div>
      ) : <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="serif-display text-lg font-semibold text-ink">Productos</h2>
            <p className="text-xs text-on-surface-soft mt-0.5">Agrega una o varias líneas al pedido.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={addLine}>+ Agregar línea</Button>
        </div>
        {lines.map((line, index) => {
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
            <Card key={line.key} className="space-y-4 p-4 md:p-5 shadow-none">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-soft">Línea {index + 1}</span>
                {lines.length > 1 && (
                  <IconButton
                    variant="ghost"
                    aria-label={`Eliminar línea ${index + 1}`}
                    onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                    className="text-lg"
                  >
                    ×
                  </IconButton>
                )}
              </div>
              <SearchSelect
                inputRef={(input) => {
                  productInputs.current[line.key] = input;
                  if (index === 0) newProductInput.current = input; // addLine focuses the top line
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
              {line.priceSource === "manual" && <p className="text-xs text-on-surface-soft">Precio ajustado manualmente.</p>}
              {line.productId && !line.unitPriceText && <p className="text-danger">Falta capturar el precio de este producto.</p>}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(7rem,0.65fr)_minmax(10rem,1fr)_minmax(11rem,1fr)]">
                <TextField
                  label="Cantidad"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={line.quantityText}
                  onChange={(event) => {
                    const value = sanitizeIntegerInput(event.target.value);
                    updateLine(line.key, { quantityText: value, quantity: parseAmount(value) ?? 0 });
                  }}
                />
                <TextField
                  label="Precio unitario"
                  hint="Puedes ajustarlo para este pedido."
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
                      hint="Se guarda en este pedido y no cambia el catálogo."
                      value={line.priceTier ?? currentTier ?? ""}
                      onChange={(value) => changeTier(line, value)}
                      options={tiers.map((tier) => ({ value: tier.id, label: tier.label }))}
                    />
                  </div>
                )}
                {!isTiered && <div className="hidden md:block" aria-hidden />}
              </div>
              <div className="grid grid-cols-2 items-end gap-3">
                <TextField
                  label="Costo (opcional)"
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.]?[0-9]*"
                  value={line.costText}
                  onChange={(event) => {
                    const value = sanitizeDecimalInput(event.target.value);
                    updateLine(line.key, { costText: value, cost: parseAmount(value) });
                  }}
                />
                <div className="rounded-md bg-surface-muted px-3 py-2.5 min-h-[3.25rem] flex items-center">
                  <StatRow label="Subtotal">{lineSubtotal == null ? "—" : <Money exact amount={lineSubtotal} />}</StatRow>
                </div>
              </div>
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
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.]?[0-9]*"
            value={deposit}
            onChange={(event) => setDeposit(sanitizeDecimalInput(event.target.value))}
          />
        )}
        <TextField label="Fecha prometida" type="date" value={promisedDate} onChange={(event) => setPromisedDate(event.target.value)} />
      </div>
      <SelectField label="Estado del pedido" value={orderStatus} onChange={setOrderStatus} options={STATUS_OPTIONS} />
      <TextArea label="Notas" value={notes} onChange={(event) => setNotes(event.target.value)} />

      <div className="sticky bottom-3 z-10 rounded-xl border border-edge bg-paper/95 p-4 shadow-lift backdrop-blur">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <StatRow label="Piezas">{totals?.pieces ?? "—"}</StatRow>
          <StatRow label="Total">{totals ? <Money exact amount={totals.estimatedTotal} /> : "—"}</StatRow>
          <StatRow label="Anticipo">{totals ? <Money exact amount={totals.paid} /> : "—"}</StatRow>
          <StatRow label="Saldo" tone={totals && totals.balance > 0 ? "danger" : "success"}>{totals ? <Money exact amount={totals.balance} /> : "—"}</StatRow>
          <StatRow
            label="Ganancia"
            tone={profitView.profitCents != null && profitView.profitCents < 0 ? "danger" : "default"}
          >{profitView.profitCents == null ? "—" : <Money exact amount={profitView.profitCents / 100} />}</StatRow>
        </div>
        {profitView.profitCents != null && profitView.linesWithoutCost > 0 && (
          <p className="text-xs text-on-surface-soft mt-1">
            {profitView.linesWithoutCost} {profitView.linesWithoutCost === 1 ? "línea sin costo no cuenta" : "líneas sin costo no cuentan"} en la ganancia.
          </p>
        )}
        {!totals && <p className="text-danger">Revisa los importes o cantidades demasiado grandes.</p>}
        <div className="flex gap-2 mt-4">
          {onCancel && <Button variant="ghost" full onClick={onCancel}>Cancelar</Button>}
          <Button full size="lg" onClick={submit} disabled={saving || !!conflictingDraft || !customerId || lines.length === 0 || !totals}>Guardar pedido</Button>        </div>
      </div>

      <Dialog open={!!pendingCustomer} title="Cambiar cliente" onClose={() => { setPendingCustomer(null); setCustomerQuery(selectedCustomer?.name ?? ""); }} footer={<div className="flex w-full flex-col gap-2">
        <Button full onClick={() => pendingCustomer && applyCustomer(pendingCustomer, true)}>Aplicar precios de {pendingCustomer?.name}</Button>
        <Button full variant="secondary" onClick={() => pendingCustomer && applyCustomer(pendingCustomer, false)}>Conservar importes</Button>
        <Button full variant="ghost" onClick={() => { setPendingCustomer(null); setCustomerQuery(selectedCustomer?.name ?? ""); }}>Cancelar</Button>
      </div>}>
        <p>Los precios ajustados a mano se conservan.</p>
      </Dialog>
      <Dialog open={newCustomerOpen} title="Nuevo cliente" onClose={() => setNewCustomerOpen(false)}>
        <CustomerForm
          customer={activeStore ? newCustomer(activeStore.id) : newCustomer(order.storeId)}
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
                if (order) void persist(order, true);
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
