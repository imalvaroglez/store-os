import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  Money,
  StatRow,
  ORDER_STATUS_TONE,
  useToast,
} from "../../design-system";
import { ORDER_STATUS_LABELS, nextActionVerb, nextStatus } from "./orderStatus";
import { orderItems } from "../../lib/inventory";
import { pending, profit } from "../../lib/money";
import { tiersForStore } from "../../lib/pricing";
import type { Order } from "../../types";

export function OrderCard({ order, onEdit }: { order: Order; onEdit: () => void }) {
  const { upsertOrder, state } = useStore();
  const toast = useToast();
  const customer = state.customers.find((c) => c.id === order.customerId);
  const items = orderItems(order);
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const due = pending(total, order.deposit);
  const single = items.length <= 1;
  // Cost is a per-unit snapshot on the flat fields; only meaningful for
  // single-line orders (public/multi-item orders carry no cost).
  const est = single
    ? profit(total, order.cost != null ? order.cost * order.quantity : undefined)
    : undefined;
  const verb = nextActionVerb(order.status);

  // Runtime shortage: compare each line's quantity against the linked product's
  // current stock. Derived (not stored) so it clears automatically when Fer
  // replenishes. Only meaningful for catalog products with tracked stock.
  const shortfall = items.reduce((sum, i) => {
    if (!i.productId) return sum;
    const stock = state.products.find((p) => p.id === i.productId)?.quantityOnHand;
    return typeof stock === "number" ? sum + Math.max(0, i.quantity - stock) : sum;
  }, 0);

  function advance() {
    if (!verb) return;
    const next = nextStatus(order.status);
    if (!next) return;
    upsertOrder({ ...order, status: next, updatedAt: new Date().toISOString() });
    // Show the state reached (participle label), not the action verb.
    toast.success(`Pedido avanzado a «${ORDER_STATUS_LABELS[next]}»`);
  }

  return (
    <Card onClick={onEdit}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink truncate">
            {single ? items[0]?.productName ?? order.productName : `${items.length} productos`}
          </h3>
          <p className="text-xs text-ink-soft truncate">
            {customer?.name ?? "Sin cliente"}
            {order.priceTier && ` · ${tiersForStore(state.stores.find((s) => s.id === order.storeId)).find((t) => t.id === order.priceTier)?.label ?? "—"}`}
            {single && items[0] && items[0].quantity > 1 && ` · ${items[0].quantity} pzs`}
          </p>
          {!single && (
            <ul className="mt-1 space-y-0.5">
              {items.map((i, idx) => (
                <li key={`${i.productId ?? i.productName}-${idx}`} className="text-xs text-ink-soft truncate">
                  {i.quantity} × {i.productName}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge tone={ORDER_STATUS_TONE[order.status]}>
            {ORDER_STATUS_LABELS[order.status]}
          </Badge>
          {order.origin === "public" && <Badge tone="info">Catálogo</Badge>}
          {shortfall > 0 && (
            <Badge tone="warning">
              Faltan {shortfall} {shortfall === 1 ? "pieza" : "piezas"}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
        <StatRow label="Total">
          <Money amount={total} />
        </StatRow>
        <StatRow label="Falta cobrar" tone={due > 0 ? "danger" : "success"}>
          <Money amount={due} />
        </StatRow>
        {est != null && (
          <StatRow label="Ganancia" tone="success">
            <Money amount={est} />
          </StatRow>
        )}
      </div>

      {verb && (
        <div className="mt-3" onClick={(e) => e.stopPropagation()}>
          <Button full onClick={advance}>
            {verb}
          </Button>
        </div>
      )}
    </Card>
  );
}
