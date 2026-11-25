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
          <Button
            variant="ghost"
            onClick={() => {
              // #463 r2: the sheet's navigation PUSHED this editor onto the
              // history stack — going BACK lets the browser restore the
              // catalog's exact scroll position natively (the in-app restore
              // could not survive the route-change scroll reset poisoning the
              // saved value at unmount; native restoration does, 10/10).
              if (returnTo) window.history.back();
              else navigate("/pedidos");
            }}
          >
            {returnTo === "/productos" ? "← Productos" : returnTo === "/" ? "← Inicio" : "← Pedidos"}
          </Button>
        )}
      />
      <div className="mx-auto max-w-5xl">
        <OrderForm
          key={`${draftOwnerId}::${activeStore.id}::${sub}`}
          order={order}
          isNew={sub === "nuevo"}
          onDone={() => { if (returnTo) window.history.back(); else navigate("/pedidos"); }}
          onCancel={() => { if (returnTo) window.history.back(); else navigate("/pedidos"); }}
        />
      </div>
    </Screen>
  );
}
