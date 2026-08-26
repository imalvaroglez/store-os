import { useEffect, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  resizeImageFile,
  uploadGalleryImage,
} from "../../app/firebase/storage";
import {
  Button,
  TextField,
  TextArea,
  CheckboxField,
  SelectField,
  MultiPhotoPicker,
  type GalleryTile,
} from "../../design-system";
import { parseAmount, formatMoney } from "../../lib/money";
import { defaultTier, suggestedPrice, tiersForStore } from "../../lib/pricing";
import { slugify, uniqueProductSlug, suggestSkuBase, uniqueProductSku } from "../../lib/catalog";
import { uid } from "../../lib/ids";
import { activeCategoriesForStore } from "../../lib/selectors";
import {
  MAX_PRODUCT_CATEGORIES,
  MAX_PRODUCT_IMAGES,
  type Product,
  type ProductImage as ProductImageType,
} from "../../types";

// Staged gallery image: a resized Blob chosen but not yet uploaded. Upload
// happens on submit so cancelling leaves no orphan in Storage.
type StagedImage = { id: string; blob: Blob; previewUrl: string };

export function ProductForm({
  product,
  onDone,
}: {
  product: Product;
  onDone: () => void;
}) {
  const { state, upsertProduct, activeStore, cloud } = useStore();
  const isTiered = activeStore?.type === "inventory_tiered";
  const [draft, setDraft] = useState<Product>(product);

  const [staged, setStaged] = useState<StagedImage[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  // SKU auto-suggest: once Fer edits the SKU by hand, stop regenerating from the
  // name. Starts true for an existing product (sku already set) → name edits
  // never touch its SKU (it may be on physical labels / history).
  const [skuManuallyEdited, setSkuManuallyEdited] = useState<boolean>(!!product.sku);

  // Revoke staged object-URLs on unmount.
  useEffect(() => {
    return () => {
      for (const s of staged) URL.revokeObjectURL(s.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Numeric inputs as strings, coerced on submit (no NaN into state).
  const [cost, setCost] = useState(product.cost?.toString() ?? "");
  const [price, setPrice] = useState(product.price?.toString() ?? "");
  // Tier prices keyed by tier id (scalable-pricing: tiers are store-defined).
  const [tierPrices, setTierPrices] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(product.prices ?? {}).map(([k, v]) => [k, v?.toString() ?? ""]))
  );
  const [qty, setQty] = useState(product.quantityOnHand?.toString() ?? "");
  const [lowAt, setLowAt] = useState(product.lowStockAt?.toString() ?? "");

  if (!activeStore) return null;
  // Capture the non-null store so async closures (submit/handleAdd) stay narrowed.
  const store = activeStore;
  const tiers = tiersForStore(store);
  const def = defaultTier(store);
  const categories = activeCategoriesForStore(state.categories, store.id);

  // Build the tile list shown in the picker: saved images + staged ones.
  const savedImages: ProductImageType[] = draft.images ?? [];
  const tiles: GalleryTile[] = [
    ...savedImages.map((img) => ({
      id: img.id,
      url: img.url,
      isPrimary: img.isPrimary,
    })),
    ...staged.map((s) => ({
      id: s.id,
      url: s.previewUrl,
      isPrimary: savedImages.length === 0 && staged[0]?.id === s.id && !savedImages.some((i) => i.isPrimary),
    })),
  ];

  async function handleAdd(file: File) {
    const total = savedImages.length + staged.length;
    if (total >= MAX_PRODUCT_IMAGES) {
      setPhotoError(`Máximo ${MAX_PRODUCT_IMAGES} fotos.`);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPhotoError("Cada foto debe pesar menos de 10 MB.");
      return;
    }
    setPhotoError(null);
    setBusyId("resize");
    try {
      const blob = await resizeImageFile(file);
      const id = uid("img");
      setStaged((prev) => [...prev, { id, blob, previewUrl: URL.createObjectURL(blob) }]);
    } catch {
      setPhotoError("No pudimos leer esa imagen, intenta con otra.");
    } finally {
      setBusyId(null);
    }
  }

  function handleRemove(id: string) {
    // Staged: revoke + drop. Saved: drop from draft (object deleted on submit).
    const s = staged.find((x) => x.id === id);
    if (s) {
      URL.revokeObjectURL(s.previewUrl);
      setStaged((prev) => prev.filter((x) => x.id !== id));
      return;
    }
    setDraft((d) => {
      const next = (d.images ?? []).filter((i) => i.id !== id);
      // Reassign primary if we removed the primary.
      if (!next.some((i) => i.isPrimary) && next.length > 0) next[0].isPrimary = true;
      return { ...d, images: next };
    });
  }

  function handleMakePrimary(id: string) {
    setDraft((d) => ({
      ...d,
      images: (d.images ?? []).map((i) => ({ ...i, isPrimary: i.id === id })),
    }));
    setStaged((prev) => prev); // no-op; primary for staged is positional
  }

  function handleMove(id: string, dir: -1 | 1) {
    setDraft((d) => {
      const imgs = [...(d.images ?? [])];
      const i = imgs.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= imgs.length) return d;
      [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
      // Re-index order + keep exactly one primary (preserve the primary flag).
      return { ...d, images: imgs.map((img, idx) => ({ ...img, order: idx })) };
    });
  }

  function toggleCategory(catId: string) {
    setDraft((d) => {
      const current = d.categoryIds ?? [];
      if (current.includes(catId)) {
        return { ...d, categoryIds: current.filter((c) => c !== catId) };
      }
      if (current.length >= MAX_PRODUCT_CATEGORIES) return d; // cap enforced silently
      return { ...d, categoryIds: [...current, catId] };
    });
  }

  async function submit() {
    setValidationError(null);
    if (!draft.name.trim() || saving) return;

    // Upload staged images first; block save on failure (no half-uploaded state).
    let uploaded: ProductImageType[] = [];
    if (cloud && staged.length > 0) {
      setSaving(true);
      try {
        uploaded = await Promise.all(
          staged.map(async (s, idx) => {
            const { url, storagePath } = await uploadGalleryImage(
              store.id,
              product.id,
              s.id,
              s.blob
            );
            return {
              id: s.id,
              url,
              storagePath,
              order: savedImages.length + idx,
              isPrimary: false,
            };
          })
        );
      } catch {
        setPhotoError("No se pudieron subir las fotos. Revisa tu conexión.");
        setSaving(false);
        return;
      }
    }

    // Merge saved + uploaded into the final gallery; ensure exactly one primary.
    const merged = reorderGallery([...savedImages, ...uploaded]);

    // PUBLISH VALIDATION: a published product needs a price and (when the store
    // has categories) a primary category. Drafts bypass validation. A photo is
    // encouraged but not hard-required — a product without one renders a
    // placeholder, and blocking save entirely fights the natural "add now,
    // photograph later" flow.
    const willPublish = (draft.status ?? "published") === "published";
    if (willPublish) {
      if (!draft.sku?.trim()) {
        setValidationError("Para publicar, agrega una clave.");
        setSaving(false);
        return;
      }
      const def = defaultTier(activeStore);
      const hasPrice = isTiered ? !!parseAmount(tierPrices[def?.id ?? ""]) : !!parseAmount(price);
      if (!hasPrice) {
        setValidationError("Para publicar, define un precio.");
        setSaving(false);
        return;
      }
      if ((draft.categoryIds ?? []).length === 0) {
        setValidationError("Para publicar, elige al menos una categoría.");
        setSaving(false);
        return;
      }
      const hasPhoto = cloud ? merged.length > 0 && merged.some((image) => image.isPrimary) : !!draft.imageUrl;
      if (!hasPhoto) {
        setValidationError("Para publicar, agrega una foto de portada.");
        setSaving(false);
        return;
      }
    }

    // Assign a stable slug if missing (survives renames thereafter).
    const slug = draft.slug
      ? draft.slug
      : uniqueProductSlug(state.products, store.id, product.id, slugify(draft.name));

    // SKU: source-of-truth at save. Auto mode → re-resolve against the final set
    // (the only authoritative uniqueness check in this local-first model; there's
    // no backend sku transaction). Manual mode → respect Fer's value but reject a
    // collision with another product in this store.
    let sku = draft.sku?.trim() ?? "";
    if (!skuManuallyEdited && draft.name.trim()) {
      sku = uniqueProductSku(state.products, store.id, product.id, sku, sku);
    } else if (sku) {
      const clashes = state.products.some(
        (p) => p.id !== product.id && p.storeId === store.id && (p.sku ?? "").toUpperCase() === sku.toUpperCase()
      );
      if (clashes) {
        setValidationError("Esa clave ya la usa otro producto. Elige otra.");
        setSaving(false);
        return;
      }
    }

    const next: Product = {
      ...draft,
      name: draft.name.trim(),
      sku,
      slug,
      images: merged,
      imageUrl: merged.find((i) => i.isPrimary)?.url ?? merged[0]?.url,
      cost: parseAmount(cost),
      updatedAt: new Date().toISOString(),
    };

    if (isTiered) {
      next.prices = Object.fromEntries(
        Object.entries(tierPrices).map(([k, v]) => [k, parseAmount(v) ?? 0])
      );
      next.quantityOnHand = parseAmount(qty) ?? 0;
      next.lowStockAt = parseAmount(lowAt);
      next.price = undefined;
    } else {
      next.price = parseAmount(price) ?? 0;
      next.prices = undefined;
      next.quantityOnHand = undefined;
    }
    try {
      await upsertProduct(next);
      onDone();
    } catch {
      setValidationError("No se pudo guardar. Intenta de nuevo.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <TextField
        label="Nombre"
        placeholder="Ej. Anillo de plata 925"
        value={draft.name}
        onChange={(e) => {
          const name = e.target.value;
          // Auto-suggest the SKU live (base only; collisions resolve on blur/save).
          // Empty name does NOT clear the SKU so Fer can replace it calmly.
          if (!skuManuallyEdited && name.trim()) {
            setDraft({ ...draft, name, sku: suggestSkuBase(name, store.skuPrefix) });
          } else {
            setDraft({ ...draft, name });
          }
        }}
        onBlur={() => {
          if (!skuManuallyEdited && draft.name.trim()) {
            const resolved = uniqueProductSku(
              state.products, store.id, product.id,
              draft.sku ?? "", draft.sku
            );
            setDraft({ ...draft, sku: resolved });
          }
        }}
        autoFocus
      />
      <TextField
        label="Clave / SKU"
        hint="La generamos a partir del nombre. Puedes cambiarla si lo necesitas."
        placeholder="Ej. OLIV-ANILLO-DE-PLATA-925"
        value={draft.sku ?? ""}
        onChange={(e) => {
          setDraft({ ...draft, sku: e.target.value });
          setSkuManuallyEdited(true);
        }}
      />
      {skuManuallyEdited && draft.name.trim() && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const resolved = uniqueProductSku(
              state.products, store.id, product.id,
              suggestSkuBase(draft.name, store.skuPrefix), undefined
            );
            setDraft({ ...draft, sku: resolved });
            setSkuManuallyEdited(false);
          }}
        >
          ↻ Generar desde el nombre
        </Button>
      )}

      {cloud ? (
        <MultiPhotoPicker
          tiles={tiles}
          max={MAX_PRODUCT_IMAGES}
          busy={busyId === "resize"}
          error={photoError ?? undefined}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onMakePrimary={handleMakePrimary}
          onMove={handleMove}
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

      {/* Categories: primary (first selected) + up to 2 secondary. */}
      <div>
        <span className="block text-xs font-semibold text-on-surface-soft uppercase tracking-wide mb-1.5">
          Categorías (máximo {MAX_PRODUCT_CATEGORIES})
        </span>
        {categories.length === 0 ? (
          <p className="text-xs text-on-surface-soft/70">
            Aún no hay categorías. Crea algunas en la pestaña Categorías.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const selected = (draft.categoryIds ?? []).includes(c.id);
              const isPrimary = (draft.categoryIds ?? [])[0] === c.id;
              return (
                <CheckboxField
                  key={c.id}
                  label={(isPrimary ? "★ " : "") + c.name}
                  checked={selected}
                  onChange={() => toggleCategory(c.id)}
                />
              );
            })}
          </div>
        )}
        <span className="block text-xs text-on-surface-soft/70 mt-1">
          La primera que elijas es la categoría principal.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Material"
          placeholder="Plata 925"
          value={draft.material ?? ""}
          onChange={(e) => setDraft({ ...draft, material: e.target.value || undefined })}
        />
        <TextField
          label="Color / acabado"
          placeholder="Dorado"
          value={draft.finish ?? ""}
          onChange={(e) => setDraft({ ...draft, finish: e.target.value || undefined })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Medidas"
          placeholder="50 cm"
          value={draft.dimensions ?? ""}
          onChange={(e) => setDraft({ ...draft, dimensions: e.target.value || undefined })}
        />
        <TextField
          label="Cuidados"
          placeholder="Evita el agua"
          value={draft.care ?? ""}
          onChange={(e) => setDraft({ ...draft, care: e.target.value || undefined })}
        />
      </div>

      <TextField
        label="Costo"
        inputMode="decimal"
        placeholder="0"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
      />

      {isTiered ? (
        <>
          <div className={tiers.length > 2 ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
            {tiers.map((t) => {
              const isDefault = t.id === def?.id;
              const suggested = isDefault ? suggestedPrice(parseAmount(cost), activeStore.pricingRule) : undefined;
              return (
                <div key={t.id}>
                  <TextField
                    label={t.label + (isDefault ? " · público" : "")}
                    inputMode="decimal"
                    placeholder="0"
                    value={tierPrices[t.id] ?? ""}
                    onChange={(e) => setTierPrices((m) => ({ ...m, [t.id]: e.target.value }))}
                    hint={suggested != null ? `Sugerido: ${formatMoney(suggested)}` : undefined}
                  />
                  {suggested != null && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-terracotta font-semibold"
                      onClick={() => setTierPrices((m) => ({ ...m, [t.id]: String(suggested) }))}
                    >
                      Usar sugerido
                    </Button>
                  )}
                </div>
              );
            })}
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
        placeholder="Lo que verá tu clienta…"
        value={draft.publicDescription ?? ""}
        onChange={(e) => setDraft({ ...draft, publicDescription: e.target.value || undefined })}
      />
      <TextArea
        label="Notas privadas"
        hint="Solo tú ves esto."
        value={draft.privateNotes ?? ""}
        onChange={(e) => setDraft({ ...draft, privateNotes: e.target.value || undefined })}
      />

      <SelectField
        label="Estado de publicación"
        value={draft.status ?? "published"}
        onChange={(v) => setDraft({ ...draft, status: v as Product["status"] })}
        options={[
          { value: "published", label: "Publicado (visible en el catálogo)" },
          { value: "draft", label: "Borrador (no visible)" },
          { value: "archived", label: "Archivado (no visible)" },
        ]}
      />
      <SelectField
        label="Disponibilidad"
        value={draft.availability ?? "available"}
        onChange={(v) => setDraft({ ...draft, availability: v as Product["availability"] })}
        options={[
          { value: "available", label: "Disponible" },
          { value: "low_stock", label: "Pocas piezas" },
          { value: "sold_out", label: "Agotado" },
        ]}
      />

      <div className="grid grid-cols-3 gap-2">
        <CheckboxField
          label="Novedad"
          checked={draft.isNew ?? false}
          onChange={(v) => setDraft({ ...draft, isNew: v })}
        />
        <CheckboxField
          label="Destacado"
          checked={draft.isFeatured ?? false}
          onChange={(v) => setDraft({ ...draft, isFeatured: v })}
        />
        <CheckboxField
          label="Permite pedir info"
          checked={draft.canInquire ?? false}
          onChange={(v) => setDraft({ ...draft, canInquire: v })}
        />
      </div>

      {validationError && (
        <p className="text-sm text-danger font-semibold" role="alert">{validationError}</p>
      )}

      <Button full size="lg" onClick={submit} disabled={!draft.name.trim() || saving}>
        {saving ? "Guardando…" : "Guardar producto"}
      </Button>
    </div>
  );
}

// Ensure exactly one primary image (the first if none is marked) and index order.
function reorderGallery(images: ProductImageType[]): ProductImageType[] {
  if (images.length === 0) return images;
  const hasPrimary = images.some((i) => i.isPrimary);
  return images.map((img, idx) => ({
    ...img,
    order: idx,
    isPrimary: hasPrimary ? img.isPrimary : idx === 0,
  }));
}
