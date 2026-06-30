import { useEffect, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { resizeImageFile, uploadProductImage } from "../../app/firebase/storage";
import {
  Button,
  TextField,
  TextArea,
  CheckboxField,
  SelectField,
  PhotoPicker,
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
  const { upsertProduct, activeStore, cloud } = useStore();
  // Form shape follows the STORE type, not the product's fields — a fresh
  // newProduct has neither price nor prices, so inferring from it would mis-classify.
  const isTiered = activeStore?.type === "inventory_tiered";
  const [draft, setDraft] = useState<Product>(product);

  // Staged photo (cloud only): a resized Blob chosen by the user but not yet
  // uploaded. Upload happens on submit so cancelling the form leaves no orphan.
  // `stagedPreview` is a local object-URL shown in the tile until save.
  const [stagedBlob, setStagedBlob] = useState<Blob | null>(null);
  const [stagedPreview, setStagedPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Revoke any staged object-URL on unmount / re-stage so we don't leak it.
  useEffect(() => {
    return () => {
      if (stagedPreview) URL.revokeObjectURL(stagedPreview);
    };
  }, [stagedPreview]);

  // Numeric inputs kept as strings in the form, coerced on submit (no NaN into state).
  const [cost, setCost] = useState(product.cost?.toString() ?? "");
  const [price, setPrice] = useState(product.price?.toString() ?? "");
  const [retail, setRetail] = useState(product.prices?.retail?.toString() ?? "");
  const [wholesale, setWholesale] = useState(product.prices?.wholesale?.toString() ?? "");
  const [reseller, setReseller] = useState(product.prices?.reseller?.toString() ?? "");
  const [qty, setQty] = useState(product.quantityOnHand?.toString() ?? "");
  const [lowAt, setLowAt] = useState(product.lowStockAt?.toString() ?? "");

  async function handleSelectPhoto(file: File) {
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const blob = await resizeImageFile(file);
      setStagedBlob(blob);
      setStagedPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch {
      setPhotoError("No pudimos leer esa imagen, intenta con otra.");
    } finally {
      setPhotoBusy(false);
    }
  }

  function handleRemovePhoto() {
    if (stagedPreview) URL.revokeObjectURL(stagedPreview);
    setStagedBlob(null);
    setStagedPreview(null);
    setDraft({ ...draft, imageUrl: undefined });
    setPhotoError(null);
  }

  async function submit() {
    if (!draft.name.trim() || saving) return;

    // Cloud + a staged photo: upload before persisting. On failure, block the
    // save so we never store a half-uploaded state — keep the form open.
    let imageUrl = draft.imageUrl;
    if (cloud && activeStore && stagedBlob) {
      setSaving(true);
      setPhotoBusy(true);
      try {
        imageUrl = await uploadProductImage(activeStore.id, product.id, stagedBlob);
        setPhotoError(null);
      } catch {
        setPhotoError("No se pudo subir la foto. Revisa tu conexión e intenta de nuevo.");
        setPhotoBusy(false);
        setSaving(false);
        return; // block save
      }
      setPhotoBusy(false);
    }

    const next: Product = {
      ...draft,
      imageUrl,
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
      {cloud ? (
        <PhotoPicker
          previewUrl={stagedPreview ?? draft.imageUrl}
          busy={photoBusy}
          error={photoError ?? undefined}
          onSelect={handleSelectPhoto}
          onRemove={handleRemovePhoto}
        />
      ) : (
        <TextField
          label="Imagen (URL)"
          hint="Pega un enlace. La subida de fotos está disponible al iniciar sesión."
          placeholder="https://..."
          value={draft.imageUrl ?? ""}
          onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value || undefined })}
        />
      )}
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

      <Button full size="lg" onClick={submit} disabled={!draft.name.trim() || saving}>
        {saving ? "Guardando…" : "Guardar producto"}
      </Button>
    </div>
  );
}
