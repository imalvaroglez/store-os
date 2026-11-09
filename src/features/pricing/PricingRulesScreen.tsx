// #254 — Reglas de venta: Fer defines ONCE how each price level's suggested
// price derives from cost (percentage, fixed increment, or a cost-band table),
// with category and product overrides. Suggestions are PROPOSALS: applying
// them is always an explicit, per-product or batch action — never automatic.
import { useMemo, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
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
import { resolveRule, suggestedPriceFor, baseCostForTier, validateBands } from "../../lib/pricingRules";
import type { PricingRule, PricingRulesConfig, PriceRounding, Product } from "../../types";

function emptyConfig(): PricingRulesConfig {
  return { byTier: {} };
}

function cloneConfig(config: PricingRulesConfig | undefined): PricingRulesConfig {
  return config ? JSON.parse(JSON.stringify(config)) : emptyConfig();
}

type DraftState = { config: PricingRulesConfig; dirty: boolean };

export function PricingRulesScreen() {
  const { state, activeStore, savePricingRules, upsertProduct } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<DraftState>(() => ({ config: cloneConfig(activeStore?.pricingRules), dirty: false }));
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const tiers = useMemo(() => tiersForStore(activeStore), [activeStore]);
  const products = useMemo(
    () => state.products.filter((p) => p.storeId === activeStore?.id),
    [state.products, activeStore?.id]
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
  const suggestions = useMemo(() => {
    return products
      .filter((product) => product.cost !== undefined && product.cost !== null)
      .map((product) => {
        const byTier: Record<string, { suggested: number | null; current: number | undefined; base: number | undefined; origin: string }> = {};
        for (const tier of tiers) {
          const resolved = resolveRule(draft.config, tier.id, product);
          const base = baseCostForTier(product, tier.id, activeStore?.packaging);
          byTier[tier.id] = {
            suggested: resolved ? suggestedPriceFor(resolved.rule, { baseCost: base, acquisitionCost: product.cost }) : null,
            current: product.prices?.[tier.id],
            base,
            origin: resolved?.origin ?? "",
          };
        }
        return { product, byTier };
      });
  }, [products, tiers, draft.config, activeStore?.packaging]);

  const selectedCount = Object.values(selected).filter(Boolean).length;

  async function applySelected() {
    const updates: Array<{ product: Product; prices: Record<string, number> }> = [];
    for (const entry of suggestions) {
      if (!selected[entry.product.id]) continue;
      const nextPrices = { ...(entry.product.prices ?? {}) };
      let changed = false;
      for (const tier of tiers) {
        const suggestion = entry.byTier[tier.id];
        if (suggestion?.suggested != null && suggestion.suggested !== suggestion.current) {
          nextPrices[tier.id] = suggestion.suggested;
          changed = true;
        }
      }
      if (changed) updates.push({ product: entry.product, prices: nextPrices });
    }
    if (updates.length === 0) {
      toast.error("Nada seleccionado con sugerencias distintas al precio actual.");
      return;
    }
    setApplying(true);
    const applied: string[] = [];
    const failed: string[] = [];
    for (const update of updates) {
      try {
        await upsertProduct({ ...update.product, prices: update.prices, updatedAt: new Date().toISOString() });
        applied.push(update.product.name);
      } catch {
        failed.push(update.product.name);
      }
    }
    setApplying(false);
    // Adversarial H4: report what actually applied — a mid-batch failure must
    // not hide the N-1 prices that DID change.
    if (failed.length === 0) {
      setSelected({});
      toast.success(`Precios actualizados en ${applied.length} producto(s).`);
    } else if (applied.length === 0) {
      toast.error("No se pudo aplicar ningún precio. Revisa tu conexión e inténtalo de nuevo.");
    } else {
      toast.error(`Se aplicaron ${applied.length}; fallaron ${failed.length}: ${failed.join(", ")}.`);
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Reglas de venta"
        subtitle="Cómo se sugiere el precio de cada nivel a partir del costo"
      />
      <div className="space-y-4">
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

        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-ink">Precios sugeridos</h2>
            <Button size="sm" disabled={selectedCount === 0 || applying} onClick={() => void applySelected()}>
              {applying ? "Aplicando…" : `Aplicar seleccionados (${selectedCount})`}
            </Button>
          </div>
          {suggestions.length === 0 ? (
            <p className="text-sm text-on-surface-soft">
              Captura el costo de compra de tus piezas para ver sugerencias aquí.
            </p>
          ) : (
            <div className="space-y-2">
              {suggestions.map(({ product, byTier }) => (
                <div key={product.id} className="space-y-1 rounded-lg border border-edge bg-surface px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <CheckboxField
                        label={product.name}
                        checked={!!selected[product.id]}
                        onChange={(next) => setSelected((current) => ({ ...current, [product.id]: next }))}
                      />
                    </div>
                    <span className="text-xs text-on-surface-soft">Costo <Money amount={product.cost} /></span>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-3">
                    {tiers.map((tier) => {
                      const s = byTier[tier.id];
                      return (
                        <p key={tier.id} className="text-xs text-on-surface-soft">
                          <span className="font-semibold text-on-surface">{tier.label}:</span>{" "}
                          {s.current !== undefined ? <>actual <Money amount={s.current} /></> : "sin precio"} →{" "}
                          {s.suggested != null ? <span className="font-semibold text-terracotta"><Money amount={s.suggested} /></span> : "sin sugerencia"}
                          {s.origin ? ` (${s.origin === "product" ? "excepción" : s.origin === "category" ? "categoría" : "regla"})` : ""}
                        </p>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
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
        <Badge tone={rule ? "success" : "neutral"}>{rule ? "regla configurada" : "sin regla"}</Badge>
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
