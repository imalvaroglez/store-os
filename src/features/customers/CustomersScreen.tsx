import { useStore, newCustomer } from "../../app/StoreProvider";
import {
  Button,
  Card,
  EmptyState,
  Money,
  ScreenHeader,
  Screen,
  Sheet,
  StatRow,
  useEntitySheet,
} from "../../design-system";
import { CustomerForm } from "./CustomerForm";
import { customersForStore, ordersForStore } from "../../lib/selectors";
import { pending } from "../../lib/money";
import type { Customer } from "../../types";

export function CustomersScreen() {
  const { state, activeStore } = useStore();
  const sheet = useEntitySheet<Customer>();

  if (!activeStore) return null;
  const customers = customersForStore(state.customers, activeStore.id);
  const orders = ordersForStore(state.orders, activeStore.id);

  return (
    <Screen>
      <ScreenHeader
        title="Clientes"
        subtitle={`${customers.length} ${customers.length === 1 ? "cliente" : "clientes"}`}
        action={
          <Button onClick={() => sheet.openCreate(newCustomer(activeStore.id))}>
            + Agregar
          </Button>
        }
      />

      {customers.length === 0 ? (
        <EmptyState
          title="Sin clientes"
          subtitle="Agrega tu primer cliente para asociarle pedidos."
          icon={<div className="text-6xl">👤</div>}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {customers.map((c) => {
            const cOrders = orders.filter((o) => o.customerId === c.id);
            const totalSold = cOrders
              .filter((o) => o.status !== "asked")
              .reduce((sum, o) => sum + o.price * o.quantity, 0);
            const due = cOrders
              .filter((o) => o.status !== "paid" && o.status !== "asked")
              .reduce((sum, o) => sum + pending(o.price * o.quantity, o.deposit), 0);
            return (
              <Card key={c.id} onClick={() => sheet.openEdit(c)}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-ink truncate">{c.name}</h3>
                    <p className="text-xs text-ink-soft truncate">
                      {c.phone ?? "Sin teléfono"} · {cOrders.length} pedidos
                    </p>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <StatRow label="Vendido" tone="default">
                      <Money amount={totalSold} />
                    </StatRow>
                    {due > 0 && (
                      <StatRow label="Falta cobrar" tone="danger">
                        <Money amount={due} />
                      </StatRow>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet
        open={sheet.open}
        onClose={sheet.close}
        title={sheet.mode === "edit" ? "Editar cliente" : "Agregar cliente"}
      >
        {sheet.entity && (
          <CustomerForm customer={sheet.entity} onDone={sheet.close} />
        )}
      </Sheet>
    </Screen>
  );
}
