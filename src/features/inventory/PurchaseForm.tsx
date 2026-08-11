import { useState } from "react";
import { useStore, newSupplier } from "../../app/StoreProvider";
import {
  Button,
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
import type { Purchase, PurchaseLine, Supplier } from "../../types";
import { SupplierForm } from "./SupplierForm";

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
    upsertPurchase({ ...draft, subtotal, updatedAt: nowIso() });
    toast.success(`Compra registrada: ${formatMoney(draft.totalConfirmed || subtotal)}`);
    onDone();
  }

  return (
    <div className="space-y-4">
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
                  <div className="grid grid-cols-3 gap-2">
                    {(["retail", "wholesale", "reseller"] as const).map((tier) => (
                      <TextField
                        key={tier}
                        label={tier === "retail" ? "Menudeo" : tier === "wholesale" ? "Mayoreo" : "Emprendedora"}
                        inputMode="decimal"
                        value={(line.prices?.[tier] ?? 0).toString()}
                        onChange={(e) =>
                          updateLine(idx, {
                            prices: { ...(line.prices ?? { retail: 0, wholesale: 0, reseller: 0 }), [tier]: parseAmount(e.target.value) },
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
    </div>
  );
}
