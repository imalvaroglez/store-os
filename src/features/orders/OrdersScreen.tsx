import { useMemo, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { AnimatedNumber, Button, EmptyState, Screen, ScreenHeader, TextField } from "../../design-system";
import { navigate } from "../../lib/router";
import { orderBucket, orderItems, orderReference, orderTotals, type OrderBucket } from "../../lib/orders";
import { ordersForStore } from "../../lib/selectors";
import { OrderCard } from "./OrderCard";

type Filter = "all" | "active" | "pending" | "completed" | "cancelled";

const FILTER_LABELS: Record<Filter, string> = {
  all: "Todos",
  active: "Activos",
  pending: "Pendientes",
  completed: "Completados",
  cancelled: "Cancelados",
};

export function OrdersScreen() {
  const { state, activeStore } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const storeId = activeStore?.id ?? "";
  const orders = useMemo(() => [...ordersForStore(state.orders, storeId)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [storeId, state.orders]);
  const counts = useMemo(() => orders.reduce<Record<OrderBucket, number>>((acc, order) => {
    const bucket = orderBucket(order);
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, { pending: 0, active: 0, completed: 0, cancelled: 0, other: 0 }), [orders]);
  const activeDue = orders.filter((order) => orderBucket(order) === "active").reduce((sum, order) => sum + orderTotals(order).balance, 0);
  const visibleOrders = orders.filter((order) => {
    if (filter !== "all" && orderBucket(order) !== filter) return false;
    if (!query.trim()) return true;
    const customer = state.customers.find((item) => item.id === order.customerId);
    const haystack = [
      orderReference(order.id), customer?.name, customer?.phone,
      order.requesterName,
      ...orderItems(order).map((item) => item.productName),
    ].filter(Boolean).join(" ").toLocaleLowerCase("es-MX");
    return haystack.includes(query.trim().toLocaleLowerCase("es-MX"));
  });

  if (!activeStore) return null;

  return (
    <Screen>
      <ScreenHeader
        title="Pedidos"
        subtitle={`${orders.length} ${orders.length === 1 ? "pedido" : "pedidos"}`}
        action={<Button onClick={() => navigate("/pedidos/nuevo")}>+ Nuevo</Button>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 mb-5">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
          <Button
            key={key}
            variant={filter === key ? "primary" : "secondary"}
            aria-pressed={filter === key}
            className="text-left h-auto"
            onClick={() => setFilter(key)}
          >
            <span className="block text-xs opacity-75">{FILTER_LABELS[key]}</span>
            <span className="block text-xl leading-tight">{key === "all" ? orders.length : counts[key]}</span>
            {key === "active" && activeDue > 0 && <span className="block text-xs mt-1">Falta cobrar: <AnimatedNumber value={activeDue} format="currency" /></span>}
          </Button>
        ))}
      </div>

      <div className="mb-5">
        <TextField label="Buscar pedidos" placeholder="Referencia, cliente o producto" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {visibleOrders.length === 0 ? (
        <EmptyState
          title={orders.length === 0 ? "Sin pedidos" : "No hay coincidencias"}
          subtitle={orders.length === 0 ? "Crea tu primer pedido para llevarlo de principio a fin." : "Prueba con otra búsqueda o filtro."}
          icon={<div className="text-6xl">🧾</div>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {visibleOrders.map((order) => <OrderCard key={order.id} order={order} onEdit={() => navigate(`/pedidos/${order.id}`)} />)}
        </div>
      )}
    </Screen>
  );
}
