import { useState } from "react";
import { useStore, newOrder } from "../../app/StoreProvider";
import { Button, EmptyState, Screen, ScreenHeader } from "../../design-system";
import { navigate } from "../../lib/router";
import { useRoute } from "../../app/router";
import { OrderForm } from "./OrderForm";

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
