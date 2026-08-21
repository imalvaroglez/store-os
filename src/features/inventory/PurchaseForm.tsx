import { useState } from "react";
import { useStore, newSupplier, newProduct } from "../../app/StoreProvider";
import {
  Button,
  CheckboxField,
  SelectField,
  TextField,
  TextArea,
  IconButton,
  Sheet,
  Badge,
  useToast,
} from "../../design-system";
import { suppliersForStore, productsForStore } from "../../lib/selectors";
import { todayIso, nowIso } from "../../lib/dates";
import { formatMoney, parseAmount } from "../../lib/money";
import { tiersForStore } from "../../lib/pricing";
import { suggestSkuBase, uniqueProductSku } from "../../lib/catalog";
import { openPurchasePdf } from "../../app/firebase/pdfImport";
import {
  effectivePurchaseStatus,
  recalcPurchaseStatus,
  type PriceTierDef,
  type Purchase,
  type PurchaseLine,
  type Supplier,
  type Product,
} from "../../types";
import { SupplierForm } from "./SupplierForm";
import { PurchasePdfImport, type PdfApplyPayload } from "./PurchasePdfImport";

// Shared purchase editor — the single destination for BOTH entries (manual
// capture and PDF import). Saving only persists the Purchase (a draft);
// "Recibir mercancía" is the only operation that moves inventory.
// Row-grid layout: reads as a table on desktop, reflows on mobile.
export function PurchaseForm({ purchase, onDone }: { purchase: Purchase; onDone: () => void }) {
  const { state, activeStore, upsertPurchase, upsertProduct, receivePurchase } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Purchase>(purchase);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState<Supplier | null>(null);
  const [productLineIdx, setProductLineIdx] = useState<number | null>(null);
  const [productDraft, setProductDraft] = useState<Product | null>(null);
  const [receiving, setReceiving] = useState(false);

  if (!activeStore) return null;
  const isTiered = activeStore.type === "inventory_tiered";
  const suppliers = suppliersForStore(state.suppliers, activeStore.id);
  const products = productsForStore(state.products, activeStore.id);
  const locked = effectivePurchaseStatus(draft) === "received";

  const merchandise = draft.lines.reduce((s, l) => s + l.quantity * (l.unitCost ?? 0), 0);
  const adjustments = (draft.discount ?? 0) + (draft.shipping ?? 0) + (draft.tax ?? 0);
  const calculated = merchandise + adjustments;
  const totalPaid = draft.totalConfirmed || merchandise + adjustments;
  const mismatch = Math.abs(calculated - totalPaid);
  const hasUnknownAmounts = draft.lines.some((l) => l.sourceAmountType === "unknown");
  const mismatchConfirmed =
    draft.confirmedMismatchAmount != null && Math.abs(mismatch - draft.confirmedMismatchAmount) < 0.005;
  const canReceive =
    !locked &&
    draft.lines.length > 0 &&
    draft.lines.every((l) => l.productId && l.quantity >= 1) &&
    !hasUnknownAmounts &&
    (mismatch <= 0.5 || mismatchConfirmed);
  const status = recalcPurchaseStatus(draft, { totalPaid });

  function addLine() {
    setDraft({ ...draft, lines: [...draft.lines, { productId: "", name: "", quantity: 1, unitCost: 0 }] });
  }
  function updateLine(idx: number, patch: Partial<PurchaseLine>) {
    // Any edit invalidates a prior explicit mismatch confirmation.
    const base = draft.confirmedMismatchAmount != null ? { ...draft, confirmedMismatchAmount: undefined } : draft;
    setDraft({ ...base, lines: base.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });
  }
  function removeLine(idx: number) {
    setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== idx) });
  }
  function pickProduct(idx: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (product) {
      updateLine(idx, {
        productId,
        name: product.name,
        unitCost: product.cost ?? 0,
        matchStatus: "matched",
        // Choosing semantics resolves "unknown" for this line.
        sourceAmountType: draft.lines[idx].sourceAmountType === "unknown" ? "line" : draft.lines[idx].sourceAmountType,
      });
    } else {
      updateLine(idx, { productId: "", name: "", matchStatus: "unmatched" });
    }
  }

  function applyPdf(payload: PdfApplyPayload) {
    setDraft((d) => ({
      ...d,
      origin: "pdf",
      lines: payload.lines,
      supplierOrder: payload.supplierOrder ?? d.supplierOrder,
      supplierName: payload.supplierCandidate ?? d.supplierName,
      documentPath: payload.documentPath ?? d.documentPath,
      documentFingerprint: payload.fingerprint ?? d.documentFingerprint,
      discount: payload.discount,
      shipping: payload.shipping,
      tax: payload.tax,
      totalConfirmed: payload.total ?? d.totalConfirmed,
    }));
  }

  async function saveDraft(receive = false) {
    if (draft.lines.length === 0) {
      toast.error("Agrega al menos una pieza.");
      return;
    }
    if (receive && !canReceive) {
      toast.error("Resuelve las líneas marcadas como Revisar antes de recibir.");
      return;
    }
    // Saving persists ONLY the purchase — never products (lifecycle contract).
    const next: Purchase = {
      ...draft,
      subtotal: merchandise,
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
      const result = await receivePurchase(next.id);
      toast.success(
        result === "already"
          ? "Esta compra ya había sido recibida; el inventario no cambió."
          : "Compra recibida: el inventario se actualizó."
      );
      onDone();
    } catch {
      toast.error("No se pudo recibir la mercancía. Intenta de nuevo.");
    } finally {
      setReceiving(false);
    }
  }

  function lineBadge(l: PurchaseLine) {
    if (l.matchStatus === "new_product") return <Badge tone="info">Nuevo</Badge>;
    if (l.productId) return <Badge tone="success">Vinculado</Badge>;
    return <Badge tone="warning">Revisar</Badge>;
  }

  const supplierSuggestion =
    draft.supplierName &&
    !suppliers.some((s) => s.name.toLowerCase() === draft.supplierName!.toLowerCase())
      ? draft.supplierName
      : undefined;
  const matchingSupplier = draft.supplierName
    ? suppliers.find((s) => s.name.toLowerCase() === draft.supplierName!.toLowerCase())
    : undefined;

  return (
    <div className="space-y-4">
      {/* ── Cabecera ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <SelectField
            label="Proveedor"
            value={draft.supplierId ?? ""}
            onChange={(v) => setDraft({ ...draft, supplierId: v || undefined })}
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Elegir proveedor…"
          />
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 -ml-2"
            onClick={() => {
              if (!activeStore) return;
              setSupplierDraft({ ...newSupplier(activeStore.id), name: draft.supplierName ?? "" });
              setCreatingSupplier(true);
            }}
          >
            + Nuevo proveedor
          </Button>
          {supplierSuggestion && (
            <div className="mt-1 text-xs text-on-surface-soft">
              Proveedor detectado: {supplierSuggestion}{" "}
              {matchingSupplier ? (
                <Button size="sm" variant="ghost" className="!px-1" onClick={() => setDraft({ ...draft, supplierId: matchingSupplier.id })}>
                  Usar {matchingSupplier.name}
                </Button>
              ) : (
                <span>(crea “{supplierSuggestion}” abajo si es nuevo)</span>
              )}
            </div>
          )}
        </div>
        <TextField
          label="Fecha"
          type="date"
          value={draft.date || todayIso()}
          onChange={(e) => setDraft({ ...draft, date: e.target.value })}
        />
        <div className="space-y-1">
          <TextField
            label="Pedido / documento"
            placeholder="3023"
            value={draft.supplierOrder ?? ""}
            onChange={(e) => setDraft({ ...draft, supplierOrder: e.target.value || undefined })}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-soft">
            {draft.origin === "pdf" && <Badge tone="info">PDF importado</Badge>}
            {locked && <Badge tone="success">Recibida</Badge>}
            {!locked && status === "needs_review" && <Badge tone="warning">Revisar</Badge>}
            {draft.documentPath && (
              <Button
                size="sm"
                variant="ghost"
                className="!px-1"
                onClick={async () => {
                  try {
                    const url = await openPurchasePdf(draft.documentPath!);
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
      {!locked && draft.lines.length === 0 && (
        <div className="flex justify-end">
          <PurchasePdfImport onApply={applyPdf} />
        </div>
      )}

      {/* ── Mercancía ── */}
      <div>
        <span className="block text-xs font-semibold text-on-surface-soft uppercase tracking-wide mb-1.5">
          Mercancía ({draft.lines.length} líneas)
        </span>
        <div className="space-y-2">
          {draft.lines.map((line, idx) => {
            const detected = line.sourceAmount != null;
            return (
              <div
                key={idx}
                className="p-3 rounded-lg bg-surface-soft grid grid-cols-2 md:grid-cols-[auto_1fr_5rem_4rem_6rem_6rem_6rem_1fr_auto] md:items-end gap-2"
              >
                <div className="col-span-2 md:col-span-1">{lineBadge(line)}</div>
                <div className="col-span-2 md:col-span-1">
                  <TextField
                    label={idx === 0 ? "Producto detectado" : ""}
                    value={line.name}
                    onChange={(e) => updateLine(idx, { name: e.target.value, matchStatus: e.target.value ? line.matchStatus : "unmatched" })}
                  />
                </div>
                <TextField
                  label={idx === 0 ? "Variante" : ""}
                  value={line.variant ?? ""}
                  onChange={(e) => updateLine(idx, { variant: e.target.value || undefined })}
                />
                <TextField
                  label={idx === 0 ? "Cant." : ""}
                  inputMode="numeric"
                  value={line.quantity.toString()}
                  onChange={(e) => updateLine(idx, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                />
                <div>
                  {idx === 0 && <span className="block text-xs font-semibold text-on-surface-soft mb-1.5">Importe detectado</span>}
                  <p className={`text-sm ${detected ? "font-mono text-ink-soft" : "text-ink-soft/40"}`}>
                    {detected ? formatMoney(line.sourceAmount!) : "—"}
                  </p>
                </div>
                <TextField
                  label={idx === 0 ? "Costo unitario" : ""}
                  inputMode="decimal"
                  value={(line.unitCost ?? 0).toString()}
                  onChange={(e) => updateLine(idx, { unitCost: parseAmount(e.target.value) ?? 0 })}
                />
                <div>
                  {idx === 0 && <span className="block text-xs font-semibold text-on-surface-soft mb-1.5">Total línea</span>}
                  <p className="text-sm font-semibold text-ink">{formatMoney(line.quantity * (line.unitCost ?? 0))}</p>
                </div>
                <div>
                  <SelectField
                    label={idx === 0 ? "En Store OS" : ""}
                    value={line.productId}
                    onChange={(v) => pickProduct(idx, v)}
                    options={products.map((p) => ({
                      value: p.id,
                      label: `${p.name} (existencia: ${p.quantityOnHand ?? 0})`,
                    }))}
                    placeholder="Vincular…"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 -ml-2"
                    onClick={() => {
                      if (!activeStore) return;
                      const base = newProduct(activeStore.id);
                      const skuBase = suggestSkuBase(line.name, activeStore.skuPrefix ?? "");
                      setProductDraft({
                        ...base,
                        name: line.variant ? `${line.name} ${line.variant}` : line.name,
                        cost: line.unitCost,
                        sku: uniqueProductSku(state.products, activeStore.id, base.id, skuBase),
                      });
                      setProductLineIdx(idx);
                    }}
                  >
                    + Crear producto
                  </Button>
                </div>
                <IconButton variant="ghost" aria-label="Quitar línea" onClick={() => removeLine(idx)}>
                  ✕
                </IconButton>
              </div>
            );
          })}
        </div>
        {!locked && (
          <Button size="sm" variant="secondary" className="mt-2" onClick={addLine}>
            + Agregar línea
          </Button>
        )}
      </div>

      {/* ── Totales y reconciliación ── */}
      <div className="border-t border-edge pt-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-ink-soft">Mercancía (Σ líneas)</span>
          <span className="font-semibold text-ink">{formatMoney(merchandise)}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <TextField
            label="Descuento"
            inputMode="decimal"
            value={(draft.discount ?? 0).toString()}
            onChange={(e) => setDraft({ ...draft, discount: parseAmount(e.target.value) ?? 0 })}
          />
          <TextField
            label="Envío"
            inputMode="decimal"
            value={(draft.shipping ?? 0).toString()}
            onChange={(e) => setDraft({ ...draft, shipping: parseAmount(e.target.value) ?? 0 })}
          />
          <TextField
            label="Impuestos"
            inputMode="decimal"
            value={(draft.tax ?? 0).toString()}
            onChange={(e) => setDraft({ ...draft, tax: parseAmount(e.target.value) ?? 0 })}
          />
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-ink-soft">Total calculado</span>
          <span>{formatMoney(calculated)}</span>
        </div>
        <TextField
          label="Total pagado"
          hint="Lo que realmente pagaste según el documento."
          inputMode="decimal"
          value={draft.totalConfirmed.toString()}
          onChange={(e) => setDraft({ ...draft, totalConfirmed: parseAmount(e.target.value) ?? 0 })}
        />
        {mismatch > 0.5 && !locked && (
          <div className="rounded-lg bg-warning/10 p-3 space-y-2">
            <p className="text-sm text-ink">
              Hay una diferencia de {formatMoney(mismatch)} entre la mercancía registrada y el total pagado.
            </p>
            {hasUnknownAmounts && (
              <p className="text-xs text-on-surface-soft">
                Además, hay importes del PDF que no pudimos interpretar (unitario vs total de línea): revisa el costo
                unitario de cada línea marcada.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!mismatchConfirmed && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDraft({ ...draft, confirmedMismatchAmount: mismatch })}
                >
                  Recibir así, con diferencia de {formatMoney(mismatch)}
                </Button>
              )}
              {mismatchConfirmed && <Badge tone="info">Diferencia confirmada ({formatMoney(mismatch)})</Badge>}
            </div>
          </div>
        )}
      </div>

      <TextArea
        label="Notas"
        value={draft.notes ?? ""}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })}
      />

      {locked ? (
        <p className="text-sm text-on-surface-soft">
          Compra recibida: el inventario ya se actualizó y esta compra ya no se puede editar ni borrar.
        </p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => void saveDraft(false)}>
            Guardar borrador
          </Button>
          <Button
            className="flex-1"
            disabled={!canReceive || receiving}
            onClick={() => void saveDraft(true)}
          >
            {receiving ? "Recibiendo…" : "Recibir mercancía"}
          </Button>
        </div>
      )}

      {creatingSupplier && supplierDraft && (
        <Sheet open onClose={() => setCreatingSupplier(false)} title="Nuevo proveedor">
          <SupplierForm
            supplier={supplierDraft}
            onDone={() => {
              setDraft({ ...draft, supplierId: supplierDraft.id });
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
  onDone: (saved: Product) => void;
  onDraftChange: (p: Product) => void;
}) {
  const [publish, setPublish] = useState(false);
  const [tierPrices, setTierPrices] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(draft.prices ?? {}).map(([k, v]) => [k, v?.toString() ?? "0"]))
  );
  const [price, setPrice] = useState(draft.price?.toString() ?? "0");
  const [cost, setCost] = useState(draft.cost?.toString() ?? "0");
  const toast = useToast();

  function save() {
    if (!draft.name.trim()) {
      toast.error("Pon un nombre al producto.");
      return;
    }
    const saved: Product = {
      ...draft,
      name: draft.name.trim(),
      cost: parseAmount(cost) || undefined,
      prices: isTiered
        ? Object.fromEntries(tiers.map((t) => [t.id, parseAmount(tierPrices[t.id]) ?? 0]))
        : draft.prices,
      price: isTiered ? draft.price : parseAmount(price),
      // Purchasing a product never publishes it by itself (invariant 5).
      status: publish ? "published" : "draft",
      isPublic: publish,
      updatedAt: nowIso(),
    };
    onDone(saved);
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
      <Button full size="lg" onClick={save} disabled={!draft.name.trim()}>
        Crear producto
      </Button>
    </div>
  );
}
