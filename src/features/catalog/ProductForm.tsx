import { useEffect, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  resizeImageFile,
  uploadGalleryImage,
} from "../../app/firebase/storage";
import {
  Button,
  Dialog,
  TextField,
  TextArea,
  CheckboxField,
  SelectField,
  MultiPhotoPicker,
  type GalleryTile,
} from "../../design-system";
import { parseAmount, formatMoney, sanitizeDecimalInput, sanitizeSignedIntegerInput , sanitizeIntegerInput } from "../../lib/money";
import { DEFAULT_LOW_STOCK_AT } from "../../lib/inventory";
import { defaultTier, suggestedPrice, tiersForStore } from "../../lib/pricing";
import { baseCostForTier, resolveRule, suggestedPriceFor, hasRules } from "../../lib/pricingRules";
import { slugify, uniqueProductSlug, suggestSkuBase, uniqueProductSku } from "../../lib/catalog";
import { uid } from "../../lib/ids";
import { activeCategoriesForStore } from "../../lib/selectors";
import {
  MAX_PRODUCT_CATEGORIES,
  MAX_PRODUCT_IMAGES,
  type Product,
  type ProductImage as ProductImageType,
  type ProductVariant,
} from "../../types";
import { suggestSkuSuffix, variantPublishError, variantSku as buildVariantSku } from "../../lib/variants";

// Staged gallery image: a resized Blob chosen but not yet uploaded. Upload
// happens on submit so cancelling leaves no orphan in Storage.
type StagedImage = { id: string; blob: Blob; width: number; height: number; previewUrl: string };

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
  // #124: color varieties — stock/cost/clave per color; prices stay shared.
  const [variantsEnabled, setVariantsEnabled] = useState((product.variants?.length ?? 0) > 0);
  const [variants, setVariants] = useState<ProductVariant[]>(product.variants ?? []);
  const [variantStaged, setVariantStaged] = useState<Record<string, StagedImage[]>>({});
  const [variantPhotoError, setVariantPhotoError] = useState<string | null>(null);
  const [confirmDisableVariants, setConfirmDisableVariants] = useState(false);
  const [confirmEnableVariants, setConfirmEnableVariants] = useState(false);

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
      const { blob, width, height } = await resizeImageFile(file);
      const id = uid("img");
      setStaged((prev) => [...prev, { id, blob, width, height, previewUrl: URL.createObjectURL(blob) }]);
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

  // ── #124: variant handlers ─────────────────────────────────────────────
  function addColor() {
    const now = new Date().toISOString();
    setVariants((vs) => [
      ...vs,
      { id: uid("var"), color: "", skuSuffix: "", cost: parseAmount(cost), createdAt: now, updatedAt: now },
    ]);
  }

  /**
   * #355: the first color of a conversion — the ficha's current identity.
   * Activating "se vende por color" on a simple product must seed the previous
   * finish as the first color, carrying its pieces, cost, alert threshold and
   * gallery (reviewable in the form before saving; never silently discarded).
   */
  function seedConversionVariant(): ProductVariant {
    const now = new Date().toISOString();
    const finishName = draft.finish?.trim() ?? "";
    const seededQty = parseAmount(qty);
    const seededLowAt = parseAmount(lowAt);
    return {
      id: uid("var"),
      color: finishName,
      skuSuffix: finishName ? suggestSkuSuffix(finishName) : "",
      cost: parseAmount(cost),
      ...(seededQty != null ? { quantityOnHand: Math.round(seededQty) } : {}),
      ...(seededLowAt != null ? { lowStockAt: Math.round(seededLowAt) } : {}),
      ...(draft.images && draft.images.length > 0 ? { photos: draft.images } : {}),
      createdAt: now,
      updatedAt: now,
    };
  }

  function patchVariant(id: string, patch: Partial<ProductVariant>) {
    setVariants((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch, updatedAt: new Date().toISOString() } : v)));
  }

  /** Color rename keeps the clave suffix in sync while it still looks
   * auto-suggested (empty or the previous color's letter) — always editable. */
  function renameColor(variant: ProductVariant, color: string) {
    const wasAuto = !variant.skuSuffix || variant.skuSuffix === suggestSkuSuffix(variant.color);
    patchVariant(variant.id, { color, ...(wasAuto ? { skuSuffix: color ? suggestSkuSuffix(color) : "" } : {}) });
  }

  function removeColor(id: string) {
    setVariants((vs) => vs.filter((v) => v.id !== id));
    setVariantStaged((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
  }

  async function handleVariantAdd(variantId: string, file: File) {
    const current = variants.find((v) => v.id === variantId);
    const total = (current?.photos?.length ?? 0) + (variantStaged[variantId]?.length ?? 0);
    if (total >= MAX_PRODUCT_IMAGES) {
      setVariantPhotoError(`Máximo ${MAX_PRODUCT_IMAGES} fotos por color.`);
      return;
    }
    setBusyId(`resize-${variantId}`);
    setVariantPhotoError(null);
    try {
      const resized = await resizeImageFile(file);
      const stagedImage: StagedImage = { id: uid("img"), blob: resized.blob, width: resized.width, height: resized.height, previewUrl: URL.createObjectURL(resized.blob) };
      setVariantStaged((m) => ({ ...m, [variantId]: [...(m[variantId] ?? []), stagedImage] }));
    } catch {
      setVariantPhotoError("No se pudo leer la foto. Prueba con otra.");
    } finally {
      setBusyId(null);
    }
  }

  function handleVariantRemovePhoto(variantId: string, photoId: string) {
    setVariantStaged((m) => ({ ...m, [variantId]: (m[variantId] ?? []).filter((s) => s.id !== photoId) }));
    patchVariant(variantId, {
      photos: (variants.find((v) => v.id === variantId)?.photos ?? []).filter((img) => img.id !== photoId),
    });
  }

  function handleVariantPrimary(variantId: string, photoId: string) {
    patchVariant(variantId, {
      photos: (variants.find((v) => v.id === variantId)?.photos ?? []).map((img) => ({ ...img, isPrimary: img.id === photoId })),
    });
  }

  function variantTiles(variantId: string): GalleryTile[] {
    const variant = variants.find((v) => v.id === variantId);
    const saved = variant?.photos ?? [];
    const stagedList = variantStaged[variantId] ?? [];
    return [
      ...saved.map((img) => ({ id: img.id, url: img.url, isPrimary: img.isPrimary })),
      ...stagedList.map((s) => ({ id: s.id, url: s.previewUrl, isPrimary: saved.length === 0 && stagedList[0]?.id === s.id })),
    ];
  }

  async function submit() {
    setValidationError(null);
    const fail = (msg: string) => {
      setValidationError(msg);
      setSaving(false);
    };
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
              width: s.width,
              height: s.height,
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

    // #124: upload each color's staged photos (variant id in the object path),
    // then materialize the full variant array with claves.
    let finalVariants: ProductVariant[] = variants;
    if (variantsEnabled && cloud) {
      const withPhotos: ProductVariant[] = [];
      for (const variant of variants) {
        const stagedList = variantStaged[variant.id] ?? [];
        let uploadedVariant: ProductImageType[] = [];
        if (stagedList.length > 0) {
          setSaving(true);
          try {
            uploadedVariant = await Promise.all(
              stagedList.map(async (s, idx) => {
                const { url, storagePath } = await uploadGalleryImage(store.id, product.id, `${variant.id}-${s.id}`, s.blob);
                return { id: s.id, url, storagePath, width: s.width, height: s.height, order: (variant.photos?.length ?? 0) + idx, isPrimary: false };
              })
            );
          } catch {
            setVariantPhotoError("No se pudieron subir las fotos del color. Revisa tu conexión.");
            setSaving(false);
            return;
          }
        }
        const gallery = reorderGallery([...(variant.photos ?? []), ...uploadedVariant]);
        withPhotos.push({ ...variant, photos: gallery });
      }
      finalVariants = withPhotos;
    }

    // #124 (misión UX): a variant design without its own gallery takes the
    // FIRST color's primary photo as cover — uploading extra photos of the
    // same piece must never be a publish requirement. Derived BEFORE the
    // publish gates below.
    if (variantsEnabled && merged.length === 0) {
      const cover = finalVariants
        .flatMap((v) => v.photos ?? [])
        .find((photo) => photo.isPrimary) ?? finalVariants.flatMap((v) => v.photos ?? [])[0];
      if (cover) merged.push(cover);
    }

    // PUBLISH VALIDATION: a published product needs a price and (when the store
    // has categories) a primary category. Drafts bypass validation. A photo is
    // encouraged but not hard-required — a product without one renders a
    // placeholder, and blocking save entirely fights the natural "add now,
    // photograph later" flow.
    const willPublish = (draft.status ?? "published") === "published";
    if (willPublish) {
      if (!draft.sku?.trim()) return fail("Para publicar, agrega una clave.");
      const def = defaultTier(activeStore);
      const hasPrice = isTiered ? !!parseAmount(tierPrices[def?.id ?? ""]) : !!parseAmount(price);
      if (!hasPrice) return fail("Para publicar, define un precio.");
      if ((draft.categoryIds ?? []).length === 0) return fail("Para publicar, elige al menos una categoría.");
      const hasPhoto = cloud ? merged.length > 0 && merged.some((image) => image.isPrimary) : !!draft.imageUrl || (variantsEnabled && merged.length > 0);
      if (!hasPhoto) return fail("Para publicar, agrega una foto de portada.");
      // #124: per-color publish gates (photo, clave, distinct names) on the
      // FINAL array (staged photos already uploaded into finalVariants).
      if (variantsEnabled) {
        if (finalVariants.length === 0) return fail("Activa colores solo cuando agregues al menos uno.");
        const variantError = variantPublishError({ sku: draft.sku, variants: finalVariants });
        if (variantError) return fail(variantError);
      }
    }
    if (variantsEnabled && variants.length === 0) {
      return fail("Agrega al menos un color o desactiva «Se vende por color».");
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
      if (clashes) return fail("Esa clave ya la usa otro producto. Elige otra.");
    }

    if (variantsEnabled) {
      finalVariants = finalVariants.map((v) => ({ ...v, color: v.color.trim(), sku: buildVariantSku(sku, v) ?? v.sku }));
      // #124/M4: claves únicas — entre colores del diseño y contra el resto
      // de la tienda (las claves viajan en compras, tickets y devoluciones).
      const claves = finalVariants.map((v) => (v.sku ?? "").toUpperCase());
      if (new Set(claves).size !== claves.length) return fail("Dos colores comparten la misma clave; dale a cada color su sufijo.");
      const clash = claves.find((clave) =>
        clave && state.products.some((p) => p.id !== product.id && p.storeId === store.id && (p.sku ?? "").toUpperCase() === clave)
      );
      if (clash) return fail(`La clave ${clash} ya la usa otro producto. Elige otra.`);
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
      // #124: variant designs carry their stock per color; the product-level
      // field would be a second, lying source of truth.
      ...(variantsEnabled ? { variants: finalVariants, quantityOnHand: undefined } : { variants: undefined }),
    };

    if (isTiered) {
      next.prices = Object.fromEntries(
        Object.entries(tierPrices).map(([k, v]) => [k, parseAmount(v) ?? 0])
      );
      // #124: a variant design keeps NO product-level shelf — each color owns
      // its own; writing 0 here would be a second, lying source of truth.
      if (!variantsEnabled) next.quantityOnHand = parseAmount(qty) ?? 0;
      next.lowStockAt = parseAmount(lowAt);
      next.price = undefined;
    } else {
      next.price = parseAmount(price) ?? 0;
      next.prices = undefined;
      // #361 review: an on_demand edit must NEVER canonically delete stock
      // fields. A store that switched type keeps its captured shelves and
      // colors; deleting the properties (instead of undefined) leaves the
      // saveEntity tombstones untouched for them.
      delete next.quantityOnHand;
      delete next.variants;
    }
    try {
      // #373: the loaded entity is the BASELINE — the save merges untouched
      // stock/cost with the fresh doc instead of replaying this clone.
      await upsertProduct(next, product);
      onDone();
    } catch {
      fail("No se pudo guardar. Intenta de nuevo.");
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
        <p className="text-xs text-on-surface-soft">
          La subida de fotos estará disponible al iniciar sesión.
        </p>
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
        onChange={(e) => setCost(sanitizeDecimalInput(e.target.value))}
      />

      {isTiered ? (
        <>
          <div className={tiers.length > 2 ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
            {tiers.map((t) => {
              const isDefault = t.id === def?.id;
              // #254: per-level rules win; the legacy single markup stays as
              // the default tier's fallback for stores without rules.
              let suggested: number | undefined;
              // An EMPTY saved config must behave as absent so the legacy
              // single-markup assistant keeps working (review finding 2).
              if (hasRules(store.pricingRules)) {
                const resolved = resolveRule(store.pricingRules, t.id, { id: product.id, categoryIds: draft.categoryIds });
                if (resolved) {
                  const base = baseCostForTier({ cost: parseAmount(cost) }, t.id, store.packaging);
                  suggested = suggestedPriceFor(resolved.rule, { baseCost: base, acquisitionCost: parseAmount(cost) }) ?? undefined;
                }
              } else if (isDefault) {
                suggested = suggestedPrice(parseAmount(cost), store.pricingRule);
              }
              return (
                <div key={t.id}>
                  <TextField
                    label={t.label + (isDefault ? " · público" : "")}
                    inputMode="decimal"
                    placeholder="0"
                    value={tierPrices[t.id] ?? ""}
                    onChange={(e) => setTierPrices((m) => ({ ...m, [t.id]: sanitizeDecimalInput(e.target.value) }))}
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
          <div className={variantsEnabled ? "hidden" : "grid grid-cols-2 gap-2"}>
            <TextField label="En existencia" inputMode="numeric" placeholder="0" value={qty} onChange={(e) => setQty(sanitizeSignedIntegerInput(e.target.value))} />
            <TextField
              label="Alerta en"
              inputMode="numeric"
              placeholder={String(DEFAULT_LOW_STOCK_AT)}
              hint={`Vacío avisa cuando queden ${DEFAULT_LOW_STOCK_AT} o menos.`}
              value={lowAt}
              onChange={(e) => setLowAt(sanitizeIntegerInput(e.target.value))}
            />
          </div>

          {/* #124: color varieties. Opt-in per design (transition B: existing */}
          {/* products are untouched unless Fer explicitly activates this). */}
          <div className="space-y-3 rounded-xl border border-edge bg-surface p-3">
            <CheckboxField
              label="Se vende por color (cada color con su propia existencia, costo y clave)"
              checked={variantsEnabled}
              onChange={(next) => {
                if (!next) {
                  if (variants.some((v) => (v.quantityOnHand ?? 0) !== 0)) {
                    setConfirmDisableVariants(true);
                    return;
                  }
                  setVariantsEnabled(false);
                  setVariants([]);
                  return;
                }
                // #355: enabling colors on a simple ficha CONVERTS it — the
                // previous finish becomes the first color with its pieces,
                // cost and photos (reviewable before saving). With pieces on
                // the design-level shelf, confirm first: it is real inventory
                // moving between shelves.
                if ((parseAmount(qty) ?? 0) > 0) {
                  setConfirmEnableVariants(true);
                  return;
                }
                setVariantsEnabled(true);
                setVariants([seedConversionVariant()]);
                setQty("");
              }}
            />
            {variantsEnabled ? (
              <div className="space-y-3">
                <p className="text-xs text-on-surface-soft">
                  El precio de venta se comparte entre colores del mismo diseño. Cada color necesita su foto para
                  publicarse; su clave se sugiere sola (p. ej. {draft.sku || "CLAVE"}-D) y puedes editarla.
                </p>
                {variants.map((variant) => (
                  <div key={variant.id} className="space-y-2 rounded-lg border border-edge bg-paper p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <TextField
                        label="Color"
                        placeholder="p. ej. Dorado"
                        value={variant.color}
                        onChange={(e) => renameColor(variant, e.target.value)}
                      />
                      <TextField
                        label={`Clave ${variant.skuSuffix ? `(${draft.sku ?? "CLAVE"}-${variant.skuSuffix})` : "(sufijo)"}`}
                        hint={variant.skuSuffix ? undefined : "Se sugiere con la inicial del color."}
                        placeholder="D"
                        value={variant.skuSuffix ?? ""}
                        onChange={(e) => patchVariant(variant.id, { skuSuffix: e.target.value.toUpperCase().slice(0, 4) })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <TextField
                        label="Costo del color"
                        inputMode="decimal"
                        placeholder={cost || "0"}
                        value={variant.cost != null ? String(Math.round(variant.cost * 100) / 100) : ""}
                        onChange={(e) => patchVariant(variant.id, { cost: parseAmount(e.target.value) })}
                        hint="Hereda el costo del diseño; ajústalo si tu proveedor cobra distinto."
                      />
                      <TextField
                        label="En existencia"
                        inputMode="numeric"
                        placeholder="0"
                        value={variant.quantityOnHand?.toString() ?? ""}
                        onChange={(e) => {
                          const parsed = parseAmount(e.target.value);
                          patchVariant(variant.id, { quantityOnHand: parsed == null ? undefined : Math.round(parsed) });
                        }}
                      />
                    </div>
                    {cloud ? (
                      <MultiPhotoPicker
                        tiles={variantTiles(variant.id)}
                        max={MAX_PRODUCT_IMAGES}
                        busy={busyId === `resize-${variant.id}`}
                        error={variantPhotoError ?? undefined}
                        onAdd={(file) => void handleVariantAdd(variant.id, file)}
                        onRemove={(photoId) => handleVariantRemovePhoto(variant.id, photoId)}
                        onMakePrimary={(photoId) => handleVariantPrimary(variant.id, photoId)}
                        onMove={() => {/* order within a color's gallery is positional; reorder via primary */}}
                      />
                    ) : (
                      <p className="text-xs text-on-surface-soft">Las fotos por color requieren iniciar sesión.</p>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removeColor(variant.id)}>
                      Quitar color {variant.color || "(sin nombre)"}
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="secondary" onClick={addColor}>
                  + Color
                </Button>
              </div>
            ) : (
              <p className="text-xs text-on-surface-soft">
                Actívalo para diseños que llegan en varios acabados: la venta pedirá el color exacto y la existencia
                se descuenta por color.
              </p>
            )}
          </div>
        </>
      ) : (
        <TextField
          label="Precio de venta"
          inputMode="decimal"
          placeholder="0"
          value={price}
          onChange={(e) => setPrice(sanitizeDecimalInput(e.target.value))}
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

      <Dialog
        open={confirmEnableVariants}
        title="¿Vender por color con existencias ya capturadas?"
        onClose={() => setConfirmEnableVariants(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setConfirmEnableVariants(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setConfirmEnableVariants(false);
                setVariantsEnabled(true);
                setVariants([seedConversionVariant()]);
                setQty("");
              }}
            >
              Vender por color
            </Button>
          </div>
        }
      >
        <p className="text-sm text-on-surface-soft">
          Este producto tiene {parseAmount(qty) ?? 0} pieza(s) capturadas como pieza única. Al vender por color, esas
          piezas y su acabado actual{draft.finish?.trim() ? ` (${draft.finish.trim()})` : ""} pasan al primer color con
          sus fotos — revísalos antes de guardar y ajusta lo que haga falta.
        </p>
      </Dialog>

      <Dialog
        open={confirmDisableVariants}
        title="¿Dejar de vender por color?"
        onClose={() => setConfirmDisableVariants(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setConfirmDisableVariants(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirmDisableVariants(false);
                setVariantsEnabled(false);
                // #361 review: symmetric conversion — the pieces return to the
                // design-level shelf (reviewable) instead of requiring a full
                // recapture. Untracked colors contribute 0; the field stays
                // empty only when NO color has a captured shelf.
                const tracked = variants.some((v) => typeof v.quantityOnHand === "number");
                const pieces = variants.reduce((sum, v) => sum + (typeof v.quantityOnHand === "number" ? v.quantityOnHand : 0), 0);
                setQty(tracked ? String(pieces) : "");
                setVariants([]);
                setVariantStaged({});
              }}
            >
              Dejar de vender por color
            </Button>
          </div>
        }
      >
        <p className="text-sm text-on-surface-soft">
          Hay colores con existencia. Al dejar de vender por color, las piezas de todos los colores regresan al
          estante único del producto (quedan anotadas en «En existencia» para que las revises antes de guardar).
        </p>
      </Dialog>
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
