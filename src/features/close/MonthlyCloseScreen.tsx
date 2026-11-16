import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Screen, ScreenHeader, Sheet, TextField } from "../../design-system";
import { navigate } from "../../lib/router";
import { loadOrderPaymentsDocs } from "../../app/firebase/firestoreData";
import { cdmxMonthKey, monthlyClose, type CloseMonth } from "../../lib/monthlyClose";
import { pendingQueues, type Queue } from "../../lib/closeQueues";
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
function FormulaRow({
  label, cents, strong = false, signed = false, onOpen, openLabel,
}: {
  label: string;
  cents: number | null;
  strong?: boolean;
  signed?: boolean;
  /** #456: rows open their traceable detail — “¿De dónde salen estos $X?”. */
  onOpen?: () => void;
  openLabel?: string;
}) {
  const text = cents === null ? "—" : signed ? signedMoney(cents) : formatMoneyExact(cents / 100);
  const body = (
    <>
      <span className={strong ? "text-ink" : "text-on-surface-soft"}>{label}</span>
      <span className={`tnum ${strong ? "text-ink" : "text-on-surface"}`}>{text}</span>
    </>
  );
  if (!onOpen) {
    return <div className={`flex items-baseline justify-between gap-3 py-1 ${strong ? "font-semibold border-t border-rule" : ""}`}>{body}</div>;
  }
  return (
    <Button
      variant="ghost"
      onClick={onOpen}
      aria-label={openLabel ?? `Ver de dónde salen estos ${text}`}
      className={`!px-1 !py-1 !min-h-0 w-full flex !justify-between gap-3 !rounded text-left !tracking-normal ${strong ? "!font-semibold !border-t !border-rule" : "!font-normal"}`}
    >
      {body}
    </Button>
  );
}

/** #456: one figure's drilldown — “¿De dónde salen estos $X?” with the
 * traceable rows, search, progressive load and exact reconciliation. */
function FigureDetailSheet({
  open, onClose, title, concept, rows, period, excluded, kindFilter = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  concept: string;
  rows: Array<{ date: string; reference: string; concept: string; amountCents: number; orderId?: string; customerName?: string; kind?: string }>;
  period: string;
  excluded?: Array<{ reference: string; amountCents: number; cause: string }>;
  /** #456 r2: composite sheets (ganancia/resultado) offer a kind filter. */
  kindFilter?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(50);
  const [kind, setKind] = useState<string>("todos");
  useEffect(() => { setQuery(""); setVisible(50); setKind("todos"); }, [open]);
  const filtered = rows.filter((row) => {
    if (kindFilter && kind !== "todos" && row.kind !== kind) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return `${row.reference} ${row.concept} ${row.customerName ?? ""}`.toLowerCase().includes(needle);
  });
  const sum = rows.reduce((total, row) => total + row.amountCents, 0);
  return (
    <Sheet open={open} onClose={onClose} title={title} contentClassName="max-w-2xl">
      <p className="text-xs text-on-surface-soft">{concept} · {period} · hora Centro de México</p>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
        <TextField label="Buscar por folio, clienta o concepto" value={query} onChange={(event) => setQuery(event.target.value)} />
        {kindFilter && (
          <div className="flex items-end gap-1">
            {["todos", "sale", "cost", "expense"].map((option) => (
              <Button key={option} size="sm" variant={kind === option ? "secondary" : "ghost"} onClick={() => setKind(option)}>
                {option === "todos" ? "Todo" : option === "sale" ? "Ventas" : option === "cost" ? "Costos" : "Gastos"}
              </Button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-3 space-y-1 max-h-[50vh] overflow-y-auto">
        {filtered.slice(0, visible).map((row, index) => (
          <div key={`${row.reference}-${row.date}-${index}`} className="flex items-baseline justify-between gap-3 text-sm border-b border-rule/60 pb-1">
            <div className="min-w-0">
              <span className="tnum text-xs text-on-surface-soft">{row.date}</span>{" "}
              <span className="text-ink">{row.reference}</span>
              {row.customerName && <span className="text-on-surface-soft"> · {row.customerName}</span>}
              <span className="text-on-surface-soft"> · {row.concept}</span>
            </div>
            <div className="flex items-baseline gap-2 shrink-0">
              <span className="tnum">{signedMoney(row.amountCents)}</span>
              {row.orderId && (
                <Button size="sm" variant="ghost" className="!px-2 !py-0 !min-h-0 !text-xs" onClick={() => navigate("/pedidos")}>
                  Ver
                </Button>
              )}
            </div>
          </div>
        ))}
        {filtered.length > visible && (
          <Button size="sm" variant="ghost" className="w-full" onClick={() => setVisible((v) => v + 100)}>
            Mostrar más ({filtered.length - visible} restantes)
          </Button>
        )}
      </div>
      <div className="mt-4 pt-3 border-t border-rule">
        <div className="flex items-baseline justify-between text-sm font-semibold">
          <span>Suma del detalle</span>
          <span className="tnum">{signedMoney(sum)}</span>
        </div>
        <p className="text-xs text-on-surface-soft mt-1">
          {rows.length} {rows.length === 1 ? "movimiento incluido" : "movimientos incluidos"}
          {excluded && excluded.length > 0 ? ` · ${excluded.length} por verificar` : ""} — cuadra con la cifra del panel.
        </p>
        {excluded && excluded.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-on-surface">Fuera del total</p>
            {excluded.map((entry, index) => (
              <p key={index} className="text-xs text-on-surface-soft">
                {entry.reference} · {signedMoney(entry.amountCents)} — {entry.cause}
              </p>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** #457: the filtered review QUEUE for one pending cause — same task, no
 * hash feeds. Search + state/affectation filters + progressive load; the
 * counts never claim a false zero («desconocido» ≠ «no afecta»). */
function QueueSheet({
  open, onClose, title, queue,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  queue: Queue;
}) {
  const [query, setQuery] = useState("");
  const [affectation, setAffectation] = useState<"todas" | "desconocido">("todas");
  const [visible, setVisible] = useState(20);
  useEffect(() => { setQuery(""); setAffectation("todas"); setVisible(20); }, [open]);
  const filtered = queue.rows.filter((row) => {
    if (affectation !== "todas" && row.affectsMonth !== affectation) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return `${row.reference} ${row.customerName} ${row.productName ?? ""}`.toLowerCase().includes(needle);
  });
  return (
    <Sheet open={open} onClose={onClose} title={title} contentClassName="max-w-2xl">
      <p className="text-xs text-on-surface-soft">
        {queue.total} por revisar · {queue.mesDesconocido} con periodo por determinar (desconocido, no «fuera del mes»)
      </p>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
        <TextField label="Buscar por folio, clienta o producto" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="flex items-end">
          <Button size="sm" variant={affectation === "desconocido" ? "secondary" : "ghost"} onClick={() => setAffectation((v) => (v === "desconocido" ? "todas" : "desconocido"))}>
            Solo por determinar
          </Button>
        </div>
      </div>
      <div className="mt-3 space-y-2 max-h-[50vh] overflow-y-auto">
        {filtered.slice(0, visible).map((row) => (
          <div key={`${row.orderId}-${row.paymentId ?? row.reference}`} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule/60 pb-2">
            <div className="min-w-0">
              <p className="text-sm text-ink">
                {row.reference} · {row.customerName}
              </p>
              <p className="text-xs text-on-surface-soft">
                {row.concept}
                {row.productName ? ` · ${row.productName}${row.quantity ? ` ×${row.quantity}` : ""}` : ""}
                {typeof row.amountCents === "number" ? ` · ${formatMoneyExact(row.amountCents / 100)}` : ""}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => navigate(row.linkPath)}>
              {row.linkPath === "/productos" ? "Ver producto" : row.linkPath.startsWith("/pedidos/") ? "Ver este pedido" : "Ver pedido"}
            </Button>
          </div>
        ))}
        {filtered.length > visible && (
          <Button size="sm" variant="ghost" className="w-full" onClick={() => setVisible((v) => v + 40)}>
            Cargar más ({filtered.length - visible} restantes)
          </Button>
        )}
        {filtered.length === 0 && <p className="text-sm text-on-surface-soft">Sin registros con esos criterios.</p>}
      </div>
      <p className="mt-3 text-xs text-ink-soft">
        Las correcciones se registran en la entidad de origen con evidencia; nada se inventa para «poner en verde».
      </p>
    </Sheet>
  );
}

export function MonthlyCloseScreen() {
  const { state, activeStore, stateStatus } = useStore();
  const [offset, setOffset] = useState(0);
  // #456: which figure's drilldown sheet is open (null = none).
  const [detail, setDetail] = useState<null | "sales" | "costs" | "expenses" | "margin" | "result" | "collections">(null);
  // #457: which review QUEUE is open (null = none).
  const [queue, setQueue] = useState<null | "pedidos" | "cobros" | "costo">(null);
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
    customers: state.customers ?? [],
  });

  // #455: skeleton of stable structure while anything is still loading — a
  // dash placeholder, never a $0 with a definitive look (#406 lesson).
  const loading = stateStatus !== "ready" || loadingPayments;
  const monthName = `${MONTH_NAMES[month.month - 1]} ${month.year}`;
  const isCurrentMonth = offset === 0;

  const c = close.coverage;
  const queues = pendingQueues({
    storeId: activeStore.id,
    month,
    coverage: c,
    orders: storeOrders,
    customers: state.customers ?? [],
  });
  // Grouped pendings: one row per CAUSE with a count and a human explanation —
  // never a feed of individual hashes.
  const pendings: Array<{ count: number; label: string; explanation: string; onOpen?: () => void }> = [];
  if (c.deliveredWithoutDate.length > 0) {
    pendings.push({
      count: c.deliveredWithoutDate.length,
      label: c.deliveredWithoutDate.length === 1 ? "pedido entregado sin fecha verificable" : "pedidos entregados sin fecha verificable",
      explanation: "No podemos determinar a qué mes pertenecen sus ventas.",
      onOpen: () => setQueue("pedidos"),
    });
  }
  if (c.unconfirmedCollections.length > 0) {
    pendings.push({
      count: c.unconfirmedCollections.length,
      label: c.unconfirmedCollections.length === 1 ? "cobro sin fecha" : "cobros sin fecha",
      explanation: "No sabemos en qué periodo debe reconocerse cada entrada de dinero.",
      onOpen: () => setQueue("cobros"),
    });
  }
  if (c.linesWithoutCost.length > 0) {
    const pieces = c.linesWithoutCost.reduce((sum, entry) => sum + entry.quantity, 0);
    pendings.push({
      count: pieces,
      label: pieces === 1 ? "producto vendido sin costo conocido" : "productos vendidos sin costo conocido",
      explanation: "Puede afectar la utilidad.",
      onOpen: () => setQueue("costo"),
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
  // #455 r2 (revisión): a partial estimate is indeterminate — even a positive
  // result gets the NEUTRAL tone while a cost is missing.
  const resultTone =
    resultCents < 0 ? "danger" : resultCents > 0 && !close.costCoverage.partialByMissingCost ? "success" : "default";
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
          <p className="text-xs font-semibold tracking-wide text-on-surface-soft">
            {heroLabel}{" "}
            {close.costCoverage.partialByMissingCost && <Badge tone="warning">Estimación incompleta</Badge>}
          </p>
          <p className={`serif-display tnum text-4xl leading-tight mt-1 ${resultTone === "success" ? "text-success" : resultTone === "danger" ? "text-danger" : "text-ink"}`}>
            {loading ? "—" : signedMoney(resultCents)}
          </p>
          <p className="text-sm text-on-surface-soft mt-2">Este monto todavía no está autorizado para reparto.</p>
        </Card>

        {/* The 5-row formula — aligned, tabular, subtotals as separators. */}
        {!loading && close.salesCents === 0 && close.expensesCents === 0 && close.collectionsCents === 0 ? (
          <Card>
            <p className="text-sm text-on-surface-soft">Todavía no hay entregas verificadas en este periodo.</p>
          </Card>
        ) : (
          <Card>
            <h3 className="text-sm font-semibold text-ink">¿Cómo llegamos a este resultado?</h3>
            {!loading && close.salesCents === 0 && (
              <p className="text-xs text-on-surface-soft mt-1">Todavía no hay entregas verificadas en este periodo.</p>
            )}
            <div className="mt-2">
              <FormulaRow label="Ventas de productos entregados" cents={loading ? null : close.salesCents} onOpen={() => setDetail("sales")} />
              {/* #455 r3 (UX): net sales vs the operadora's notebook — the
                  returns line is VISIBLE, not hidden inside the drilldown. */}
              {!loading && close.posventaAdjustmentCents !== 0 && (
                <p className="text-xs text-on-surface-soft -mt-0.5">
                  Incluye {signedMoney(close.posventaAdjustmentCents)} de devoluciones y ajustes de posventa confirmados
                  este mes.
                </p>
              )}
              <FormulaRow label="Costo de los productos vendidos" cents={loading ? null : -close.costCents} signed onOpen={() => setDetail("costs")} />
              <FormulaRow label="Ganancia antes de gastos" cents={loading ? null : close.grossMarginCents} strong onOpen={() => setDetail("margin")} />
              <FormulaRow label="Gastos operativos del mes" cents={loading ? null : -close.expensesCents} signed onOpen={() => setDetail("expenses")} />
              <FormulaRow label="Resultado operativo" cents={loading ? null : close.operatingResultCents} strong onOpen={() => setDetail("result")} />
            </div>
          </Card>
        )}

        {/* Collections: a DIFFERENT flow — money received in the period, never
            an extra profit line inside the formula. */}
        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <Button variant="ghost" onClick={() => setDetail("collections")} className="!px-0 !py-0 !min-h-0 text-left !text-sm !font-semibold text-ink hover:!underline">
              Dinero recibido durante {MONTH_NAMES[month.month - 1]}
            </Button>
            <span className="text-xs rounded-full border border-edge px-2 py-0.5 text-on-surface-soft">Por fecha de cobro</span>
          </div>
          <p className={`serif-display tnum text-2xl mt-1 ${paymentsFailed ? "text-on-surface-soft" : "text-ink"}`}>
            {loading ? "—" : paymentsFailed ? "no disponibles" : formatMoneyExact(close.collectionsCents / 100)}
          </p>
          <p className="text-sm text-on-surface-soft mt-2">
            Incluye pagos registrados en {MONTH_NAMES[month.month - 1]}, aunque correspondan a ventas de otros meses o anticipos.
            No representa una ganancia adicional.
          </p>
          {/* #456: groups reconcile the origin of the money; the sales≠collections
              gap is a DATES difference, never an invented profit or loss. */}
          {close.collectionGroups.length > 0 && (
            <div className="mt-3">
              {close.collectionGroups.map((group) => (
                <div key={group.group} className="flex items-baseline justify-between gap-3 text-sm border-b border-rule/60 py-1">
                  <span className="text-on-surface-soft">
                    {group.label} <span className="text-xs">({group.count})</span>
                  </span>
                  <span className="tnum">{formatMoneyExact(group.totalCents / 100)}</span>
                </div>
              ))}
              <p className="text-xs text-on-surface-soft mt-2">
                Ventas y cobros se agrupan por fechas distintas: la venta cuenta al entregarse; el cobro, al entrar el dinero.
                La diferencia entre ambas cifras no es una ganancia ni un faltante.
              </p>
            </div>
          )}
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
                  {pending.onOpen && (
                    <Button size="sm" variant="secondary" onClick={pending.onOpen}>
                      Revisar
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

      {/* #456 drilldowns — the same-task detail for every figure. */}
      <FigureDetailSheet
        open={detail === "sales"} onClose={() => setDetail(null)}
        title={`¿De dónde salen estas ${formatMoneyExact(close.salesCents / 100)}?`}
        concept="Ventas de productos entregados" period={monthName}
        rows={close.details.sales}
      />
      <FigureDetailSheet
        open={detail === "costs"} onClose={() => setDetail(null)}
        title={`¿De dónde salen estos ${formatMoneyExact(close.costCents / 100)}?`}
        concept="Costo de los productos vendidos" period={monthName}
        rows={close.details.costs}
      />
      <FigureDetailSheet
        open={detail === "margin"} onClose={() => setDetail(null)}
        title={`¿De dónde salen estas ${formatMoneyExact(close.grossMarginCents / 100)}?`}
        concept="Ganancia antes de gastos (ventas − costo)" period={monthName}
        rows={[...close.details.sales, ...close.details.costs]} kindFilter
      />
      <FigureDetailSheet
        open={detail === "expenses"} onClose={() => setDetail(null)}
        title={`¿De dónde salen estos ${formatMoneyExact(close.expensesCents / 100)}?`}
        concept="Gastos operativos del mes" period={monthName}
        rows={close.details.expenses}
      />
      <FigureDetailSheet
        open={detail === "result"} onClose={() => setDetail(null)}
        title={`¿De dónde salen estas ${formatMoneyExact(close.operatingResultCents / 100)}?`}
        concept="Resultado operativo (ventas − costo − gastos)" period={monthName}
        rows={[...close.details.sales, ...close.details.costs, ...close.details.expenses]} kindFilter
      />
      {/* #457 review queues — same task, filtered and searchable. */}
      <QueueSheet open={queue === "pedidos"} onClose={() => setQueue(null)} title="Pedidos entregados sin fecha" queue={queues.pedidosSinFecha} />
      <QueueSheet open={queue === "cobros"} onClose={() => setQueue(null)} title="Cobros sin fecha" queue={queues.cobrosSinFecha} />
      <QueueSheet open={queue === "costo"} onClose={() => setQueue(null)} title="Productos sin costo" queue={queues.sinCosto} />

      <FigureDetailSheet
        open={detail === "collections"} onClose={() => setDetail(null)}
        title={paymentsFailed ? "Cobros no disponibles" : `¿De dónde salen estos ${formatMoneyExact(close.collectionsCents / 100)}?`}
        concept="Dinero recibido durante el mes" period={monthName}
        rows={close.details.collections}
        excluded={close.details.excludedCollections}
      />
    </Screen>
  );
}
