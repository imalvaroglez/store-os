import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  AnimatedNumber,
  Badge,
  Button,
  Card,
  Dialog,
  Money,
  Reveal,
  ScreenHeader,
  Screen,
  StatRow,
} from "../../design-system";
import { ordersForStore, productsToRestock, customersForStore } from "../../lib/selectors";
import { monthRanking, currentMonth } from "../../lib/resellerRanking";
import { stockAlertLevel, stockAlertText } from "../../lib/inventory";
import { orderProfitBreakdown } from "../../lib/saleProfit";
import { effectiveOrderStatus, orderCountsTowardToPay, orderItems, orderTotals } from "../../lib/orders";
import { iconicStatus } from "../../lib/iconic";
import { formatDate } from "../../lib/dates";
import { ORDER_STATUS_LABELS, nextActionVerb, advanceOrder } from "../orders/orderStatus";
import { OrderPaymentsSheet } from "../orders/OrderPaymentsSheet";
import { FinancialPositionCard } from "../financial/FinancialPositionCard";
import { DeliverySheet } from "../orders/DeliverySheet";
import { pendingDeliveries } from "../../lib/deliveries";
import { navigate } from "../../lib/router";
import { useToast } from "../../design-system";

export function HomeScreen() {
  const { state, activeStore, upsertOrder, stateStatus } = useStore();
  const toast = useToast();
  // Cobros sheet for orders in the payments model (#123+): Inicio rows must
  // register real receipts, never bump the deposit silently. Only the ID is
  // stored; the CANONICAL order is resolved on every render so an abono or
  // sync refreshes what the sheet shows — and the sheet simply closes if the
  // order leaves the current store context (Codex review of #186).
  const [paymentsOrderId, setPaymentsOrderId] = useState<string | null>(null);
  const [expressPrefillCents, setExpressPrefillCents] = useState<number | null>(null);
  // #333: delivery-evidence sheet for the "Entregar" rows (same as the card).
  const [deliveryOrderId, setDeliveryOrderId] = useState<string | null>(null);
  // #539: «Preparar» is the one Home action that CHANGES an order's state on
  // its own — it confirms first, naming the order and the exact step.
  const [prepareOrderId, setPrepareOrderId] = useState<string | null>(null);
  if (!activeStore) return null;
  const isTiered = activeStore.type === "inventory_tiered";
  const orders = ordersForStore(state.orders, activeStore.id);
  const paymentsOrder = paymentsOrderId ? orders.find((o) => o.id === paymentsOrderId) ?? null : null;
  // Inicio keeps every actionable unpaid order visible, including asked/quoted
  // orders. Completed and cancelled orders belong in the dedicated list only.
  const active = orders.filter(orderCountsTowardToPay);

  const toPay = active.reduce(
    (sum, o) => sum + orderTotals(o).balance,
    0
  );
  // Full-cost profit (FER-03), same rule as the order card: precio − costo de
  // compra − gastos de venta; orders without any known cost contribute 0.
  const expectedProfit = active.reduce(
    (sum, o) => sum + (orderProfitBreakdown(o, state.purchases).profitCents ?? 0),
    0
  ) / 100;
  // FER-09 restock alerts, derived from synced state (no extra Firestore reads).
  // On-demand stores track no stock, so only tiered stores can alert.
  const restock = isTiered ? productsToRestock(state.products, activeStore.id) : [];
  // #132 (FER-17): the private in-app notice — the PREVIOUS month's ranking is
  // ready for Fer's review while it has no confirmation yet. Pure state; no
  // extra reads. Shown only when there is something to review.
  const previousMonth = (() => {
    const now = currentMonth();
    const zero = now.year * 12 + (now.month - 1) - 1;
    return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
  })();
  const previousRanking = monthRanking({
    storeId: activeStore.id,
    month: previousMonth,
    orders: state.orders,
    customers: state.customers,
  });
  const rankingPendingReview =
    previousRanking.entries.length > 0 &&
    !(state.rankingConfirmations ?? []).some(
      (confirmation) =>
        confirmation.storeId === activeStore.id &&
        confirmation.year === previousMonth.year &&
        confirmation.month === previousMonth.month
    );
  // FER-05 aviso previo (visual only): iconic customers whose validity ends
  // within the notice window, most urgent first. Derives from synced state.
  const iconicRenewals = isTiered
    ? customersForStore(state.customers, activeStore.id)
        .map((customer) => ({ customer, status: iconicStatus(customer, orders) }))
        .filter((x) => x.status?.active && x.status.expiringSoon)
        .sort((a, b) => a.status!.until.localeCompare(b.status!.until))
    : [];

  async function advance(orderId: string) {
    const o = orders.find((x) => x.id === orderId);
    if (!o) return;
    const advanced = advanceOrder(o);
    if (!advanced) return;
    try {
      await upsertOrder(advanced);
    } catch {
      toast.error("No se pudo actualizar el pedido.");
    }
  }

  /** #279 r4 (UX r3): the home "Cobrar" no longer writes a bare deposit —
   * same treatment as the order card (#267/#489 evidence rule): open the
   * Cobros sheet with the NET pending amount prefilled so the receipt feeds
   * the caja. A deposit without a receipt never did. */
  function collect(orderId: string) {
    const o = orders.find((x) => x.id === orderId);
    if (!o) return;
    const { balance } = orderTotals(o);
    setExpressPrefillCents(balance > 0 ? Math.round(balance * 100) : null);
    setPaymentsOrderId(o.id);
  }

  return (
    <>
    <Screen>
      <ScreenHeader
        title="Inicio"
        subtitle={`¿Qué necesitas hacer hoy en ${activeStore.name}?`}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* #455 r3 (UX): the month's close is reachable from Inicio —
                living only under Productos▸Gastos was "knowing the hideout". */}
            <Button variant="ghost" onClick={() => navigate("/productos/cierre")}>Cierre mensual</Button>
            <Button onClick={() => navigate("/pedidos/nuevo")}>+ Nuevo pedido</Button>
          </div>
        }
      />

      <Reveal>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <Card>
            <StatRow label="Falta cobrar" tone="danger">
              {/* #406 r2: while orders load, a dash — never a $0 that looks
                  final. The first real value paints directly (no 0-count). */}
              {stateStatus !== "ready"
                ? <span aria-label="Cargando" className="serif-display tnum text-[1.6rem] leading-tight">—</span>
                : <AnimatedNumber value={toPay} format="currency" className="text-[1.6rem] leading-tight" />}
            </StatRow>
          </Card>
          <Card>
            <StatRow label="Ganancia esperada" tone="success">
              {stateStatus !== "ready"
                ? <span aria-label="Cargando" className="serif-display tnum text-[1.6rem] leading-tight">—</span>
                : <AnimatedNumber value={expectedProfit} format="currency" className="text-[1.6rem] leading-tight" />}
            </StatRow>
          </Card>
        </div>
      </Reveal>

      <Reveal>
        <FinancialPositionCard />
      </Reveal>

      {iconicRenewals.length > 0 && (
        <Card className="mb-5 bg-terracotta-soft/60! ring-terracotta/20">
          <h3 className="font-semibold text-terracotta text-sm">⏳ Iconic por renovar</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {iconicRenewals.map(({ customer, status }) => (
              <Badge key={customer.id} tone="warning">
                {customer.name} · vence {formatDate(status!.until)}
              </Badge>
            ))}
          </div>
          <Button variant="ghost" className="mt-2 px-0!" onClick={() => navigate("/clientes")}>
            Ver clientas →
          </Button>
        </Card>
      )}

      {rankingPendingReview && (
        <Card className="mb-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h3 className="font-semibold text-ink text-sm">🏆 Top emprendedoras listo para tu revisión</h3>
              <p className="text-xs text-on-surface-soft mt-0.5">
                El ranking del mes pasado está listo: revísalo y confirma el resultado antes de comunicar incentivos.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => navigate("/productos/ranking")}>Ver top →</Button>
          </div>
        </Card>
      )}

      {restock.length > 0 && (
        <Card className="mb-5">
          <div className="flex items-baseline justify-between">
            <h3 className="font-semibold text-ink text-sm">⚠️ Por surtir</h3>
            {/* #337: the count is PRODUCTS in alert, not missing pieces — say so,
                or a store with 40 products / 280 missing pieces reads backwards. */}
            <span className="text-xs text-ink-soft/70">
              {restock.length} {restock.length === 1 ? "producto" : "productos"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {restock.map((p) => (
              <Badge key={p.id} tone={stockAlertLevel(p) === "out" ? "danger" : "warning"}>
                {p.name} · {stockAlertText(p)}
              </Badge>
            ))}
          </div>
          <Button variant="ghost" full onClick={() => navigate("/productos")} className="py-2 mt-3">
            Ver catálogo →
          </Button>
        </Card>
      )}

      <div className="flex items-baseline justify-between mb-2 mt-1">
        <h2 className="serif-display text-lg font-semibold text-ink">Pedidos activos</h2>
        <span className="text-xs text-ink-soft/70">{active.length}</span>
      </div>
      <div className="rule mb-5" />
      {active.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-soft text-center py-2">
            No tienes pedidos pendientes. 🎉
          </p>
        </Card>
      ) : (
        <div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {active.slice(0, 8).map((o) => {
              const customer = state.customers.find((c) => c.id === o.customerId);
              const status = effectiveOrderStatus(o);
              const verb = nextActionVerb(status);
              const totals = orderTotals(o);
              const preview = orderItems(o).slice(0, 2).map((item) => item.productName).join(", ");
              return (
                <Card key={o.id}>
                  <div className="flex items-center justify-between gap-3">
                    {/* #539: the card itself opens the EXACT order — the route
                        mental «veo mi pedido → lo toco». It never changes state;
                        its accessible action is distinct from «Preparar». */}
                    <Button
                      variant="ghost"
                      className="!min-w-0 !flex-1 !justify-start !px-0 !text-left"
                      onClick={() => navigate(`/pedidos/${o.id}`)}
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-ink text-sm truncate">
                          {preview || "Sin productos"}
                        </span>
                        <span className="block text-xs text-ink-soft truncate">
                          {customer?.name ?? "—"} · {ORDER_STATUS_LABELS[status]}
                        </span>
                      </span>
                    </Button>
                    {verb ? (
                      <Button
                        size="sm"
                        className="shrink-0 whitespace-nowrap"
                        onClick={() => {
                          // #539: preparing is the money-adjacent step that
                          // changed an order with one touch — confirm first.
                          if (verb === "Preparar") setPrepareOrderId(o.id);
                          // #333: delivering registers the evidence (per piece,
                          // effective date) — Home must not bypass the sheet.
                          else if (verb === "Entregar" && pendingDeliveries(o).length > 0) setDeliveryOrderId(o.id);
                          else void advance(o.id);
                        }}
                      >
                        {verb}
                      </Button>
                    ) : o.installments ? (
                      totals.balance > 0 && (
                        <Button size="sm" variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => setPaymentsOrderId(o.id)}>
                          Abonar
                        </Button>
                      )
                    ) : totals.balance > 0 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="shrink-0 whitespace-nowrap"
                        onClick={() =>
                          typeof o.paymentsReceivedCents === "number" ? setPaymentsOrderId(o.id) : collect(o.id)
                        }
                      >
                        Cobrar
                      </Button>
                    ) : null}
                  </div>
                  {/* The wide row earns its width: money up front, not a void. */}
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <StatRow label="Total">
                      <Money amount={totals.estimatedTotal} />
                    </StatRow>
                    <StatRow label="Saldo" tone={totals.balance > 0 ? "danger" : "success"}>
                      <Money amount={totals.balance} />
                    </StatRow>
                  </div>
                </Card>
              );
            })}
          </div>
          {active.length > 8 && (
            <Button
              variant="ghost"
              full
              onClick={() => navigate("/pedidos")}
              className="py-2 mt-5"
            >
              Ver todos los pedidos →
            </Button>
          )}
        </div>
      )}

    </Screen>
      {deliveryOrderId && (() => {
        const deliveryOrder = orders.find((x) => x.id === deliveryOrderId);
        // The order can leave the store context while the sheet is open —
        // close quietly instead of crashing on undefined (same guard as the
        // payments sheet).
        return deliveryOrder ? (
          <DeliverySheet key={deliveryOrderId} order={deliveryOrder} open onClose={() => setDeliveryOrderId(null)} />
        ) : null;
      })()}
      {(() => {
            // #539: the confirmation names the order and the exact step. On
            // confirm, the CURRENT state decides — an order that changed while
            // the dialog was open shows its updated status instead of another
            // advance. Cancelar leaves everything intact.
            const prepareOrder = prepareOrderId ? orders.find((o) => o.id === prepareOrderId) ?? null : null;
            if (!prepareOrder) return null;
            const prepareCustomer = state.customers.find((c) => c.id === prepareOrder.customerId);
            const preparePreview = orderItems(prepareOrder).slice(0, 2).map((item) => item.productName).join(", ");
            const prepareStatus = effectiveOrderStatus(prepareOrder);
            return (
              <Dialog
                open
                title="¿Preparar este pedido?"
                onClose={() => setPrepareOrderId(null)}
                footer={
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setPrepareOrderId(null)}>Cancelar</Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        const fresh = orders.find((o) => o.id === prepareOrder.id);
                        const freshStatus = fresh ? effectiveOrderStatus(fresh) : null;
                        if (!fresh || freshStatus !== "confirmed") {
                          setPrepareOrderId(null);
                          toast.info(`El pedido ya no está Confirmado: ahora está ${ORDER_STATUS_LABELS[freshStatus ?? prepareStatus]}.`);
                          return;
                        }
                        setPrepareOrderId(null);
                        void advance(fresh.id);
                      }}
                    >
                      Preparar pedido
                    </Button>
                  </div>
                }
              >
                <p className="text-sm text-on-surface">
                  {preparePreview || "Sin productos"} · {prepareCustomer?.name ?? "—"}
                </p>
                <p className="text-sm text-on-surface-soft mt-1">
                  El pedido pasará de Confirmado a Preparando. Ningún otro pedido cambia y puedes cancelar sin dejar
                  rastro.
                </p>
              </Dialog>
            );
          })()}

    {paymentsOrder && (
      <OrderPaymentsSheet
        order={paymentsOrder}
        open
        onClose={() => { setPaymentsOrderId(null); setExpressPrefillCents(null); }}
        prefillAmountCents={expressPrefillCents}
      />
    )}
    </>
  );
}
