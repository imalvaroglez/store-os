import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  AnimatedNumber,
  Badge,
  Button,
  Card,
  Money,
  Reveal,
  ScreenHeader,
  Screen,
  StatRow,
} from "../../design-system";
import { ordersForStore, productsToRestock, customersForStore } from "../../lib/selectors";
import { stockAlertLevel, stockAlertText } from "../../lib/inventory";
import { orderProfitBreakdown } from "../../lib/saleProfit";
import { effectiveOrderStatus, orderCountsTowardToPay, orderItems, orderTotals } from "../../lib/orders";
import { iconicStatus } from "../../lib/iconic";
import { formatDate } from "../../lib/dates";
import { ORDER_STATUS_LABELS, nextActionVerb, advanceOrder } from "../orders/orderStatus";
import { OrderPaymentsSheet } from "../orders/OrderPaymentsSheet";
import { navigate } from "../../lib/router";
import { useToast } from "../../design-system";

export function HomeScreen() {
  const { state, activeStore, upsertOrder } = useStore();
  const toast = useToast();
  // Cobros sheet for orders in the payments model (#123+): Inicio rows must
  // register real receipts, never bump the deposit silently. Only the ID is
  // stored; the CANONICAL order is resolved on every render so an abono or
  // sync refreshes what the sheet shows — and the sheet simply closes if the
  // order leaves the current store context (Codex review of #186).
  const [paymentsOrderId, setPaymentsOrderId] = useState<string | null>(null);
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

  /** One-tap collection from the home row: LEGACY deposit-only orders only.
   * Orders in the payments model (#123+) must register a real receipt — the
   * button opens the Cobros sheet instead (Codex review 2026-11-04: the old
   * shortcut announced "Pedido cobrado" while the canonical saldo stood). */
  async function collect(orderId: string) {
    const o = orders.find((x) => x.id === orderId);
    if (!o) return;
    try {
      await upsertOrder({ ...o, deposit: orderTotals(o).estimatedTotal, updatedAt: new Date().toISOString() });
      toast.success("Pedido cobrado");
    } catch {
      toast.error("No se pudo registrar el cobro.");
    }
  }

  return (
    <>
    <Screen>
      <ScreenHeader
        title="Inicio"
        subtitle={`¿Qué necesitas hacer hoy en ${activeStore.name}?`}
        action={<Button onClick={() => navigate("/pedidos/nuevo")}>+ Nuevo pedido</Button>}
      />

      <Reveal>
        <div className="grid grid-cols-2 gap-4 mb-5">
          <Card>
            <StatRow label="Falta cobrar" tone="danger">
              <AnimatedNumber value={toPay} format="currency" className="text-[1.6rem] leading-tight" />
            </StatRow>
          </Card>
          <Card>
            <StatRow label="Ganancia esperada" tone="success">
              <AnimatedNumber value={expectedProfit} format="currency" className="text-[1.6rem] leading-tight" />
            </StatRow>
          </Card>
        </div>
      </Reveal>

      {iconicRenewals.length > 0 && (
        <Card className="mb-5 !bg-terracotta-soft/60 ring-terracotta/20">
          <h3 className="font-semibold text-terracotta text-sm">⏳ Iconic por renovar</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {iconicRenewals.map(({ customer, status }) => (
              <Badge key={customer.id} tone="warning">
                {customer.name} · vence {formatDate(status!.until)}
              </Badge>
            ))}
          </div>
          <Button variant="ghost" className="mt-2 !px-0" onClick={() => navigate("/clientes")}>
            Ver clientas →
          </Button>
        </Card>
      )}

      {restock.length > 0 && (
        <Card className="mb-5">
          <div className="flex items-baseline justify-between">
            <h3 className="font-semibold text-ink text-sm">⚠️ Por surtir</h3>
            <span className="text-xs text-ink-soft/70">{restock.length}</span>
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
                    <div className="min-w-0">
                      <p className="font-semibold text-ink text-sm truncate">
                        {preview || "Sin productos"}
                      </p>
                      <p className="text-xs text-ink-soft truncate">
                        {customer?.name ?? "—"} · {ORDER_STATUS_LABELS[status]}
                      </p>
                    </div>
                    {verb ? (
                      <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => advance(o.id)}>
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
    {paymentsOrder && (
      <OrderPaymentsSheet order={paymentsOrder} open onClose={() => setPaymentsOrderId(null)} />
    )}
    </>
  );
}
