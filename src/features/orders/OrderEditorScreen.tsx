import { useState } from "react";
import { useStore, newOrder } from "../../app/StoreProvider";
import { Button, EmptyState, Screen, ScreenHeader } from "../../design-system";
import { navigate } from "../../lib/router";
import { takeReturnOrigin } from "../../lib/returnOrigin";
import { useRoute } from "../../app/router";
import { OrderForm } from "./OrderForm";

export function OrderEditorScreen() {
  const { state, activeStore, draftOwnerId } = useStore();
  const route = useRoute();
  const sub = route.name === "admin" ? route.params.sub ?? "" : "";
  const [draft] = useState(() => newOrder(activeStore?.id ?? ""));
  // #463: a pedido opened from another area's task (e.g. the products'
  // "Comprometido" breakdown) returns THERE — same list state, same scroll —
  // instead of stranding the operator in the orders list. Consumed once on
  // mount so every exit of this visit uses the same target.
  const [returnTo] = useState(() => (sub === "nuevo" ? undefined : takeReturnOrigin(sub)));

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
        action={(
          <Button variant="ghost" onClick={() => navigate(returnTo ?? "/pedidos")}>
            {returnTo === "/productos" ? "← Productos" : "← Pedidos"}
          </Button>
        )}
      />
      <div className="mx-auto max-w-5xl">
        <OrderForm
          key={`${draftOwnerId}::${activeStore.id}::${sub}`}
          order={order}
          isNew={sub === "nuevo"}
          onDone={() => navigate(returnTo ?? "/pedidos")}
          onCancel={() => navigate(returnTo ?? "/pedidos")}
        />
      </div>
    </Screen>
  );
}
