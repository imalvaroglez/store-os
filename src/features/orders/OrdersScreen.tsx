import { useStore, newOrder } from "../../app/StoreProvider";
import {
  Button,
  EmptyState,
  ScreenHeader,
  Screen,
  Sheet,
  useEntitySheet,
} from "../../design-system";
import { OrderCard } from "./OrderCard";
import { OrderForm } from "./OrderForm";
import { ordersForStore } from "../../lib/selectors";
import type { Order } from "../../types";

export function OrdersScreen() {
  const { state, activeStore } = useStore();
  const sheet = useEntitySheet<Order>();

  if (!activeStore) return null;
  // Active = anything not yet paid. Newest first.
  const orders = ordersForStore(state.orders, activeStore.id).sort((a, b) =>
    a.status === "paid" ? 1 : b.status === "paid" ? -1 : b.createdAt.localeCompare(a.createdAt)
  );

  return (
    <Screen>
      <ScreenHeader
        title="Pedidos"
        subtitle={`${orders.filter((o) => o.status !== "paid").length} activos`}
        action={<Button onClick={() => sheet.openCreate(newOrder(activeStore.id))}>+ Nuevo</Button>}
      />

      {orders.length === 0 ? (
        <EmptyState
          title="Sin pedidos"
          subtitle="Crea tu primer pedido para llevarlo de principio a fin."
          icon={<div className="text-6xl">🧾</div>}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} onEdit={() => sheet.openEdit(o)} />
          ))}
        </div>
      )}

      <Sheet
        open={sheet.open}
        onClose={sheet.close}
        title={sheet.mode === "edit" ? "Editar pedido" : "Nuevo pedido"}
      >
        {sheet.entity && (
          <OrderForm order={sheet.entity} onDone={sheet.close} />
        )}
      </Sheet>
    </Screen>
  );
}
