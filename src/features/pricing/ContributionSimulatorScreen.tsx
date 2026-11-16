import { useMemo, useState } from "react";
import { Badge, Button, Card, Money, Screen, ScreenHeader, SelectField, TextField } from "../../design-system";
import { useStore } from "../../app/StoreProvider";
import { tiersForStore } from "../../lib/pricing";
import { parseAmount } from "../../lib/money";
import { navigate } from "../../lib/router";
import { simulateContribution, type VolumeSource } from "../../lib/contribution";

// #336 (2B): simulador determinista de contribución y equilibrio. Solo lectura:
// nada se persiste ni promete ventas; cada supuesto visible. Álgebra exacta en
// lib/contribution.ts (probada aparte); esta pantalla la alimenta con los
// valores reales de la pieza/nivel y declara la fuente del volumen.

type Mode = "pieza" | "categoria";

function pesosInputToCents(raw: string): number | null {
  const parsed = parseAmount(raw);
  return parsed !== undefined && parsed > 0 ? Math.round(parsed * 100) : null;
}

function centsPesos(cents: number | null): number | undefined {
  return cents == null ? undefined : cents / 100;
}

export function ContributionSimulatorScreen() {
  const { state, activeStore } = useStore();
  const tiers = useMemo(() => tiersForStore(activeStore), [activeStore]);
  const [mode, setMode] = useState<Mode>("pieza");
  const [productId, setProductId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tierId, setTierId] = useState(tiers[0]?.id ?? "");
  const [priceCurrent, setPriceCurrent] = useState("");
  const [priceProposed, setPriceProposed] = useState("");
  const [basePieces, setBasePieces] = useState("");
  const [period, setPeriod] = useState("");
  const [minPerPiece, setMinPerPiece] = useState("");
  const [variableCost, setVariableCost] = useState("");
  const [sensitivity, setSensitivity] = useState("-20, 10");

  if (!activeStore) return null;
  const storeProducts = state.products.filter((p) => p.storeId === activeStore.id);
  const categories = state.categories.filter((c) => c.storeId === activeStore.id);
  const product = storeProducts.find((p) => p.id === productId) ?? null;

  // Variable cost per piece: acquisition + the level's per-piece packaging.
  // Any missing figure (product cost, a material without estimated cost)
  // leaves the cost UNKNOWN — never zero.
  const packagingCost = useMemo(() => {
    const materials = new Map((activeStore.packaging?.materials ?? []).map((m) => [m.id, m]));
    const tierPackaging = tierId ? activeStore.packaging?.byTier?.[tierId] : undefined;
    const perPieceCents = (tierPackaging?.perPiece ?? []).reduce<number | null>((sum, line) => {
      const cost = materials.get(line.materialId)?.estimatedCost;
      if (sum == null || cost === undefined || !Number.isFinite(cost)) return null;
      return sum + Math.round(cost * 100 * line.units);
    }, 0);
    const perOrderCents = (tierPackaging?.perOrder ?? []).reduce<number | null>((sum, line) => {
      const cost = materials.get(line.materialId)?.estimatedCost;
      if (sum == null || cost === undefined || !Number.isFinite(cost)) return null;
      return sum + Math.round(cost * 100 * line.units);
    }, 0);
    return { perPieceCents, perOrderCents, perPieceIncomplete: (tierPackaging?.perPiece ?? []).length > 0 && perPieceCents == null };
  }, [activeStore.packaging, tierId]);

  const productCostCents = product && product.cost !== undefined && Number.isFinite(product.cost) ? Math.round(product.cost * 100) : null;
  const autoVariableCostCents = mode === "pieza" && productCostCents != null && packagingCost.perPieceCents != null
    ? productCostCents + packagingCost.perPieceCents
    : null;

  // The commercial ladder for THIS product: only tiers WITH a price, in the
  // store's canonical order — the simulated tier must stay strictly between
  // its neighbors.
  const ladder = useMemo(() => {
    if (mode !== "pieza" || !product) return null;
    const rungs = tiers
      .map((tier) => ({ tierId: tier.id, label: tier.label, price: product.prices?.[tier.id] }))
      .filter((rung) => rung.price !== undefined && rung.price > 0)
      .map((rung) => ({ label: rung.label, priceCents: Math.round(rung.price! * 100), tierId: rung.tierId }));
    const index = rungs.findIndex((rung) => rung.tierId === tierId);
    return rungs.length > 1 && index >= 0 ? { rungs, index } : null;
  }, [mode, product, tiers, tierId]);

  const sensitivityPct = sensitivity
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((pct) => Number.isFinite(pct) && pct !== 0)
    .slice(0, 4);

  const manualCostCents = pesosInputToCents(variableCost);
  const variableCostCents = manualCostCents ?? autoVariableCostCents;
  const currentCents = pesosInputToCents(priceCurrent);
  const proposedCents = pesosInputToCents(priceProposed);
  const pieces = Number.parseInt(basePieces, 10);
  const volumeSource: VolumeSource = "ingresado"; // la serie histórica aún no está disponible (#335/#333)

  const result = currentCents != null && proposedCents != null && Number.isFinite(pieces)
    ? simulateContribution({
        priceCurrentCents: currentCents,
        priceProposedCents: proposedCents,
        basePieces: Math.max(0, pieces),
        volumeSource,
        variableCostCents,
        perOrderPackagingCents: packagingCost.perOrderCents,
        minContributionPerPieceCents: pesosInputToCents(minPerPiece),
        ladder: ladder?.rungs ?? null,
        simulatedTierIndex: ladder?.index,
        sensitivityPct,
      })
    : null;

  const categoryProducts = mode === "categoria" && categoryId
    ? storeProducts.filter((p) => (p.categoryIds ?? []).includes(categoryId))
    : [];

  function pickProduct(next: string) {
    setProductId(next);
    const chosen = storeProducts.find((p) => p.id === next);
    const price = chosen?.prices?.[tierId];
    setPriceCurrent(Number.isFinite(price) && price ? String(price) : "");
  }

  function pickTier(next: string) {
    setTierId(next);
    if (product) {
      const price = product.prices?.[next];
      setPriceCurrent(Number.isFinite(price) && price ? String(price) : "");
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Simulador de contribución"
        subtitle="Álgebra exacta con supuestos visibles — escenario, no pronóstico"
        action={<Button variant="ghost" size="sm" onClick={() => navigate("/productos/estrategia")}>Volver a Estrategia</Button>}
      />
      <div className="mx-auto max-w-5xl space-y-4">
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField
              label="Simular"
              value={mode}
              onChange={(value) => { setMode(value as Mode); setProductId(""); setPriceCurrent(""); }}
              options={[
                { value: "pieza", label: "Una pieza" },
                { value: "categoria", label: "Una categoría (conjunto)" },
              ]}
            />
            <SelectField
              label="Nivel"
              value={tierId}
              onChange={pickTier}
              options={tiers.map((t) => ({ value: t.id, label: t.label }))}
            />
            {mode === "pieza" ? (
              <SelectField
                label="Pieza"
                value={productId}
                onChange={pickProduct}
                options={[{ value: "", label: "Elige una pieza" }, ...storeProducts.map((p) => ({ value: p.id, label: p.name }))]}
              />
            ) : (
              <SelectField
                label="Categoría"
                value={categoryId}
                onChange={(value) => { setCategoryId(value); setPriceCurrent(""); }}
                options={[{ value: "", label: "Elige una categoría" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              />
            )}
            <TextField label="Precio actual" value={priceCurrent} onChange={(e) => setPriceCurrent(e.target.value)} inputMode="decimal" placeholder="540" />
            <TextField label="Precio propuesto" value={priceProposed} onChange={(e) => setPriceProposed(e.target.value)} inputMode="decimal" placeholder="600" />
            <TextField label="Volumen base (piezas)" value={basePieces} onChange={(e) => setBasePieces(e.target.value)} inputMode="numeric" placeholder="10" />
            <TextField label="Periodo del volumen (opcional)" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="noviembre" />
            <TextField
              label="Costo variable por pieza (opcional)"
              value={variableCost}
              onChange={(e) => setVariableCost(e.target.value)}
              inputMode="decimal"
              placeholder={autoVariableCostCents != null ? (autoVariableCostCents / 100).toString() : "Regístralo en Compras"}
              title="Costo de adquisición más el empaque por pieza de este nivel. Sin costo completo, la contribución no se calcula (nunca se toma como cero)."
            />
            <TextField label="Mínimo de contribución por pieza (opcional)" value={minPerPiece} onChange={(e) => setMinPerPiece(e.target.value)} inputMode="decimal" placeholder="Solo si lo decides" title="Restricción dura: si la propuesta no lo alcanza, el escenario es infactible." />
            <TextField label="Cambios de volumen a comparar (%)" value={sensitivity} onChange={(e) => setSensitivity(e.target.value)} placeholder="-20, 10" title="Hasta cuatro porcentajes separados por comas. Comparación de escenario, nunca demanda esperada." />
          </div>
          {mode === "categoria" && categoryId && (
            <p className="mt-2 text-xs text-on-surface-soft">
              {categoryProducts.length} {categoryProducts.length === 1 ? "pieza en esta categoría" : "piezas en esta categoría"} · resultado conjunto: el volumen y el precio son el supuesto global que ingresas — sin canibalización ni aumento de demanda simulados.
            </p>
          )}
          <p className="mt-2 text-xs text-on-surface-soft" title="La serie histórica de volumen se integrará con el análisis por periodo; mientras tanto, el volumen es un valor que ingresas.">
            Volumen: ingresado por ti. La serie histórica observada aún no está disponible; cuando lo esté, su origen se etiquetará (observado/estimado).
          </p>
        </Card>

        {result && (
          <Card>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h2 className="font-semibold text-ink text-sm">Resultado</h2>
              <span className="text-xs text-on-surface-soft">
                Simulación · {new Date().toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}
                {period ? ` · periodo: ${period}` : ""} · volumen {volumeSource}
              </span>
            </div>
            {result.status === "infeasible" ? (
              <div className="mt-2 space-y-1">
                <p className="text-sm font-semibold text-danger">Sin escenario factible</p>
                {result.blockers.map((blocker) => (
                  <p key={blocker} className="text-sm text-on-surface">{blocker}</p>
                ))}
              </div>
            ) : result.status === "limit" ? (
              <div className="mt-2 space-y-1">
                {result.notes.map((note) => (
                  <p key={note} className="text-sm text-on-surface">{note}</p>
                ))}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 min-w-0">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-on-surface-soft">Contribución por pieza</p>
                  <p className="serif-display tnum font-bold text-on-surface">
                    <Money exact amount={centsPesos(result.unitCurrentCents)} /> → <Money exact amount={centsPesos(result.unitProposedCents)} />
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-on-surface-soft">Total del escenario</p>
                  <p className="serif-display tnum font-bold text-on-surface"><Money exact amount={centsPesos(result.scenarioTotalCents)} /></p>
                  {result.deltaCents !== 0 && (
                    <p className={`text-xs ${result.deltaCents && result.deltaCents > 0 ? "text-success" : "text-danger"}`}>
                      {result.deltaCents && result.deltaCents > 0 ? "+" : ""}<Money exact amount={centsPesos(result.deltaCents)} /> vs base
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-on-surface-soft">Equilibrio q*</p>
                  <p className="serif-display tnum font-bold text-on-surface">{result.breakEven!.label}</p>
                  <p className="text-xs text-on-surface-soft">
                    {result.breakEven!.piecesToMatch} {result.breakEven!.piecesToMatch === 1 ? "pieza iguala" : "piezas igualan"} o superan · {result.breakEven!.piecesToExceed} para superar
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-on-surface-soft">Base con volumen actual</p>
                  <p className="serif-display tnum font-bold text-on-surface"><Money exact amount={centsPesos(result.baseTotalCents)} /></p>
                </div>
              </div>
            )}
            {result.sensitivity.length > 0 && result.status === "ok" && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {result.sensitivity.map((point) => (
                  <li key={point.pct}>
                    <Badge tone="neutral">
                      {point.pct > 0 ? "+" : ""}{point.pct}% → {point.pieces} {point.pieces === 1 ? "pieza" : "piezas"} · <Money exact amount={centsPesos(point.totalCents)} />
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {result.notes.length > 0 && result.status !== "limit" && (
              <ul className="mt-2 space-y-0.5">
                {result.notes.map((note) => (
                  <li key={note} className="text-xs text-on-surface-soft">{note}</li>
                ))}
              </ul>
            )}
            {variableCostCents == null && (
              <p className="mt-2 text-xs text-on-surface-soft">
                Falta el costo variable por pieza{mode === "pieza" && product ? (productCostCents == null ? " de adquisición (regístralo en Compras)" : packagingCost.perPieceIncomplete ? " de algún material del empaque por pieza" : "") : " — en un conjunto, ingresa el costo del supuesto global"} — la contribución no se calcula hasta completarlo.
              </p>
            )}
            <p className="mt-3 text-xs text-on-surface-soft">
              Nada de esto se guarda ni cambia el catálogo: es un escenario, no un pronóstico.
            </p>
          </Card>
        )}
      </div>
    </Screen>
  );
}
