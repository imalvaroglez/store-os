// #569 — Surtir del almacén como flujo PRIMARIO de la ficha: un solo diálogo
// donde la operadora busca por producto o color, distingue las variantes de
// cada diseño con su existencia y su costo, agrega renglones a la captura en
// lote y revisa TODO antes de una única confirmación. La búsqueda sólo
// estrecha lo que se VE: los renglones agregados viven en «Piezas para
// surtir», editables hasta el envío. Una intención por surtido (misma carga
// al reintentar); una captura descartada no aparece en otro punto.
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, Dialog, TextField, useToast } from "../../design-system";
import { todayIso } from "../../lib/dates";
import { uid } from "../../lib/ids";
import { formatMoneyExact, parseAmount, sanitizeIntegerInput } from "../../lib/money";
import { orderAmountCents } from "../../lib/orderMoney";
import { variantEffectivePrice } from "../../lib/variantPrice";
import type { PointOfSale, Product } from "../../types";

/** Cents → pesos for display helpers (whole-peso rounding, cents kept exact). */
const pesos = (cents: number): number => Math.round(cents) / 100;

/** One capturable shelf dimension: a variant or the plain product itself. */
type StockRow = {
  key: string;
  productId: string;
  variantId?: string;
  productName: string;
  variantColor?: string;
  available: number;
  /** Level price in pesos; undefined = this level has NO price for the row. */
  suggestedPrice?: number;
  /** Cost evidence the callable will record (the variant's own, or the
   * product's only when it has no variants — mirrors functions shelfOf). */
  costCents?: number;
};

/** A row added to «Piezas para surtir», with its editable capture. */
type StockLine = {
  key: string;
  row: StockRow;
  qty: string;
  price: string;
};

function rowName(row: StockRow): string {
  return row.variantColor ? `${row.productName} · ${row.variantColor}` : row.productName;
}

/** The shelf rows of one design, with the point's level price per variant. */
function rowsForProduct(product: Product, tierId: string): StockRow[] {
  const variants = product.variants ?? [];
  if (variants.length > 0) {
    return variants.map((variant) => ({
      key: `${product.id}|${variant.id}`,
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantColor: variant.color,
      available: variant.quantityOnHand ?? 0,
      suggestedPrice: variantEffectivePrice(variant, tierId, product),
      costCents: typeof variant.cost === "number" ? Math.round(variant.cost * 100) : undefined,
    }));
  }
  const suggested = product.prices?.[tierId];
  return [
    {
      key: `${product.id}|`,
      productId: product.id,
      productName: product.name,
      available: product.quantityOnHand ?? 0,
      suggestedPrice:
        suggested !== undefined && Number.isFinite(suggested) && suggested > 0 ? suggested : undefined,
      costCents: typeof product.cost === "number" ? Math.round(product.cost * 100) : undefined,
    },
  ];
}

/** Valid label-price cents from form text; undefined/≤0 = not confirmable. */
function priceCentsOf(text: string): number | undefined {
  const parsed = parseAmount(text.trim());
  if (parsed === undefined) return undefined;
  try {
    const cents = orderAmountCents(parsed, 1);
    return cents > 0 ? cents : undefined;
  } catch {
    return undefined;
  }
}

/** Positive whole-number quantity from sanitized form text. */
function qtyNumberOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= 1 ? value : undefined;
}

export function StockPointDialog({
  open,
  point,
  products,
  tierId,
  onClose,
}: {
  open: boolean;
  point: PointOfSale | null;
  products: Product[];
  tierId: string;
  onClose: () => void;
}) {
  const { stockPoint } = useStore();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { qty?: string; price?: string }>>({});
  const [lines, setLines] = useState<StockLine[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [intentId, setIntentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const lineQtyRefs = useRef(new Map<string, HTMLInputElement>());

  // One fresh intent per surtido session; a retry after a lost response keeps
  // the SAME id (and the same payload) so the callable answers
  // already-applied instead of stocking twice (#524 M1 discipline).
  useEffect(() => {
    if (open) setIntentId(uid());
  }, [open]);

  // A discarded capture never reappears — not in this point nor in another.
  useEffect(() => {
    if (!open) {
      setLines([]);
      setDrafts({});
      setRowErrors({});
      setLineErrors({});
      setQuery("");
      setLastAdded(null);
    }
  }, [open]);

  // Predictable focus after «Agregar»: the newly captured row receives it.
  useEffect(() => {
    if (!lastAdded) return;
    lineQtyRefs.current.get(lastAdded)?.focus();
    setLastAdded(null);
  }, [lastAdded, lines]);

  // Search narrows what the operator SEES; a variant match brings its
  // sisters along. The empty search prioritizes available merchandise only.
  const groups = useMemo(() => {
    if (!open) return [];
    const needle = query.trim().toLowerCase();
    const result: Array<{ product: Product; rows: StockRow[] }> = [];
    for (const product of products) {
      const rows = rowsForProduct(product, tierId);
      if (needle === "") {
        const available = rows.filter((row) => row.available > 0);
        if (available.length > 0) result.push({ product, rows: available });
      } else {
        const nameMatches = product.name.toLowerCase().includes(needle);
        const variantMatches = rows.some((row) =>
          (row.variantColor ?? "").toLowerCase().includes(needle)
        );
        if (nameMatches || variantMatches) result.push({ product, rows });
      }
    }
    return result;
  }, [open, products, tierId, query]);

  const totalUnits = lines.reduce((sum, line) => sum + (qtyNumberOf(line.qty) ?? 0), 0);

  function draftPriceOf(row: StockRow): string {
    const draft = drafts[row.key]?.price;
    if (draft !== undefined) return draft;
    return row.suggestedPrice !== undefined ? String(row.suggestedPrice) : "";
  }

  function addRow(row: StockRow) {
    const qtyText = drafts[row.key]?.qty ?? "";
    const qty = qtyNumberOf(qtyText);
    if (qty === undefined) {
      setRowErrors((prev) => ({ ...prev, [row.key]: "Captura cuántas piezas surtir." }));
      return;
    }
    if (qty > row.available) {
      setRowErrors((prev) => ({ ...prev, [row.key]: `Sólo hay ${row.available} en almacén.` }));
      return;
    }
    const price = draftPriceOf(row);
    if (priceCentsOf(price) === undefined) {
      setRowErrors((prev) => ({ ...prev, [row.key]: "Captura el precio de etiqueta." }));
      return;
    }
    setLines((prev) =>
      prev.some((line) => line.key === row.key) ? prev : [...prev, { key: row.key, row, qty: qtyText.trim(), price: price.trim() }]
    );
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[row.key];
      return next;
    });
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[row.key];
      return next;
    });
    setLastAdded(row.key);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((line) => line.key !== key));
    setLineErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function updateLine(key: string, patch: Partial<Pick<StockLine, "qty" | "price">>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function confirm() {
    if (!point || lines.length === 0) return;
    // Validate the WHOLE batch first: one bad row holds the confirmation and
    // the callable receives zero calls — never a partial surtido.
    const errors: Record<string, string> = {};
    const payload: Array<{ productId: string; variantId?: string; qty: number; markedPriceCents: number }> = [];
    for (const line of lines) {
      const qty = qtyNumberOf(line.qty);
      const cents = priceCentsOf(line.price);
      const error =
        qty === undefined
          ? "Captura cuántas piezas surtir."
          : qty > line.row.available
            ? `Sólo hay ${line.row.available} en almacén.`
            : cents === undefined
              ? "Captura el precio de etiqueta."
              : undefined;
      if (error !== undefined) {
        errors[line.key] = error;
        continue;
      }
      if (qty === undefined || cents === undefined) continue; // type-level only: error already covers it
      payload.push({
        productId: line.row.productId,
        ...(line.row.variantId ? { variantId: line.row.variantId } : {}),
        qty,
        markedPriceCents: cents,
      });
    }
    setLineErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    try {
      const result = await stockPoint({
        storeId: point.storeId,
        pointId: point.id,
        physicalDate: todayIso(),
        intentId,
        lines: payload,
      });
      toast.success(
        result.stocked
          ? `Surtido: ${result.units} piezas al punto.`
          : "Este surtido ya estaba aplicado; no se hizo ningún cambio."
      );
      onClose();
    } catch (error) {
      // The capture survives a failed save; retrying keeps the same intent.
      toast.error(error instanceof Error ? error.message : "No se pudo surtir el punto.");
    } finally {
      setBusy(false);
    }
  }

  if (!point) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Surtir del almacén"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy || lines.length === 0} onClick={() => void confirm()}>
            Surtir piezas
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-on-surface-soft">
          Mueve piezas disponibles del almacén a{" "}
          <span className="font-semibold text-on-surface">{point.name}</span>. Busca por producto o
          color; confirma el precio de etiqueta de cada renglón.
        </p>
        <TextField
          label="Buscar"
          placeholder="Producto o color…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="grid items-start gap-4 md:grid-cols-2">
          {lines.length > 0 ? (
            <section aria-label="Piezas para surtir" className="order-1 min-w-0 md:order-2">
              <div className="space-y-2 rounded-xl bg-surface p-3 ring-1 ring-edge">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-on-surface">Piezas para surtir</p>
                  <p className="text-xs text-on-surface-soft">
                    {totalUnits} {totalUnits === 1 ? "pieza" : "piezas"} en {lines.length}{" "}
                    {lines.length === 1 ? "renglón" : "renglones"} · destino {point.name}
                  </p>
                </div>
                {lines.map((line) => (
                  <div
                    key={line.key}
                    className="flex flex-wrap items-end justify-between gap-2 border-b border-rule pb-2 last:border-0"
                  >
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="text-sm font-medium text-on-surface">{rowName(line.row)}</p>
                      <p className="text-xs text-on-surface-soft">
                        {line.row.available} en almacén ·{" "}
                        {line.row.costCents !== undefined
                          ? `costo ${formatMoneyExact(pesos(line.row.costCents))}`
                          : "costo pendiente"}
                      </p>
                      {lineErrors[line.key] ? (
                        <p className="text-xs text-danger">{lineErrors[line.key]}</p>
                      ) : null}
                    </div>
                    <div className="w-20">
                      <TextField
                        label="Cantidad"
                        inputMode="numeric"
                        placeholder="0"
                        aria-label={`Cantidad a surtir de ${rowName(line.row)}`}
                        value={line.qty}
                        onChange={(e) =>
                          updateLine(line.key, { qty: sanitizeIntegerInput(e.target.value) })
                        }
                        inputRef={(el) => {
                          if (el) lineQtyRefs.current.set(line.key, el);
                          else lineQtyRefs.current.delete(line.key);
                        }}
                      />
                    </div>
                    <div className="w-28">
                      <TextField
                        label="Precio de etiqueta"
                        inputMode="decimal"
                        aria-label={`Precio de etiqueta a surtir de ${rowName(line.row)}`}
                        value={line.price}
                        onChange={(e) => updateLine(line.key, { price: e.target.value })}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Quitar ${rowName(line.row)}`}
                      onClick={() => removeLine(line.key)}
                    >
                      Quitar
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <section aria-label="Disponible en almacén" className="order-2 min-w-0 md:order-1">
            <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1 md:max-h-[60vh]">
              {groups.length === 0 ? (
                <p className="text-sm text-on-surface-soft">
                  {query.trim() === ""
                    ? "No hay piezas disponibles en el almacén."
                    : "Sin resultados para esta búsqueda."}
                </p>
              ) : (
                groups.map(({ product, rows }) => (
                  <div key={product.id} className="space-y-1">
                    {rows[0].variantColor ? (
                      <p className="text-sm font-semibold text-on-surface">{product.name}</p>
                    ) : null}
                    {rows.map((row) => {
                      const added = lines.some((line) => line.key === row.key);
                      const out = row.available <= 0;
                      return (
                        <div
                          key={row.key}
                          className="flex flex-wrap items-end justify-between gap-2 border-b border-rule pb-2 last:border-0"
                        >
                          <div className="min-w-0 flex-1 basis-40">
                            <p className="text-sm font-medium text-on-surface">
                              {row.variantColor ?? row.productName}
                            </p>
                            <p className="text-xs text-on-surface-soft">
                              {out ? "Sin existencias" : `${row.available} en almacén`} ·{" "}
                              {row.costCents !== undefined
                                ? `costo ${formatMoneyExact(pesos(row.costCents))}`
                                : "costo pendiente"}
                            </p>
                            {rowErrors[row.key] ? (
                              <p className="text-xs text-danger">{rowErrors[row.key]}</p>
                            ) : null}
                          </div>
                          <div className="w-20">
                            <TextField
                              label="Cantidad"
                              inputMode="numeric"
                              placeholder="0"
                              disabled={out}
                              aria-label={`Cantidad de ${rowName(row)}`}
                              value={drafts[row.key]?.qty ?? ""}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [row.key]: {
                                    ...prev[row.key],
                                    qty: sanitizeIntegerInput(e.target.value),
                                  },
                                }))
                              }
                            />
                          </div>
                          <div className="w-28">
                            <TextField
                              label="Precio de etiqueta"
                              inputMode="decimal"
                              placeholder={row.suggestedPrice !== undefined ? String(row.suggestedPrice) : "sin sugerido"}
                              disabled={out}
                              hint={
                                row.suggestedPrice === undefined
                                  ? "Sin precio sugerido en este nivel; captura el de etiqueta."
                                  : undefined
                              }
                              aria-label={`Precio de etiqueta de ${rowName(row)}`}
                              value={draftPriceOf(row)}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [row.key]: { ...prev[row.key], price: e.target.value },
                                }))
                              }
                            />
                          </div>
                          <Button
                            size="sm"
                            disabled={out || added}
                            onClick={() => addRow(row)}
                            aria-label={added ? undefined : `Agregar ${rowName(row)}`}
                          >
                            {added ? "Agregado" : "Agregar"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </Dialog>
  );
}
