import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  Money,
  PAYMENT_STATUS_TONE,
  ORDER_STATUS_TONE,
  StatRow,
  useToast,
} from "../../design-system";
import { orderItems, orderReference, orderTotals, paymentStatusForOrder, effectiveOrderStatus } from "../../lib/orders";
import { profit } from "../../lib/money";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, nextActionVerb, advanceOrder } from "./orderStatus";
import type { Order } from "../../types";

export function OrderCard({ order, onEdit }: { order: Order; onEdit: () => void }) {
  const { upsertOrder, state } = useStore();
  const toast = useToast();
  const customer = state.customers.find((c) => c.id === order.customerId);
  const items = orderItems(order);
  const totals = orderTotals(order);
  const paymentStatus = paymentStatusForOrder(order);
  const status = effectiveOrderStatus(order);
  const verb = nextActionVerb(status);
  // Per-line profit: lines without a known cost contribute 0 instead of
  // blanking the whole order's estimate.
  const knownProfit = items.some((item) => item.cost != null)
    ? items.reduce((sum, item) => sum + (profit(item.unitPrice, item.cost, item.quantity) ?? 0), 0)
    : undefined;
  const shortageByProduct = new Map<string, number>();
  items.forEach((item) => {
    if (!item.productId) return;
    const product = state.products.find((candidate) => candidate.id === item.productId);
    const stock = typeof product?.quantityOnHand === "number" ? product.quantityOnHand : undefined;
    if (typeof stock === "number" && stock < 0) shortageByProduct.set(item.productId, -stock);
  });
  const shortages = [...shortageByProduct.values()];
  const preview = items.slice(0, 3).map((item) => `${item.quantity} × ${item.productName}`).join(", ");
  // "T00:00:00" is load-bearing: a bare yyyy-mm-dd parses as UTC and shows the
  // previous day in Mexico (UTC-6).
  const orderDate = order.promisedDate
    ? `Prometido: ${new Date(`${order.promisedDate}T00:00:00`).toLocaleDateString("es-MX")}`
    : order.createdAt ? `Creado: ${new Date(order.createdAt).toLocaleDateString("es-MX")}` : "Sin fecha";

  async function advance() {
    const advanced = advanceOrder(order);
    if (!advanced) return;
    try {
      await upsertOrder(advanced);
      toast.success(`Pedido avanzado a «${ORDER_STATUS_LABELS[advanced.orderStatus]}»`);
    } catch {
      toast.error("No se pudo actualizar el pedido.");
    }
  }

  /** One-tap payment collection: deposit rises to the total, paymentStatus re-derives to paid. */
  async function collect() {
    try {
      await upsertOrder({ ...order, deposit: totals.estimatedTotal, updatedAt: new Date().toISOString() });
      toast.success("Pedido cobrado");
    } catch {
      toast.error("No se pudo registrar el cobro.");
    }
  }

  return (
    <Card onClick={onEdit} className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink truncate">#{orderReference(order.id)} · {order.requesterName ?? customer?.name ?? "Sin cliente"}</h3>
          <p className="text-xs text-ink-soft truncate">{preview || "Sin productos"}{items.length > 3 && " …"}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABELS[status]}</Badge>
          {status !== "requested" && <Badge tone={PAYMENT_STATUS_TONE[paymentStatus]}>{PAYMENT_STATUS_LABELS[paymentStatus]}</Badge>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3 text-xs text-ink-soft">
        <span>{items.length} {items.length === 1 ? "producto" : "productos"}</span>
        <span>·</span>
        <span>{totals.pieces} {totals.pieces === 1 ? "pieza" : "piezas"}</span>
        <span>·</span>
        <span>{orderDate}</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
        <StatRow label="Total"><Money amount={totals.estimatedTotal} /></StatRow>
        <StatRow label="Pagado"><Money amount={totals.paid} /></StatRow>
        <StatRow label="Saldo" tone={totals.balance > 0 ? "danger" : "success"}><Money amount={totals.balance} /></StatRow>
      </div>
      {knownProfit != null && <p className="text-xs text-ink-soft mt-2">Ganancia estimada: <Money amount={knownProfit} /></p>}
      {shortages.length > 0 && <Badge tone="warning">Faltan {shortages.reduce((sum, n) => sum + n, 0)} piezas</Badge>}

      {status === "requested" ? (
        <div className="mt-3" onClick={(event) => event.stopPropagation()}>
          <Button full variant="secondary" onClick={onEdit}>Revisar solicitud</Button>
        </div>
      ) : (verb || totals.balance > 0) && (
        <div className="mt-3 flex gap-2" onClick={(event) => event.stopPropagation()}>
          {verb && <Button full onClick={advance}>{verb}</Button>}
          {totals.balance > 0 && (
            <Button variant="secondary" full onClick={collect}>Cobrar</Button>
          )}
        </div>
      )}
    </Card>
  );
}
