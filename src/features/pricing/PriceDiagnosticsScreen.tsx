import { useMemo, useState } from "react";
import { Badge, Card, Money, Screen, ScreenHeader, SelectField } from "../../design-system";
import { useStore } from "../../app/StoreProvider";
import { categoryDiagnosis } from "../../lib/priceDiagnostics";
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

  if (!activeStore) return null;
  const categories = state.categories.filter((c) => c.storeId === activeStore.id);
  const products = state.products.filter(
    (p) => p.storeId === activeStore.id && (!categoryId || (p.categoryIds ?? []).includes(categoryId))
  );
  const diagnosis = tierId ? categoryDiagnosis(products, tierId) : null;
  const withPrices = diagnosis?.sample ?? 0;

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
                    Mediana <b><Money exact amount={diagnosis.median} /></b> · IQR{" "}
                    <b><Money exact amount={diagnosis.iqr} /></b>
                    {diagnosis.madSignal && <> · segunda señal MAD ≠ 0</>}
                    {diagnosis.dispersion === "none" && <> · sin dispersión estimable</>}
                  </p>
                  {diagnosis.withoutCost > 0 && (
                    <p className="text-xs text-on-surface-soft">
                      {diagnosis.withoutCost} {diagnosis.withoutCost === 1 ? "pieza sin" : "piezas sin"} costo conocido —
                      sus precios se muestran, su contribución no se calcula.
                    </p>
                  )}
                  {diagnosis.tierOrderIssues.length > 0 && (
                    <p className="text-xs text-on-surface-soft">
                      {diagnosis.tierOrderIssues.length}{" "}
                      {diagnosis.tierOrderIssues.length === 1 ? "pieza rompe" : "piezas rompen"} Regular &gt; Girly &gt;
                      Iconic.
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
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold text-ink text-sm">Decisiones</h2>
            <Badge tone="info">desde el alta de esta vista</Badge>
          </div>
          <p className="mt-1 text-xs text-on-surface-soft">
            El historial de cambios de precio y reglas empieza a registrarse con esta función; los cambios anteriores
            no se reconstruyen ni se inventan. La consulta por tienda queda aislada para su dueña.
          </p>
        </Card>
      </div>
    </Screen>
  );
}
