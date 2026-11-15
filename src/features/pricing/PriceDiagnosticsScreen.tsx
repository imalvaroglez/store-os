import { useMemo, useState, type ReactNode } from "react";
import { Badge, Button, Card, Money, Screen, ScreenHeader, SelectField } from "../../design-system";
import { useStore } from "../../app/StoreProvider";
import { loadPriceEvents } from "../../app/firebase/firestoreData";
import { categoryDiagnosis, type PriceChangeEvent, type RuleChangeEvent } from "../../lib/priceDiagnostics";
import { tiersForStore } from "../../lib/pricing";

// #335 (2a): diagnóstico descriptivo de precios/costos — compacto, mobile-first,
// sin juicios («malo», «oportunidad») ni umbrales fijos. Cada cifra con método
// y muestra; periodAnalysis NO disponible hasta #333. La trazabilidad de
// eventos empieza al liberar (nada retroactivo).

export function PriceDiagnosticsScreen() {
  const { state, activeStore } = useStore();
  const tiers = useMemo(() => tiersForStore(activeStore), [activeStore]);
  const [categoryId, setCategoryId] = useState("");
  const [tierId, setTierId] = useState(tiers[0]?.id ?? "");
  // #335 M2: "Decisiones" is a REAL history — the store's own events, read on
  // demand (one bounded query), never a listener.
  const [history, setHistory] = useState<Array<PriceChangeEvent | RuleChangeEvent> | null>(null);
  const [historyError, setHistoryError] = useState(false);

  if (!activeStore) return null;
  const categories = state.categories.filter((c) => c.storeId === activeStore.id);
  const products = state.products.filter(
    (p) => p.storeId === activeStore.id && (!categoryId || (p.categoryIds ?? []).includes(categoryId))
  );
  // Tier ids are store-defined: the coherence check runs over THIS store's
  // canonical order (cheapest → priciest), never a hardcoded trio.
  const diagnosis = tierId ? categoryDiagnosis(products, tierId, tiers.map((t) => t.id)) : null;
  const withPrices = diagnosis?.sample ?? 0;
  const productsById = useMemo(
    () => new Map(state.products.filter((p) => p.storeId === activeStore?.id).map((p) => [p.id, p])),
    [state.products, activeStore?.id]
  );
  async function loadHistory() {
    if (!activeStore) return;
    setHistoryError(false);
    try {
      setHistory(await loadPriceEvents(activeStore.id));
    } catch {
      setHistoryError(true);
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Diagnóstico de precios"
        subtitle="Descriptivo y trazable — no recomienda ni aplica precios"
      />
      <div className="mx-auto max-w-5xl space-y-4">
        <Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField
              label="Categoría"
              value={categoryId}
              onChange={(value) => setCategoryId(value)}
              options={[
                { value: "", label: "Todas" },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <SelectField
              label="Nivel"
              value={tierId}
              onChange={(value) => setTierId(value)}
              options={tiers.map((t) => ({ value: t.id, label: t.label }))}
            />
          </div>
          {diagnosis && (
            <div className="mt-3 space-y-1">
              <p className="text-sm text-on-surface">
                {withPrices} {withPrices === 1 ? "pieza con precio" : "piezas con precio"} de {products.length} ·
                método {diagnosis.method}
              </p>
              {withPrices >= 3 ? (
                <>
                  <p className="text-sm">
                    La mitad de las piezas cuesta menos de <b><Money exact amount={diagnosis.median} /></b> · la mitad
                    central va de <b><Money exact amount={diagnosis.median - diagnosis.iqr / 2} /></b> a{" "}
                    <b><Money exact amount={diagnosis.median + diagnosis.iqr / 2} /></b>
                    {diagnosis.dispersion === "none" && <> · sin dispersión estimable</>}
                  </p>
                  {diagnosis.withoutCost > 0 && (
                    <p className="text-xs text-on-surface-soft">
                      {diagnosis.withoutCost} {diagnosis.withoutCost === 1 ? "pieza sin" : "piezas sin"} costo registrado —
                      el costo no interviene en este cálculo de precios; se registra en Compras.
                    </p>
                  )}
                  {diagnosis.costStats && (
                    <p className="text-xs text-on-surface-soft">
                      Costos ({diagnosis.costStats.withCost} {diagnosis.costStats.withCost === 1 ? "pieza" : "piezas"} con
                      costo): la mitad bajo <Money exact amount={diagnosis.costStats.median} /> · entre{" "}
                      <Money exact amount={diagnosis.costStats.min} /> y <Money exact amount={diagnosis.costStats.max} /> ·{" "}
                      {diagnosis.costStats.distinct} {diagnosis.costStats.distinct === 1 ? "costo distinto" : "costos distintos"}.
                    </p>
                  )}
                  {diagnosis.outliers.length > 0 && (
                    <p className="text-xs text-on-surface-soft">
                      {diagnosis.outliers.length === 1 ? "Pieza alejada del resto" : `${diagnosis.outliers.length} piezas alejadas del resto`}{" "}
                      (método: cuartiles):{" "}
                      {diagnosis.outliers.slice(0, 6).map((outlier) => (
                        <span key={outlier.id}>
                          {outlier.name} (<Money exact amount={outlier.price} />)
                        </span>
                      )).reduce<ReactNode[]>((acc, item) => (acc.length ? [...acc, ", ", item] : [item]), [])}
                      {diagnosis.outliers.length > 6 ? ` y ${diagnosis.outliers.length - 6} más.` : "."}
                    </p>
                  )}
                  {diagnosis.tierOrderIssues.length > 0 && (
                    <p className="text-xs text-on-surface-soft">
                      {diagnosis.tierOrderIssues.length}{" "}
                      {diagnosis.tierOrderIssues.length === 1 ? "pieza rompe" : "piezas rompen"} el orden{" "}
                      {tiers.map((t) => t.label).join(" > ")}.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-on-surface-soft">Evidencia insuficiente (menos de 3 piezas con precio).</p>
              )}
              <p className="text-xs text-on-surface-soft">{diagnosis.periodNote}</p>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold text-ink text-sm">Decisiones — historial de cambios</h2>
            {history === null && !historyError && (
              <Button size="sm" variant="ghost" onClick={() => void loadHistory()}>
                Ver historial
              </Button>
            )}
          </div>
          {historyError && (
            <p className="mt-1 text-sm text-danger">
              No se pudo cargar el historial. Revisa tu conexión e inténtalo de nuevo.
            </p>
          )}
          {history !== null && history.length === 0 && !historyError && (
            <p className="mt-1 text-xs text-on-surface-soft">
              Aún no hay cambios registrados — el historial empieza con esta función; los cambios anteriores no se
              reconstruyen ni se inventan.
            </p>
          )}
          {history !== null && history.length > 0 && (
            <ul className="mt-2 divide-y divide-rule">
              {history.map((event) => (
                <li key={event.id} className="py-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-sm text-on-surface">
                    {"summary" in event ? (
                      event.summary
                    ) : (
                      <>
                        {productsById.get((event as PriceChangeEvent).productId)?.name ?? "Pieza"} ·{" "}
                        {tiers.find((t) => t.id === (event as PriceChangeEvent).tierId)?.label ?? (event as PriceChangeEvent).tierId}:{" "}
                        <Money exact amount={(event as PriceChangeEvent).previousCents / 100} /> →{" "}
                        <Money exact amount={(event as PriceChangeEvent).nextCents / 100} />
                      </>
                    )}
                  </span>
                  <span className="text-xs text-on-surface-soft tabular-nums">
                    {new Date(event.recordedAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })} ·{" "}
                    {"changedByEmail" in event && event.changedByEmail ? event.changedByEmail : "Equipo"} ·{" "}
                    {"summary" in event ? (
                      <Badge tone="info">regla</Badge>
                    ) : (event as PriceChangeEvent).origin === "manual" ? (
                      <Badge tone="neutral">manual</Badge>
                    ) : (
                      <Badge tone="neutral">aplicación</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {history !== null && history.length > 0 && (
            <p className="mt-2 text-xs text-on-surface-soft">
              Últimos {history.length} cambios de esta tienda; nada se reconstruye ni se inventa.
            </p>
          )}
        </Card>
      </div>
    </Screen>
  );
}
