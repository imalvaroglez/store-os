import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, SelectField, TextField, TextArea, useToast } from "../../design-system";
import { tiersForStore } from "../../lib/pricing";
import type { Customer } from "../../types";

export function CustomerForm({
  customer,
  onDone,
  onSaved,
}: {
  customer: Customer;
  onDone: () => void;
  onSaved?: (customer: Customer) => void;
}) {
  const { upsertCustomer, activeStore } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Customer>(customer);

  async function submit() {
    if (!draft.name.trim()) return;
    if (draft.assignedPriceTierId && !tiersForStore(activeStore).some((tier) => tier.id === draft.assignedPriceTierId)) {
      toast.error("Elige un nivel de precio disponible.");
      return;
    }
    const saved = {
      ...draft,
      name: draft.name.trim(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await upsertCustomer(saved);
      onSaved?.(saved);
      onDone();
    } catch {
      toast.error("No se pudo guardar el cliente. Intenta de nuevo.");
    }
  }

  return (
    <div className="space-y-4">
      <TextField
        label="Nombre"
        placeholder="Ej. María López"
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        autoFocus
      />
      <TextField
        label="Teléfono"
        inputMode="tel"
        placeholder="5512345678"
        value={draft.phone ?? ""}
        onChange={(e) => setDraft({ ...draft, phone: e.target.value || undefined })}
      />
      <TextField
        label="Instagram"
        placeholder="@usuario"
        value={draft.instagram ?? ""}
        onChange={(e) => setDraft({ ...draft, instagram: e.target.value || undefined })}
      />
      <SelectField label="Tipo de cliente" value={draft.segment ?? "regular"} onChange={(segment) => setDraft({ ...draft, segment })} options={[{ value: "regular", label: "Regular" }, { value: "entrepreneur", label: "Emprendedora" }]} />
      {activeStore?.type === "inventory_tiered" && (
        <SelectField label="Nivel de precio" value={draft.assignedPriceTierId ?? ""} onChange={(value) => setDraft({ ...draft, assignedPriceTierId: value || undefined })} options={[
          { value: "", label: "Precio de la tienda" },
          ...(draft.assignedPriceTierId && !tiersForStore(activeStore).some((tier) => tier.id === draft.assignedPriceTierId) ? [{ value: draft.assignedPriceTierId, label: "Nivel no disponible" }] : []),
          ...tiersForStore(activeStore).map((tier) => ({ value: tier.id, label: tier.label })),
        ]} />
      )}
      <TextArea
        label="Notas"
        value={draft.notes ?? ""}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })}
      />
      <Button full size="lg" onClick={submit} disabled={!draft.name.trim()}>
        Guardar cliente
      </Button>
    </div>
  );
}
