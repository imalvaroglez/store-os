import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, Dialog, SelectField, TextField, TextArea, useToast } from "../../design-system";

/** #219 (Clientas): a phone typed or pasted from WhatsApp keeps the
 * separators Fer uses (spaces, dashes, parens, dots, +) — anything else
 * (letters, emojis) never reaches the draft. Persistence keeps as typed:
 * search normalizes on both sides. */
export function sanitizePhoneInput(value: string): string {
  return value.replace(/[^\d+\s().-]/g, "").slice(0, 24);
}

import { looseText } from "../../lib/text";

/** #219: duplicate-name detection shares the search's loose normalization. */
function sameNameLoose(a: string, b: string): boolean {
  return looseText(a) === looseText(b);
}
import { defaultTier, tiersForStore } from "../../lib/pricing";
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
  const { upsertCustomer, activeStore, state } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Customer>(customer);
  // FER-05: manual Iconic grant. Kept as plain strings while editing so the
  // dates can be cleared; validated (both or none, until >= since) on submit.
  const [confirmDuplicate, setConfirmDuplicate] = useState<string | null>(null);
  const [iconicSince, setIconicSince] = useState(customer.iconic?.since ?? "");
  const [iconicUntil, setIconicUntil] = useState(customer.iconic?.until ?? "");

  async function submit(force = false) {
    if (!draft.name.trim()) return;
    if (draft.assignedPriceTierId && !tiersForStore(activeStore).some((tier) => tier.id === draft.assignedPriceTierId)) {
      toast.error("Elige un nivel de precio disponible.");
      return;
    }
    // #219: a phone needs enough digits to be a phone — a stray letter-less
    // "12" is a capture error, not a contact. Separators are fine.
    const phoneDigits = (draft.phone ?? "").replace(/\D/g, "");
    if ((draft.phone ?? "").trim() && phoneDigits.length < 8) {
      toast.error("El teléfono necesita al menos 8 dígitos (con lada).");
      return;
    }
    if (draft.instagram && /\s/.test(draft.instagram)) {
      toast.error("El usuario de Instagram no lleva espacios.");
      return;
    }
    // #219: duplicate name — SOFT warning, never a block (two Marías exist);
    // accent/case-insensitive so "Maria Lopez" warns against "María López".
    const clash = state.customers.find(
      (c) => c.id !== draft.id && c.storeId === activeStore?.id && sameNameLoose(c.name, draft.name)
    );
    if (clash && !force) {
      setConfirmDuplicate(clash.name);
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
      phone: draft.phone?.trim() || undefined,
      instagram: draft.instagram?.trim() || undefined,
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
        onChange={(e) => setDraft({ ...draft, phone: sanitizePhoneInput(e.target.value) || undefined })}
      />
      <TextField
        label="Instagram"
        placeholder="@usuario"
        value={draft.instagram ?? ""}
        onChange={(e) => setDraft({ ...draft, instagram: e.target.value.replace(/\s+/g, "") || undefined })}
      />
      <SelectField label="Tipo de cliente" value={draft.segment ?? "regular"} onChange={(segment) => setDraft({ ...draft, segment })} options={[{ value: "regular", label: "Regular" }, { value: "entrepreneur", label: "Emprendedora" }]} />
      {activeStore?.type === "inventory_tiered" && <p className="text-sm text-ink-soft">El tipo identifica a tu clienta. Su precio se elige abajo; marcar Emprendedora no asigna Iconic automáticamente.</p>}
      {activeStore?.type === "inventory_tiered" && (
        <SelectField label="Nivel de precio" aria-label="Nivel de precio" hint={`Se aplica automáticamente en sus nuevos pedidos. Sin un nivel elegido se usa ${defaultTier(activeStore)?.label ?? "el precio de la tienda"}.`} value={draft.assignedPriceTierId ?? ""} onChange={(value) => setDraft({ ...draft, assignedPriceTierId: value || undefined })} options={[
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
      <Button full size="lg" onClick={() => void submit()} disabled={!draft.name.trim()}>
        Guardar cliente
      </Button>

      <Dialog
        open={confirmDuplicate !== null}
        title="¿Ya tienes una clienta con ese nombre?"
        onClose={() => setConfirmDuplicate(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setConfirmDuplicate(null)}>
              Revisar
            </Button>
            <Button size="sm" onClick={() => { setConfirmDuplicate(null); void submit(true); }}>
              Guardar de todos modos
            </Button>
          </div>
        }
      >
        <p className="text-sm text-on-surface-soft">
          Ya existe «{confirmDuplicate}» con un nombre muy parecido. Si es la misma persona, revisa
          su ficha en lugar de crear un duplicado.
        </p>
      </Dialog>
    </div>
  );
}
