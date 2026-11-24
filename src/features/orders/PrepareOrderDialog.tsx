import { Button, Dialog, useToast } from "../../design-system";
import { useStore } from "../../app/StoreProvider";
import { effectiveOrderStatus, orderItems, orderReference, orderTotals } from "../../lib/orders";
import { ORDER_STATUS_LABELS, advanceOrder } from "./orderStatus";
import type { Order } from "../../types";

// #539 (QA verdict): «Preparar» is the one tap that changes an order's state
// on its own. Inicio and the Pedidos list show the SAME confirmation — folio,
// pieces and clienta, the exact step (Confirmado → Preparando) — and on
// confirm the CURRENT state decides, never a second advance.

type Props = { order: Order | null; onClose: () => void };

export function PrepareOrderDialog({ order, onClose }: Props) {
  const { state, upsertOrder } = useStore();
  const toast = useToast();
  if (!order) return null;
  const customer = state.customers.find((c) => c.id === order.customerId && c.storeId === order.storeId);
  const items = orderItems(order);
  const preview = items.slice(0, 2).map((item) => item.productName).join(", ");
  const pieces = orderTotals(order).pieces;
  // The non-null order for the handler below (narrowing does not cross into it).
  const current = order;

  function confirm() {
    // The CURRENT state decides: an order that changed while this dialog was
    // open shows its updated status instead of another advance. Looked up at
    // click time, never from a render that could predate the change.
    const fresh = state.orders.find((o) => o.id === current.id) ?? current;
    const status = effectiveOrderStatus(fresh);
    if (status !== "confirmed") {
      onClose();
      toast.info(`El pedido ya no está Confirmado: ahora está ${ORDER_STATUS_LABELS[status]}.`);
      return;
    }
    const advanced = advanceOrder(fresh);
    if (!advanced) return;
    onClose();
    upsertOrder(advanced)
      .then(() => toast.success(`Pedido #${orderReference(advanced.id)} avanzado a «${ORDER_STATUS_LABELS[advanced.orderStatus]}»`))
      .catch(() => toast.error("No se pudo actualizar el pedido."));
  }

  return (
    <Dialog
      open
      title="¿Preparar este pedido?"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={confirm}>Preparar pedido</Button>
        </div>
      }
    >
      <p className="text-sm font-semibold text-ink">
        #{orderReference(order.id)} · {order.customerName || customer?.name || "Sin cliente"}
      </p>
      <p className="text-sm text-on-surface mt-1">
        {preview || "Sin productos"}{items.length > 2 ? ` y ${items.length - 2} más` : ""} ·{" "}
        {pieces} {pieces === 1 ? "pieza" : "piezas"}
      </p>
      <p className="text-sm text-on-surface-soft mt-2">
        El pedido pasará de Confirmado a Preparando. Ningún otro pedido cambia y puedes cancelar sin dejar rastro.
      </p>
    </Dialog>
  );
}
