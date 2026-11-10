// #254 — Reglas de venta: Fer defines ONCE how each price level's suggested
// price derives from cost (percentage, fixed increment, or a cost-band table),
// with category and product overrides. Suggestions are PROPOSALS: applying
// them is always an explicit, reviewed batch action — never automatic.
// #289: the review experience — Estrategia de precios links here with a
// category context (?categoria=), changed pieces come first, non-eligible
// rows cannot be selected, bulk selection only touches the current filter's
// eligible pieces, and applying writes ONLY prices (scoped batch, never a
// full product upsert) after an explicit summary confirmation.
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, PublicCatalogProjectionError } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Money,
  Screen,
  ScreenHeader,
  CheckboxField,
  SelectField,
  TextField,
  useToast,
} from "../../design-system";
import { tiersForStore } from "../../lib/pricing";
import { sanitizeMoneyInput } from "../../lib/money";
import { resolveRule, suggestedPriceFor, baseCostForTier, validateBands, hasRules } from "../../lib/pricingRules";
import { navigate } from "../../lib/router";
import type { Category, PricingRule, PricingRulesConfig, PriceRounding, Product } from "../../types";

function emptyConfig(): PricingRulesConfig {
  return { byTier: {} };
}

function cloneConfig(config: PricingRulesConfig | undefined): PricingRulesConfig {
  // Legacy docs can lack byTier (the type says required; early #280 writers
  // could omit it) — never let a missing map crash the editor.
  const clone = config ? (JSON.parse(JSON.stringify(config)) as PricingRulesConfig) : emptyConfig();
  clone.byTier = clone.byTier ?? {};
  return clone;
}

type DraftState = { config: PricingRulesConfig; dirty: boolean };

type PriceUpdate = { id: string; prices: Record<string, number> };

type TierSuggestion = {
  suggested: number | null;
  current: number | undefined;
  base: number | undefined;
  origin: string;
  belowCost: boolean;
  reason: string; // why there is no applicable suggestion ("" when there is one)
};

type SuggestionEntry = {
  product: Product;
  byTier: Record<string, TierSuggestion>;
  applicable: number; // tiers whose price would change and may apply
  pendingConfirm: number; // below-cost changes from per-product exceptions
  omitted: number; // below-cost changes refused (category/general origin)
  eligible: boolean; // applicable + pendingConfirm > 0
  hasSuggestion: boolean; // any tier produced a suggestion at all
  available: boolean; // not archived and not sold out
};

export function PricingRulesScreen() {
  const { state, activeStore, savePricingRules, applyProductPrices } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<DraftState>(() => ({ config: cloneConfig(activeStore?.pricingRules), dirty: false }));
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // #289: Estrategia de precios bridges here with ?categoria=<id> — keep the
  // context so Fer reviews exactly the category she just configured.
  const [categoryFilter, setCategoryFilter] = useState<string>(
    () => new URLSearchParams(window.location.search).get("categoria") ?? ""
  );
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  // #289 UX: arriving from Estrategia's bridge, land ON the review list —
  // not above the general-rule cards (operator review finding 1).
  const suggestionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (categoryFilter && suggestionsRef.current) {
      suggestionsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Pre-apply summary (#289): what will change, what is omitted, what needs
  // explicit loss confirmation — nothing writes before Fer sees this.
  const [review, setReview] = useState<{
    safe: PriceUpdate[];
    full: PriceUpdate[];
    pieces: number;
    priceCount: number;
    up: number;
    down: number;
    omitted: number;
    pendingConfirm: number;
  } | null>(null);
  // PO 2026-11-09: applying a below-cost price that comes from a per-product
  // exception needs a CONFIRMATION IN THE MOMENT — a previously configured
  // exception is not standing authorization to sell at a loss today.
  const [confirmBelowCost, setConfirmBelowCost] = useState<{
    full: PriceUpdate[];
    safe: PriceUpdate[];
    exceptionCount: number;
    omitted: number;
  } | null>(null);

  const tiers = useMemo(() => tiersForStore(activeStore), [activeStore]);
  const products = useMemo(
    () => state.products.filter((p) => p.storeId === activeStore?.id),
    [state.products, activeStore?.id]
  );
  const categories = useMemo(
    () => state.categories.filter((c) => c.storeId === activeStore?.id).sort((a, b) => a.name.localeCompare(b.name)),
    [state.categories, activeStore?.id]
  );

  function patchConfig(mutate: (config: PricingRulesConfig) => void) {
    setDraft((current) => {
      const config = cloneConfig(current.config);
      mutate(config);
      return { config, dirty: true };
    });
  }

  async function save() {
    // Adversarial H1: nonsensical increments are refused before persisting.
    for (const [tierId, rule] of Object.entries(draft.config.byTier)) {
      const label = tiers.find((t) => t.id === tierId)?.label ?? tierId;
      if (rule.kind === "markup" && !(rule.percent >= 0)) {
        toast.error(`El porcentaje de ${label} no puede ser negativo.`);
        return;
      }
      if (rule.kind === "fixed" && !(rule.amount >= 0)) {
        toast.error(`El importe fijo de ${label} no puede ser negativo.`);
        return;
      }
    }
    // Bands must be unequivocal before anything persists.
    for (const [tierId, rule] of Object.entries(draft.config.byTier)) {
      if (rule.kind === "bands") {
        const error = validateBands(rule.bands);
        if (error) {
          toast.error(`Bandas de ${tiers.find((t) => t.id === tierId)?.label ?? tierId}: ${error}`);
          return;
        }
      }
    }
    setBusy(true);
    try {
      await savePricingRules(draft.config);
      // Functional update: edits made while saving are preserved, not clobbered
      // by the click-time closure (adversarial H3).
      setDraft((current) => ({ config: cloneConfig(current.config), dirty: false }));
      toast.success("Reglas de venta guardadas.");
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "No se pudieron guardar las reglas.");
    } finally {
      setBusy(false);
    }
  }

  // The suggestions table: current vs suggested per product × level.
  const suggestions = useMemo<SuggestionEntry[]>(() => {
    return products
      .filter((product) => product.cost !== undefined && product.cost !== null)
      .map((product) => {
        const byTier: Record<string, TierSuggestion> = {};
        let applicable = 0;
        let pendingConfirm = 0;
        let omitted = 0;
        let hasSuggestion = false;
        for (const tier of tiers) {
          const resolved = resolveRule(draft.config, tier.id, product);
          const base = baseCostForTier(product, tier.id, activeStore?.packaging);
          const suggested = resolved ? suggestedPriceFor(resolved.rule, { baseCost: base, acquisitionCost: product.cost }) : null;
          const belowCost = suggested != null && base !== undefined && suggested < base;
          let reason = "";
          if (suggested == null) {
            reason = resolved
              ? resolved.rule.kind === "bands"
                ? "costo fuera de la tabla"
                : "falta el costo base"
              : "sin regla para esta pieza";
          } else if (suggested === product.prices?.[tier.id]) {
            reason = "ya está en ese precio";
          } else if (belowCost && resolved?.origin !== "product") {
            reason = "bajo el costo: se omite (excepción de Fer requerida)";
          }
          if (suggested != null) hasSuggestion = true;
          if (suggested != null && suggested !== product.prices?.[tier.id]) {
            if (belowCost && resolved?.origin === "product") pendingConfirm += 1;
            else if (belowCost) omitted += 1;
            else applicable += 1;
          }
          byTier[tier.id] = { suggested, current: product.prices?.[tier.id], base, origin: resolved?.origin ?? "", belowCost, reason };
        }
        return {
          product,
          byTier,
          applicable,
          pendingConfirm,
          omitted,
          eligible: applicable + pendingConfirm > 0,
          hasSuggestion,
          available: product.status !== "archived" && (product.quantityOnHand ?? 0) > 0,
        };
      });
  }, [products, tiers, draft.config, activeStore?.packaging]);

  // #289: scoped to the current category filter, changed pieces first.
  const visible = useMemo(() => {
    const filtered = categoryFilter
      ? suggestions.filter((entry) => entry.product.categoryIds?.includes(categoryFilter))
      : suggestions;
    const rank = (entry: SuggestionEntry) => (entry.eligible ? 0 : entry.hasSuggestion ? 1 : 2);
    return [...filtered].sort(
      (a, b) => rank(a) - rank(b) || a.product.name.localeCompare(b.product.name)
    );
  }, [suggestions, categoryFilter]);

  const selectedCount = visible.filter((entry) => selected[entry.product.id]).length;
  // Bulk selection only touches the CURRENT FILTER's eligible pieces; sold-out
  // and archived enter solely through Fer's explicit opt-in (#289).
  const bulkPool = useMemo(
    () => visible.filter((entry) => entry.eligible && (includeUnavailable || entry.available)),
    [visible, includeUnavailable]
  );
  const allBulkSelected = bulkPool.length > 0 && bulkPool.every((entry) => selected[entry.product.id]);
  const activeTables = Object.keys(activeStore?.pricingRules?.byCategory ?? {}).length;
  const filterCategory: Category | undefined = categories.find((c) => c.id === categoryFilter);

  // #289: scoped writes ONLY — a stale full product object can never clobber
  // stock, cost or photos edited while prices were being reviewed.
  async function runApply(updates: PriceUpdate[], skippedBelowCost: number) {
    setApplying(true);
    try {
      await applyProductPrices(updates);
      setSelected({});
      toast.success(
        skippedBelowCost > 0
          ? `Precios actualizados en ${updates.length} pieza(s); se omitieron ${skippedBelowCost} por quedar bajo el costo.`
          : `Precios actualizados en ${updates.length} pieza(s).`
      );
    } catch (error) {
      if (error instanceof PublicCatalogProjectionError) {
        // Prices DID change; only the public projection failed — honest report.
        setSelected({});
        toast.error("Precios actualizados, pero el catálogo público no se actualizó: usa Republicar catálogo en la tienda.");
      } else {
        toast.error("No se pudo aplicar. Ningún precio cambió: revisa tu conexión e inténtalo de nuevo.");
      }
    } finally {
      setApplying(false);
    }
  }

  function applySelected() {
    const safe: PriceUpdate[] = [];
    const full: PriceUpdate[] = [];
    let up = 0;
    let down = 0;
    let priceCount = 0;
    for (const entry of visible) {
      if (!selected[entry.product.id] || !entry.eligible) continue;
      const safePrices = { ...(entry.product.prices ?? {}) };
      const fullPrices = { ...(entry.product.prices ?? {}) };
      let safeChanged = false;
      let fullChanged = false;
      for (const tier of tiers) {
        const suggestion = entry.byTier[tier.id];
        if (suggestion?.suggested == null || suggestion.suggested === suggestion.current) continue;
        if (suggestion.belowCost && suggestion.origin === "product") {
          fullPrices[tier.id] = suggestion.suggested;
          fullChanged = true;
          continue; // pending explicit loss confirmation
        }
        if (suggestion.belowCost) continue; // refused outright
        safePrices[tier.id] = suggestion.suggested;
        fullPrices[tier.id] = suggestion.suggested;
        safeChanged = true;
        fullChanged = true;
        priceCount += 1;
        if (suggestion.current === undefined || suggestion.suggested > suggestion.current) up += 1;
        else down += 1;
      }
      if (safeChanged) safe.push({ id: entry.product.id, prices: safePrices });
      if (fullChanged) full.push({ id: entry.product.id, prices: fullPrices });
    }
    const omitted = visible
      .filter((entry) => selected[entry.product.id])
      .reduce((acc, entry) => acc + entry.omitted, 0);
    const pendingConfirm = visible
      .filter((entry) => selected[entry.product.id])
      .reduce((acc, entry) => acc + entry.pendingConfirm, 0);
    const pieces = new Set([...safe, ...full].map((update) => update.id)).size;
    if (pieces === 0) {
      toast.error(
        omitted > 0
          ? `Solo había precios sugeridos bajo el costo (${omitted}); no se aplicó nada. Vender con pérdida requiere una excepción por producto.`
          : hasRules(draft.config)
            ? "Las piezas seleccionadas no tienen sugerencias aplicables (mira la razón en cada fila)."
            : "No hay sugerencias porque aún no hay reglas ni tablas: define tu estrategia en Estrategia de precios."
      );
      return;
    }
    setReview({ safe, full, pieces, priceCount, up, down, omitted, pendingConfirm });
  }

  return (
    <Screen>
      <ScreenHeader
        title="Reglas de venta"
        subtitle={
          filterCategory
            ? `Revisando la categoría ${filterCategory.name}: primero las piezas con cambios pendientes`
            : "Cómo se sugiere el precio de cada nivel a partir del costo"
        }
      />
      <div className="space-y-4">
          {!hasRules(draft.config) && (
            <Card className="space-y-2 border border-warning">
              <h3 className="font-semibold text-ink">Todavía no hay reglas ni tablas de precios</h3>
              <p className="text-sm text-on-surface-soft">
                Por eso la lista de abajo no tiene sugerencias: sin reglas no hay nada que sugerir. Lo recomendado es
                definir tus tablas por categoría en Estrategia de precios (usa tus costos y precios reales); las reglas
                generales de abajo son opcionales y sirven de respaldo para categorías sin tabla.
              </p>
              <Button size="sm" onClick={() => navigate("/productos/estrategia")}>
                Ir a Estrategia de precios
              </Button>
            </Card>
          )}
          {hasRules(draft.config) && (
            <p className="text-xs text-on-surface-soft">
              {activeTables > 0
                ? `Hay ${activeTables} tabla(s) de categoría activas en Estrategia de precios: esas categorías ya tienen sugerencias sin que configures nada aquí. `
                : "Sin tablas de categoría todavía. "}
              Las reglas generales de abajo son opcionales (respaldo para categorías sin tabla); una excepción por
              producto gana sobre todo.
            </p>
          )}
          {tiers.map((tier) => (
          <RuleCard
            key={tier.id}
            label={tier.label}
            disabled={busy}
            rule={draft.config.byTier[tier.id]}
            onChange={(rule) =>
              patchConfig((config) => {
                if (rule === null) delete config.byTier[tier.id];
                else config.byTier[tier.id] = rule;
              })
            }
          />
        ))}

        <div className="space-y-2 pb-6">
          <Button full disabled={!draft.dirty || busy} onClick={() => void save()}>
            {busy ? "Guardando…" : draft.dirty ? "Guardar reglas" : "Sin cambios"}
          </Button>
          <p className="text-xs text-on-surface-soft">
            Las sugerencias usan el costo de adquisición más el empaque individual del nivel (el empaque por pedido
            nunca sube el precio). Guardar reglas NO cambia ningún precio: aplicarlos siempre es explícito, abajo.
          </p>
        </div>

        <Card className="space-y-3" >
          <div ref={suggestionsRef} className="flex flex-wrap items-end justify-between gap-2">
            <div className="w-full sm:w-72">
              <SelectField
                label="Categoría a revisar"
                value={categoryFilter}
                onChange={(next) => {
                  setCategoryFilter(next);
                  setSelected({});
                }}
                options={[
                  { value: "", label: "Todas las categorías" },
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={bulkPool.length === 0 || applying || allBulkSelected}
                onClick={() => setSelected(Object.fromEntries(bulkPool.map((entry) => [entry.product.id, true])))}
              >
                Seleccionar elegibles ({bulkPool.length})
              </Button>
              {selectedCount > 0 && (
                <Button size="sm" variant="ghost" disabled={applying} onClick={() => setSelected({})}>
                  Limpiar selección
                </Button>
              )}
              <Button size="sm" disabled={selectedCount === 0 || applying} onClick={applySelected}>
                {applying ? "Aplicando…" : `Aplicar seleccionados (${selectedCount})`}
              </Button>
            </div>
          </div>
          <CheckboxField
            label="Incluir agotadas y archivadas en la selección masiva"
            checked={includeUnavailable}
            onChange={setIncludeUnavailable}
          />
          {visible.length === 0 ? (
            <p className="text-sm text-on-surface-soft">
              {categoryFilter
                ? "No hay piezas con costo en esta categoría."
                : "Captura el costo de compra de tus piezas para ver sugerencias aquí."}
            </p>
          ) : (
            <div className="space-y-2">
              {visible.map(({ product, byTier, eligible }, index) => {
                const previous = visible[index - 1];
                const startsEligible = eligible && (!previous || !previous.eligible);
                const startsInactive = !eligible && hasRules(draft.config) && (!previous || previous.eligible);
                return (
                  <div key={product.id}>
                    {startsEligible && (
                      <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-on-surface-soft">
                        Con cambios pendientes
                      </p>
                    )}
                    {startsInactive && (
                      <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-on-surface-soft">
                        Sin cambios aplicables ahora
                      </p>
                    )}
                    <div className="space-y-1 rounded-lg border border-edge bg-surface px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <CheckboxField
                            label={product.name}
                            checked={!!selected[product.id]}
                            disabled={!eligible}
                            onChange={(next) => setSelected((current) => ({ ...current, [product.id]: next }))}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {product.status === "archived" && <Badge tone="neutral">archivada</Badge>}
                          {(product.quantityOnHand ?? 0) === 0 && <Badge tone="warning">agotada</Badge>}
                          {product.status === "draft" && <Badge tone="neutral">borrador</Badge>}
                          <span className="text-xs text-on-surface-soft">Costo <Money amount={product.cost} /></span>
                        </div>
                      </div>
                      <div className="grid gap-1 sm:grid-cols-3">
                        {tiers.map((tier) => {
                          const s = byTier[tier.id];
                          if (!s) return null; // tier added mid-session: next render catches up
                          return (
                            <p key={tier.id} className="text-xs text-on-surface-soft">
                              <span className="font-semibold text-on-surface">{tier.label}:</span>{" "}
                              {s.current !== undefined ? <>actual <Money amount={s.current} /></> : "sin precio"} →{" "}
                              {s.suggested != null ? <span className={eligible ? "font-semibold text-terracotta" : ""}><Money amount={s.suggested} /></span> : "sin sugerencia"}
                              {s.suggested != null && s.reason ? ` (${s.reason})` : ""}
                              {s.suggested == null && s.reason ? ` (${s.reason})` : ""}
                              {s.origin ? ` · ${s.origin === "product" ? "excepción" : s.origin === "category" ? "categoría" : "regla"}` : ""}
                            </p>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Dialog
        open={review !== null}
        title={review ? `Aplicar precios a ${review.pieces} pieza(s)` : ""}
        onClose={() => setReview(null)}
        footer={
          review ? (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setReview(null)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const pending = review;
                  setReview(null);
                  if (pending.pendingConfirm > 0) {
                    setConfirmBelowCost({
                      full: pending.full,
                      safe: pending.safe,
                      exceptionCount: pending.pendingConfirm,
                      omitted: pending.omitted,
                    });
                    return;
                  }
                  if (pending.safe.length > 0) void runApply(pending.safe, pending.omitted);
                }}
              >
                {review.pendingConfirm > 0 ? "Continuar" : `Aplicar ${review.priceCount} precio(s)`}
              </Button>
            </div>
          ) : undefined
        }
      >
        {review && (
          <div className="space-y-1 text-sm text-on-surface-soft">
            <p>
              {review.priceCount} precio(s) con cambio seguro en {review.pieces} pieza(s): {review.up} subirían,{" "}
              {review.down} bajarían.
            </p>
            {review.omitted > 0 && <p>Se omitirán {review.omitted} precio(s) por quedar bajo el costo.</p>}
            {review.pendingConfirm > 0 && (
              <p>
                Además hay {review.pendingConfirm} precio(s) bajo el costo por excepciones de producto: pedirán tu
                confirmación expresa en el siguiente paso.
              </p>
            )}
            <p>Solo se escriben los precios; existencias, costos y fotos quedan intactos.</p>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmBelowCost !== null}
        tone="danger"
        title={confirmBelowCost ? `${confirmBelowCost.exceptionCount} precio(s) bajo el costo` : ""}
        onClose={() => setConfirmBelowCost(null)}
        footer={
          confirmBelowCost ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setConfirmBelowCost(null)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const pending = confirmBelowCost;
                  setConfirmBelowCost(null);
                  if (pending.safe.length > 0) void runApply(pending.safe, pending.exceptionCount + pending.omitted);
                  else toast.error("No quedó ningún otro precio por aplicar.");
                }}
              >
                Aplicar sin esos {confirmBelowCost.exceptionCount}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  const pending = confirmBelowCost;
                  setConfirmBelowCost(null);
                  void runApply(pending.full, pending.omitted);
                }}
              >
                Aplicar todo (vender bajo costo a propósito)
              </Button>
            </div>
          ) : undefined
        }
      >
        <p className="text-sm text-on-surface-soft">
          Los precios marcados vienen de excepciones por producto y quedarían por debajo de su costo base. Aplicarlos
          es vender con pérdida de forma deliberada; la decisión es tuya, ahora.
        </p>
      </Dialog>
    </Screen>
  );
}

function RuleCard({
  label,
  rule,
  onChange,
  disabled = false,
}: {
  label: string;
  rule: PricingRule | undefined;
  onChange: (rule: PricingRule | null) => void;
  disabled?: boolean;
}) {
  const kind = rule?.kind ?? "markup";
  const rounding: PriceRounding = rule?.rounding ?? "none";
  // Adversarial H2: remember each method's last values so switching methods
  // never silently restores defaults.
  const [last, setLast] = useState<{ percent: number; amount: number }>({ percent: 100, amount: 50 });

  function patchRule(patch: Partial<PricingRule> & { kind?: PricingRule["kind"] }) {
    const nextKind = patch.kind ?? kind;
    setLast((current) => ({
      percent: kind === "markup" ? (rule as { percent?: number } | undefined)?.percent ?? current.percent : current.percent,
      amount: kind === "fixed" ? (rule as { amount?: number } | undefined)?.amount ?? current.amount : current.amount,
    }));
    if (nextKind === "markup") {
      onChange({ kind: "markup", percent: (rule as { percent?: number } | undefined)?.percent ?? last.percent, rounding, ...(patch as object) } as PricingRule);
    } else if (nextKind === "fixed") {
      onChange({ kind: "fixed", amount: (rule as { amount?: number } | undefined)?.amount ?? last.amount, rounding, ...(patch as object) } as PricingRule);
    } else {
      const bands = (rule as { bands?: Array<{ min: number; max?: number; price: number }> } | undefined)?.bands ?? [
        { min: 0, max: 90, price: 0 },
      ];
      onChange({ kind: "bands", bands, rounding, ...(patch as object) } as PricingRule);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">{label}</h3>
        <Badge tone={rule ? "success" : "neutral"}>{rule ? "regla configurada" : "sin regla (opcional)"}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Método"
          disabled={disabled}
          value={kind}
          onChange={(next) => patchRule({ kind: next as PricingRule["kind"] })}
          options={[
            { value: "markup", label: "Porcentaje sobre el costo" },
            { value: "fixed", label: "Importe fijo sobre el costo" },
            { value: "bands", label: "Tabla por bandas de costo" },
          ]}
        />
        <SelectField
          label="Redondeo"
          disabled={disabled}
          value={rounding}
          onChange={(next) => patchRule({ rounding: next as PriceRounding })}
          options={[
            { value: "none", label: "Sin redondeo" },
            { value: "1", label: "Al peso (más cercano)" },
            { value: "5", label: "A $5 (sube)" },
            { value: "10", label: "A $10 (sube)" },
          ]}
        />
      </div>
      {kind === "markup" && (
        <TextField
          label="Porcentaje sobre el costo"
          disabled={disabled}
          inputMode="decimal"
          placeholder="p. ej. 200"
          hint="Ojo: +200% sobre un costo de $100 da un precio de $300 — una ganancia de 66.7% sobre la venta, no 200%."
          value={String((rule as { percent?: number } | undefined)?.percent ?? "")}
          onChange={(e) => {
            const value = e.target.value.replace(/[^\d.]/g, "");
            onChange({ kind: "markup", percent: Number(value) || 0, rounding } as PricingRule);
          }}
        />
      )}
      {kind === "fixed" && (
        <TextField
          label="Importe fijo (pesos sobre el costo)"
          disabled={disabled}
          inputMode="decimal"
          placeholder="p. ej. 50"
          value={String((rule as { amount?: number } | undefined)?.amount ?? "")}
          onChange={(e) => {
            const value = sanitizeMoneyInput(e.target.value);
            onChange({ kind: "fixed", amount: Number(value) || 0, rounding } as PricingRule);
          }}
        />
      )}
      {kind === "bands" && rule?.kind === "bands" && (
        <div className="space-y-2">
          {rule.bands.map((band, index) => {
            return (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <div className="w-24">
                  <TextField
                    label="Desde $"
                    inputMode="decimal"
                    value={String(band.min)}
                    onChange={(e) => {
                      const bands = [...rule.bands];
                      bands[index] = { ...band, min: Number(sanitizeMoneyInput(e.target.value)) || 0 };
                      onChange({ kind: "bands", bands, rounding });
                    }}
                  />
                </div>
                <div className="w-24">
                  <TextField
                    label="Hasta $"
                    inputMode="decimal"
                    placeholder="sin tope"
                    value={band.max !== undefined ? String(band.max) : ""}
                    onChange={(e) => {
                      const bands = [...rule.bands];
                      const max = e.target.value.trim() === "" ? undefined : Number(sanitizeMoneyInput(e.target.value)) || 0;
                      bands[index] = { ...band, ...(max !== undefined ? { max } : {}) };
                      onChange({ kind: "bands", bands, rounding });
                    }}
                  />
                </div>
                <div className="w-28">
                  <TextField
                    label={`Precio ${label}`}
                    inputMode="decimal"
                    value={String(band.price)}
                    onChange={(e) => {
                      const bands = [...rule.bands];
                      bands[index] = { ...band, price: Number(sanitizeMoneyInput(e.target.value)) || 0 };
                      onChange({ kind: "bands", bands, rounding });
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const bands = rule.bands.filter((_, i) => i !== index);
                    onChange({ kind: "bands", bands, rounding });
                  }}
                >
                  Quitar
                </Button>
              </div>
            );
          })}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const last = rule.bands[rule.bands.length - 1];
                const bands = [...rule.bands, { min: last?.max ?? 0, price: 0 }];
                onChange({ kind: "bands", bands, rounding });
              }}
            >
              + Banda
            </Button>
            {rule.bands.length > 0 && validateBands(rule.bands) && (
              <span className="text-xs text-danger">{validateBands(rule.bands)}</span>
            )}
          </div>
          <p className="text-xs text-on-surface-soft">
            La banda la elige el COSTO DE COMPRA de la pieza, no el empaque: un centavo de bolsa nunca cambia de banda
            el precio. Las bandas son [desde, hasta): una pieza que cuesta exactamente el tope entra en la siguiente.
          </p>
        </div>
      )}
      {rule && (
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Quitar regla de {label}
        </Button>
      )}
    </Card>
  );
}
