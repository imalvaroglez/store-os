import { useState } from "react";
import { useStore, newOrder } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  Money,
  ScreenHeader,
  Sheet,
  StatRow,
} from "../../design-system";
import { OrderForm } from "../orders/OrderForm";
import { ordersForStore, lowStockProducts } from "../../lib/selectors";
import { pending, profit } from "../../lib/money";
import { ORDER_STATUS_LABELS, nextActionVerb, nextStatus } from "../orders/orderStatus";
import { navigate } from "../../lib/router";

export function HomeScreen() {
  const { state, activeStore, upsertOrder } = useStore();
  const [creating, setCreating] = useState(false);

  if (!activeStore) return null;
  const isTiered = activeStore.type === "inventory_tiered";
  const orders = ordersForStore(state.orders, activeStore.id);
  const active = orders.filter((o) => o.status !== "paid");

  const toPay = active.reduce(
    (sum, o) => sum + pending(o.price * o.quantity, o.deposit),
    0
  );
  const expectedProfit = active.reduce((sum, o) => {
    if (o.cost == null) return sum;
    return sum + (profit(o.price * o.quantity, o.cost * o.quantity) ?? 0);
  }, 0);
  const lowStock = isTiered ? lowStockProducts(state.products, activeStore.id) : [];

  function advance(orderId: string) {
    const o = orders.find((x) => x.id === orderId);
    if (!o || !nextActionVerb(o.status)) return;
    const next = nextStatus(o.status);
    if (!next) return;
    upsertOrder({ ...o, status: next, updatedAt: new Date().toISOString() });
  }

  return (
    <div className="p-4">
      <ScreenHeader title="Inicio" subtitle={`¿Qué necesitas hacer hoy en ${activeStore.name}?`} />

      <Button full size="lg" onClick={() => setCreating(true)} className="mb-4">
        + Nuevo pedido
      </Button>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card>
          <StatRow label="Falta cobrar" tone="danger">
            <Money amount={toPay} className="text-[1.6rem] leading-tight" />
          </StatRow>
        </Card>
        <Card>
          <StatRow label="Ganancia esperada" tone="success">
            <Money amount={expectedProfit} className="text-[1.6rem] leading-tight" />
          </StatRow>
        </Card>
      </div>

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
            const verb = nextActionVerb(o.status);
            return (
              <Card key={o.id}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink text-sm truncate">
                      {o.productName}
                    </p>
                    <p className="text-xs text-ink-soft">
                      {customer?.name ?? "—"} · {ORDER_STATUS_LABELS[o.status]}
                    </p>
                  </div>
                  {verb && (
                    <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => advance(o.id)}>
                      {verb}
                    </Button>
                  )}
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

      <Sheet open={creating} onClose={() => setCreating(false)} title="Nuevo pedido">
        <OrderForm order={newOrder(activeStore.id)} onDone={() => setCreating(false)} />
      </Sheet>
    </div>
  );
}
