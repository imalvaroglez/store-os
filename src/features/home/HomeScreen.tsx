import { useStore } from "../../app/StoreProvider";
import {
  AnimatedNumber,
  Badge,
  Button,
  Card,
  Reveal,
  ScreenHeader,
  Screen,
  StatRow,
} from "../../design-system";
import { ordersForStore, lowStockProducts } from "../../lib/selectors";
import { profit } from "../../lib/money";
import { effectiveOrderStatus, orderCountsTowardToPay, orderItems, orderTotals } from "../../lib/orders";
import { ORDER_STATUS_LABELS, nextActionVerb, advanceOrder } from "../orders/orderStatus";
import { navigate } from "../../lib/router";
import { useToast } from "../../design-system";

export function HomeScreen() {
  const { state, activeStore, upsertOrder } = useStore();
  const toast = useToast();
  if (!activeStore) return null;
  const isTiered = activeStore.type === "inventory_tiered";
  const orders = ordersForStore(state.orders, activeStore.id);
  // Inicio keeps every actionable unpaid order visible, including asked/quoted
  // orders. Completed and cancelled orders belong in the dedicated list only.
  const active = orders.filter(orderCountsTowardToPay);

  const toPay = active.reduce(
    (sum, o) => sum + orderTotals(o).balance,
    0
  );
  // Per-line profit: lines without a known cost contribute 0 instead of
  // blanking the whole estimate.
  const expectedProfit = active.reduce(
    (sum, o) => sum + orderItems(o).reduce((itemSum, item) => itemSum + (profit(item.unitPrice, item.cost, item.quantity) ?? 0), 0),
    0
  );
  const lowStock = isTiered ? lowStockProducts(state.products, activeStore.id) : [];

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

  /** One-tap collection from the home row: deposit rises to the total. */
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
    <Screen>
      <ScreenHeader title="Inicio" subtitle={`¿Qué necesitas hacer hoy en ${activeStore.name}?`} />

      <Button full size="lg" onClick={() => navigate("/pedidos/nuevo")} className="mb-4">
        + Nuevo pedido
      </Button>

      <Reveal>
        <div className="grid grid-cols-2 gap-3 mb-4">
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

      {lowStock.length > 0 && (
        <Card className="mb-4 !bg-terracotta-soft/60 ring-terracotta/20">
          <h3 className="font-semibold text-terracotta text-sm">⚠️ Baja existencia</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lowStock.map((p) => (
              <Badge key={p.id} tone="warning">
                {p.name} ({p.quantityOnHand})
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <div className="flex items-baseline justify-between mb-2 mt-1">
        <h2 className="serif-display text-lg font-semibold text-ink">Pedidos activos</h2>
        <span className="text-xs text-ink-soft/70">{active.length}</span>
      </div>
      <div className="rule mb-3" />
      {active.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-soft text-center py-2">
            No tienes pedidos pendientes. 🎉
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {active.slice(0, 8).map((o) => {
            const customer = state.customers.find((c) => c.id === o.customerId);
            const status = effectiveOrderStatus(o);
            const verb = nextActionVerb(status);
            const totals = orderTotals(o);
            const preview = orderItems(o).slice(0, 2).map((item) => item.productName).join(", ");
            return (
              <Card key={o.id}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink text-sm truncate">
                      {preview || "Sin productos"}
                    </p>
                    <p className="text-xs text-ink-soft">
                      {customer?.name ?? "—"} · {ORDER_STATUS_LABELS[status]}
                    </p>
                  </div>
                  {verb ? (
                    <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => advance(o.id)}>
                      {verb}
                    </Button>
                  ) : totals.balance > 0 ? (
                    <Button size="sm" variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => collect(o.id)}>
                      Cobrar
                    </Button>
                  ) : null}
                </div>
              </Card>
            );
          })}
          {active.length > 8 && (
            <Button
              variant="ghost"
              full
              onClick={() => navigate("/pedidos")}
              className="py-2"
            >
              Ver todos los pedidos →
            </Button>
          )}
        </div>
      )}

    </Screen>
  );
}
