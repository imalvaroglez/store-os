import { useMemo, useState } from "react";
import { useStore, newSupplier, newProduct } from "../../app/StoreProvider";
import {
  Button,
  Card,
  CheckboxField,
  SelectField,
  SearchSelect,
  TextField,
  TextArea,
  IconButton,
  Sheet,
  Badge,
  useToast,
} from "../../design-system";
import { suppliersForStore, productsForStore } from "../../lib/selectors";
import { todayIso, nowIso, parseSpanishDate } from "../../lib/dates";
import { formatMoney, formatMoneyExact, parseAmount } from "../../lib/money";
import { tiersForStore } from "../../lib/pricing";
import { suggestSkuBase, uniqueProductSku } from "../../lib/catalog";
import { uid } from "../../lib/ids";
import { legacyPurchaseTicket, purchaseCostAllocation, purchaseProductCosts } from "../../lib/purchases";
import { openPurchasePdf } from "../../app/firebase/pdfImport";
import {
  effectivePurchaseStatus,
  lineStatus,
  purchaseTotals,
  purchaseRecordedTotal,
  purchaseConfirmedTotal,
  purchaseTicketTotals,
  purchaseSourcingExpenseTotal,
  PURCHASE_EXPENSE_CATEGORY_LABEL,
  recalcPurchaseStatus,
  type PriceTierDef,
  type Purchase,
  type PurchaseExpense,
  type PurchaseExpenseCategory,
  type PurchaseLine,
  type PurchaseLineStatus,
  type PurchaseTicket,
  type Supplier,
  type Product,
} from "../../types";
import { SupplierForm } from "./SupplierForm";
import { PurchasePdfImport, type PdfApplyPayload } from "./PurchasePdfImport";

// Shared purchase editor — the single destination for BOTH entries (manual
// capture and PDF import). Saving only persists the Purchase (a draft);
// "Receive merchandise" (Recibir mercancía) is the only operation that moves inventory.
// purchase-ux2: one responsive CSS grid (dense table on desktop, two-tier
// rows on mobile), sticky footer, calculated line states, global amount
// resolution and (cloud) bulk product creation.
const LINE_STATUS_LABEL: Record<PurchaseLineStatus, string> = {
  amount_review: "Importe por revisar",
  unlinked: "Sin vincular",
  new_product: "Nuevo",
  linked: "Vinculado",
};
const LINE_STATUS_TONE: Record<PurchaseLineStatus, "warning" | "info" | "success"> = {
  amount_review: "warning",
  unlinked: "warning",
  new_product: "info",
  linked: "success",
};

const EXPENSE_CATEGORY_OPTIONS = Object.entries(PURCHASE_EXPENSE_CATEGORY_LABEL).map(([value, label]) => ({
  value: value as PurchaseExpenseCategory,
  label,
}));

type Filter = "all" | PurchaseLineStatus;

export function PurchaseForm({ purchase, onDone }: { purchase: Purchase; onDone: () => void }) {
  const { state, activeStore, upsertPurchase, upsertProduct, createDraftProductsForPurchase, receivePurchase, cloud } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Purchase>(() => {
    const editable = effectivePurchaseStatus(purchase) !== "received";
    const tickets = purchase.tickets?.length ? purchase.tickets : [legacyPurchaseTicket(purchase)];
    return {
      ...purchase,
      ...(editable ? { tickets, costingMethod: "latest_purchase" as const } : {}),
      lines: purchase.lines.map((line) => ({ ...line, lineId: line.lineId ?? uid("pl"), ...(editable ? { ticketId: line.ticketId ?? tickets[0].id } : {}) })),
    };
  });
  const [activeTicketId, setActiveTicketId] = useState(() => draft.tickets?.[0]?.id ?? legacyPurchaseTicket(draft).id);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState<Supplier | null>(null);
  const [productLineIdx, setProductLineIdx] = useState<number | null>(null);
  const [productDraft, setProductDraft] = useState<Product | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [expenseAmountDrafts, setExpenseAmountDrafts] = useState<Record<string, string>>({});
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [productQueries, setProductQueries] = useState<Record<string, string>>({});
  const [pdfBusy, setPdfBusy] = useState(false);

  if (!activeStore) return null;
  const isTiered = activeStore.type === "inventory_tiered";
  const suppliers = suppliersForStore(state.suppliers, activeStore.id);
  const products = productsForStore(state.products, activeStore.id)
    .sort((a, b) => a.name.localeCompare(b.name, "es-MX", { sensitivity: "base" }));
  const locked = effectivePurchaseStatus(draft) === "received";
  const tickets = draft.tickets ?? [legacyPurchaseTicket(draft)];
  const activeTicket = tickets.find((ticket) => ticket.id === activeTicketId) ?? tickets[0];
  const activeTotals = draft.tickets ? purchaseTicketTotals(draft, activeTicket.id) : purchaseTotals(draft);

  // Spec §1 totals live in purchaseTotals (single source, shared with status).
  const { merchandise, calculated } = purchaseTotals(draft);
  const sourcingExpenses = draft.sourcingExpenses ?? [];
  const sourcingExpenseTotal = purchaseSourcingExpenseTotal(draft);
  const recordedTotal = purchaseRecordedTotal(draft);
  const incompleteExpenseCount = sourcingExpenses.filter(
    (expense) => !Number.isFinite(expense.amount) || expense.amount <= 0
  ).length;
  // A confirmed total of 0 is REAL (free order); never fall back to `calculated`
  // or the difference would vanish. Missing/non-finite reads as 0 → mismatch.
  const totalPaid = Number.isFinite(activeTicket.totalConfirmed) ? activeTicket.totalConfirmed : 0;
  const mismatch = Math.abs(activeTotals.calculated - totalPaid);
  const mismatchConfirmed =
    draft.confirmedMismatchAmount != null && Math.abs(mismatch - draft.confirmedMismatchAmount) < 0.005;
  const status = recalcPurchaseStatus(draft);
  const invalidInput = Object.entries(amountDrafts).some(([key, raw]) => {
    if (["discount", "shipping", "tax"].includes(key) && raw.trim() === "") return false;
    const parsed = parseAmount(raw);
    return parsed == null || parsed < 0 || (key.startsWith("quantity:") && (!Number.isSafeInteger(parsed) || parsed <= 0));
  });
  // The single rule lives in recalcPurchaseStatus; the button just obeys it.
  let allocations: ReturnType<typeof purchaseCostAllocation> = [];
  let productCosts: ReturnType<typeof purchaseProductCosts> = new Map();
  let allocationError: string | undefined;
  if (draft.costingMethod === "latest_purchase" && draft.lines.length > 0) {
    try {
      allocations = locked && draft.costAllocations ? draft.costAllocations : purchaseCostAllocation(draft);
      productCosts = purchaseProductCosts(draft, allocations);
    }
    catch (error) { allocationError = error instanceof Error ? error.message : "Revisa los costos de los productos y los gastos."; }
  }
  const canReceive = !locked && status === "ready" && draft.lines.length > 0 && !allocationError && !invalidInput;
  const incompleteTickets = tickets.filter((ticket) => {
    if (!draft.tickets) return false;
    return !draft.lines.some((line) => line.ticketId === ticket.id)
      || Math.abs(purchaseTicketTotals(draft, ticket.id).calculated - ticket.totalConfirmed) > 0.005;
  });

  const statuses = useMemo(() => draft.lines.map(lineStatus), [draft.lines]);
  const counts = useMemo(() => {
    const c: Record<PurchaseLineStatus, number> = { amount_review: 0, unlinked: 0, new_product: 0, linked: 0 };
    for (const s of statuses) c[s] += 1;
    return c;
  }, [statuses]);
  const hasUnknown = counts.amount_review > 0;
  const visible = statuses.map((s, i) => ({ line: draft.lines[i], status: s, idx: i })).filter((r) => filter === "all" || r.status === filter);

  const blockReason = locked
    ? undefined
    : invalidInput
      ? "Revisa los importes y las cantidades que estás escribiendo"
    : counts.amount_review > 0
      ? `${counts.amount_review} ${counts.amount_review === 1 ? "línea tiene un importe sin interpretar" : "líneas tienen importes sin interpretar"}`
      : counts.unlinked > 0
        ? `${counts.unlinked} ${counts.unlinked === 1 ? "línea no está vinculada a un producto" : "líneas no están vinculadas a un producto"}`
        : incompleteExpenseCount > 0
          ? `${incompleteExpenseCount} ${incompleteExpenseCount === 1 ? "gasto necesita" : "gastos necesitan"} un importe mayor que cero`
        : allocationError
          ? allocationError
        : incompleteTickets.length > 0
          ? `Revisa los productos y el total pagado de ${incompleteTickets.length === 1 ? "un ticket" : `${incompleteTickets.length} tickets`}`
        : mismatch > 0.5 && !mismatchConfirmed
          ? `diferencia de ${formatMoneyExact(mismatch)} sin confirmar`
          : undefined;

  function invalidateMismatch(d: Purchase): Purchase {
    return d.confirmedMismatchAmount != null ? { ...d, confirmedMismatchAmount: undefined } : d;
  }
  function ticketLabel(ticket: PurchaseTicket, index: number) {
    return `${ticket.folio ? `#${ticket.folio}` : `Ticket ${index + 1}`} · ${suppliers.find((supplier) => supplier.id === ticket.supplierId)?.name ?? ticket.supplierName ?? "Sin proveedor"}`;
  }
  function updateTicket(patch: Partial<PurchaseTicket>) {
    const nextTickets = tickets.map((ticket) => ticket.id === activeTicket.id ? { ...ticket, ...patch } : ticket);
    setDraft(invalidateMismatch({ ...draft, tickets: nextTickets, totalConfirmed: nextTickets.reduce((sum, ticket) => sum + ticket.totalConfirmed, 0) }));
  }
  function selectTicket(id: string) {
    setActiveTicketId(id);
    setAmountDrafts((previous) => {
      const next = { ...previous };
      for (const key of ["discount", "shipping", "tax", "totalConfirmed"]) delete next[key];
      return next;
    });
  }
  function addTicket() {
    const ticket: PurchaseTicket = { id: uid("pt"), totalConfirmed: 0 };
    setDraft(invalidateMismatch({ ...draft, tickets: [...tickets, ticket], costingMethod: "latest_purchase" }));
    selectTicket(ticket.id);
  }
  function removeTicket() {
    if (tickets.length <= 1 || draft.lines.some((line) => line.ticketId === activeTicket.id)) return;
    const next = tickets.filter((ticket) => ticket.id !== activeTicket.id);
    setDraft(invalidateMismatch({ ...draft, tickets: next, totalConfirmed: next.reduce((sum, ticket) => sum + ticket.totalConfirmed, 0) }));
    selectTicket(next[0].id);
  }
  function addLine() {
    // Any line change — including adding — invalidates a prior confirmation.
    setDraft(invalidateMismatch({ ...draft, lines: [...draft.lines, { lineId: uid("pl"), ticketId: activeTicket.id, productId: "", name: "", quantity: 1, unitCost: 0 }] }));
  }
  function updateLine(idx: number, patch: Partial<PurchaseLine>) {
    if (patch.unitCost != null) {
      const key = `line:${draft.lines[idx].lineId}`;
      setAmountDrafts((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
    // Any line edit invalidates a prior explicit mismatch confirmation.
    setDraft(invalidateMismatch({ ...draft, lines: draft.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  }
  function removeLine(idx: number) {
    const lineId = draft.lines[idx].lineId;
    setAmountDrafts((previous) => {
      const next = { ...previous };
      delete next[`line:${lineId}`]; delete next[`quantity:${lineId}`];
      return next;
    });
    setDraft(invalidateMismatch({ ...draft, lines: draft.lines.filter((_, i) => i !== idx) }));
  }
  function setAdjustment(field: "discount" | "shipping" | "tax", raw: string) {
    setAmountDrafts((previous) => ({ ...previous, [field]: raw }));
    updateTicket({ [field]: parseAmount(raw) ?? 0 });
  }
  function setTotalPaid(raw: string) {
    setAmountDrafts((previous) => ({ ...previous, totalConfirmed: raw }));
    updateTicket({ totalConfirmed: parseAmount(raw) ?? 0 });
  }
  function setUnitCost(idx: number, raw: string) {
    updateLine(idx, { unitCost: parseAmount(raw) ?? 0 });
    // Keep the editable text so a trailing decimal separator survives typing.
    setAmountDrafts((previous) => ({ ...previous, [`line:${draft.lines[idx].lineId}`]: raw }));
  }
  function updateExpense(id: string, patch: Partial<PurchaseExpense>) {
    setDraft({
      ...draft,
      sourcingExpenses: sourcingExpenses.map((expense) =>
        expense.id === id ? { ...expense, ...patch } : expense
      ),
    });
  }
  function addExpense() {
    setDraft({
      ...draft,
      sourcingExpenses: [
        ...sourcingExpenses,
        { id: uid("pe"), category: "sourcing_transport", amount: 0 },
      ],
    });
  }
  function removeExpense(id: string) {
    setDraft({
      ...draft,
      sourcingExpenses: sourcingExpenses.filter((expense) => expense.id !== id),
    });
    setExpenseAmountDrafts((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }
  function setExpenseAmount(id: string, raw: string) {
    setExpenseAmountDrafts((previous) => ({ ...previous, [id]: raw }));
    const parsed = parseAmount(raw);
    const amount = parsed == null ? 0 : Math.round(parsed * 100) / 100;
    updateExpense(id, { amount });
  }
  function setQuantity(idx: number, raw: string) {
    const parsed = parseAmount(raw);
    const qty = parsed != null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
    const line = draft.lines[idx];
    // When the printed amount is the LINE total, the unit cost follows quantity.
    const unitCost = qty > 0 && line.sourceAmountType === "line" && line.sourceAmount != null ? line.sourceAmount / qty : line.unitCost;
    updateLine(idx, { quantity: qty, unitCost });
    setAmountDrafts((previous) => ({ ...previous, [`quantity:${line.lineId}`]: raw }));
  }
  function openMiniForm(idx: number) {
    if (!activeStore) return;
    if (!cloud) { toast.error("Inicia sesión y conecta Firebase para crear productos."); return; }
    const line = draft.lines[idx];
    const base = newProduct(activeStore.id);
    const fullName = line.variant ? `${line.name} ${line.variant}` : line.name;
    setProductDraft({
      ...base,
      name: fullName,
      cost: line.unitCost,
      sku: uniqueProductSku(products, activeStore.id, base.id, suggestSkuBase(fullName, activeStore.skuPrefix ?? "")),
    });
    setProductLineIdx(idx);
  }
  function pickProduct(idx: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (product) {
      setProductQueries((previous) => ({ ...previous, [draft.lines[idx].lineId!]: product.name }));
      // Linking identifies the product; it does not edit the purchase amount
      // or interpret the printed ticket. Both are explicit operator actions.
      updateLine(idx, {
        productId,
        name: product.name,
        matchStatus: "matched",
      });
    } else {
      updateLine(idx, { productId: "", name: "", matchStatus: "unmatched" });
    }
  }
  // Global resolution for every `unknown` line at once (unit vs line total).
  function resolveAmountsGlobally(type: "unit" | "line") {
    setAmountDrafts({});
    setDraft(invalidateMismatch({
      ...draft,
      lines: draft.lines.map((l) =>
        l.sourceAmountType === "unknown" && l.sourceAmount != null
          ? { ...l, sourceAmountType: type, unitCost: type === "unit" ? l.sourceAmount : l.sourceAmount / (l.quantity || 1) }
          : l
      ),
    }));
  }
  function resolveAmount(idx: number, type: "unit" | "line") {
    const l = draft.lines[idx];
    if (l.sourceAmount == null) return;
    updateLine(idx, { sourceAmountType: type, unitCost: type === "unit" ? l.sourceAmount : l.sourceAmount / (l.quantity || 1) });
  }

  function applyPdf(payload: PdfApplyPayload) {
    setAmountDrafts({});
    const parsedDate = payload.dateLabel ? parseSpanishDate(payload.dateLabel) : null;
    setDraft((d) => invalidateMismatch({
      ...d,
      origin: "pdf",
      // Imported lines get their stable identity at ingestion (idempotent: only
      // lines without a lineId adopt one).
      lines: [...d.lines, ...payload.lines.map((line) => ({ ...line, lineId: line.lineId ?? uid("pl"), ticketId: activeTicket.id }))],
      tickets: (d.tickets ?? tickets).map((ticket) => ticket.id === activeTicket.id ? {
        ...ticket, folio: payload.supplierOrder ?? ticket.folio,
        supplierName: payload.supplierCandidate ?? ticket.supplierName,
        documentPath: payload.documentPath, documentFingerprint: payload.fingerprint,
        discount: payload.discount, shipping: payload.shipping,
        totalConfirmed: payload.total ?? ticket.totalConfirmed,
      } : ticket),
      // taxIncluded stays documental (parser data): it is already inside the
      // line amounts, so persisting it into Purchase.tax would double-count.
      ...(parsedDate && tickets.length === 1 ? { date: parsedDate.iso, dateInferred: parsedDate.inferredYear } : {}),
    }));
  }

  async function saveDraft(receive = false) {
    if (!cloud) {
      toast.error("Inicia sesión y conecta Firebase para guardar la compra de inventario.");
      return;
    }
    if (invalidInput) { toast.error("Revisa los importes y las cantidades que estás escribiendo."); return; }
    if (incompleteExpenseCount > 0) {
      toast.error("Completa el importe de cada gasto o quita los gastos vacíos.");
      return;
    }
    if (draft.lines.length === 0) {
      toast.error("Agrega al menos una pieza.");
      return;
    }
    if (receive && !canReceive) {
      toast.error(blockReason ? `No se puede recibir: ${blockReason}.` : "Resuelve la compra antes de recibir.");
      return;
    }
    // Saving persists ONLY the purchase — never products (lifecycle contract).
    const next: Purchase = {
      ...draft,
      subtotal: merchandise,
      totalConfirmed: purchaseConfirmedTotal(draft),
      status: receive ? "ready" : status,
      updatedAt: nowIso(),
    };
    try {
      await upsertPurchase(next);
    } catch {
      toast.error("No se pudo guardar la compra. Revisa tu conexión e intenta de nuevo.");
      return;
    }
    if (!receive) {
      setDraft(next);
      toast.success("Borrador guardado.");
      return;
    }
    setReceiving(true);
    try {
      const result = await receivePurchase(next);
      toast.success(
        result === "already"
          ? "Esta compra ya había sido recibida; el inventario no cambió."
          : "Compra recibida: el inventario se actualizó."
      );
      onDone();
    } catch (e) {
      toast.error(e instanceof Error && !("code" in e) && e.message ? e.message : "No se pudo recibir la mercancía. Intenta de nuevo.");
    } finally {
      setReceiving(false);
    }
  }

  // Bulk-create one private product per unlinked line (cloud-only; PDF import
  // requires cloud anyway). SKUs avoid collisions within the batch.
  async function bulkCreateProducts() {
    if (!activeStore || !cloud) return;
    const targets = draft.lines.filter((l) => !l.productId);
    if (!targets.length) return;
    if (hasUnknown) {
      toast.error("Primero interpreta los importes (unitario o total por línea).");
      return;
    }
    if (targets.length > 499) {
      toast.error(`Son ${targets.length} líneas; el máximo por lote es 499.`);
      return;
    }
    setBulkCreating(true);
    try {
      // `products` is the store-scoped selector (never raw state.products).
      // The SKU generator sees the accumulated batch so two lines with the
      // same name can never collide inside one lot.
      const batchProducts: Product[] = [];
      const newIds: (string | undefined)[] = []; // per-line new product id
      const lines = draft.lines.map((l, i) => {
        if (l.productId) {
          newIds[i] = undefined;
          return l;
        }
        const base = newProduct(activeStore.id);
        const fullName = l.variant ? `${l.name} ${l.variant}` : l.name;
        const sku = uniqueProductSku([...batchProducts, ...products], activeStore.id, base.id, suggestSkuBase(fullName, activeStore.skuPrefix ?? ""));
        batchProducts.push({ ...base, name: fullName, cost: l.unitCost, sku });
        newIds[i] = base.id;
        return { ...l, productId: base.id, matchStatus: "new_product" as const };
      });
      // The batch itself must carry the invalidation, not just local state.
      const next: Purchase = invalidateMismatch({ ...draft, lines, subtotal: merchandise, updatedAt: nowIso() });
      await createDraftProductsForPurchase(batchProducts, next);
      setDraft(next);
      toast.success(`${batchProducts.length} ${batchProducts.length === 1 ? "producto creado" : "productos creados"} y vinculados.`);
    } catch {
      toast.error("No se pudo crear el lote. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setBulkCreating(false);
    }
  }

  const supplierSuggestion =
    activeTicket.supplierName &&
    !suppliers.some((s) => s.name.toLowerCase() === activeTicket.supplierName!.toLowerCase())
      ? activeTicket.supplierName
      : undefined;
  // The detected-supplier hint shows whenever the PDF named one, even after
  // linking, so "Usar" stays reachable for an existing match (spec §2).
  const matchingSupplier = activeTicket.supplierName
    ? suppliers.find((s) => s.name.toLowerCase() === activeTicket.supplierName!.toLowerCase())
    : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-36">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label="Nombre de la compra" placeholder="Ej. Centro joyero — 30 de octubre" value={draft.name ?? ""} disabled={locked} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <Card className="!p-3 !bg-surface-muted text-sm">
          Una compra reúne los tickets del mismo viaje o surtido, aunque sean de distintos proveedores.
        </Card>
      </div>
      <div className="flex flex-wrap gap-3 items-end border-t border-edge pt-4">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <SelectField label={locked ? "Ticket que estás revisando" : "Ticket que estás capturando"} value={activeTicket.id} onChange={selectTicket} disabled={pdfBusy}
            options={tickets.map((ticket, index) => ({ value: ticket.id, label: ticketLabel(ticket, index) }))} />
        </div>
        {!locked && <Button variant="secondary" disabled={pdfBusy} onClick={addTicket}>+ Agregar ticket</Button>}
        {!locked && tickets.length > 1 && !draft.lines.some((line) => line.ticketId === activeTicket.id) && <Button variant="ghost" disabled={pdfBusy} onClick={removeTicket}>Quitar ticket vacío</Button>}
      </div>
      {/* ── Cabecera ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <SelectField
            label="Proveedor"
            value={activeTicket.supplierId ?? ""}
            onChange={(v) => updateTicket({ supplierId: v || undefined, supplierName: suppliers.find((supplier) => supplier.id === v)?.name ?? activeTicket.supplierName })}
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Elegir proveedor…"
            disabled={locked}
          />
          {!locked && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-1 -ml-2"
              onClick={() => {
                if (!activeStore) return;
                setSupplierDraft({ ...newSupplier(activeStore.id), name: activeTicket.supplierName ?? "" });
                setCreatingSupplier(true);
              }}
            >
              + Nuevo proveedor
            </Button>
          )}
          {!activeTicket.supplierId && <TextField label="Nombre del proveedor (si no está en la lista)" value={activeTicket.supplierName ?? ""} disabled={locked} onChange={(event) => updateTicket({ supplierName: event.target.value })} />}
          {(activeTicket.supplierId == null || supplierSuggestion) && activeTicket.supplierName && draft.origin === "pdf" && (
            <div className="mt-1 text-xs text-on-surface-soft">
              Proveedor detectado: {supplierSuggestion}{" "}
              {matchingSupplier ? (
                <Button size="sm" variant="ghost" className="!px-1" onClick={() => updateTicket({ supplierId: matchingSupplier.id })}>
                  Usar {matchingSupplier.name}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="!px-1"
                  onClick={() => {
                    if (!activeStore) return;
                    setSupplierDraft({ ...newSupplier(activeStore.id), name: supplierSuggestion ?? activeTicket.supplierName ?? "" });
                    setCreatingSupplier(true);
                  }}
                >
                  Crear {supplierSuggestion}
                </Button>
              )}
            </div>
          )}
        </div>
        <div>
          <TextField
            label="Fecha"
            type="date"
            value={draft.date || todayIso()}
            disabled={locked}
            onChange={(e) => setDraft({ ...draft, date: e.target.value, dateInferred: false })}
          />
          {draft.dateInferred && <p className="text-xs text-on-surface-soft mt-1">Año sugerido según el documento — edítalo si no es correcto.</p>}
        </div>
        <div className="space-y-1">
          <TextField
            label="Folio del ticket"
            placeholder="3023"
            value={activeTicket.folio ?? ""}
            disabled={locked}
            onChange={(e) => updateTicket({ folio: e.target.value || undefined })}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-soft">
            {draft.origin === "pdf" && <Badge tone="info">PDF importado</Badge>}
            {locked && <Badge tone="success">Recibida</Badge>}
            {!locked && status === "needs_review" && <Badge tone="warning">Revisar</Badge>}
            {activeTicket.documentPath && (
              <Button
                size="sm"
                variant="ghost"
                className="!px-1"
                onClick={async () => {
                  try {
                    const url = await openPurchasePdf(activeTicket.documentPath!);
                    window.open(url, "_blank");
                  } catch {
                    toast.error("No se pudo abrir el documento.");
                  }
                }}
              >
                Ver documento original
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Entrada PDF (solo hasta que ya hay líneas importadas) ── */}
      {!locked && !draft.lines.some((line) => line.ticketId === activeTicket.id) && (
        <div className="flex justify-end">
          <PurchasePdfImport key={activeTicket.id} onApply={applyPdf} existingFingerprints={tickets.map((ticket) => ticket.documentFingerprint).filter((value): value is string => !!value)} onBusyChange={setPdfBusy} />
        </div>
      )}

      {/* ── Resolución global de importes ── */}
      {hasUnknown && !locked && (
        <div className="rounded-lg bg-warning/10 p-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <p className="text-sm text-ink flex-1">
            Hay {counts.amount_review} {counts.amount_review === 1 ? "importe sin interpretar" : "importes sin interpretar"}. ¿Qué
            significan en el documento?
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => resolveAmountsGlobally("unit")}>
              Unitarios
            </Button>
            <Button size="sm" variant="secondary" onClick={() => resolveAmountsGlobally("line")}>
              Total por línea
            </Button>
          </div>
        </div>
      )}

      {/* ── Mercancía: filtros + tabla densa / filas móviles ── */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs font-semibold text-on-surface-soft uppercase tracking-wide">Productos de la compra</span>
          <div className="flex flex-wrap gap-1">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`Todas (${draft.lines.length})`} />
            {counts.amount_review > 0 && <FilterChip active={filter === "amount_review"} onClick={() => setFilter("amount_review")} label={`Importes (${counts.amount_review})`} />}
            {counts.unlinked > 0 && <FilterChip active={filter === "unlinked"} onClick={() => setFilter("unlinked")} label={`Sin vincular (${counts.unlinked})`} />}
            {counts.new_product > 0 && <FilterChip active={filter === "new_product"} onClick={() => setFilter("new_product")} label={`Nuevos (${counts.new_product})`} />}
            {counts.linked > 0 && <FilterChip active={filter === "linked"} onClick={() => setFilter("linked")} label={`Vinculadas (${counts.linked})`} />}
          </div>
        </div>

        {/* Header row (desktop only), outside the rows' scroll flow */}
        <div className="hidden xl:grid xl:grid-cols-[auto_1fr_4rem_5rem_6rem_6rem_auto_1fr] gap-2 px-3 py-3 text-xs font-semibold text-ink-soft uppercase tracking-wide sticky top-0 z-10 rounded-lg border-b border-edge bg-paper">
          <span>Estado</span>
          <span>Producto</span>
          <span>Cant.</span>
          <span>Importe</span>
          <span>Costo unit.</span>
          <span>Total</span>
          <span />{/* quitar */}
          <span>Vincular producto</span>
        </div>
        <div className="space-y-1.5">
          {visible.map(({ line, status: st, idx }) => (
            <Card
              key={line.lineId}
              className="!p-3 xl:min-h-14 !bg-surface-muted grid grid-cols-2 xl:grid-cols-[auto_1fr_4rem_5rem_6rem_6rem_auto_1fr] xl:items-center gap-3"
            >
              {/* Mobile tier 1: status + name + printed amount. Desktop: flat grid cells. */}
              <div className="col-span-2 flex items-start gap-2 xl:contents">
                <div className="flex items-center pt-2.5">
                  <Badge tone={LINE_STATUS_TONE[st]}>{LINE_STATUS_LABEL[st]}</Badge>
                </div>
                <div className="min-w-0 flex-1 xl:col-span-1">
                  <TextField
                    aria-label="Producto"
                    label="Producto del ticket"
                    labelClassName="xl:sr-only"
                    value={line.name}
                    disabled={locked}
                    onChange={(e) => updateLine(idx, { name: e.target.value, matchStatus: e.target.value ? line.matchStatus : "unmatched" })}
                  />
                  {tickets.length > 1 && (
                    <SelectField label="Ticket de esta línea" value={line.ticketId ?? tickets[0].id} disabled={locked}
                      onChange={(ticketId) => updateLine(idx, { ticketId })}
                      options={tickets.map((ticket, index) => ({ value: ticket.id, label: ticketLabel(ticket, index) }))} />
                  )}
                  <div className="xl:hidden mt-1 flex items-center justify-between gap-2 text-xs text-on-surface-soft">
                    <span className="font-mono">{line.sourceAmount != null ? formatMoneyExact(line.sourceAmount) : "—"}</span>
                    <span className="font-semibold text-ink">{formatMoneyExact(line.quantity * (line.unitCost ?? 0))}</span>
                  </div>
                  {st === "amount_review" && !locked && line.sourceAmount != null && (
                    <div className="xl:hidden mt-1 flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => resolveAmount(idx, "unit")}>
                        Unitario
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => resolveAmount(idx, "line")}>
                        Total línea
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Mobile tier 2: qty/cost/delete on one line, linking below. */}
              <div className="col-span-2 xl:contents">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center xl:contents">
                  <TextField
                    aria-label="Cantidad"
                    label="Cantidad"
                    labelClassName="xl:sr-only"
                    inputMode="numeric"
                    value={amountDrafts[`quantity:${line.lineId}`] ?? line.quantity.toString()}
                    disabled={locked}
                    onChange={(e) => setQuantity(idx, e.target.value)}
                  />
                  <div className="hidden xl:block">
                    <p className={`text-sm font-mono ${line.sourceAmount != null ? "text-ink-soft" : "text-ink-soft/40"}`}>
                      {line.sourceAmount != null ? formatMoneyExact(line.sourceAmount) : "—"}
                    </p>
                    {st === "amount_review" && !locked && line.sourceAmount != null && (
                      <div className="flex gap-0.5">
                        <Button size="sm" variant="ghost" onClick={() => resolveAmount(idx, "unit")}>
                          Unitario
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => resolveAmount(idx, "line")}>
                          Total
                        </Button>
                      </div>
                    )}
                  </div>
                  <TextField
                    aria-label="Costo unitario"
                    label="Costo por pieza"
                    labelClassName="xl:sr-only"
                    inputMode="decimal"
                    value={amountDrafts[`line:${line.lineId}`] ?? (line.unitCost ?? 0).toString()}
                    disabled={locked}
                    onChange={(e) => setUnitCost(idx, e.target.value)}
                  />
                  <div className="hidden xl:flex items-center">
                    <span className="text-sm font-semibold text-ink">{formatMoneyExact(line.quantity * (line.unitCost ?? 0))}</span>
                  </div>
                {!locked ? (
                  <IconButton variant="ghost" aria-label="Quitar línea" className="!min-h-10 !min-w-10 xl:justify-self-center" onClick={() => removeLine(idx)}>
                    ✕
                  </IconButton>
                ) : (
                  <span className="hidden xl:block" />
                )}
                </div>
                <div className="col-span-3 xl:col-span-1 min-w-0 mt-3 xl:mt-0">
                  <SearchSelect
                    label="Producto en Store OS"
                    labelClassName="xl:sr-only"
                    value={productQueries[line.lineId!] ?? products.find((product) => product.id === line.productId)?.name ?? ""}
                    disabled={locked}
                    onChange={(value) => {
                      setProductQueries((previous) => ({ ...previous, [line.lineId!]: value }));
                      if (line.productId) updateLine(idx, { productId: "", matchStatus: "unmatched" });
                    }}
                    onSelect={(option) => pickProduct(idx, option.value)}
                    options={products.map((product) => ({
                      value: product.id,
                      label: product.name,
                      detail: `Existencia: ${product.quantityOnHand ?? 0}`,
                      keywords: product.sku,
                    }))}
                    placeholder="Buscar por nombre o clave…"
                    action={{ label: "+ Crear nuevo producto", onClick: () => openMiniForm(idx) }}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
        {!locked && (
          <div className="flex flex-wrap gap-2 mt-2">
            <Button size="sm" variant="secondary" disabled={pdfBusy} onClick={addLine}>
              + Agregar línea
            </Button>
            {tickets.length > 1 && <span className="self-center text-xs text-ink-soft">Se agregará al ticket {activeTicket.folio ? `#${activeTicket.folio}` : tickets.indexOf(activeTicket) + 1}.</span>}
            {cloud && counts.unlinked > 1 && !hasUnknown && (
              <Button size="sm" variant="secondary" disabled={bulkCreating} onClick={() => void bulkCreateProducts()}>
                {bulkCreating ? "Creando…" : `Crear ${counts.unlinked} ${counts.unlinked === 1 ? "producto" : "productos"}`}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Totales y reconciliación (contenido, no footer) ── */}
      <div className="border-t border-edge pt-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-ink-soft">Subtotal de productos de este ticket</span>
          <span className="font-semibold text-ink">{formatMoneyExact(activeTotals.merchandise)}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextField
            label="Descuento"
            aria-label="Descuento"
            hint="Pesos descontados por el proveedor."
            inputMode="decimal"
            disabled={locked}
            value={amountDrafts.discount ?? (activeTicket.discount ?? 0).toString()}
            onChange={(e) => setAdjustment("discount", e.target.value)}
          />
          <TextField
            label="Envío"
            aria-label="Envío"
            hint="Cargo del proveedor; no el traslado para surtir."
            inputMode="decimal"
            disabled={locked}
            value={amountDrafts.shipping ?? (activeTicket.shipping ?? 0).toString()}
            onChange={(e) => setAdjustment("shipping", e.target.value)}
          />
          <TextField
            label="Impuestos"
            aria-label="Impuestos"
            hint="Solo el importe adicional que no esté incluido en los productos."
            inputMode="decimal"
            disabled={locked}
            value={amountDrafts.tax ?? (activeTicket.tax ?? 0).toString()}
            onChange={(e) => setAdjustment("tax", e.target.value)}
          />
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-ink-soft">Total calculado de este ticket</span>
          <span>{formatMoneyExact(activeTotals.calculated)}</span>
        </div>
        <TextField
          label="Total pagado"
          aria-label="Total pagado"
          hint="Lo que pagaste por este ticket, incluidos sus ajustes y su envío."
          inputMode="decimal"
          disabled={locked}
          value={amountDrafts.totalConfirmed ?? activeTicket.totalConfirmed.toString()}
          onChange={(e) => setTotalPaid(e.target.value)}
        />
        {mismatch > (draft.tickets ? 0.005 : 0.5) && !locked && (
          <div className="rounded-lg bg-warning/10 p-3 space-y-2">
            <p className="text-sm text-ink">
              Hay una diferencia de {formatMoneyExact(mismatch)} entre la mercancía registrada y el total pagado.
            </p>
            {hasUnknown && (
              <p className="text-xs text-on-surface-soft">
                Además, hay importes del PDF que no pudimos interpretar (unitario vs total de línea): revisa el costo
                unitario de cada línea marcada.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!draft.tickets && !mismatchConfirmed && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDraft({ ...draft, confirmedMismatchAmount: mismatch })}
                >
                  Recibir así, con diferencia de {formatMoney(mismatch)}
                </Button>
              )}
              {mismatchConfirmed && <Badge tone="info">Diferencia confirmada ({formatMoneyExact(mismatch)})</Badge>}
            </div>
          </div>
        )}
      </div>

      {/* ── Gastos separados del documento del proveedor ── */}
      <div className="border-t border-edge pt-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-ink">Gastos de surtido</h3>
            <p className="text-xs text-ink-soft mt-1">
              {draft.costingMethod === "latest_purchase" ? "Marca los gastos que se repartirán entre todas las piezas del viaje. El envío del proveedor se captura en su ticket." : "Se registran aparte del total del proveedor y no cambian el costo por pieza."}
            </p>
          </div>
          {!locked && (
            <Button size="sm" variant="secondary" onClick={addExpense}>
              + Agregar gasto
            </Button>
          )}
        </div>

        {sourcingExpenses.length === 0 ? (
          <p className="text-sm text-on-surface-soft">No hay gastos adicionales registrados.</p>
        ) : (
          <div className="space-y-3">
            {sourcingExpenses.map((expense) => (
              <Card
                key={expense.id}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.2fr_0.7fr_1.2fr_auto] gap-3 items-end !p-3"
              >
                <SelectField
                  label="Tipo de gasto"
                  value={expense.category}
                  disabled={locked}
                  onChange={(category) => updateExpense(expense.id, { category })}
                  options={EXPENSE_CATEGORY_OPTIONS}
                />
                <TextField
                  label="Importe"
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                  disabled={locked}
                  value={expenseAmountDrafts[expense.id] ?? (expense.amount > 0 ? expense.amount.toFixed(2) : "")}
                  onChange={(e) => setExpenseAmount(expense.id, e.target.value)}
                />
                <TextField
                  label="Descripción (opcional)"
                  placeholder="4 camiones"
                  disabled={locked}
                  value={expense.description ?? ""}
                  onChange={(e) => updateExpense(expense.id, { description: e.target.value })}
                />
                {!locked && (
                  <Button size="sm" variant="ghost" onClick={() => removeExpense(expense.id)}>
                    Quitar
                  </Button>
                )}
                {draft.costingMethod === "latest_purchase" && <div className="sm:col-span-2 lg:col-span-4"><CheckboxField label="Costo del inventario" caption="Repartir este gasto entre las piezas del viaje"
                  disabled={locked}
                  checked={expense.includeInInventoryCost ?? expense.category === "sourcing_transport"}
                  onChange={(includeInInventoryCost) => { if (!locked) updateExpense(expense.id, { includeInInventoryCost }); }} /></div>}
              </Card>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-edge p-3 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-ink-soft">Gastos adicionales</span>
            <span>{formatMoneyExact(sourcingExpenseTotal)}</span>
          </div>
          <div className="flex justify-between gap-3 font-semibold">
            <span>Total de tickets + gastos</span>
            <span>{formatMoneyExact(recordedTotal)}</span>
          </div>
        </div>
      </div>

      {draft.costingMethod === "latest_purchase" && (
        <Card className="!bg-surface-muted space-y-3">
          <h3 className="font-semibold text-ink">Costo del inventario de esta compra</h3>
          <p className="text-sm text-ink-soft">Al recibir, se usará el costo completo de la última compra, sin promediar con las piezas que ya tenías. Los centavos del reparto se conservan en el total.</p>
          {hasUnknown ? <p className="text-sm text-ink-soft">Interpreta los importes del PDF para revisar el costo completo.</p> : allocationError ? <p role="alert" className="text-danger">{allocationError}</p> : <>
            <div className="flex justify-between gap-3 text-sm"><span>Productos de todos los tickets</span><span>{formatMoneyExact(merchandise)}</span></div>
            <div className="flex justify-between gap-3 text-sm"><span>Envío y ajustes de los tickets</span><span>{formatMoneyExact(allocations.reduce((sum, allocation) => sum + allocation.supplierAdjustmentCents, 0) / 100)}</span></div>
            <div className="flex justify-between gap-3 text-sm"><span>Gastos del viaje repartidos</span><span>{formatMoneyExact(allocations.reduce((sum, allocation) => sum + allocation.sourcingExpenseCents, 0) / 100)}</span></div>
            <div className="flex justify-between gap-3 font-semibold"><span>Costo completo de las piezas</span><span>{formatMoneyExact(allocations.reduce((sum, allocation) => sum + allocation.totalCents, 0) / 100)}</span></div>
            {[...productCosts].map(([id, cost]) => <div key={id} className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate">{products.find((product) => product.id === id)?.name ?? draft.lines.find((line) => line.productId === id)?.name} · {cost.quantity} piezas</span><span className="shrink-0">{formatMoneyExact(cost.cents / 100 / cost.quantity)} por pieza</span></div>)}
          </>}
        </Card>
      )}

      <TextArea
        label="Notas"
        value={draft.notes ?? ""}
        disabled={locked}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })}
      />

      {locked ? (
        <p className="text-sm text-on-surface-soft">
          Compra recibida: el inventario ya se actualizó y esta compra ya no se puede editar ni borrar.
        </p>
      ) : (
        /* Sticky footer: total, diferencia y acciones — nothing else. */
        <div className="fixed inset-x-0 z-40 border-t border-edge bg-surface px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-sm bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-0">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-ink-soft">
                Compra {formatMoneyExact(calculated + sourcingExpenseTotal)}
                {mismatch > 0.5 && <span className="text-warning"> · difiere {formatMoneyExact(mismatch)}</span>}
              </span>
              {blockReason && <span className="text-xs text-warning">{blockReason}</span>}
            </div>
            <div className="flex gap-2 mt-1.5">
              <Button variant="secondary" className="flex-1" disabled={receiving || pdfBusy || incompleteExpenseCount > 0} onClick={() => void saveDraft(false)}>
                Guardar borrador
              </Button>
              <Button className="flex-1" disabled={pdfBusy || !canReceive || incompleteExpenseCount > 0 || receiving} onClick={() => void saveDraft(true)}>
                {receiving ? "Recibiendo…" : "Recibir mercancía"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {creatingSupplier && supplierDraft && (
        <Sheet open onClose={() => setCreatingSupplier(false)} title="Nuevo proveedor">
          <SupplierForm
            supplier={supplierDraft}
            onDone={(saved) => {
                updateTicket({ supplierId: saved.id, supplierName: saved.name });
              setCreatingSupplier(false);
              setSupplierDraft(null);
            }}
          />
        </Sheet>
      )}

      {productLineIdx !== null && productDraft && activeStore && (
        <Sheet
          open
          onClose={() => {
            setProductLineIdx(null);
            setProductDraft(null);
          }}
          title="Nuevo producto"
        >
          <ProductMiniForm
            draft={productDraft}
            isTiered={isTiered}
            tiers={tiersForStore(activeStore)}
            onDone={async (saved) => {
              await upsertProduct(saved);
              setProductQueries((previous) => ({ ...previous, [draft.lines[productLineIdx].lineId!]: saved.name }));
              updateLine(productLineIdx, {
                productId: saved.id,
                name: saved.name,
                unitCost: saved.cost ?? 0,
                matchStatus: "new_product",
              });
              setProductLineIdx(null);
              setProductDraft(null);
            }}
            onDraftChange={setProductDraft}
          />
        </Sheet>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <Button
      size="sm"
      variant={active ? "primary" : "ghost"}
      className="!rounded-full !px-3 !py-1.5 !text-xs"
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

// Minimal product creator for the purchase flow (F2). Creates a product with
// name + cost + sale price (private by default; toggle to publish). The full
// ProductForm (photo, categories, SEO) is filled later from the catalog. Caller
// owns the draft via onDraftChange so it can upsert+pick on save.
function ProductMiniForm({
  draft,
  isTiered,
  tiers,
  onDone,
  onDraftChange,
}: {
  draft: Product;
  isTiered: boolean;
  tiers: PriceTierDef[];
  onDone: (saved: Product) => Promise<void>;
  onDraftChange: (p: Product) => void;
}) {
  const [publish, setPublish] = useState(false);
  const [tierPrices, setTierPrices] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(draft.prices ?? {}).map(([k, v]) => [k, v?.toString() ?? "0"]))
  );
  const [price, setPrice] = useState(draft.price?.toString() ?? "0");
  const [cost, setCost] = useState(draft.cost?.toString() ?? "0");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save() {
    if (saving) return;
    if (!draft.name.trim()) {
      toast.error("Pon un nombre al producto.");
      return;
    }
    const saved: Product = {
      ...draft,
      name: draft.name.trim(),
      cost: parseAmount(cost),
      prices: isTiered
        ? Object.fromEntries(tiers.map((t) => [t.id, parseAmount(tierPrices[t.id]) ?? 0]))
        : draft.prices,
      price: isTiered ? draft.price : parseAmount(price),
      // Purchasing a product never publishes it by itself (invariant 5).
      status: publish ? "published" : "draft",
      isPublic: publish,
      updatedAt: nowIso(),
    };
    setSaving(true);
    try {
      await onDone(saved);
    } catch {
      toast.error("No se pudo crear el producto. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <TextField
        label="Nombre"
        placeholder="Ej. Anillo de plata 925"
        value={draft.name}
        onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
        autoFocus
      />
      <TextField label="Costo" inputMode="decimal" placeholder="0" value={cost} onChange={(e) => setCost(e.target.value)} />
      {isTiered ? (
        <div className={tiers.length > 2 ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
          {tiers.map((t) => (
            <TextField
              key={t.id}
              label={t.label}
              inputMode="decimal"
              placeholder="0"
              value={tierPrices[t.id] ?? ""}
              onChange={(e) => setTierPrices((m) => ({ ...m, [t.id]: e.target.value }))}
            />
          ))}
        </div>
      ) : (
        <TextField label="Precio de venta" inputMode="decimal" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} />
      )}
      <CheckboxField
        label="Publicar en el catálogo"
        checked={publish}
        onChange={setPublish}
        hint="Si no, queda como borrador privado. Completa la ficha después."
      />
      <Button full size="lg" onClick={() => void save()} disabled={saving || !draft.name.trim()}>
        {saving ? "Creando…" : "Crear producto"}
      </Button>
    </div>
  );
}
