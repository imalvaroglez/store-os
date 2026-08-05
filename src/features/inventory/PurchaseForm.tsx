import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Button,
  SelectField,
  TextField,
  TextArea,
  IconButton,
  useToast,
} from "../../design-system";
import { suppliersForStore, productsForStore } from "../../lib/selectors";
import { applyPurchaseLines } from "../../lib/inventory";
import { todayIso, nowIso } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import type { Purchase, PurchaseLine } from "../../types";

// Multi-line supplier purchase ticket. Each line replenishes a product's stock
// and recomputes its weighted-average cost. The first repeating line-item form
// in the app.
export function PurchaseForm({ purchase, onDone }: { purchase: Purchase; onDone: () => void }) {
  const { state, activeStore, upsertPurchase, upsertProduct } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Purchase>(purchase);

  if (!activeStore) return null;
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
      updateLine(idx, { productId, name: product.name, unitCost: product.cost ?? 0 });
    } else {
      updateLine(idx, { productId: "", name: "", unitCost: 0 });
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
    // Apply stock + weighted-average cost to each product. upsertProduct also
    // re-projects the public catalog, but only the private stock/cost moved
    // (cost is never projected), so the projection is a no-op rewrite. At a
    // few lines per purchase this stays well within the free tier.
    const computed = applyPurchaseLines(products, draft.lines);
    for (const [productId, update] of computed) {
      const p = state.products.find((x) => x.id === productId);
      if (p) {
        await upsertProduct({
          ...p,
          quantityOnHand: update.quantityOnHand,
          cost: update.cost,
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
      <SelectField
        label="Proveedor"
        value={draft.supplierId ?? ""}
        onChange={(v) => setDraft({ ...draft, supplierId: v || undefined })}
        options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        placeholder="Elegir proveedor…"
      />
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
    </div>
  );
}
