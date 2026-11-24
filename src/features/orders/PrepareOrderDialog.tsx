import { useEffect, useState } from "react";
import { Button, Dialog, useToast } from "../../design-system";
import { useStore } from "../../app/StoreProvider";
import { StaleOrderError } from "../../app/firebase/firestoreData";
import { orderLineLabel } from "./orderTicket";
import { effectiveOrderStatus, orderItems, orderReference, orderTotals } from "../../lib/orders";
import { ORDER_STATUS_LABELS, advancedMessage, advanceOrder } from "./orderStatus";
import type { Order } from "../../types";

// #539 (QA verdict): «Preparar» is the one tap that changes an order's state
// on its own. Inicio and the Pedidos list show the SAME confirmation — folio,
// pieces and clienta, the exact step (Confirmado → Preparando) — and on
// confirm the CURRENT state decides, never a second advance.

type Props = { order: Order | null; onClose: () => void };

// A repeated tap — the one that opened the dialog, or a nervous second one —
// lands wherever the dialog has just appeared, sometimes on «Preparar pedido»
// (measured on Inicio: 3 of 36 and 12 of 39 heights with an 80 ms double tap).
// The confirm action only arms once the dialog has settled: the theme's own
// entry motion, never shorter than a human double tap. Until then the button
// is visibly disabled; Cancelar and Escape answer at once.
const ARM_FLOOR_MS = 400;

/** The theme's entry motion (its `--motion-base` token) in ms; 0 when unreadable. */
function themeMotionMs(): number {
  const token = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--motion-base").trim();
  const seconds = token.endsWith("ms") ? Number.parseFloat(token) / 1000 : Number.parseFloat(token);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
}

/** How long until «Preparar pedido» answers. */
export function confirmArmMs(): number {
  return Math.max(ARM_FLOOR_MS, themeMotionMs());
}

export function PrepareOrderDialog({ order, onClose }: Props) {
  if (!order) return null;
  // Mounted per opening: its mount starts the settling timer below.
  return <PrepareConfirmation order={order} onClose={onClose} />;
}

function PrepareConfirmation({ order, onClose }: { order: Order; onClose: () => void }) {
  const { state, upsertOrder } = useStore();
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), confirmArmMs());
    return () => window.clearTimeout(timer);
  }, []);
  const customer = state.customers.find((c) => c.id === order.customerId && c.storeId === order.storeId);
  const items = orderItems(order);
  const preview = items.slice(0, 2).map((item) => `${item.quantity} × ${orderLineLabel(item)}`).join(", ");
  const pieces = orderTotals(order).pieces;

  function confirm() {
    // The order as last rendered decides: one that changed while this dialog
    // was open arrives here with its updated status, so there is no second
    // advance. A change the sync has not delivered yet is refused by the
    // transaction (StaleOrderError) and says so below.
    const status = effectiveOrderStatus(order);
    if (status !== "confirmed") {
      onClose();
      toast.info(`El pedido ya no está Confirmado: ahora está ${ORDER_STATUS_LABELS[status]}.`);
      return;
    }
    const advanced = advanceOrder(order);
    if (!advanced) return;
    onClose();
    upsertOrder(advanced)
      .then(() => toast.success(advancedMessage(advanced)))
      .catch((error: unknown) => {
        toast.error(error instanceof StaleOrderError ? error.message : "No se pudo actualizar el pedido.");
      });
  }

  return (
    <Dialog
      open
      title="¿Preparar este pedido?"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={!armed} onClick={confirm}>Preparar pedido</Button>
        </>
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
