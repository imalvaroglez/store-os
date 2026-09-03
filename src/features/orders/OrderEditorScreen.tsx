import { useState } from "react";
import { useStore, newOrder } from "../../app/StoreProvider";
import { Badge, Button, Card, Dialog, EmptyState, Money, Screen, ScreenHeader, StatRow, useToast } from "../../design-system";
import { navigate } from "../../lib/router";
import { useRoute } from "../../app/router";
import { OrderForm } from "./OrderForm";
import { orderItems, orderReference, orderTotals } from "../../lib/orders";
import type { Order } from "../../types";

export function OrderEditorScreen() {
  const { state, activeStore } = useStore();
  const route = useRoute();
  const sub = route.name === "admin" ? route.params.sub ?? "" : "";
  const [draft] = useState(() => newOrder(activeStore?.id ?? ""));

  if (!activeStore) return null;
  const order = sub === "nuevo"
    ? { ...draft, storeId: activeStore.id }
    : state.orders.find((item) => item.id === sub && item.storeId === activeStore.id);

  if (!order) {
    return (
      <Screen>
        <EmptyState title="Pedido no encontrado" subtitle="Puede que ya no exista o pertenezca a otra tienda." />
        <Button full onClick={() => navigate("/pedidos")}>Volver a pedidos</Button>
      </Screen>
    );
  }

  if (order.orderStatus === "requested") {
    return <OrderRequestReview order={order} />;
  }

  return (
    <Screen>
      <ScreenHeader
        title={sub === "nuevo" ? "Nuevo pedido" : "Editar pedido"}
        action={<Button variant="ghost" onClick={() => navigate("/pedidos")}>← Pedidos</Button>}
      />
      <div className="mx-auto max-w-5xl">
        <OrderForm order={order} onDone={() => navigate("/pedidos")} onCancel={() => navigate("/pedidos")} />
      </div>
    </Screen>
  );
}

function OrderRequestReview({ order }: { order: Order }) {
  const { acceptPublicOrderRequest, deleteOrder } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const items = orderItems(order);
  const totals = orderTotals(order);

  async function accept() {
    setBusy(true);
    try {
      await acceptPublicOrderRequest(order.id);
      toast.success("Solicitud aceptada. El pedido quedó por cotizar.");
      navigate("/pedidos");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo aceptar la solicitud.");
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await deleteOrder(order.id);
      toast.success("Solicitud rechazada");
      navigate("/pedidos");
    } catch {
      toast.error("No se pudo rechazar la solicitud.");
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Revisar solicitud"
        action={<Button variant="ghost" onClick={() => navigate("/pedidos")}>← Pedidos</Button>}
      />
      <div className="mx-auto max-w-5xl space-y-4">
        <Card className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-on-surface-soft">Solicitud #{orderReference(order.id)}</p>
              <h2 className="serif-display text-2xl font-semibold text-ink mt-1">{order.requesterName || "Cliente de catálogo"}</h2>
              <p className="text-sm text-on-surface-soft mt-1">{order.createdAt ? new Date(order.createdAt).toLocaleString("es-MX") : "Sin fecha"}</p>
            </div>
            <Badge tone="warning">Solicitud</Badge>
          </div>
          <div className="divide-y divide-rule mt-5">
            {items.map((item, index) => (
              <div key={`${item.productId ?? item.productName}-${index}`} className="py-3 flex items-center justify-between gap-3">
                <div><p className="font-semibold text-ink">{item.productName}</p><p className="text-sm text-on-surface-soft">{item.quantity} {item.quantity === 1 ? "pieza" : "piezas"}</p></div>
                <Money amount={item.subtotal} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-rule">
            <StatRow label="Piezas">{totals.pieces}</StatRow>
            <StatRow label="Subtotal estimado"><Money amount={totals.estimatedTotal} /></StatRow>
          </div>
        </Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button full size="lg" disabled={busy} onClick={accept}>Aceptar solicitud</Button>
          <Button full size="lg" variant="danger" disabled={busy} onClick={() => setConfirmReject(true)}>Rechazar solicitud</Button>
        </div>
      </div>
      <Dialog
        open={confirmReject}
        title="¿Rechazar solicitud?"
        tone="danger"
        onClose={() => setConfirmReject(false)}
        footer={<><Button variant="ghost" onClick={() => setConfirmReject(false)}>Cancelar</Button><Button variant="danger" onClick={() => { setConfirmReject(false); void reject(); }}>Rechazar</Button></>}
      >
        Se eliminará la solicitud y no se apartará ninguna pieza.
      </Dialog>
    </Screen>
  );
}
