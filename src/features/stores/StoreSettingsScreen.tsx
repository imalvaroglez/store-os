import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { useAuth } from "../../app/firebase/AuthProvider";
import { Button, TextField, SelectField } from "../../design-system";
import { STORE_TYPE_LABELS } from "../../lib/labels";
import { SlugTakenError } from "../../app/firebase/firestoreData";
import { slugify } from "./slugify";
import type { StoreType } from "../../types";

// Full management for a single store: rename, change type, WhatsApp, members
// (invite by email / remove), and delete. Shown as a sheet from the picker.
export function StoreSettingsScreen({
  storeId,
  onDone,
}: {
  storeId: string;
  onDone: () => void;
}) {
  const { state, updateStore, deleteStore, inviteMember, removeMember, republishCatalog } = useStore();
  const { user } = useAuth();
  const store = state.stores.find((s) => s.id === storeId);

  const [name, setName] = useState(store?.name ?? "");
  const [whatsapp, setWhatsapp] = useState(store?.whatsappPhone ?? "");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!store) {
    return <p className="text-sm text-ink-soft">Tienda no encontrada.</p>;
  }

  // Resolve member uids -> emails (best-effort via the users we can see).
  const memberUids = store.memberUids ?? [];
  const pending = store.pendingInvites ?? [];
  const isOwnerOrAdmin = user?.role === "super_admin" || store.ownerUid === user?.uid;

  const [saveError, setSaveError] = useState<string | null>(null);
  const [catalogMsg, setCatalogMsg] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);

  async function republish() {
    setCatalogBusy(true);
    setCatalogMsg(null);
    try {
      await republishCatalog(store!.id);
      setCatalogMsg("Catálogo publicado. Visible en /catalogo/" + store!.slug);
    } catch {
      setCatalogMsg("No se pudo publicar. Intenta de nuevo.");
    } finally {
      setCatalogBusy(false);
    }
  }

  async function saveBasic() {
    setSaveError(null);
    const newName = name.trim() || store!.name;
    // If the name changed, the slug changes too — recompute it so updateStore
    // re-claims/re-publishes the catalog under the new slug.
    const patch: Parameters<typeof updateStore>[0] = {
      id: store!.id,
      name: newName,
      whatsappPhone: whatsapp.trim() || undefined,
    };
    if (slugify(newName) !== store!.slug) patch.slug = slugify(newName);
    try {
      await updateStore(patch);
      onDone();
    } catch (err) {
      setSaveError(err instanceof SlugTakenError ? err.message : "No se pudo guardar. Intenta de nuevo.");
    }
  }

  function changeType(type: StoreType) {
    void updateStore({ id: store!.id, type });
  }

  async function doInvite() {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    setInviteMsg(null);
    try {
      const result = await inviteMember(store!.id, inviteEmail.trim());
      setInviteMsg(
        result === "invited"
          ? "Miembro agregado."
          : "Invitación enviada. Quedará pendiente hasta que la persona cree su cuenta."
      );
      setInviteEmail("");
    } catch {
      setInviteMsg("No se pudo invitar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <TextField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <SelectField
          label="Tipo de tienda"
          value={store.type}
          onChange={(t) => changeType(t as StoreType)}
          options={[
            { value: "on_demand" as StoreType, label: STORE_TYPE_LABELS.on_demand },
            { value: "inventory_tiered" as StoreType, label: STORE_TYPE_LABELS.inventory_tiered },
          ]}
        />
        <TextField
          label="Teléfono de WhatsApp"
          hint="Con clave de país, ej. 5215512345678"
          placeholder="52155..."
          inputMode="tel"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
        />
        {saveError && <p className="text-sm text-danger">{saveError}</p>}
        <Button full onClick={saveBasic} disabled={!name.trim()}>
          Guardar
        </Button>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Miembros</h3>
        {memberUids.length === 0 && pending.length === 0 && (
          <p className="text-sm text-ink-soft">Solo tú. Invita a alguien por correo.</p>
        )}
        {memberUids.map((uid) => (
          <div key={uid} className="flex items-center justify-between bg-surface rounded-md px-3 py-2 ring-1 ring-edge">
            <span className="text-sm text-ink">{uid === user?.uid ? "Tú" : uid.slice(0, 8)}</span>
            {isOwnerOrAdmin && uid !== user?.uid && (
              <Button size="sm" variant="ghost" onClick={() => removeMember(store!.id, uid)}>
                Quitar
              </Button>
            )}
          </div>
        ))}
        {pending.map((email) => (
          <div key={email} className="flex items-center justify-between bg-surface rounded-md px-3 py-2 ring-1 ring-edge">
            <span className="text-sm text-ink-soft">{email} · pendiente</span>
          </div>
        ))}
        {isOwnerOrAdmin && (
          <>
            <TextField
              label="Invitar por correo"
              placeholder="correo@ejemplo.com"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <Button full onClick={doInvite} disabled={busy || !inviteEmail.trim()}>
              Enviar invitación
            </Button>
          </>
        )}
        {inviteMsg && <p className="text-xs text-ink-soft">{inviteMsg}</p>}
      </div>

      {isOwnerOrAdmin && (
        <div className="pt-2 border-t border-edge space-y-2">
          <Button full variant="secondary" onClick={republish} disabled={catalogBusy}>
            Republicar catálogo
          </Button>
          {catalogMsg && <p className="text-xs text-ink-soft">{catalogMsg}</p>}
          <Button
            full
            variant="danger"
            onClick={() => {
              if (confirm(`¿Eliminar "${store!.name}" y todos sus datos? Esto no se puede deshacer.`)) {
                deleteStore(store!.id);
                onDone();
              }
            }}
          >
            Eliminar tienda
          </Button>
        </div>
      )}
    </div>
  );
}
