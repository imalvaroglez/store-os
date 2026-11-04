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
  // FER-05: manual Iconic grant. Kept as plain strings while editing so the
  // dates can be cleared; validated (both or none, until >= since) on submit.
  const [iconicSince, setIconicSince] = useState(customer.iconic?.since ?? "");
  const [iconicUntil, setIconicUntil] = useState(customer.iconic?.until ?? "");

  async function submit() {
    if (!draft.name.trim()) return;
    if (draft.assignedPriceTierId && !tiersForStore(activeStore).some((tier) => tier.id === draft.assignedPriceTierId)) {
      toast.error("Elige un nivel de precio disponible.");
      return;
    }
    if ((iconicSince || iconicUntil) && !(iconicSince && iconicUntil)) {
      toast.error("Completa ambas fechas de la vigencia Iconic, o deja ambas vacías.");
      return;
    }
    if (iconicSince && iconicUntil && iconicUntil < iconicSince) {
      toast.error("La fecha final de Iconic debe ser igual o posterior a la inicial.");
      return;
    }
    const saved = {
      ...draft,
      name: draft.name.trim(),
      // undefined (both dates empty) removes a previous manual grant —
      // saveEntity turns it into a deleteField() so Firestore actually clears it.
      iconic: iconicSince && iconicUntil ? { since: iconicSince, until: iconicUntil } : undefined,
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
      {activeStore?.type === "inventory_tiered" && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField
              label="Iconic desde"
              type="date"
              value={iconicSince}
              onChange={(e) => setIconicSince(e.target.value)}
            />
            <TextField
              label="Iconic hasta"
              type="date"
              value={iconicUntil}
              onChange={(e) => setIconicUntil(e.target.value)}
            />
          </div>
          <p className="text-xs text-on-surface-soft mt-1.5">
            El beneficio Iconic se activa al liquidar un pedido de $1,000 o más, y se renueva con cualquier pedido liquidado dentro de la vigencia
            (30 días más). Estas fechas solo agregan una vigencia manual, por ejemplo para otorgarlo a mano.
          </p>
        </div>
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
