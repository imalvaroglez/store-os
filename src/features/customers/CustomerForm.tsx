import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, TextField, TextArea } from "../../design-system";
import type { Customer } from "../../types";

export function CustomerForm({
  customer,
  onDone,
}: {
  customer: Customer;
  onDone: () => void;
}) {
  const { upsertCustomer } = useStore();
  const [draft, setDraft] = useState<Customer>(customer);

  function submit() {
    if (!draft.name.trim()) return;
    upsertCustomer({
      ...draft,
      name: draft.name.trim(),
      updatedAt: new Date().toISOString(),
    });
    onDone();
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
