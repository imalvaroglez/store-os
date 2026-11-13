import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Money, Screen, ScreenHeader, StatRow } from "../../design-system";
import { loadOrderPaymentsDocs } from "../../app/firebase/firestoreData";
import { cdmxMonthKey, monthlyClose, type CloseMonth } from "../../lib/monthlyClose";
import { useStore } from "../../app/StoreProvider";
import type { OrderPayment } from "../../types";

// #129 — etapa lista: vista previa de cierre mensual, SOLO LECTURA. No cierra
// periodos, no autoriza repartos, no mueve dinero ni toca pedidos históricos.
// Ventas por entregas verificables, cobros por su fecha real, gastos una vez
// (mes calendario CDMX, centavos exactos). La cobertura incompleta queda a la
// vista y NO habilita un cierre oficial.

/** The CURRENT CDMX calendar month (the device's timezone is irrelevant). */
function cdmxCurrentMonth(): CloseMonth {
  const [year, month] = cdmxMonthKey(new Date().toISOString()).split("-").map(Number);
  return { year, month };
}

function shiftMonth(base: CloseMonth, offset: number): CloseMonth {
  const zeroBased = base.year * 12 + (base.month - 1) + offset;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

export function MonthlyCloseScreen() {
  const { state, activeStore } = useStore();
  const [offset, setOffset] = useState(0);
  const [paymentsByOrder, setPaymentsByOrder] = useState<Record<string, OrderPayment[]>>({});
  const [loadingPayments, setLoadingPayments] = useState(true);
  // #129: a failed cobros load must SAY so — silent $0 would read as "no hay
  // cobros" and mislead the preview.
  const [paymentsFailed, setPaymentsFailed] = useState(false);

  const month = useMemo(() => shiftMonth(cdmxCurrentMonth(), offset), [offset]);
  const storeOrders = useMemo(
    () => state.orders.filter((order) => order.storeId === activeStore?.id),
    [state.orders, activeStore?.id]
  );
  // Cobros on demand: only orders with delivery evidence or a pending legacy
  // anticipo can contribute dated cobros — the preview's own reads (no listener).
  const paymentOrderIds = useMemo(
    () => storeOrders.filter((order) => (order.deliveries?.length ?? 0) > 0 || order.deposit > 0).map((order) => order.id),
    [storeOrders]
  );

  useEffect(() => {
    let alive = true;
    setLoadingPayments(true);
    loadOrderPaymentsDocs(paymentOrderIds)
      .then((loaded) => {
        if (alive) {
          setPaymentsByOrder(loaded);
          setPaymentsFailed(false);
        }
      })
      .catch(() => {
        if (alive) {
          setPaymentsByOrder({});
          setPaymentsFailed(true);
        }
      })
      .finally(() => {
        if (alive) setLoadingPayments(false);
      });
    return () => {
      alive = false;
    };
  }, [paymentOrderIds.join(",")]);

  if (!activeStore) return null;
  const close = monthlyClose({
    storeId: activeStore.id,
    month,
    orders: storeOrders,
    paymentsByOrder,
    expenses: state.expenses,
  });
  const tone = close.operatingResultCents < 0 ? "danger" : close.operatingResultCents > 0 ? "success" : "default";

  return (
    <Screen>
      <ScreenHeader
        title="Cierre mensual"
        subtitle={`${close.monthLabel} · vista previa, solo lectura`}
        action={
          <div className="flex items-center gap-1">
            <Button variant="ghost" aria-label="Mes anterior" onClick={() => setOffset((v) => v - 1)}>‹</Button>
            <Button variant="ghost" aria-label="Mes siguiente" disabled={offset >= 0} onClick={() => setOffset((v) => Math.min(0, v + 1))}>›</Button>
          </div>
        }
      />

      <div className="mx-auto max-w-5xl space-y-4">
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold text-ink text-sm capitalize">{close.monthLabel}</h2>
            {loadingPayments && <span className="text-xs text-ink-soft">Cargando cobros…</span>}
          </div>
          <div className="mt-2 space-y-1">
            <StatRow label="Ventas (entregas verificadas)">
              <Money exact amount={close.salesCents / 100} />
            </StatRow>
            <StatRow label="Costo de lo vendido">
              <Money exact amount={close.costCents / 100} />
            </StatRow>
            <StatRow label="Margen bruto" tone={close.grossMarginCents < 0 ? "danger" : "default"}>
              <Money exact amount={close.grossMarginCents / 100} />
            </StatRow>
            <StatRow label="Gastos del mes">
              <Money exact amount={close.expensesCents / 100} />
            </StatRow>
            <StatRow label="Resultado operativo" tone={tone}>
              <Money exact amount={close.operatingResultCents / 100} />
            </StatRow>
            <StatRow label="Cobros del mes (fecha real)">
              {paymentsFailed ? <span>no disponibles</span> : <Money exact amount={close.collectionsCents / 100} />}
            </StatRow>
          </div>
          <p className="mt-3 text-xs text-on-surface-soft">
            Ventas reconocidas al confirmar entrega de cada pieza; cobros en su fecha real; gastos contados una sola vez.
            No se cierra el periodo ni se autoriza reparto.
          </p>
        </Card>

        {paymentsFailed && (
          <Card className="!bg-terracotta-soft/60 ring-terracotta/20">
            <p className="text-sm font-semibold text-terracotta">No se pudieron cargar los cobros.</p>
            <p className="text-xs text-on-surface-soft">
              Ventas y gastos no dependen de ellos; los cobros de este mes quedan como no disponibles.
              Revisa tu conexión y vuelve a entrar.
            </p>
          </Card>
        )}

        {(!close.coverage.complete || storeOrders.length > 0) && (
          <Card>
            <h3 className="font-semibold text-ink text-sm">
              Cobertura del periodo{" "}
              {close.coverage.complete && <Badge tone="success">completa</Badge>}
              {!close.coverage.complete && <Badge tone="warning">incompleta — no habilita cierre</Badge>}
            </h3>
            {close.coverage.deliveredWithoutDate.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-semibold text-on-surface">Entregados sin fecha verificable (no entran a las ventas)</p>
                <ul className="mt-1 space-y-0.5">
                  {close.coverage.deliveredWithoutDate.map((entry) => (
                    <li key={entry.orderId} className="text-xs text-on-surface-soft">
                      {entry.reference} — entregado legado sin evidencia de entrega con fecha
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {close.coverage.linesWithoutCost.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-semibold text-on-surface">Líneas sin costo conocido (el costo no se inventa)</p>
                <ul className="mt-1 space-y-0.5">
                  {close.coverage.linesWithoutCost.map((entry, index) => (
                    <li key={`${entry.orderId}-${index}`} className="text-xs text-on-surface-soft">
                      {entry.reference} — {entry.quantity} × {entry.productName}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {close.coverage.unconfirmedCollections.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-semibold text-on-surface">Cobros «Fecha por confirmar» (fuera del total)</p>
                <ul className="mt-1 space-y-0.5">
                  {close.coverage.unconfirmedCollections.map((entry) => (
                    <li key={`${entry.orderId}-${entry.paymentId}`} className="text-xs text-on-surface-soft">
                      {entry.reference} — anticipo sin fecha · <Money exact amount={entry.amountCents / 100} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {close.coverage.complete && storeOrders.length > 0 && (
              <p className="mt-2 text-xs text-on-surface-soft">
                Toda venta del mes tiene entrega verificada con fecha y costo conocido.
              </p>
            )}
          </Card>
        )}

        <p className="text-xs text-ink-soft px-1">
          Vista previa de la etapa «cierre mensual» (#129): calculada al momento con los datos del sistema.
          El cierre oficial, las correcciones y los repartos quedan para su etapa operativa.
        </p>
      </div>
    </Screen>
  );
}
