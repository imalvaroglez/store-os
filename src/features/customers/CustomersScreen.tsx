import { useState } from "react";
import { useStore, newCustomer } from "../../app/StoreProvider";
import {
  Badge,
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
  TextField,
  useEntitySheet,
  useToast,
} from "../../design-system";
import { CustomerForm } from "./CustomerForm";
import { useEffect } from "react";
import { customersForStore, ordersForStore } from "../../lib/selectors";
import { useListRestore } from "../../lib/listRestore";
import { orderBucket, orderCountsTowardToPay, orderTotals } from "../../lib/orders";
import { formatDate } from "../../lib/dates";
import { iconicStatus, type IconicStatus } from "../../lib/iconic";
import type { Customer } from "../../types";
import { defaultTier, tiersForStore } from "../../lib/pricing";

export function CustomersScreen() {
  const { state, activeStore, deleteCustomer } = useStore();
  const sheet = useEntitySheet<Customer>();
  const toast = useToast();
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // #233: keep search + scroll when returning from a customer's detail.
  const { filters, setFilters, restoreScroll } = useListRestore("customers", { query: "" });
  const query = filters.query;
  const setQuery = (next: string) => setFilters((previous) => ({ ...previous, query: next }));
  useEffect(() => {
    restoreScroll();
  }, [restoreScroll]);

  if (!activeStore) return null;
  const customers = customersForStore(state.customers, activeStore.id);
  const orders = ordersForStore(state.orders, activeStore.id);
  const visibleCustomers = customers.filter((customer) => {
    const needle = query.trim().toLocaleLowerCase("es-MX");
    return !needle || [customer.name, customer.phone, customer.instagram].filter(Boolean).join(" ").toLocaleLowerCase("es-MX").includes(needle);
  });
  // FER-05 aviso previo: visual-only renewal alert, most urgent first. No
  // external notifications (zero-cost rule) — Fer sees it when opening Clientes.
  const renewalAlerts = customers
    .map((customer) => ({ customer, status: iconicStatus(customer, orders) }))
    .filter(
      (x): x is { customer: Customer; status: IconicStatus } =>
        x.status != null && x.status.active && x.status.expiringSoon
    )
    .sort((a, b) => a.status.until.localeCompare(b.status.until));

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

      {renewalAlerts.length > 0 && (
        <Card className="mb-5 !bg-terracotta-soft/60 ring-terracotta/20">
          <h3 className="font-semibold text-terracotta text-sm">⏳ Renovación próxima de Iconic</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {renewalAlerts.map(({ customer, status }) => (
              <Badge key={customer.id} tone="warning">
                {customer.name} · vence {formatDate(status.until)}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            Cualquier pedido liquidado dentro de la vigencia renueva el beneficio 30 días más.
          </p>
        </Card>
      )}

      <div className="mb-5">
        <TextField label="Buscar clientes" placeholder="Nombre, teléfono o Instagram" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {visibleCustomers.length === 0 ? (
        <EmptyState
          title={customers.length === 0 ? "Sin clientes" : "No hay coincidencias"}
          subtitle={customers.length === 0 ? "Agrega tu primer cliente para asociarle pedidos." : "Prueba con otra búsqueda."}
          icon={<div className="text-6xl">👤</div>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {visibleCustomers.map((c) => {
            const cOrders = orders.filter((o) => o.customerId === c.id);
            const iconic = iconicStatus(c, orders);
            const totalSold = cOrders
              .filter((o) => orderBucket(o) !== "pending" && orderBucket(o) !== "cancelled")
              .reduce((sum, o) => sum + orderTotals(o).estimatedTotal, 0);
            const due = cOrders
              .filter(orderCountsTowardToPay)
              .reduce((sum, o) => sum + orderTotals(o).balance, 0);
            // #189: saldo a favor sin consumir de sus pedidos y el neto a
            // cobrar (la compensación automática suele consumirlo en segundos;
            // mientras tanto la clienta ve las tres cifras, sin sorpresas).
            const favor = cOrders
              .filter((o) => o.orderStatus !== "cancelled")
              .reduce((sum, o) => sum + orderTotals(o).availableCredit, 0);
            const netDue = Math.max(0, due - favor);
            return (
              <Card key={c.id} onClick={() => sheet.openEdit(c)}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-ink truncate">{c.name}</h3>
                    <p className="text-xs text-ink-soft truncate">
                      {c.phone ?? "Sin teléfono"} · {cOrders.length} {cOrders.length === 1 ? "pedido" : "pedidos"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                      <Badge tone={c.segment === "entrepreneur" ? "info" : "neutral"}>{c.segment === "entrepreneur" ? "Emprendedora" : "Regular"}</Badge>
                      {activeStore.type === "inventory_tiered" && <span>Precio: {c.assignedPriceTierId ? tiersForStore(activeStore).find((tier) => tier.id === c.assignedPriceTierId)?.label ?? "Nivel no disponible" : defaultTier(activeStore)?.label ?? "Sin nivel"}</span>}
                    </div>
                    {iconic && (
                      <div className="mt-1.5">
                        <Badge tone={iconic.active ? (iconic.expiringSoon ? "warning" : "accent") : "neutral"}>
                          {iconic.active
                            ? `Iconic · vence ${formatDate(iconic.until)}`
                            : `Iconic · venció ${formatDate(iconic.until)}`}
                        </Badge>
                      </div>
                    )}
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
                      {favor > 0 && (
                        <StatRow label="Saldo a favor" tone="success">
                          <Money amount={favor} />
                        </StatRow>
                      )}
                      {due > 0 && favor > 0 && (
                        <StatRow label="Neto a cobrar" tone={netDue > 0 ? "danger" : "success"}>
                          <Money amount={netDue} />
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
              onClick={async () => {
                if (deleting) {
                  try {
                    await deleteCustomer(deleting.id);
                  } catch {
                    toast.error("No se pudo eliminar la clienta. Intenta de nuevo.");
                    return;
                  }
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
