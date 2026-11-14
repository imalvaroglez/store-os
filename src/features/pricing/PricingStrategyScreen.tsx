// #280 — Estrategia de precios: analyze one category's real costs, propose an
// explainable band table (limits + Iconic/Girly/Regular prices), let Fer edit
// it, and save ONLY that category's rules — transactionally, so other
// categories, level rules and product exceptions are never touched. Applying
// prices to products stays in Reglas de venta; this screen never edits prices.
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, CategoryRulesConflictError } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  Disclosure,
  Dialog,
  Money,
  Screen,
  ScreenHeader,
  SelectField,
  TextField,
  useToast,
} from "../../design-system";
import { navigate } from "../../lib/router";
import { tiersForStore } from "../../lib/pricing";
import { parseAmount, sanitizeMoneyInput } from "../../lib/money";
import { resolveRule, suggestedPriceFor, baseCostForTier, validateBands, rulesSignature } from "../../lib/pricingRules";
import {
  analyzeCategory,
  packagingConfigured,
  packagingGaps,
  proposeCategoryBands,
  tierEvidence,
  type BandProposal,
  type PriceSupport,
} from "../../lib/pricingBands";
import type { PricingRule, Product } from "../../types";

// The editor's model: ONE table per category with SHARED limits and one price
// column per level — serialized into three `bands` rules on save.
type TableDraft = {
  limits: Array<{ min: number; max?: number }>;
  prices: Record<string, Array<number | null>>; // tierId -> price per band
  dirty: boolean;
};

const SUPPORT_LABEL: Record<string, string> = { high: "soporte alto", medium: "soporte medio", low: "soporte bajo" };
const EVIDENCE_LABEL = {
  orders: "canal con más pedidos en el mix GLOBAL de la tienda (no prueba la demanda de esta categoría)",
  prices: "respaldado solo por los precios actuales de la categoría",
  reference: "referencia, pendiente de validar en puntos físicos",
} as const;
const SUPPORT_HINT: Record<PriceSupport, string> = {
  strong: "sólido",
  weak: "poco respaldado",
  pending: "pendiente: sin evidencia",
};

export function PricingStrategyScreen() {
  const { state, activeStore, saveCategoryPricingRules } = useStore();
  const toast = useToast();
  const [categoryId, setCategoryId] = useState<string>("");
  const [draft, setDraft] = useState<TableDraft | null>(null);
  const [draftBase, setDraftBase] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);

  const tiers = useMemo(() => tiersForStore(activeStore), [activeStore]);
  const categories = useMemo(
    () => state.categories.filter((c) => c.storeId === activeStore?.id && c.active).sort((a, b) => a.name.localeCompare(b.name)),
    [state.categories, activeStore?.id]
  );
  const products = useMemo(
    () => state.products.filter((p) => p.storeId === activeStore?.id),
    [state.products, activeStore?.id]
  );

  const analysis = useMemo(
    () => (categoryId ? analyzeCategory(products, categoryId, tiers) : null),
    [products, categoryId, tiers]
  );
  const proposal = useMemo(
    () =>
      categoryId
        ? proposeCategoryBands({ products, categoryId, tiers, packaging: activeStore?.packaging })
        : null,
    [products, categoryId, tiers, activeStore?.packaging]
  );

  // Existing saved rules for the category — compatible when every visible tier
  // carries a bands rule with IDENTICAL limits (what this editor writes).
  const existing = useMemo(() => {
    if (!categoryId) return null;
    const byCategory = activeStore?.pricingRules?.byCategory?.[categoryId];
    if (!byCategory) return null;
    const bandsByTier = tiers.map((tier) => {
      const rule = byCategory[tier.id];
      return { tier, rule };
    });
    const allBands = bandsByTier.filter((e) => e.rule?.kind === "bands");
    if (bandsByTier.length === 0 || allBands.length !== bandsByTier.length) {
      return { compatible: false as const, byCategory };
    }
    const signature = (rule: PricingRule) =>
      rule.kind === "bands" ? JSON.stringify(rule.bands.map((b) => [b.min, b.max])) : "";
    const shared = signature(bandsByTier[0].rule!);
    if (!bandsByTier.every((e) => signature(e.rule!) === shared)) {
      return { compatible: false as const, byCategory };
    }
    const bands = (bandsByTier[0].rule as { bands: Array<{ min: number; max?: number; price: number }> }).bands;
    return {
      compatible: true as const,
      draft: {
        limits: bands.map((b) => ({ min: b.min, max: b.max })),
        // Each tier's prices come from ITS OWN bands — never from the first
        // tier's rule (e2e caught the cross-tier leak: Iconic loading Regular's
        // prices after a reload).
        prices: Object.fromEntries(
          tiers.map((t) => {
            const rule = byCategory[t.id];
            return [t.id, rule?.kind === "bands" ? rule.bands.map((b) => b.price) : bands.map(() => null)];
          })
        ),
        dirty: false,
      } as TableDraft,
    };
  }, [categoryId, activeStore?.pricingRules, tiers]);

  // Concurrency: the saved table changed under a dirty draft (another session).
  const savedSignature = useMemo(
    () => (categoryId ? rulesSignature(activeStore?.pricingRules?.byCategory?.[categoryId] ?? null) : ""),
    [categoryId, activeStore?.pricingRules]
  );
  const concurrentChange = !!draft?.dirty && savedSignature !== draftBase;

  function loadFromProposal(bands: BandProposal[] | null) {
    if (!bands || bands.length === 0) {
      setDraft(null);
      return;
    }
    setDraft({
      limits: bands.map((b) => ({ min: b.min, max: b.max })),
      prices: Object.fromEntries(tiers.map((t) => [t.id, bands.map((b) => b.prices[t.id] ?? null)])),
      dirty: false,
    });
  }

  // UX operadora #3: choosing a category is the big decision — take Fer to
  // the analysis/proposal, not the top of the page.
  const proposalRef = useRef<HTMLDivElement>(null);
  function adopt(categoryIdNext: string) {
    setCategoryId(categoryIdNext);
    setReplaceExisting(false);
    // Draft re-adoption on category switch is driven by the effect below.
    setDraft(null);
    setDraftBase("");
    if (categoryIdNext) requestAnimationFrame(() => proposalRef.current?.scrollIntoView?.({ behavior: "smooth" }));
  }

  // Adopt the saved table (when compatible) or start from the proposal card.
  // A DIRTY draft is never clobbered here — concurrent saves surface through
  // the banner instead (and the transactional save keeps them safe).
  useEffect(() => {
    if (!categoryId) return;
    if (draft?.dirty) return;
    if (existing?.compatible) setDraft(existing.draft);
    setDraftBase(savedSignature);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, savedSignature]);

  // The serialized rules this draft will save (also drives the impact preview).
  // Rules for tiers that are currently HIDDEN ride along untouched — hiding a
  // level must not silently delete its saved table.
  const serialized: Record<string, PricingRule> | null = useMemo(() => {
    if (!draft || draft.limits.length === 0) return null;
    const rules: Record<string, PricingRule> = {};
    for (const tier of tiers) {
      const prices = draft.prices[tier.id] ?? [];
      rules[tier.id] = {
        kind: "bands",
        bands: draft.limits.map((limit, index) => ({
          min: limit.min,
          ...(limit.max !== undefined ? { max: limit.max } : {}),
          price: prices[index] ?? 0,
        })),
        rounding: "none",
      };
    }
    const saved = activeStore?.pricingRules?.byCategory?.[categoryId ?? ""];
    const visible = new Set(tiers.map((t) => t.id));
    for (const [tierId, rule] of Object.entries(saved ?? {})) {
      if (!visible.has(tierId)) rules[tierId] = rule;
    }
    return rules;
  }, [draft, tiers, activeStore?.pricingRules, categoryId]);

  const limitError = useMemo(() => {
    if (!draft) return null;
    return validateBands(draft.limits.map((l) => ({ min: l.min, max: l.max, price: 1 })));
  }, [draft]);

  const pendingPrices = useMemo(() => {
    if (!draft) return [];
    return tiers.filter((tier) => (draft.prices[tier.id] ?? []).some((p) => p === null || p === undefined || !(p > 0)));
  }, [draft, tiers]);

  // #289: the config Reglas will ACTUALLY resolve once this table is saved —
  // saved rules with this category's table overlaid. The impact preview and
  // the bridge count both use it, so what Estrategia simulates is exactly
  // what Reglas will offer (secondary categories and byProduct exceptions
  // included).
  const previewConfig = useMemo(() => {
    const base = activeStore?.pricingRules
      ? (JSON.parse(JSON.stringify(activeStore.pricingRules)) as NonNullable<typeof activeStore.pricingRules>)
      : { byTier: {} as Record<string, PricingRule> };
    if (!categoryId || !serialized) return base;
    base.byCategory = { ...(base.byCategory ?? {}), [categoryId]: serialized };
    return base;
  }, [activeStore?.pricingRules, categoryId, serialized]);

  // Pieces of this category (any position) whose prices would change under
  // previewConfig — the number the bridge button carries into Reglas.
  const pendingReviewCount = useMemo(() => {
    if (!categoryId) return 0;
    return products.filter((p) => {
      if (!p.categoryIds?.includes(categoryId)) return false;
      if (typeof p.cost !== "number" || p.cost <= 0) return false;
      return tiers.some((tier) => {
        const resolved = resolveRule(previewConfig, tier.id, p);
        if (!resolved) return false;
        const base = baseCostForTier(p, tier.id, activeStore?.packaging);
        const suggested = suggestedPriceFor(resolved.rule, { baseCost: base, acquisitionCost: p.cost });
        return suggested != null && suggested !== p.prices?.[tier.id];
      });
    }).length;
  }, [products, categoryId, tiers, previewConfig, activeStore?.packaging]);

  function patchDraft(mutate: (draft: TableDraft) => void) {
    setDraft((current) => {
      if (!current) return current;
      const next: TableDraft = JSON.parse(JSON.stringify(current));
      mutate(next);
      next.dirty = true;
      return next;
    });
  }

  function setLimit(index: number, field: "min" | "max", raw: string) {
    const value = parseAmount(sanitizeMoneyInput(raw));
    patchDraft((next) => {
      if (field === "max") {
        const max = raw.trim() === "" ? undefined : value ?? 0;
        next.limits[index] = { min: next.limits[index].min, ...(max !== undefined ? { max } : {}) };
        // Contiguity: the next band's min IS this band's max.
        if (index + 1 < next.limits.length && max !== undefined) next.limits[index + 1].min = max;
      } else if (index > 0 && value !== undefined) {
        next.limits[index].min = value;
        if (next.limits[index - 1]) next.limits[index - 1].max = value;
      }
    });
  }

  function setPrice(tierId: string, index: number, raw: string) {
    const value = parseAmount(sanitizeMoneyInput(raw));
    patchDraft((next) => {
      const list = next.prices[tierId] ?? [];
      list[index] = value === undefined ? null : value;
      next.prices[tierId] = list;
    });
  }

  function addBand() {
    patchDraft((next) => {
      const last = next.limits[next.limits.length - 1];
      if (!last) {
        // Empty table (every band was removed): restart from a single open
        // band instead of dead-ending the editor.
        next.limits = [{ min: 0 }];
        for (const tier of tiers) next.prices[tier.id] = [null];
        return;
      }
      const previousMax = last.max ?? Math.max(100, Math.ceil((last.min + 100) / 50) * 50);
      last.max = previousMax;
      next.limits.push({ min: previousMax });
      for (const tier of tiers) {
        const list = next.prices[tier.id] ?? [];
        list.push(list[list.length - 1] ?? null);
        next.prices[tier.id] = list;
      }
    });
  }

  function removeBand(index: number) {
    patchDraft((next) => {
      next.limits = next.limits.filter((_, i) => i !== index);
      for (const tier of tiers) {
        next.prices[tier.id] = (next.prices[tier.id] ?? []).filter((_, i) => i !== index);
      }
      if (next.limits.length === 0) return;
      if (index === 0) {
        // The following band becomes the first: it must open at $0.
        next.limits[0].min = 0;
      } else if (index === next.limits.length) {
        // The removed band was last: its predecessor becomes the open band.
        delete next.limits[next.limits.length - 1].max;
      } else {
        // Middle band: its predecessor absorbs the range (contiguity).
        next.limits[index - 1].max = next.limits[index].min;
      }
    });
  }

  function splitBand(index: number) {
    // Data-driven cut: the midpoint of this band's member costs (defaults to
    // +50% of min for an empty band) — Fer adjusts before saving. Members are
    // matched by COST RANGE, not by proposal index: removeBand/addBand shift
    // indices and would otherwise pick the wrong band's pieces.
    patchDraft((next) => {
      const band = next.limits[index];
      if (!band) return;
      const inBand = (proposal?.bands ?? []).flatMap((b) => b.members.map((m) => m.cost)).filter(
        (c) => c > 0 && c >= band.min && (band.max === undefined || c < band.max)
      );
      const cut =
        inBand.length > 0
          ? Math.round(((Math.min(...inBand) + Math.max(...inBand)) / 2) * 100) / 100
          : Math.round((band.min + 50) * 100) / 100;
      if (!(cut > band.min) || (band.max !== undefined && !(cut < band.max))) return;
      const nextBand = { min: cut, ...(band.max !== undefined ? { max: band.max } : {}) };
      band.max = cut;
      next.limits.splice(index + 1, 0, nextBand);
      for (const tier of tiers) {
        const list = next.prices[tier.id] ?? [];
        list.splice(index + 1, 0, list[index] ?? null);
        next.prices[tier.id] = list;
      }
    });
  }

  async function save() {
    if (!categoryId || !draft || !serialized) return;
    if (limitError) {
      toast.error(`Límites: ${limitError}`);
      return;
    }
    if (pendingPrices.length > 0) {
      toast.error(`Completa los precios pendientes de ${pendingPrices.map((t) => t.label).join(", ")}.`);
      return;
    }
    setBusy(true);
    try {
      await saveCategoryPricingRules(categoryId, serialized, draftBase);
      setDraft((current) => (current ? { ...current, dirty: false } : current));
      setDraftBase(rulesSignature(serialized));
      setReplaceExisting(false);
      toast.success("Tabla guardada. Los precios de tus productos no cambiaron.");
    } catch (error) {
      // P0-2: a same-category concurrent edit REFUSES the save (nothing is
      // lost); the banner below then offers to reload the fresh table.
      if (error instanceof CategoryRulesConflictError) {
        toast.error(error.message);
        return;
      }
      toast.error(error instanceof Error && error.message ? error.message : "No se pudo guardar la tabla.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!categoryId) return;
    setBusy(true);
    try {
      await saveCategoryPricingRules(categoryId, null, draftBase);
      setDraft(null);
      setDraftBase("");
      toast.success("Tabla eliminada.");
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "No se pudo eliminar la tabla.");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Estrategia de precios"
        subtitle="Tablas por categoría: rangos de costo con precios Iconic, Girly y Regular"
        action={
          <Button variant="ghost" size="sm" onClick={() => navigate("/productos/diagnostico")}>Diagnóstico</Button>
        }
      />
      <div className="space-y-4">
        <Card className="space-y-3">
          <SelectField
            label="Categoría"
            value={categoryId}
            onChange={(next) => adopt(next)}
            options={[
              { value: "", label: "Elige una categoría…" },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <div ref={proposalRef} />
          {categoryId && analysis && (
            <div className="space-y-1 text-sm text-on-surface-soft">
              <p>
                <span className="font-semibold text-on-surface">{analysis.skuCount} piezas</span> en la categoría ·{" "}
                {analysis.withCost} con costo confiable · {analysis.unitsOnHand} unidades disponibles ·{" "}
                {analysis.soldOut} agotadas.
              </p>
              {analysis.costMedian !== undefined && (
                <p>
                  La mitad cuesta menos de <Money amount={analysis.costMedian} /> · entre <Money amount={analysis.costMin ?? 0} /> y{" "}
                  <Money amount={analysis.costMax ?? 0} /> · {analysis.distinctCosts} costos distintos.
                </p>
              )}
              {analysis.withoutCost > 0 && (
                <p className="text-danger">
                  {analysis.withoutCost} piezas sin costo confiable quedan fuera (nunca reciben precio inventado).
                </p>
              )}
              {(() => {
                // UX operadora #2: three identical red lines are noise — one
                // clear line when NO level is configured; keep per-tier detail
                // only for the mixed cases (some configured, some missing costs).
                const unconfigured = tiers.filter((t) => !packagingConfigured(activeStore?.packaging, t.id));
                const withGaps = tiers
                  .map((t) => ({ tier: t, gaps: packagingGaps(activeStore?.packaging, t.id) }))
                  .filter((entry) => entry.gaps.length > 0);
                if (unconfigured.length === tiers.length && withGaps.length === 0) {
                  return (
                    <p className="text-danger">
                      Empaques individuales sin configurar: el costo base es solo adquisición (contribuciones
                      preliminares). Configúralo en Productos → Empaques.
                    </p>
                  );
                }
                return (
                  <>
                    {unconfigured.length > 0 && unconfigured.length < tiers.length && (
                      <p className="text-danger">
                        Empaque individual sin configurar en: {unconfigured.map((t) => t.label).join(", ")} — costo
                        base preliminar (solo adquisición).
                      </p>
                    )}
                    {withGaps.map(({ tier, gaps }) => (
                      <p key={tier.id} className="text-danger">
                        Costo base de {tier.label} incompleto: faltan costos de empaque ({gaps.join(", ")}).
                      </p>
                    ))}
                  </>
                );
              })()}
            </div>
          )}
        </Card>

        {categoryId && existing && !existing.compatible && !replaceExisting && (
          <Card className="space-y-2">
            <h3 className="font-semibold text-ink">Esta categoría ya tiene reglas que este editor no puede mostrar</h3>
            <p className="text-sm text-on-surface-soft">
              Hay reglas por nivel que no son tablas de bandas compartidas (o sus límites difieren entre niveles). No
              se sobrescriben en silencio: puedes verlas en Reglas de venta, o reemplazarlas por la propuesta de aquí.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => navigate("/productos/reglas")}>
                Ver en Reglas de venta
              </Button>
              <Button size="sm" onClick={() => { loadFromProposal(proposal?.bands ?? null); setReplaceExisting(true); }}>
                Reemplazar con la propuesta
              </Button>
            </div>
          </Card>
        )}

        {categoryId && proposal && !draft && !existing?.compatible && !replaceExisting && (
          <Card className="space-y-2">
            {proposal.bands ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink">Propuesta</h3>
                  <Badge tone={proposal.support === "high" ? "success" : proposal.support === "medium" ? "info" : "warning"}>
                    {SUPPORT_LABEL[proposal.support]}
                  </Badge>
                </div>
                <p className="text-sm text-on-surface-soft">{proposal.supportReason}</p>
                <p className="text-sm text-on-surface-soft">{proposal.chosenReason}</p>
                <Disclosure label={`Por qué ${proposal.bands.length} banda(s) y no otra cantidad`}>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-on-surface-soft">
                    {proposal.kSummary.map((option) => (
                      <li key={option.k}>
                        {option.k} banda(s): {option.reason}
                        {option.status === "chosen" ? " — elegida." : "."}
                      </li>
                    ))}
                  </ul>
                </Disclosure>
                {proposal.warnings.map((warning) => (
                  <p key={warning} className="text-sm text-danger">{warning}</p>
                ))}
                <Button size="sm" onClick={() => loadFromProposal(proposal.bands)}>Editar esta propuesta</Button>
              </>
            ) : (
              <p className="text-sm text-on-surface-soft">{proposal.supportReason}</p>
            )}
          </Card>
        )}

        {concurrentChange && (
          <Card className="space-y-2 border border-warning">
            <p className="text-sm text-on-surface">
              Las reglas de esta categoría cambiaron en otra sesión mientras editabas. Tu guardado solo tocaría esta
              categoría, pero conviene revisar antes de continuar.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                // Rebuild directly from the CURRENT saved state — the adopt
                // effect won't re-run (its deps didn't change) and leaving
                // draft null would dead-end the editor.
                setDraft(existing?.compatible ? existing.draft : null);
                setDraftBase(savedSignature);
              }}
            >
              Descartar mis cambios y recargar
            </Button>
          </Card>
        )}

        {draft && (
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-ink">Tabla de bandas</h3>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => loadFromProposal(proposal?.bands ?? null)}>
                  Restaurar propuesta
                </Button>
                <Button size="sm" variant="ghost" onClick={addBand}>+ Banda</Button>
              </div>
            </div>
            {limitError && <p className="text-sm text-danger">{limitError}</p>}
            <div className="space-y-3">
              {draft.limits.map((limit, index) => (
                <div key={index} className="space-y-2 rounded-lg border border-edge bg-surface px-3 py-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-24">
                      <TextField
                        label="Desde $"
                        inputMode="decimal"
                        disabled={index === 0}
                        hint={index === 0 ? "la primera banda abre en $0" : undefined}
                        value={index === 0 ? "0" : String(limit.min)}
                        onChange={(e) => setLimit(index, "min", e.target.value)}
                      />
                    </div>
                    <div className="w-24">
                      <TextField
                        label="Hasta $"
                        inputMode="decimal"
                        placeholder="sin tope"
                        value={limit.max !== undefined ? String(limit.max) : ""}
                        onChange={(e) => setLimit(index, "max", e.target.value)}
                      />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => splitBand(index)}>Dividir</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeBand(index)}>Quitar</Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {tiers.map((tier) => {
                      const value = draft.prices[tier.id]?.[index];
                      const support = proposal?.bands?.[index]?.priceSupport[tier.id];
                      return (
                        <TextField
                          key={tier.id}
                          label={`${tier.label} (pesos)`}
                          inputMode="decimal"
                          error={value === null || value === undefined || !(value > 0) ? "Precio pendiente" : undefined}
                          hint={support ? `Mediana actual, ${SUPPORT_HINT[support]} · ${tier.label}: ${EVIDENCE_LABEL[tierEvidence(tier.label)]}` : undefined}
                          value={value === null || value === undefined ? "" : String(value)}
                          onChange={(e) => setPrice(tier.id, index, e.target.value)}
                        />
                      );
                    })}
                  </div>
                  {proposal?.bands?.[index] && draft.limits.length === proposal.bands.length && (
                    <p className="text-xs text-on-surface-soft">
                      Contribución mínima en la banda (con la pieza más cara, empaque individual incluido):{" "}
                      {tiers
                        .map((t) => {
                          const contribution = proposal.bands![index].minContribution[t.id];
                          const preliminary =
                            packagingGaps(activeStore?.packaging, t.id).length > 0 ||
                            !packagingConfigured(activeStore?.packaging, t.id);
                          const value = contribution === null || contribution === undefined ? "—" : `$${contribution}`;
                          return `${t.label} ${value}${preliminary ? " (preliminar: falta costo de empaque)" : ""}`;
                        })
                        .join(" · ")}
                    </p>
                  )}
                  {proposal?.bands?.[index] && draft.limits.length === proposal.bands.length && proposal.bands[index].belowCost.length ? (
                    <div className="rounded-lg border border-danger bg-surface px-3 py-2 text-xs">
                      <p className="font-semibold text-danger">
                        {proposal.bands[index].belowCost.length} pieza(s) quedarían con precio sugerido bajo su costo base:
                      </p>
                      <ul className="list-disc pl-5 text-on-surface-soft">
                        {proposal.bands[index].belowCost.map(({ member, tiers: below }) => (
                          <li key={member.id}>
                            {member.name} — costo <Money amount={member.cost} /> · {member.inStock ? "con existencia" : "agotada"} ·{" "}
                            {below.map((b) => `${tiers.find((t) => t.id === b.tierId)?.label ?? b.tierId} $${b.price}`).join(", ")}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-on-surface-soft">
                        No se subió el precio de toda la banda para taparlas: decide una excepción por producto o un ajuste puntual con Fer.
                        {tiers.some((t) => !packagingConfigured(activeStore?.packaging, t.id) || packagingGaps(activeStore?.packaging, t.id).length > 0)
                          ? " El costo base aún no incluye empaques sin configurar: esta lista puede crecer al completarlos."
                          : ""}
                      </p>
                    </div>
                  ) : null}
                  {proposal?.bands?.[index] && draft.limits.length === proposal.bands.length && (
                    <BandMembers band={proposal.bands[index]} tiers={tiers} serialized={serialized} packaging={activeStore?.packaging} />
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-on-surface-soft">
              Las bandas eligen por el costo de compra de la pieza, en rangos [desde, hasta): una pieza que cuesta
              exactamente el tope entra en la siguiente. Guardar la tabla NO cambia ningún precio.
            </p>
            <div className="space-y-2 pb-2">
              <Button full disabled={!draft.dirty || busy || !!limitError || pendingPrices.length > 0} onClick={() => void save()}>
                {busy ? "Guardando…" : draft.dirty ? "Guardar tabla" : "Sin cambios"}
              </Button>
              {existing && (
                <Button full variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  Quitar tabla de esta categoría
                </Button>
              )}
            </div>
          </Card>
        )}

        {categoryId && draft && serialized && <ImpactPreview products={products} categoryId={categoryId} tiers={tiers} config={previewConfig} packaging={activeStore?.packaging} />}

        {categoryId && existing?.compatible && pendingReviewCount > 0 && (
          <Card className="space-y-2 border border-terracotta">
            <p className="text-sm text-on-surface">
              <span className="font-semibold">Siguiente paso:</span> {pendingReviewCount} pieza(s) de esta categoría
              tienen precios sugeridos distintos a los actuales.
            </p>
            <Button size="sm" onClick={() => navigate(`/productos/reglas?categoria=${categoryId}`)}>
              Revisar precios pendientes de esta categoría ({pendingReviewCount})
            </Button>
          </Card>
        )}
        {categoryId && (
          <Card className="space-y-2">
            {activeStore?.pricingRules?.byCategory?.[categoryId] ? (
              <>
                <p className="text-sm text-on-surface">
                  <span className="font-semibold">Tabla activa:</span> las sugerencias de esta categoría ya aparecen
                  pieza por pieza en Reglas de venta (verás "categoría" como origen). Revisa los cambios, selecciona y
                  aplica ahí — nunca automáticamente.
                </p>
                <Button size="sm" onClick={() => navigate("/productos/reglas")}>
                  Ver y aplicar sugerencias en Reglas de venta
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-on-surface-soft">
                  Guarda la tabla de esta categoría y sus sugerencias aparecerán pieza por pieza en Reglas de venta,
                  listas para revisar y aplicar cuando tú decidas.
                </p>
                <Button size="sm" variant="secondary" onClick={() => navigate("/productos/reglas")}>
                  Ir a Reglas de venta
                </Button>
              </>
            )}
          </Card>
        )}
      </div>

      <Dialog
        open={confirmDelete}
        tone="danger"
        title="¿Quitar la tabla de esta categoría?"
        onClose={() => setConfirmDelete(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>Quitar tabla</Button>
          </div>
        }
      >
        <p className="text-sm text-on-surface-soft">
          Se elimina la tabla guardada; los precios de los productos no cambian. Las reglas de otras categorías y las
          excepciones por producto se quedan.
        </p>
      </Dialog>
    </Screen>
  );
}

/** Which products fall in this band + how their price would change if the
 * DRAFT table were adopted (current → suggested per level, read-only). */
function BandMembers({
  band,
  tiers,
  serialized,
  packaging,
}: {
  band: BandProposal;
  tiers: Array<{ id: string; label: string }>;
  serialized: Record<string, PricingRule> | null;
  packaging: Parameters<typeof baseCostForTier>[2];
}) {
  if (band.members.length === 0) return null;
  return (
    <Disclosure label={`Piezas en esta banda (${band.members.length})`}>
      <div className="space-y-1">
        {band.members.map((member) => (
          <div key={member.id} className="rounded-lg border border-edge bg-surface px-3 py-2 text-xs text-on-surface-soft">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate font-semibold text-on-surface">{member.name}</span>
              <span>costo <Money amount={member.cost} /></span>
            </div>
            <div className="grid gap-1 sm:grid-cols-3">
              {tiers.map((tier) => {
                const current = member.currentPrices[tier.id];
                const suggested =
                  serialized?.[tier.id] && member.cost !== undefined
                    ? suggestedPriceFor(serialized[tier.id], {
                        baseCost: baseCostForTier({ cost: member.cost }, tier.id, packaging),
                        acquisitionCost: member.cost,
                      })
                    : null;
                return (
                  <p key={tier.id}>
                    <span className="font-semibold text-on-surface">{tier.label}:</span>{" "}
                    {current !== undefined ? <Money amount={current} /> : "sin precio"} →{" "}
                    {suggested != null ? (
                      <span className={suggested !== current ? "font-semibold text-terracotta" : ""}>
                        <Money amount={suggested} />
                      </span>
                    ) : (
                      "sin sugerencia"
                    )}
                  </p>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Disclosure>
  );
}

/** Read-only scenario: how many pieces would change (up/down) per level if the
 * draft table were adopted, SPLIT by stock (historical catalog vs sellable
 * inventory, P1) and surfacing which pieces would land under their full base
 * cost (P0-1). Not a projection of future profit. */
function emptyImpact() {
  return {
    up: 0,
    upInStock: 0,
    down: 0,
    downInStock: 0,
    same: 0,
    noSuggestion: 0,
    belowCost: 0,
    belowCostInStock: 0,
    belowCostList: [] as Array<{ id: string; name: string; cost: number; inStock: boolean; price: number; base: number }>,
  };
}

function ImpactPreview({
  products,
  categoryId,
  tiers,
  config,
  packaging,
}: {
  products: Product[];
  categoryId: string;
  tiers: Array<{ id: string; label: string }>;
  config: Parameters<typeof resolveRule>[0];
  packaging: Parameters<typeof baseCostForTier>[2];
}) {
  const impact = useMemo(() => {
    // Any category position counts (that is how resolveRule matches), and
    // suggestions resolve against the FULL config — a byProduct exception or a
    // byTier fallback shows here exactly as Reglas will apply it.
    const members = products.filter(
      (p): p is Product & { cost: number } => !!p.categoryIds?.includes(categoryId) && typeof p.cost === "number" && p.cost > 0
    );
    let exceptions = 0;
    const byTier = Object.fromEntries(
      tiers.map((tier): [string, ReturnType<typeof emptyImpact>] => {
        const impact = emptyImpact();
        for (const product of members) {
          const inStock = (product.quantityOnHand ?? 0) > 0;
          const current = product.prices?.[tier.id];
          const base = baseCostForTier(product, tier.id, packaging);
          const resolved = resolveRule(config, tier.id, product);
          if (resolved?.origin === "product") exceptions += 1;
          const suggested = resolved ? suggestedPriceFor(resolved.rule, { baseCost: base, acquisitionCost: product.cost }) : null;
          if (suggested == null) {
            impact.noSuggestion += 1;
            continue;
          }
          if (base !== undefined && suggested < base) {
            impact.belowCost += 1;
            if (inStock) impact.belowCostInStock += 1;
            impact.belowCostList.push({ id: product.id, name: product.name, cost: product.cost, inStock, price: suggested, base });
          }
          if (current === undefined || suggested > current) {
            impact.up += 1;
            if (inStock) impact.upInStock += 1;
          } else if (suggested < current) {
            impact.down += 1;
            if (inStock) impact.downInStock += 1;
          } else impact.same += 1;
        }
        impact.belowCostList.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
        return [tier.id, impact];
      })
    );
    return { total: members.length, byTier, exceptions };
  
  }, [products, categoryId, tiers, config, packaging]);

  if (impact.total === 0) return null;
  return (
    <Card className="space-y-2">
      <h3 className="font-semibold text-ink">Si adoptaras esta tabla (escenario, no proyección)</h3>
      <p className="text-sm text-on-surface-soft">
        {impact.total} piezas con costo en la categoría (histórico completo; la cifra "en existencia" es el inventario
        vendible de hoy):
      </p>
      <div className="grid gap-1 sm:grid-cols-3">
        {tiers.map((tier) => {
          const t = impact.byTier[tier.id];
          return (
            <p key={tier.id} className="text-xs text-on-surface-soft">
              <span className="font-semibold text-on-surface">{tier.label}:</span> {t.up} subirían ({t.upInStock} en
              existencia) · {t.down} bajarían ({t.downInStock} en existencia) · {t.same} iguales · {t.noSuggestion} sin
              sugerencia
            </p>
          );
        })}
      </div>
      {tiers.some((tier) => impact.byTier[tier.id].belowCost > 0) && (
        <div className="rounded-lg border border-danger px-3 py-2 text-xs">
          <p className="font-semibold text-danger">
            Piezas cuyo precio sugerido queda BAJO su costo base ({tiers.reduce((acc, t) => acc + impact.byTier[t.id].belowCost, 0)} precio(s),{" "}
            {tiers.reduce((acc, t) => acc + impact.byTier[t.id].belowCostInStock, 0)} en piezas con existencia):
          </p>
          {tiers.some((t) => !packagingConfigured(packaging, t.id) || packagingGaps(packaging, t.id).length > 0) && (
            <p className="text-on-surface-soft">El costo base aún no incluye empaques sin configurar: esta lista puede crecer al completarlos.</p>
          )}
          <ul className="list-disc pl-5 text-on-surface-soft">
            {tiers.flatMap((tier) =>
              impact.byTier[tier.id].belowCostList.map((piece) => (
                <li key={`${tier.id}-${piece.id}`}>
                  {piece.name} — {tier.label} ${piece.price} vs costo base ${piece.base} · {piece.inStock ? "con existencia" : "agotada"}
                </li>
              ))
            )}
          </ul>
          <p className="mt-1 text-on-surface-soft">
            Vender con pérdida requiere decisión explícita: al aplicar precios en Reglas de venta estas sugerencias se
            omiten solas (salvo excepción por producto).
          </p>
        </div>
      )}
      {impact.exceptions > 0 && (
        <p className="text-xs text-on-surface-soft">
          {impact.exceptions} sugerencia(s) vienen de excepciones por producto (ganán a la tabla y requerirán tu
          confirmación expresa al aplicar).
        </p>
      )}
      <p className="text-xs text-on-surface-soft">
        Nada cambia hasta que apliques precios pieza por pieza en Reglas de venta. Las excepciones por producto ganan
        a esta tabla.
      </p>
    </Card>
  );
}
