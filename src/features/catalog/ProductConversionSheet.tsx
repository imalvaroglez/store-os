import { useMemo, useState } from "react";
import { Badge, Button, IconButton, SelectField, Sheet, TextField, useToast } from "../../design-system";
import { useStore } from "../../app/StoreProvider";
import { buildConversionPreview, type ConversionMapping } from "../../lib/variantConversion";
import { formatMoney } from "../../lib/money";
import type { Product } from "../../types";

// #461 — assisted conversion of already-separated fichas into one design sold
// by exact color×size. One design at a time, confirmed by Fer: the preview
// puts Disponible/Comprometido/Físico antes/después, claves, costos, price
// differences and the affected public links ON THE TABLE before anything
// moves; pending movements stop the whole conversion naming what to resolve.

type Props = { open: boolean; onClose: () => void };

type MappingDraft = { productId: string; color: string; size: string; customColor: boolean };

const NEW_COLOR = "__nuevo__";

export function ProductConversionSheet({ open, onClose }: Props) {
  const { state, activeStore, convertProductVariants } = useStore();
  const toast = useToast();
  const [mainId, setMainId] = useState("");
  const [drafts, setDrafts] = useState<MappingDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storeId = activeStore?.id ?? "";
  const storeProducts = useMemo(
    () => state.products.filter((p) => p.storeId === storeId),
    [state.products, storeId]
  );
  const main = storeProducts.find((p) => p.id === mainId);
  const mainCandidates = storeProducts.filter((p) => p.variants?.length);
  const originCandidates = storeProducts.filter(
    (p) => p.id !== mainId && !p.variants?.length && p.status !== "archived" && !p.mergedInto
  );
  const chosenIds = new Set(drafts.map((d) => d.productId));
  const incidents = useMemo(() => state.orders.flatMap((o) => o.incidents ?? []), [state.orders]);

  const mappings: ConversionMapping[] = drafts.map((d) => ({
    productId: d.productId,
    color: d.color,
    size: d.size,
  }));
  const preview = useMemo(
    () =>
      main
        ? buildConversionPreview(
            main,
            drafts.map((d) => storeProducts.find((p) => p.id === d.productId)!).filter(Boolean),
            mappings,
            { orders: state.orders, purchases: state.purchases, incidents }
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [main, drafts, storeProducts, state.orders, state.purchases, incidents]
  );

  const expected = useMemo(() => {
    const out: Record<string, { physical?: number; quarantine: number }> = {};
    for (const draft of drafts) {
      const product = storeProducts.find((p) => p.id === draft.productId);
      if (product) out[product.id] = { physical: product.quantityOnHand, quarantine: product.quantityQuarantined ?? 0 };
    }
    return out;
  }, [drafts, storeProducts]);

  function addOrigin(productId: string) {
    if (!productId || chosenIds.has(productId)) return;
    const product = storeProducts.find((p) => p.id === productId);
    const firstColor = main?.variants?.[0]?.color ?? "";
    setDrafts((current) => [...current, { productId, color: firstColor, size: product?.name.match(/\b(\d{2}|\d)\b/)?.[1] ?? "", customColor: false }]);
  }

  async function confirm() {
    if (!main || !preview?.canConvert) return;
    setSaving(true);
    setError(null);
    try {
      await convertProductVariants({ mainId: main.id, mappings, expected });
      toast.success("Fichas unificadas. Las de origen quedaron en Archivados con su nota de fusión.");
      setMainId("");
      setDrafts([]);
      onClose();
    } catch (err) {
      // Stale/blocked errors arrive verbatim — they name what to resolve.
      setError(err instanceof Error ? err.message : "No se pudo unificar. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Unificar fichas en un diseño">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-on-surface-soft">
          Reúne fichas ya separadas en un diseño que se vende por color y talla. La existencia, la clave y el costo de cada
          ficha pasan a su combinación exacta; las fichas de origen se retiran de venta y quedan en Archivados con su nota
          de fusión.
        </p>
        <SelectField
          label="Diseño principal (unificado)"
          value={mainId}
          onChange={(value) => { setMainId(value); setDrafts([]); }}
          hint={mainCandidates.length ? "Debe venderse por color." : "Primero activa colores en la ficha que unificará."}
          options={[
            { value: "", label: "Elegir ficha…" },
            ...mainCandidates.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        {!!main && (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <SelectField
                label="Agregar ficha origen"
                value=""
                onChange={addOrigin}
                hint="Ficha simple sin pendientes; se asociará a una combinación exacta."
                options={[
                  { value: "", label: originCandidates.filter((p) => !chosenIds.has(p.id)).length ? "Elegir ficha…" : "Sin más fichas elegibles" },
                  ...originCandidates.filter((p) => !chosenIds.has(p.id)).map((p) => ({ value: p.id, label: `${p.name} · Físico ${p.quantityOnHand ?? "?"}` })),
                ]}
              />
            </div>
            {drafts.map((draft, index) => {
              const product = storeProducts.find((p) => p.id === draft.productId);
              const row = preview?.rows.find((r) => r.productId === draft.productId);
              return (
                <div key={draft.productId} className="rounded-xl border border-edge p-3 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{product?.name}</p>
                      <p className="text-xs text-on-surface-soft">
                        Clave {product?.sku ?? "sin clave"} · costo {typeof product?.cost === "number" ? formatMoney(product.cost) : "desconocido"}
                      </p>
                    </div>
                    <IconButton
                      variant="ghost"
                      aria-label={`Quitar ${product?.name} de la unificación`}
                      onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}
                    >
                      ×
                    </IconButton>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {draft.customColor ? (
                      <TextField
                        label="Color nuevo"
                        value={draft.color}
                        onChange={(e) => setDrafts((current) => current.map((d, i) => (i === index ? { ...d, color: e.target.value } : d)))}
                      />
                    ) : (
                      <SelectField
                        label="Color del diseño"
                        value={draft.customColor ? "" : draft.color}
                        onChange={(value) =>
                          setDrafts((current) =>
                            current.map((d, i) =>
                              i === index
                                ? value === NEW_COLOR
                                  ? { ...d, customColor: true, color: "" }
                                  : { ...d, customColor: false, color: value }
                                : d
                            )
                          )
                        }
                        options={[
                          ...(main.variants ?? []).map((v) => ({ value: v.color, label: v.color })),
                          { value: NEW_COLOR, label: "＋ Color nuevo…" },
                        ]}
                      />
                    )}
                    <TextField
                      label="Talla de la combinación"
                      value={draft.size}
                      placeholder="p. ej. 7"
                      onChange={(e) => setDrafts((current) => current.map((d, i) => (i === index ? { ...d, size: e.target.value } : d)))}
                    />
                  </div>
                  {row && (
                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                      <div><dt className="text-xs text-on-surface-soft">Físico antes</dt><dd>{row.physicalBefore ?? "sin rastrear"}</dd></div>
                      <div><dt className="text-xs text-on-surface-soft">Comprometido</dt><dd>{row.committedBefore}</dd></div>
                      <div><dt className="text-xs text-on-surface-soft">Disponible antes</dt><dd>{row.availableBefore ?? "sin rastrear"}</dd></div>
                      <div><dt className="text-xs text-on-surface-soft">En la combinación</dt><dd>{row.combinationAfter ?? "sin rastrear"}</dd></div>
                      {row.priceDifferences.map((d) => (
                        <div key={d.level} className="col-span-2 sm:col-span-4"><dt className="text-xs text-on-surface-soft">Precio distinto ({d.level})</dt><dd>origen {formatMoney(d.origin)} · diseño {formatMoney(d.main)}</dd></div>
                      ))}
                    </dl>
                  )}
                </div>
              );
            })}
            {preview && preview.blockers.length > 0 && (
              <div className="rounded-xl border border-danger/40 bg-danger/5 p-3">
                <p className="text-sm font-semibold text-danger">Resuelve esto antes de unificar</p>
                <ul className="list-disc pl-5 text-sm text-on-surface mt-1 space-y-1">
                  {preview.blockers.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            )}
            {preview && preview.rows.length > 0 && (
              <div className="rounded-xl border border-edge p-3 text-sm">
                <p className="font-semibold">Efecto en los enlaces públicos</p>
                <p className="text-on-surface-soft mt-1">
                  Al confirmar, {preview.rows.length === 1 ? "el enlace público de la ficha de origen dejará de abrir su ficha" : `los ${preview.rows.length} enlaces públicos de las fichas de origen dejarán de abrir sus fichas`} y el diseño unificado queda publicado con sus combinaciones. Los pedidos y compras anteriores conservan su referencia original.
                </p>
              </div>
            )}
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
              <Button onClick={confirm} disabled={!preview?.canConvert || saving}>{saving ? "Unificando…" : "Unificar fichas"}</Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** #461: the archived ficha's fusion note — identity kept, internal link to
 * the unified design (badge + action live on the catalog card). */
export function MergedIntoLink({ product, onOpen }: { product: Product; onOpen: (mainId: string) => void }) {
  if (!product.mergedInto) return null;
  return (
    <>
      <Badge tone="neutral">Fusionada</Badge>
      <Button variant="ghost" size="sm" className="!px-2" onClick={() => onOpen(product.mergedInto!.productId)}>
        Ver diseño unificado
      </Button>
    </>
  );
}
