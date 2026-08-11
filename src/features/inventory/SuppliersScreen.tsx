import { useState } from "react";
import { useStore, newSupplier } from "../../app/StoreProvider";
import {
  Button,
  Card,
  EmptyState,
  ScreenHeader,
  Sheet,
  IconButton,
  Dialog,
  useToast,
} from "../../design-system";
import { suppliersForStore } from "../../lib/selectors";
import type { Supplier } from "../../types";
import { SupplierForm } from "./SupplierForm";

// Proveedores admin: light CRUD mirroring CategoriesScreen. Suppliers are
// per-store and used as the "who" on purchase tickets. Reachable from Ajustes
// de tienda and from the purchase form.
//
// Receives `storeId` by prop (not from the global activeStore) so it works in
// contexts where activeStore is null — e.g. StoreSettingsScreen opened from the
// StorePicker, where the store being administered isn't the active one. Matches
// the StoreSettingsScreen pattern.
export function SuppliersScreen({ storeId }: { storeId: string }) {
  const { state, deleteSupplier } = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Supplier | null>(null);

  const suppliers = suppliersForStore(state.suppliers, storeId);

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="Proveedores"
        subtitle={`${suppliers.length} ${suppliers.length === 1 ? "proveedor" : "proveedores"}`}
        action={<Button onClick={() => setCreating(true)}>+ Agregar</Button>}
      />

      {suppliers.length === 0 ? (
        <EmptyState
          title="Sin proveedores"
          subtitle="Agrega los proveedores de quienes compras."
          icon={<div className="text-6xl">🤝</div>}
        />
      ) : (
        <div className="space-y-2">
          {suppliers.map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-ink truncate">{s.name || "Sin nombre"}</h3>
                  {s.contact && (
                    <p className="text-xs text-ink-soft truncate">{s.contact}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <IconButton variant="ghost" aria-label="Editar" onClick={() => setEditing(s)}>
                    ✎
                  </IconButton>
                  <IconButton variant="ghost" aria-label="Eliminar" onClick={() => setDeleting(s)}>
                    🗑
                  </IconButton>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={creating} onClose={() => setCreating(false)} title="Agregar proveedor">
        <SupplierForm supplier={newSupplier(storeId)} onDone={() => setCreating(false)} />
      </Sheet>

      {editing && (
        <Sheet open onClose={() => setEditing(null)} title="Editar proveedor">
          <SupplierForm supplier={editing} onDone={() => setEditing(null)} />
        </Sheet>
      )}

      <Dialog
        open={deleting !== null}
        title="Eliminar proveedor"
        tone="danger"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleting) {
                  deleteSupplier(deleting.id);
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
        ¿Eliminar <span className="font-semibold text-ink">{deleting?.name}</span>? Esta acción no se puede deshacer.
      </Dialog>
    </div>
  );
}
