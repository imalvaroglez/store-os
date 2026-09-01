import { useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { useAuth } from "../../app/firebase/AuthProvider";
import { findAccountByEmail, type EmailAccount } from "../../app/firebase/auth";
import { Button, TextField, SelectField, Dialog, Sheet, useToast } from "../../design-system";
import { STORE_TYPE_LABELS } from "../../lib/labels";
import { SlugTakenError } from "../../app/firebase/firestoreData";
import { createWhatsAppShareCatalogUrl } from "../../lib/whatsapp";
import { slugify } from "../../lib/catalog";
import { StorefrontEditor } from "../catalog/StorefrontEditor";
import { normalizeSkuPrefixToken } from "../../lib/catalog";
import { CANONICAL_TIERS } from "../../lib/pricing";
import { parseAmount } from "../../lib/money";
import { uid } from "../../lib/ids";
import { IconButton } from "../../design-system";
import type { PriceTierDef } from "../../types";
import { productsForStore } from "../../lib/selectors";
import { SuppliersScreen } from "../inventory/SuppliersScreen";
import type { StoreType } from "../../types";

// Full management for a single store: rename, change type, WhatsApp, members
// (invite by email / remove), and delete. Shown from the picker or active store.
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
  // Exact-email search result (single verified account or null = not found).
  const [foundAccount, setFoundAccount] = useState<EmailAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [catalogMsg, setCatalogMsg] = useState<string | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [transferEmail, setTransferEmail] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [confirmTransfer, setConfirmTransfer] = useState(false);
  const [editSite, setEditSite] = useState(false);
  const [skuPrefix, setSkuPrefix] = useState(store?.skuPrefix ?? "");
  const [confirmSkuPrefix, setConfirmSkuPrefix] = useState(false);
  const [showSuppliers, setShowSuppliers] = useState(false);
  // ── Niveles de precio (scalable-pricing) ──
  const [tiersDraft, setTiersDraft] = useState<PriceTierDef[]>(() => (store?.priceTiers ?? CANONICAL_TIERS).map((t) => ({ ...t })));
  const [defaultTierDraft, setDefaultTierDraft] = useState<string>(store?.defaultTierId ?? "t_retail");
  const [markupPercent, setMarkupPercent] = useState(store?.pricingRule?.percent?.toString() ?? "");
  const [tierError, setTierError] = useState<string | null>(null);
  const [confirmTierDelete, setConfirmTierDelete] = useState<string | null>(null);

  if (!store) {
    return <p className="text-sm text-ink-soft">Tienda no encontrada.</p>;
  }

  // Resolve member uids -> emails (best-effort via the users we can see).
  const memberUids = store.memberUids ?? [];
  const pending = store.pendingInvites ?? [];
  // Owners and platform super_admins can manage the store. Other members keep
  // the read-only view and cannot submit business-content writes.
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

  // Save the SKU prefix. If the store already has products, changing the prefix
  // only affects NEW suggestions — existing SKUs never change — so confirm first.
  async function saveSkuPrefix() {
    const hasProducts = productsForStore(state.products, store!.id).length > 0;
    if (hasProducts && !confirmSkuPrefix) {
      setConfirmSkuPrefix(true); // ask for confirmation; user re-clicks to confirm
      return;
    }
    setConfirmSkuPrefix(false);
    await updateStore({ id: store!.id, skuPrefix: skuPrefix.trim() || undefined });
    toast.success("Prefijo de SKU guardado");
  }

  // Save the tier editor. Blocks: zero visible tiers, or a default tier that is
  // missing/hidden (defaultTier also falls back defensively at read time).
  // Minimums are non-negative integers (review F4): parseAmount keeps sign/decimals.
  const parseMinimum = (v: string): number | undefined => {
    const n = parseAmount(v);
    return n == null ? undefined : Math.max(0, Math.floor(n));
  };

  async function saveTiers() {
    setTierError(null);
    const visible = tiersDraft.filter((t) => !t.hidden && t.label.trim());
    if (visible.length === 0) {
      setTierError("Debe haber al menos un nivel visible con nombre.");
      return;
    }
    if (!visible.some((t) => t.id === defaultTierDraft)) {
      setTierError("El nivel al público debe ser un nivel visible.");
      return;
    }
    // Re-index order 0..n so moves are stable.
    const priceTiers = tiersDraft.map((t, i) => ({ ...t, label: t.label.trim() || t.label, order: i }));
    const percent = parseAmount(markupPercent);
    try {
      await updateStore({
        id: store!.id,
        priceTiers,
        defaultTierId: defaultTierDraft,
        // Empty % clears the rule: explicit undefined overwrites the existing
        // value in the reducer merge, and persistence strips undefined keys.
        ...(percent != null && percent >= 0
          ? { pricingRule: { kind: "markup", percent } }
          : { pricingRule: undefined }),
      });
      toast.success("Niveles de precio guardados");
    } catch {
      setTierError("No se pudo guardar (¿catálogo público?). Vuelve a intentar o usa \"Republicar catálogo\".");
    }
  }

  function moveTier(id: string, delta: number) {
    setTiersDraft((list) => {
      const i = list.findIndex((t) => t.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function doSearch() {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    setInviteMsg(null);
    setFoundAccount(null);
    try {
      const account = await findAccountByEmail(inviteEmail.trim());
      setFoundAccount(account);
      if (!account) {
        setInviteMsg("No hay una cuenta con ese correo. Puedes enviar una invitación: quedará pendiente hasta que la persona cree su cuenta.");
      }
    } catch {
      setInviteMsg("No se pudo buscar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
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
      setFoundAccount(null);
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
          hint="Se usará para pedidos y contacto. Incluye la clave de país, ej. 5215512345678"
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
              label="Buscar por correo"
              placeholder="correo@ejemplo.com"
              type="email"
              value={inviteEmail}
              onChange={(e) => { setInviteEmail(e.target.value); setFoundAccount(null); }}
            />
            <Button full variant="secondary" onClick={doSearch} disabled={busy || !inviteEmail.trim()}>
              Buscar cuenta
            </Button>
            {foundAccount && (
              <div className="flex items-center justify-between bg-surface rounded-md px-3 py-2 ring-1 ring-edge">
                <span className="text-sm text-ink min-w-0">
                  {foundAccount.email}
                  {foundAccount.displayName && <span className="text-ink-soft"> · {foundAccount.displayName}</span>}
                </span>
                <Button size="sm" onClick={doInvite} disabled={busy}>
                  Agregar
                </Button>
              </div>
            )}
            {foundAccount === null && inviteEmail.trim() !== "" && inviteMsg?.startsWith("No hay una cuenta") && (
              <Button full onClick={doInvite} disabled={busy || !inviteEmail.trim()}>
                Enviar invitación
              </Button>
            )}
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

      {isOwnerOrAdmin && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Catálogo</h3>
          <TextField
            label="Prefijo de SKU"
            hint="Se usa al generar las claves de productos nuevos. Ej. OLIV-ANILLO-DORADO."
            placeholder="OLIV"
            value={skuPrefix}
            onChange={(e) => setSkuPrefix(normalizeSkuPrefixToken(e.target.value))}
          />
          <Button full onClick={saveSkuPrefix} disabled={skuPrefix === (store!.skuPrefix ?? "")}>
            Guardar prefijo
          </Button>
        </div>
      )}

      {isOwnerOrAdmin && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Compras</h3>
          <Button full variant="secondary" onClick={() => setShowSuppliers(true)}>
            Proveedores
          </Button>
        </div>
      )}

      {editSite && store && (
        <Sheet open onClose={() => setEditSite(false)} title="Sitio público">
          <StorefrontEditor store={store} onDone={() => setEditSite(false)} />
        </Sheet>
      )}

      {isOwnerOrAdmin && store.type === "inventory_tiered" && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Niveles de precio</h3>
          {tiersDraft.map((t, i) => (
            <div key={t.id} className="space-y-1 bg-surface rounded-md px-3 py-2 ring-1 ring-edge">
              <div className="flex items-center gap-2">
                <TextField
                  label={i === 0 ? "Nombre del nivel" : " "}
                  value={t.label}
                  onChange={(e) =>
                    setTiersDraft((list) => list.map((x) => (x.id === t.id ? { ...x, label: e.target.value } : x)))
                  }
                />
                <div className="flex items-center gap-1 shrink-0">
                  <IconButton variant="secondary" aria-label="Subir" onClick={() => moveTier(t.id, -1)}>↑</IconButton>
                  <IconButton variant="secondary" aria-label="Bajar" onClick={() => moveTier(t.id, 1)}>↓</IconButton>
                  <IconButton
                    variant="secondary"
                    aria-label={t.hidden ? "Mostrar" : "Ocultar"}
                    onClick={() => setTiersDraft((list) => list.map((x) => (x.id === t.id ? { ...x, hidden: !x.hidden } : x)))}
                  >
                    {t.hidden ? "👁" : "🚫"}
                  </IconButton>
                  <IconButton
                    variant="secondary"
                    aria-label="Eliminar"
                    onClick={() => {
                      if (confirmTierDelete !== t.id) {
                        setConfirmTierDelete(t.id);
                        return;
                      }
                      setTiersDraft((list) => list.filter((x) => x.id !== t.id));
                      setConfirmTierDelete(null);
                    }}
                  >
                    {confirmTierDelete === t.id ? "¿Seguro?" : "×"}
                  </IconButton>
                </div>
              </div>
              {t.hidden && <p className="text-xs text-ink-soft">Oculto: los precios guardados se conservan.</p>}
              {/* Informative minimums for the public cart (never enforced in
                  the client — qualification is confirmed in the chat). */}
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label={i === 0 ? "Mínimo de piezas" : " "}
                  hint={i === 0 ? "Piezas que necesita el pedido. Vacío = sin mínimo." : undefined}
                  inputMode="numeric"
                  placeholder="5"
                  value={t.minPieces != null ? String(t.minPieces) : ""}
                  onChange={(e) =>
                    setTiersDraft((list) => list.map((x) => (x.id === t.id ? { ...x, minPieces: parseMinimum(e.target.value) } : x)))
                  }
                />
                <TextField
                  label={i === 0 ? "Mínimo de compra" : " "}
                  hint={i === 0 ? "A precio del propio nivel. Vacío = sin mínimo." : undefined}
                  inputMode="numeric"
                  placeholder="1000"
                  value={t.minAmount != null ? String(t.minAmount) : ""}
                  onChange={(e) =>
                    setTiersDraft((list) => list.map((x) => (x.id === t.id ? { ...x, minAmount: parseMinimum(e.target.value) } : x)))
                  }
                />
              </div>
              {confirmTierDelete === t.id && (
                <p className="text-xs text-danger">Toca × otra vez para eliminar. Las órdenes históricas quedan como están.</p>
              )}
            </div>
          ))}
          <Button
            full
            variant="secondary"
            onClick={() => setTiersDraft((list) => [...list, { id: uid("t_"), label: "Nuevo nivel", order: list.length }])}
          >
            + Agregar nivel
          </Button>
          <SelectField
            label="Precio al público"
            value={defaultTierDraft}
            onChange={(v) => setDefaultTierDraft(v)}
            options={tiersDraft.filter((t) => !t.hidden).map((t) => ({ value: t.id, label: t.label || t.id }))}
          />
          <TextField
            label="Ganancia sobre costo (%)"
            hint="Sugiere el precio público a partir del costo. Vacío = sin asistente."
            inputMode="numeric"
            placeholder="120"
            value={markupPercent}
            onChange={(e) => setMarkupPercent(e.target.value)}
          />
          <Button full onClick={saveTiers}>Guardar niveles</Button>
          {tierError && <p className="text-xs text-danger">{tierError}</p>}
        </div>
      )}

      {showSuppliers && (
        <Sheet open onClose={() => setShowSuppliers(false)} title="Proveedores">
          <SuppliersScreen storeId={store.id} />
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
        open={confirmSkuPrefix}
        title="Cambiar prefijo de SKU"
        onClose={() => setConfirmSkuPrefix(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSkuPrefix(false)}>Cancelar</Button>
            <Button onClick={() => void saveSkuPrefix()}>Confirmar cambio</Button>
          </>
        }
      >
        Este cambio solo aplicará a las claves generadas para <span className="font-semibold text-ink">productos nuevos</span>. Las claves existentes no se modificarán.
      </Dialog>

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
