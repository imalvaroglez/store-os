import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { useAuth } from "../../app/firebase/AuthProvider";
import { Button, TextField, SelectField, Dialog, Sheet, useToast } from "../../design-system";
import { STORE_TYPE_LABELS } from "../../lib/labels";
import { SlugTakenError } from "../../app/firebase/firestoreData";
import { createWhatsAppShareCatalogUrl } from "../../lib/whatsapp";
import { slugify } from "./slugify";
import { StorefrontEditor } from "../catalog/StorefrontEditor";
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
  const { state, updateStore, deleteStore, inviteMember, removeMember, transferStoreOwnership, republishCatalog } = useStore();
  const { user } = useAuth();
  const toast = useToast();
  const store = state.stores.find((s) => s.id === storeId);

  // ALL hooks must run before any early return, or React throws
  // "rendered fewer hooks than expected" if `store` becomes undefined mid-mount
  // (e.g. the store is deleted via cloud sync while this sheet is open).
  const [name, setName] = useState(store?.name ?? "");
  const [whatsapp, setWhatsapp] = useState(store?.whatsappPhone ?? "");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [catalogMsg, setCatalogMsg] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [transferEmail, setTransferEmail] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [editSite, setEditSite] = useState(false);

  if (!store) {
    return <p className="text-sm text-ink-soft">Tienda no encontrada.</p>;
  }

  // Resolve member uids -> emails (best-effort via the users we can see).
  const memberUids = store.memberUids ?? [];
  const pending = store.pendingInvites ?? [];
  const isOwnerOrAdmin = user?.role === "super_admin" || store.ownerUid === user?.uid;

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

  // The public catalog URL = origin + /catalogo/:slug. Built on the client so
  // it reflects the real deployment domain (Vercel in prod, localhost in dev).
  const catalogUrl = `${window.location.origin}/catalogo/${store!.slug}`;

  async function copyCatalogUrl() {
    try {
      await navigator.clipboard.writeText(catalogUrl);
      toast.success("Enlace copiado");
    } catch {
      // Clipboard API can be unavailable (insecure context). Fall back to a
      // toast with the URL so the user can still copy it manually.
      toast.info("Copia el enlace: " + catalogUrl);
    }
  }

  function shareOnWhatsApp() {
    window.open(createWhatsAppShareCatalogUrl(store!, catalogUrl), "_blank", "noopener,noreferrer");
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

  async function transferOwnership() {
    setTransferError(null);
    try {
      await transferStoreOwnership(store!.id, transferEmail);
      toast.success("Propiedad transferida");
      setTransferEmail("");
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "No se pudo transferir la propiedad.");
    }
  }

  return (
    <div className="space-y-5">
      {isOwnerOrAdmin && <div className="space-y-3">
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
      </div>}

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
        {isOwnerOrAdmin && (
          <div className="pt-2">
            <TextField label="Transferir propiedad a" placeholder="correo@ejemplo.com" type="email" value={transferEmail} onChange={(e) => setTransferEmail(e.target.value)} />
            <Button full variant="secondary" onClick={() => setConfirmTransfer(true)} disabled={!transferEmail.trim()}>Transferir propiedad</Button>
            {transferError && <p className="text-xs text-danger">{transferError}</p>}
          </div>
        )}
        {inviteMsg && <p className="text-xs text-ink-soft">{inviteMsg}</p>}
      </div>

      {isOwnerOrAdmin && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Catálogo público</h3>
          <p className="text-sm text-ink-soft break-all">{catalogUrl}</p>
          <Button full onClick={copyCatalogUrl}>Copiar enlace</Button>
          <Button full variant="success" onClick={shareOnWhatsApp}>Compartir por WhatsApp</Button>
          <Button full variant="secondary" onClick={() => setEditSite(true)}>
            Editar sitio público
          </Button>
          <Button full variant="secondary" onClick={republish} disabled={catalogBusy}>
            Republicar catálogo
          </Button>
          {catalogMsg && <p className="text-xs text-ink-soft">{catalogMsg}</p>}
        </div>
      )}

      {editSite && store && (
        <Sheet open onClose={() => setEditSite(false)} title="Sitio público">
          <StorefrontEditor store={store} onDone={() => setEditSite(false)} />
        </Sheet>
      )}

      {isOwnerOrAdmin && (
        <div className="pt-2 border-t border-edge space-y-2">
          <Button
            full
            variant="danger"
            onClick={() => setConfirmDelete(true)}
          >
            Eliminar tienda
          </Button>
        </div>
      )}

      <Dialog
        open={confirmDelete}
        title="Eliminar tienda"
        tone="danger"
        onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            <Button variant="danger" onClick={() => { deleteStore(store!.id); onDone(); }}>Eliminar</Button>
          </>
        }
      >
        ¿Eliminar <span className="font-semibold text-ink">{store!.name}</span> y todos sus datos? Esta acción no se puede deshacer.
      </Dialog>
      <Dialog
        open={confirmTransfer}
        title="Transferir propiedad"
        tone="danger"
        onClose={() => setConfirmTransfer(false)}
        footer={<><Button variant="ghost" onClick={() => setConfirmTransfer(false)}>Cancelar</Button><Button variant="danger" onClick={() => { void transferOwnership(); setConfirmTransfer(false); }}>Transferir</Button></>}
      >
        Dejarás de ser la persona dueña de esta tienda. Seguirás como miembro.
      </Dialog>
    </div>
  );
}
