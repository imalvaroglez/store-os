import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, TextField, TextArea } from "../../design-system";
import { nowIso } from "../../lib/dates";
import type { Supplier } from "../../types";

// Minimal supplier form: name (required), contact, notes. Shared between
// SuppliersScreen (full CRUD) and PurchaseForm (inline create). The caller owns
// the draft lifecycle via the `supplier` prop; on save the supplier is upserted
// and onDone fires.
export function SupplierForm({ supplier, onDone }: { supplier: Supplier; onDone: () => void }) {
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
