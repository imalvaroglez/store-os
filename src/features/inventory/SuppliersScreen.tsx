import { useState } from "react";
import { useStore, newSupplier } from "../../app/StoreProvider";
import {
  Button,
  Card,
  EmptyState,
  ScreenHeader,
  Sheet,
  TextField,
  TextArea,
  IconButton,
  Dialog,
  useToast,
} from "../../design-system";
import { suppliersForStore } from "../../lib/selectors";
import { nowIso } from "../../lib/dates";
import type { Supplier } from "../../types";

// Proveedores admin: light CRUD mirroring CategoriesScreen. Suppliers are
// per-store and used as the "who" on purchase tickets. Reachable from Ajustes
// de tienda and from the purchase form.
export function SuppliersScreen() {
  const { state, activeStore, deleteSupplier } = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Supplier | null>(null);

  if (!activeStore) return null;
  const suppliers = suppliersForStore(state.suppliers, activeStore.id);

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
        <SupplierForm supplier={newSupplier(activeStore.id)} onDone={() => setCreating(false)} />
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

function SupplierForm({ supplier, onDone }: { supplier: Supplier; onDone: () => void }) {
  const { upsertSupplier } = useStore();
  const [draft, setDraft] = useState<Supplier>(supplier);

  return (
    <div className="space-y-4">
      <TextField
        label="Nombre"
        placeholder="Ej. Platería GDL"
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        autoFocus
      />
      <TextField
        label="Contacto"
        placeholder="Teléfono / dónde encontrarlo"
        value={draft.contact ?? ""}
        onChange={(e) => setDraft({ ...draft, contact: e.target.value || undefined })}
      />
      <TextArea
        label="Notas"
        value={draft.notes ?? ""}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })}
      />
      <Button
        full
        size="lg"
        onClick={() => {
          if (!draft.name.trim()) return;
          upsertSupplier({ ...draft, name: draft.name.trim(), updatedAt: nowIso() });
          onDone();
        }}
        disabled={!draft.name.trim()}
      >
        Guardar proveedor
      </Button>
    </div>
  );
}
