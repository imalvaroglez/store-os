import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  Money,
  StatRow,
  ORDER_STATUS_TONE,
} from "../../design-system";
import { ORDER_STATUS_LABELS, nextActionVerb, nextStatus } from "./orderStatus";
import { pending, profit } from "../../lib/money";
import { TIER_LABELS } from "../../lib/labels";
import type { Order } from "../../types";

export function OrderCard({ order, onEdit }: { order: Order; onEdit: () => void }) {
  const { upsertOrder, state } = useStore();
  const customer = state.customers.find((c) => c.id === order.customerId);
  const total = order.price * order.quantity;
  const due = pending(total, order.deposit);
  const est = profit(total, order.cost != null ? order.cost * order.quantity : undefined);
  const verb = nextActionVerb(order.status);

  function advance() {
    if (!verb) return;
    const next = nextStatus(order.status);
    if (!next) return;
    upsertOrder({ ...order, status: next, updatedAt: new Date().toISOString() });
  }

  return (
    <Card onClick={onEdit}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink truncate">{order.productName}</h3>
          <p className="text-xs text-ink-soft truncate">
            {customer?.name ?? "Sin cliente"}
            {order.priceTier && ` · ${TIER_LABELS[order.priceTier]}`}
            {order.quantity > 1 && ` · ${order.quantity} pzs`}
          </p>
        </div>
        <Badge tone={ORDER_STATUS_TONE[order.status]} className="shrink-0">
          {ORDER_STATUS_LABELS[order.status]}
        </Badge>
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
