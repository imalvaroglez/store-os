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
import { ORDER_STATUS_LABELS, nextActionVerb, advanceOrder } from "./orderStatus";
import { pending, profit } from "../../lib/money";
import { tiersForStore } from "../../lib/pricing";
import type { Order } from "../../types";

export function OrderCard({ order, onEdit }: { order: Order; onEdit: () => void }) {
  const { upsertOrder, state } = useStore();
  const toast = useToast();
  const customer = state.customers.find((c) => c.id === order.customerId);
  const total = order.price * order.quantity;
  const due = pending(total, order.deposit);
  const est = profit(total, order.cost != null ? order.cost * order.quantity : undefined);
  const verb = nextActionVerb(order.status);

  // Runtime shortage: compare the ordered quantity against the linked product's
  // current stock. Derived (not stored) so it clears automatically when Fer
  // replenishes. Only meaningful when the order references a catalog product.
  const product = order.productId ? state.products.find((p) => p.id === order.productId) : undefined;
  const stock = typeof product?.quantityOnHand === "number" ? product.quantityOnHand : undefined;
  const shortfall = typeof stock === "number" ? Math.max(0, order.quantity - stock) : 0;

  function advance() {
    const advanced = advanceOrder(order);
    if (!advanced) return;
    upsertOrder(advanced);
    // Show the state reached (participle label), not the action verb.
    toast.success(`Pedido avanzado a «${ORDER_STATUS_LABELS[advanced.status]}»`);
  }

  return (
    <Card onClick={onEdit}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink truncate">{order.productName}</h3>
          <p className="text-xs text-ink-soft truncate">
            {customer?.name ?? "Sin cliente"}
            {order.priceTier && ` · ${tiersForStore(state.stores.find((s) => s.id === order.storeId)).find((t) => t.id === order.priceTier)?.label ?? "—"}`}
            {order.quantity > 1 && ` · ${order.quantity} pzs`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge tone={ORDER_STATUS_TONE[order.status]}>
            {ORDER_STATUS_LABELS[order.status]}
          </Badge>
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
