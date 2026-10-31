import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, TextField, TextArea, useToast } from "../../design-system";
import { nowIso } from "../../lib/dates";
import type { Supplier } from "../../types";

// Minimal supplier form: name (required), contact, notes. Shared between
// SuppliersScreen (full CRUD) and PurchaseForm (inline create). The caller owns
// the draft lifecycle via the `supplier` prop; on save the supplier is upserted
// and onDone fires.
export function SupplierForm({ supplier, onDone }: { supplier: Supplier; onDone: (saved: Supplier) => void }) {
  const { upsertSupplier } = useStore();
  const [draft, setDraft] = useState<Supplier>(supplier);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save() {
    if (!draft.name.trim() || saving) return;
    const saved = { ...draft, name: draft.name.trim(), updatedAt: nowIso() };
    setSaving(true);
    try { await upsertSupplier(saved); onDone(saved); }
    catch { toast.error("No se pudo guardar el proveedor. Revisa tu conexión e intenta de nuevo."); }
    finally { setSaving(false); }
  }

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
        onClick={() => void save()}
        disabled={saving || !draft.name.trim()}
      >
        {saving ? "Guardando…" : "Guardar proveedor"}
      </Button>
    </div>
  );
}
