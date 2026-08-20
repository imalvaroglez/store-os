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
  useToast,
} from "../../design-system";
import { suppliersForStore, productsForStore } from "../../lib/selectors";
import { applyPurchaseLines } from "../../lib/inventory";
import { todayIso, nowIso } from "../../lib/dates";
import { formatMoney, parseAmount } from "../../lib/money";
import { tiersForStore } from "../../lib/pricing";
import type { PriceTierDef, Purchase, PurchaseLine, Supplier, Product } from "../../types";
import { SupplierForm } from "./SupplierForm";
import { PurchasePdfImport } from "./PurchasePdfImport";

// Multi-line supplier purchase ticket. Each line replenishes a product's stock
// and recomputes its weighted-average cost. The first repeating line-item form
// in the app.
export function PurchaseForm({ purchase, onDone }: { purchase: Purchase; onDone: () => void }) {
  const { state, activeStore, upsertPurchase, upsertProduct } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Purchase>(purchase);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  // Draft supplier for the inline-create Sheet. Its id is known up-front so we
  // can auto-select it on the purchase once saved.
  const [supplierDraft, setSupplierDraft] = useState<Supplier | null>(null);
  // Inline product create (F2): the index of the line that triggered it, and a
  // draft product. Mini-form fields tracked alongside.
  const [productLineIdx, setProductLineIdx] = useState<number | null>(null);
  const [productDraft, setProductDraft] = useState<Product | null>(null);

  if (!activeStore) return null;
  const isTiered = activeStore.type === "inventory_tiered";
  const suppliers = suppliersForStore(state.suppliers, activeStore.id);
  const products = productsForStore(state.products, activeStore.id);

  const subtotal = draft.lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const delta = draft.totalConfirmed - subtotal;

  function addLine() {
    setDraft({
      ...draft,
      lines: [...draft.lines, { productId: "", name: "", quantity: 1, unitCost: 0 }],
    });
  }
  function updateLine(idx: number, patch: Partial<PurchaseLine>) {
    setDraft({ ...draft, lines: draft.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });
  }
  function removeLine(idx: number) {
    setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== idx) });
  }
  function pickProduct(idx: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (product) {
      // Carry the product's current sale prices onto the line so the user can
      // see and edit them from the purchase (F3). inventory_tiered → prices,
      // on_demand → price.
      updateLine(idx, {
        productId,
        name: product.name,
        unitCost: product.cost ?? 0,
        prices: isTiered ? product.prices : undefined,
        price: isTiered ? undefined : product.price,
      });
    } else {
      updateLine(idx, { productId: "", name: "", unitCost: 0, prices: undefined, price: undefined });
    }
  }

  async function submit() {
    if (draft.lines.length === 0) {
      toast.error("Agrega al menos una pieza.");
      return;
    }
    if (draft.lines.some((l) => !l.productId)) {
      toast.error("Cada línea necesita un producto.");
      return;
    }
    // Apply stock + weighted-average cost to each product. Also merge any
    // sale-price edits from the line (F3). upsertProduct re-projects the public
    // catalog — stock/cost are private (no-op projection), but a price change
    // DOES republish (intended: adjusting price while buying updates the
    // catalog). If several lines touch the same product, the last line's price
    // wins (applyPurchaseLines already folds qty/cost the same way).
    const computed = applyPurchaseLines(products, draft.lines);
    try {
      for (const [productId, update] of computed) {
        const p = state.products.find((x) => x.id === productId);
        if (p) {
          const line = draft.lines.find((l) => l.productId === productId);
          await upsertProduct({
            ...p,
            quantityOnHand: update.quantityOnHand,
            cost: update.cost,
            // Merge price edits only if the line carries them (undefined → keep
            // the product's existing price).
            prices: line?.prices ?? p.prices,
            price: line?.price ?? p.price,
            updatedAt: nowIso(),
          });
        }
      }
      await upsertPurchase({ ...draft, subtotal, updatedAt: nowIso() });
    } catch {
      // persistEntity (StoreProvider) already logged the Firestore rejection.
      // Do NOT show the success toast — that lied when a write silently failed.
      toast.error("No se pudo registrar la compra. Revisa tu conexión e intenta de nuevo.");
      return;
    }
    toast.success(`Compra registrada: ${formatMoney(draft.totalConfirmed || subtotal)}`);
    onDone();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* purchase-pdf-import: optional OCR assist — manual capture stays intact */}
        <PurchasePdfImport
          onApply={(lines, meta) =>
            setDraft((d) => ({
              ...d,
              lines: [...d.lines, ...lines],
              supplierOrder: meta.supplierOrder ?? d.supplierOrder,
              documentUrl: meta.documentUrl ?? d.documentUrl,
              totalConfirmed: meta.total ?? d.totalConfirmed,
            }))
          }
        />
      </div>
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
            setSupplierDraft(newSupplier(activeStore.id));
            setCreatingSupplier(true);
          }}
        >
          + Nuevo proveedor
        </Button>
      </div>
      <TextField
        label="Fecha"
        type="date"
        value={draft.date || todayIso()}
        onChange={(e) => setDraft({ ...draft, date: e.target.value })}
      />

      <div>
        <span className="block text-xs font-semibold text-on-surface-soft uppercase tracking-wide mb-1.5">
          Piezas
        </span>
        <div className="space-y-2">
          {draft.lines.map((line, idx) => (
            <div key={idx} className="space-y-2 p-3 rounded-lg bg-surface-soft">
              <div>
                <SelectField
                  label="Producto"
                  value={line.productId}
                  onChange={(v) => pickProduct(idx, v)}
                  options={products.map((p) => ({
                    value: p.id,
                    label: `${p.name} (existencia: ${p.quantityOnHand ?? 0})`,
                  }))}
                  placeholder="Elegir producto…"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 -ml-2"
                  onClick={() => {
                    if (!activeStore) return;
                    setProductDraft(newProduct(activeStore.id));
                    setProductLineIdx(idx);
                  }}
                >
                  + Nuevo producto
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Cantidad"
                  inputMode="numeric"
                  value={line.quantity.toString()}
                  onChange={(e) =>
                    updateLine(idx, { quantity: Math.max(1, parseInt(e.target.value) || 1) })
                  }
                />
                <TextField
                  label="Costo por pieza"
                  inputMode="decimal"
                  value={line.unitCost.toString()}
                  onChange={(e) => updateLine(idx, { unitCost: parseFloat(e.target.value) || 0 })}
                />
              </div>
              {/* Sale-price edit (F3): shows the product's current prices so the
                  user can adjust them while buying. Persisted onto the product
                  on save. Only after a product is picked. */}
              {line.productId && (
                isTiered ? (
                  <div className={tiersForStore(activeStore).length > 2 ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
                    {tiersForStore(activeStore).map((t) => (
                      <TextField
                        key={t.id}
                        label={t.label}
                        inputMode="decimal"
                        value={(line.prices?.[t.id] ?? 0).toString()}
                        onChange={(e) =>
                          updateLine(idx, {
                            prices: { ...(line.prices ?? {}), [t.id]: parseAmount(e.target.value) ?? 0 },
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <TextField
                    label="Precio de venta"
                    inputMode="decimal"
                    value={(line.price ?? 0).toString()}
                    onChange={(e) => updateLine(idx, { price: parseAmount(e.target.value) })}
                  />
                )
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-soft">
                  Subtotal: {formatMoney(line.quantity * line.unitCost)}
                </span>
                <IconButton variant="ghost" aria-label="Quitar línea" onClick={() => removeLine(idx)}>
                  ✕
                </IconButton>
              </div>
            </div>
          ))}
        </div>
        <Button size="sm" variant="secondary" className="mt-2" onClick={addLine}>
          + Agregar pieza
        </Button>
      </div>

      <div className="border-t border-edge pt-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-ink-soft">Subtotal (suma de líneas)</span>
          <span className="font-semibold text-ink">{formatMoney(subtotal)}</span>
        </div>
        <TextField
          label="Total del ticket"
          hint="Lo que realmente pagaste. Si difiere del subtotal, te avisamos."
          inputMode="decimal"
          value={draft.totalConfirmed.toString()}
          onChange={(e) => setDraft({ ...draft, totalConfirmed: parseFloat(e.target.value) || 0 })}
        />
        {delta !== 0 && (
          <p className="text-xs text-terracotta">
            Diferencia de {formatMoney(Math.abs(delta))} ({delta > 0 ? "de más" : "de menos"}) —
            ¿envío, descuento o redondeo?
          </p>
        )}
      </div>

      <TextArea
        label="Notas"
        value={draft.notes ?? ""}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })}
      />

      <Button full size="lg" onClick={() => void submit()} disabled={draft.lines.length === 0}>
        Guardar compra
      </Button>

      {creatingSupplier && supplierDraft && (
        <Sheet
          open
          onClose={() => setCreatingSupplier(false)}
          title="Nuevo proveedor"
        >
          <SupplierForm
            supplier={supplierDraft}
            onDone={() => {
              // Auto-select the just-created supplier on the purchase. The
              // SupplierForm upserts before onDone, so it's in state.suppliers.
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
          onClose={() => { setProductLineIdx(null); setProductDraft(null); }}
          title="Nuevo producto"
        >
          <ProductMiniForm
            draft={productDraft}
            isTiered={isTiered}
            tiers={tiersForStore(activeStore)}
            onDone={async (saved) => {
              // Upsert (private by default; published if the user toggled it),
              // then set it directly on the line. We bypass pickProduct because
              // it reads the `products` array from this render's scope, which is
              // stale right after the awaited upsert — but we already hold the
              // full saved product, so set the line fields directly.
              await upsertProduct(saved);
              updateLine(productLineIdx, {
                productId: saved.id,
                name: saved.name,
                unitCost: saved.cost ?? 0,
                prices: isTiered ? saved.prices : undefined,
                price: isTiered ? undefined : saved.price,
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
      // Prices only when the store uses them.
      prices: isTiered
        ? Object.fromEntries(tiers.map((t) => [t.id, parseAmount(tierPrices[t.id]) ?? 0]))
        : draft.prices,
      price: isTiered ? draft.price : parseAmount(price),
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
      <TextField
        label="Costo"
        inputMode="decimal"
        placeholder="0"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
      />
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
