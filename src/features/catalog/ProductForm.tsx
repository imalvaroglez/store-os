import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Button,
  TextField,
  TextArea,
  CheckboxField,
  SelectField,
} from "../../design-system";
import { CATEGORY_LABELS, CATEGORY_OPTIONS } from "../../lib/labels";
import { parseAmount } from "../../lib/money";
import type { Product, ProductCategory } from "../../types";

export function ProductForm({
  product,
  onDone,
}: {
  product: Product;
  onDone: () => void;
}) {
  const { upsertProduct, activeStore } = useStore();
  // Form shape follows the STORE type, not the product's fields — a fresh
  // newProduct has neither price nor prices, so inferring from it would mis-classify.
  const isTiered = activeStore?.type === "inventory_tiered";
  const [draft, setDraft] = useState<Product>(product);

  // Numeric inputs kept as strings in the form, coerced on submit (no NaN into state).
  const [cost, setCost] = useState(product.cost?.toString() ?? "");
  const [price, setPrice] = useState(product.price?.toString() ?? "");
  const [retail, setRetail] = useState(product.prices?.retail?.toString() ?? "");
  const [wholesale, setWholesale] = useState(product.prices?.wholesale?.toString() ?? "");
  const [reseller, setReseller] = useState(product.prices?.reseller?.toString() ?? "");
  const [qty, setQty] = useState(product.quantityOnHand?.toString() ?? "");
  const [lowAt, setLowAt] = useState(product.lowStockAt?.toString() ?? "");

  function submit() {
    if (!draft.name.trim()) return;
    const next: Product = {
      ...draft,
      name: draft.name.trim(),
      category: draft.category,
      cost: parseAmount(cost),
      updatedAt: new Date().toISOString(),
    };
    if (isTiered) {
      next.prices = {
        retail: parseAmount(retail),
        wholesale: parseAmount(wholesale),
        reseller: parseAmount(reseller),
      };
      next.quantityOnHand = parseAmount(qty) ?? 0;
      next.lowStockAt = parseAmount(lowAt);
      next.price = undefined;
    } else {
      next.price = parseAmount(price) ?? 0;
      next.prices = undefined;
      next.quantityOnHand = undefined;
    }
    upsertProduct(next);
    onDone();
  }

  return (
    <div className="space-y-4">
      <TextField
        label="Nombre"
        placeholder="Ej. Perfume Baccarat Rouge 540"
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        autoFocus
      />
      <SelectField<ProductCategory>
        label="Categoría"
        value={draft.category}
        onChange={(next) => setDraft({ ...draft, category: next })}
        options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
      />
      <TextField
        label="Imagen (URL)"
        hint="Pega un enlace. Sin subida de archivos por ahora."
        placeholder="https://..."
        value={draft.imageUrl ?? ""}
        onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value || undefined })}
      />
      <TextField
        label="Costo"
        inputMode="decimal"
        placeholder="0"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
      />

      {isTiered ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <TextField label="Menudeo" inputMode="decimal" placeholder="0" value={retail} onChange={(e) => setRetail(e.target.value)} />
            <TextField label="Mayoreo" inputMode="decimal" placeholder="0" value={wholesale} onChange={(e) => setWholesale(e.target.value)} />
            <TextField label="Emprendedora" inputMode="decimal" placeholder="0" value={reseller} onChange={(e) => setReseller(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextField label="En existencia" inputMode="numeric" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)} />
            <TextField label="Alerta en" inputMode="numeric" placeholder="3" value={lowAt} onChange={(e) => setLowAt(e.target.value)} />
          </div>
        </>
      ) : (
        <TextField
          label="Precio de venta"
          inputMode="decimal"
          placeholder="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      )}

      <TextArea
        label="Descripción pública"
        hint="Se muestra en tu catálogo compartido."
        placeholder="Lo que verá tu cliente..."
        value={draft.publicDescription ?? ""}
        onChange={(e) =>
          setDraft({ ...draft, publicDescription: e.target.value || undefined })
        }
      />
      <TextArea
        label="Notas privadas"
        hint="Solo tú ves esto."
        value={draft.privateNotes ?? ""}
        onChange={(e) =>
          setDraft({ ...draft, privateNotes: e.target.value || undefined })
        }
      />

      <CheckboxField
        label="¿Mostrar en catálogo público?"
        checked={draft.isPublic}
        onChange={(next) => setDraft({ ...draft, isPublic: next })}
        caption={draft.isPublic ? "Público" : "Privado"}
      />

      <Button full size="lg" onClick={submit} disabled={!draft.name.trim()}>
        Guardar producto
      </Button>
    </div>
  );
}
