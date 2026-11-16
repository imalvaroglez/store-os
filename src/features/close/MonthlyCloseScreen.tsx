import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Screen, ScreenHeader } from "../../design-system";
import { navigate } from "../../lib/router";
import { loadOrderPaymentsDocs } from "../../app/firebase/firestoreData";
import { cdmxMonthKey, monthlyClose, type CloseMonth } from "../../lib/monthlyClose";
import { useStore } from "../../app/StoreProvider";
import { formatMoneyExact } from "../../lib/money";
import type { OrderPayment } from "../../types";

// #129 (etapa de solo lectura) · #455 — composición contractual del dashboard
// de cierre: una columna narrativa con protagonista de resultado, fórmula de
// 5 filas, cobros como flujo DISTINTO y pendientes agrupados por causa (nunca
// un feed de identificadores). No cierra periodos, no autoriza repartos, no
// mueve dinero; los desconocido jamás se pinta como $0.

/** The CURRENT CDMX calendar month (the device's timezone is irrelevant). */
function cdmxCurrentMonth(): CloseMonth {
  const [year, month] = cdmxMonthKey(new Date().toISOString()).split("-").map(Number);
  return { year, month };
}

function shiftMonth(base: CloseMonth, offset: number): CloseMonth {
  const zeroBased = base.year * 12 + (base.month - 1) + offset;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Signed, 2-decimal, es-MX — the formula's costs and expenses carry a minus. */
function signedMoney(cents: number): string {
  const plain = formatMoneyExact(Math.abs(cents) / 100);
  return cents < 0 ? `−${plain}` : plain;
}

/** One aligned formula row: label left, tabular amount right. `cents`
 * null = still loading — a dash placeholder, never a $0 (stable skeleton). */
function FormulaRow({ label, cents, strong = false, signed = false }: { label: string; cents: number | null; strong?: boolean; signed?: boolean }) {
  const text = cents === null ? "—" : signed ? signedMoney(cents) : formatMoneyExact(cents / 100);
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${strong ? "font-semibold border-t border-rule" : ""}`}>
      <span className={strong ? "text-ink" : "text-on-surface-soft"}>{label}</span>
      <span className={`tnum ${strong ? "text-ink" : "text-on-surface"}`}>{text}</span>
    </div>
  );
}

export function MonthlyCloseScreen() {
  const { state, activeStore, stateStatus } = useStore();
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
    () => storeOrders
      .filter((order) => (order.deliveries?.length ?? 0) > 0 || order.deposit > 0 || (order.paymentsReceivedCents ?? 0) > 0)
      .map((order) => order.id),
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

  // #455: skeleton of stable structure while anything is still loading — a
  // dash placeholder, never a $0 with a definitive look (#406 lesson).
  const loading = stateStatus !== "ready" || loadingPayments;
  const monthName = `${MONTH_NAMES[month.month - 1]} ${month.year}`;
  const isCurrentMonth = offset === 0;

  const c = close.coverage;
  // Grouped pendings: one row per CAUSE with a count and a human explanation —
  // never a feed of individual hashes.
  const pendings: Array<{ count: number; label: string; explanation: string; action?: { label: string; path: string } }> = [];
  if (c.deliveredWithoutDate.length > 0) {
    pendings.push({
      count: c.deliveredWithoutDate.length,
      label: c.deliveredWithoutDate.length === 1 ? "pedido entregado sin fecha verificable" : "pedidos entregados sin fecha verificable",
      explanation: "No podemos determinar a qué mes pertenecen sus ventas.",
      action: { label: "Revisar pedidos", path: "/pedidos" },
    });
  }
  if (c.unconfirmedCollections.length > 0) {
    pendings.push({
      count: c.unconfirmedCollections.length,
      label: c.unconfirmedCollections.length === 1 ? "cobro sin fecha" : "cobros sin fecha",
      explanation: "No sabemos en qué periodo debe reconocerse cada entrada de dinero.",
      // La cola de cobros llega con #457 — sin superficie no se publica un
      // enlace falso; la fila informativa ya guía la revisión.
    });
  }
  if (c.linesWithoutCost.length > 0) {
    const pieces = c.linesWithoutCost.reduce((sum, entry) => sum + entry.quantity, 0);
    pendings.push({
      count: pieces,
      label: pieces === 1 ? "producto vendido sin costo conocido" : "productos vendidos sin costo conocido",
      explanation: "Puede afectar la utilidad.",
      action: { label: "Revisar costo", path: "/productos" },
    });
  }
  if (c.deliveredWithoutLine.length > 0) {
    const pieces = c.deliveredWithoutLine.reduce((sum, entry) => sum + entry.quantity, 0);
    pendings.push({
      count: pieces,
      label: pieces === 1 ? "pieza entregada que ya no está en el pedido" : "piezas entregadas que ya no están en el pedido",
      explanation: "La evidencia de entrega se conserva; la línea salió del pedido.",
    });
  }
  if (c.unreadableData.length > 0) {
    pendings.push({
      count: c.unreadableData.length,
      label: c.unreadableData.length === 1 ? "pedido con datos no interpretables" : "pedidos con datos no interpretables",
      explanation: "Un dato dañado impide leer este pedido; no se rompe el periodo.",
    });
  }

  const resultCents = close.operatingResultCents;
  const resultTone = resultCents < 0 ? "danger" : resultCents > 0 ? "success" : "default";
  const heroLabel = resultCents < 0 ? "PÉRDIDA OPERATIVA ESTIMADA" : "GANANCIA OPERATIVA ESTIMADA";

  return (
    <Screen>
      <ScreenHeader
        title="Cierre mensual"
        subtitle={`${monthName} · ${isCurrentMonth ? "Periodo en curso · " : ""}Vista preliminar`}
        action={
          <div className="flex items-center gap-1" aria-label="Cambio de mes">
            <Button variant="ghost" aria-label="Mes anterior" onClick={() => setOffset((v) => v - 1)}>‹</Button>
            <Button variant="ghost" aria-label="Mes siguiente" disabled={offset >= 0} onClick={() => setOffset((v) => Math.min(0, v + 1))}>›</Button>
          </div>
        }
        badge={pendings.length > 0 ? <Badge tone="warning">En revisión</Badge> : undefined}
      />

      <div className="mx-auto max-w-5xl space-y-4">
        {/* Protagonist: the period's operative result — never presented as
            available cash, never authorized from this screen. */}
        <Card>
          <p className="text-xs font-semibold tracking-wide text-on-surface-soft">{heroLabel}</p>
          <p className={`serif-display tnum text-4xl leading-tight mt-1 ${resultTone === "success" ? "text-success" : resultTone === "danger" ? "text-danger" : "text-ink"}`}>
            {loading ? "—" : signedMoney(resultCents)}
          </p>
          <p className="text-sm text-on-surface-soft mt-2">Este monto todavía no está autorizado para reparto.</p>
        </Card>

        {/* The 5-row formula — aligned, tabular, subtotals as separators. */}
        {!loading && close.salesCents === 0 ? (
          <Card>
            <p className="text-sm text-on-surface-soft">Todavía no hay entregas verificadas en este periodo.</p>
          </Card>
        ) : (
          <Card>
            <h3 className="text-sm font-semibold text-ink">¿Cómo llegamos a este resultado?</h3>
            <div className="mt-2">
              <FormulaRow label="Ventas de productos entregados" cents={loading ? null : close.salesCents} />
              <FormulaRow label="Costo de los productos vendidos" cents={loading ? null : -close.costCents} signed />
              <FormulaRow label="Ganancia antes de gastos" cents={loading ? null : close.grossMarginCents} strong />
              <FormulaRow label="Gastos operativos del mes" cents={loading ? null : -close.expensesCents} signed />
              <FormulaRow label="Resultado operativo" cents={loading ? null : close.operatingResultCents} strong />
            </div>
          </Card>
        )}

        {/* Collections: a DIFFERENT flow — money received in the period, never
            an extra profit line inside the formula. */}
        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">Dinero recibido durante {MONTH_NAMES[month.month - 1]}</h3>
            <span className="text-xs rounded-full border border-edge px-2 py-0.5 text-on-surface-soft">Por fecha de cobro</span>
          </div>
          <p className={`serif-display tnum text-2xl mt-1 ${paymentsFailed ? "text-on-surface-soft" : "text-ink"}`}>
            {loading ? "—" : paymentsFailed ? "no disponibles" : formatMoneyExact(close.collectionsCents / 100)}
          </p>
          <p className="text-sm text-on-surface-soft mt-2">
            Incluye pagos registrados en {MONTH_NAMES[month.month - 1]}, aunque correspondan a ventas de otros meses o anticipos.
            No representa una ganancia adicional.
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

        {/* Grouped pendings: one row per cause. No empty warning container. */}
        {pendings.length > 0 ? (
          <Card>
            <h3 className="text-sm font-semibold text-ink">⚠ Hay información pendiente de revisar</h3>
            <div className="mt-2 space-y-2">
              {pendings.map((pending) => (
                <div key={pending.label} className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm text-ink">
                      {pending.count} {pending.label}
                    </p>
                    <p className="text-xs text-on-surface-soft">{pending.explanation}</p>
                  </div>
                  {pending.action && (
                    <Button size="sm" variant="secondary" onClick={() => navigate(pending.action!.path)}>
                      {pending.action.label}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ) : (
          !loading && storeOrders.length > 0 && (
            <p className="text-sm text-on-surface-soft px-1">Sin pendientes detectados para este periodo.</p>
          )
        )}

        <p className="text-xs text-ink-soft px-1">
          Vista preliminar: ventas al confirmar entrega de cada pieza, cobros en su fecha real, gastos contados una sola vez.
          El cierre oficial y los repartos quedan para su etapa operativa.
        </p>
      </div>
    </Screen>
  );
}
