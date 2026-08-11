import { useState } from "react";
import { useStore, newCustomer } from "../../app/StoreProvider";
import {
  Button,
  Card,
  Dialog,
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  EmptyState,
  IconButton,
  Money,
  ScreenHeader,
  Screen,
  Sheet,
  StatRow,
  useEntitySheet,
  useToast,
} from "../../design-system";
import { CustomerForm } from "./CustomerForm";
import { customersForStore, ordersForStore } from "../../lib/selectors";
import { pending } from "../../lib/money";
import type { Customer } from "../../types";

export function CustomersScreen() {
  const { state, activeStore, deleteCustomer } = useStore();
  const sheet = useEntitySheet<Customer>();
  const toast = useToast();
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

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
                  <div className="flex items-center gap-1 shrink-0">
                    <div className="text-right space-y-1">
                      <StatRow label="Vendido" tone="default">
                        <Money amount={totalSold} />
                      </StatRow>
                      {due > 0 && (
                        <StatRow label="Falta cobrar" tone="danger">
                          <Money amount={due} />
                        </StatRow>
                      )}
                    </div>
                    {/* Stop propagation so opening the menu / picking an item does
                        not also trigger the card's onClick (edit). */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <Dropdown
                        open={menuOpenId === c.id}
                        onClose={() => setMenuOpenId(null)}
                        trigger={
                          <IconButton
                            variant="ghost"
                            aria-label="Acciones"
                            aria-haspopup="menu"
                            aria-expanded={menuOpenId === c.id}
                            onClick={() => setMenuOpenId(menuOpenId === c.id ? null : c.id)}
                            className="text-xl -mr-1"
                          >
                            ⋯
                          </IconButton>
                        }
                      >
                        <DropdownItem onClick={() => { setMenuOpenId(null); sheet.openEdit(c); }}>Editar</DropdownItem>
                        <DropdownSeparator />
                        <DropdownItem tone="danger" onClick={() => { setMenuOpenId(null); setDeleting(c); }}>Eliminar</DropdownItem>
                      </Dropdown>
                    </div>
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

      <Dialog
        open={deleting !== null}
        title="Eliminar cliente"
        tone="danger"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleting) {
                  deleteCustomer(deleting.id);
                  toast.success(`«${deleting.name}» eliminado`);
                }
                setDeleting(null);
              }}
            >
              Eliminar
            </Button>
          </>
        }
      >
        {deleting && (() => {
          const n = orders.filter((o) => o.customerId === deleting.id).length;
          return (
            <p className="text-sm text-on-surface-soft">
              ¿Eliminar a <span className="font-semibold text-on-surface">{deleting.name}</span>? Esta acción no se puede deshacer.
              {n > 0 && (
                <> Tiene <span className="font-semibold">{n}</span> {n === 1 ? "pedido asociado" : "pedidos asociados"} que quedarán sin cliente (no se borran).</>
              )}
            </p>
          );
        })()}
      </Dialog>
    </Screen>
  );
}
