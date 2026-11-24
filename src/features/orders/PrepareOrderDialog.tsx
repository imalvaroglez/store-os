import { useRef } from "react";
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

// A repeated tap — the one that opened the dialog, or a nervous second one —
// lands wherever the dialog has just appeared, sometimes on «Preparar pedido»
// (measured on Inicio: 3 of 36 and 12 of 39 heights with an 80 ms double tap).
// The confirm action only arms once the dialog has settled: nobody reads
// "¿Preparar este pedido?" in under this time. Cancelar and Escape work at once.
export const CONFIRM_ARM_MS = 400;

export function PrepareOrderDialog({ order, onClose }: Props) {
  if (!order) return null;
  // Mounted per opening, so «when did this dialog open» is simply its mount.
  return <PrepareConfirmation order={order} onClose={onClose} />;
}

function PrepareConfirmation({ order, onClose }: { order: Order; onClose: () => void }) {
  const { state, upsertOrder } = useStore();
  const toast = useToast();
  const openedAt = useRef(Date.now());
  const customer = state.customers.find((c) => c.id === order.customerId && c.storeId === order.storeId);
  const items = orderItems(order);
  const preview = items.slice(0, 2).map((item) => item.productName).join(", ");
  const pieces = orderTotals(order).pieces;

  function confirm() {
    if (Date.now() - openedAt.current < CONFIRM_ARM_MS) return;
    // The CURRENT state decides: an order that changed while this dialog was
    // open shows its updated status instead of another advance. Looked up at
    // click time, never from a render that could predate the change.
    const fresh = state.orders.find((o) => o.id === order.id) ?? order;
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
