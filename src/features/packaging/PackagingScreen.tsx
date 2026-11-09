// #253 — Empaques por nivel: Fer configures ONCE which materials each price
// level carries (per piece and once per order). The estimated costs are
// planning inputs only — real charges always come from consuming the linked
// supplies (#184) when preparing an order.
import { useMemo, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Screen,
  ScreenHeader,
  SelectField,
  TextField,
  useToast,
} from "../../design-system";
import { tiersForStore } from "../../lib/pricing";
import { formatMoneyExact, parseAmount, sanitizeMoneyInput } from "../../lib/money";
import { uid } from "../../lib/ids";
import { supplyAvailableQuantity } from "../../lib/expenses";
import type { PackagingMaterial, StorePackaging, TierPackaging } from "../../types";

function emptyPackaging(): StorePackaging {
  return { materials: [], byTier: {} };
}

function clonePackaging(packaging: StorePackaging | undefined): StorePackaging {
  return packaging ? JSON.parse(JSON.stringify(packaging)) : emptyPackaging();
}

export function PackagingScreen() {
  const { state, activeStore, updateStore } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<StorePackaging>(() => clonePackaging(activeStore?.packaging));
  const [busy, setBusy] = useState(false);
  const [materialDialog, setMaterialDialog] = useState<PackagingMaterial | "new" | null>(null);

  const tiers = useMemo(() => tiersForStore(activeStore), [activeStore]);
  const supplies = useMemo(
    () =>
      state.expenses.filter(
        (expense) =>
          expense.storeId === activeStore?.id &&
          expense.category === "supplies" &&
          !!expense.supply &&
          !expense.simplifiedOperation
      ),
    [state.expenses, activeStore?.id]
  );
  const materialName = (id: string) => draft.materials.find((m) => m.id === id)?.name ?? "—";
  const dirty = JSON.stringify(draft) !== JSON.stringify(activeStore?.packaging ?? emptyPackaging());

  function patchDraft(mutate: (packaging: StorePackaging) => void) {
    setDraft((current) => {
      const next = clonePackaging(current);
      mutate(next);
      return next;
    });
  }

  async function save() {
    // Validation first: referenced materials must exist and units must be
    // positive integers — a broken profile must never reach the store doc.
    for (const material of draft.materials) {
      if (!material.name.trim()) {
        toast.error("Todos los materiales necesitan nombre.");
        return;
      }
      if (material.estimatedCost !== undefined && !(material.estimatedCost >= 0)) {
        toast.error(`El costo estimado de "${material.name}" no es válido.`);
        return;
      }
    }
    for (const [tierId, profile] of Object.entries(draft.byTier)) {
      for (const [group, lines] of [["porPieza", profile.perPiece], ["porPedido", profile.perOrder]] as const) {
        for (const line of lines) {
          if (!draft.materials.some((m) => m.id === line.materialId)) {
            toast.error(`El perfil de ${tiers.find((t) => t.id === tierId)?.label ?? tierId} usa un material que ya no existe (${group}).`);
            return;
          }
          if (!Number.isSafeInteger(line.units) || line.units < 1) {
            toast.error(`Las unidades de ${materialName(line.materialId)} deben ser enteras y al menos 1.`);
            return;
          }
        }
      }
    }
    setBusy(true);
    try {
      await updateStore({ id: activeStore!.id, packaging: draft });
      toast.success("Empaques guardados.");
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "No se pudieron guardar los empaques.");
    } finally {
      setBusy(false);
    }
  }

  function removeMaterial(id: string) {
    const referenced = Object.entries(draft.byTier).some(([, profile]) =>
      [...profile.perPiece, ...profile.perOrder].some((line) => line.materialId === id)
    );
    if (referenced) {
      toast.error("Ese material está usado en perfiles de nivel; quítalo de los perfiles primero.");
      return;
    }
    patchDraft((packaging) => {
      packaging.materials = packaging.materials.filter((m) => m.id !== id);
    });
  }

  return (
    <Screen>
      <ScreenHeader
        title="Empaques"
        subtitle="Materiales por nivel de clienta — se sugieren al preparar un pedido"
      />
      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-ink">Materiales</h2>
            <Button size="sm" variant="secondary" onClick={() => setMaterialDialog("new")}>+ Agregar</Button>
          </div>
          {draft.materials.length === 0 ? (
            <p className="text-sm text-on-surface-soft">
              Bolsa transparente, cartoncito, moño… registra cada material con su costo estimado y, si ya lo
              cargaste como suministro en Gastos, vincúlalo para que el consumo sea real.
            </p>
          ) : (
            <ul className="space-y-2">
              {draft.materials.map((material) => {
                const supply = supplies.find((s) => s.id === material.supplyExpenseId);
                return (
                  <li key={material.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-surface px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{material.name}</p>
                      <p className="text-xs text-on-surface-soft">
                        {material.estimatedCost !== undefined ? `≈ ${formatMoneyExact(material.estimatedCost)} c/u · ` : null}
                        {supply
                          ? `${supply.description ?? "Suministro"} · ${supplyAvailableQuantity(supply)} disponibles`
                          : "sin suministro vinculado (solo estimado)"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setMaterialDialog(material)}>Editar</Button>
                      <Button size="sm" variant="ghost" onClick={() => removeMaterial(material.id)}>Eliminar</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {tiers.map((tier) => {
          const profile = draft.byTier[tier.id];
          return (
            <Card key={tier.id} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-ink">{tier.label}</h3>
                <Badge tone={profile ? "success" : "neutral"}>{profile ? "configurado" : "sin perfil"}</Badge>
              </div>
              {(["perPiece", "perOrder"] as const).map((group) => (
                <div key={group} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-soft">
                    {group === "perPiece" ? "Por pieza vendida" : "Una vez por pedido"}
                  </p>
                  {(profile?.[group] ?? []).map((line, index) => (
                    <div key={`${line.materialId}-${index}`} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-40 flex-1">
                        <SelectField
                          label="Material"
                          value={line.materialId}
                          onChange={(next) =>
                            patchDraft((packaging) => {
                              packaging.byTier[tier.id]![group][index].materialId = next;
                            })
                          }
                          options={draft.materials.map((m) => ({ value: m.id, label: m.name }))}
                        />
                      </div>
                      <div className="w-24">
                        <TextField
                          label="Unidades"
                          inputMode="numeric"
                          value={String(line.units)}
                          onChange={(e) =>
                            patchDraft((packaging) => {
                              packaging.byTier[tier.id]![group][index].units = Math.max(0, Math.round(Number(e.target.value.replace(/[^\d]/g, "")) || 0));
                            })
                          }
                        />
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          patchDraft((packaging) => {
                            const profile = packaging.byTier[tier.id]!;
                            profile[group] = profile[group].filter((_, i) => i !== index);
                          })
                        }
                      >
                        Quitar
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={draft.materials.length === 0}
                    onClick={() =>
                      patchDraft((packaging) => {
                        const profile: TierPackaging = packaging.byTier[tier.id] ?? { perPiece: [], perOrder: [] };
                        profile[group] = [...profile[group], { materialId: draft.materials[0].id, units: 1 }];
                        packaging.byTier[tier.id] = profile;
                      })
                    }
                  >
                    + {group === "perPiece" ? "Material por pieza" : "Material por pedido"}
                  </Button>
                </div>
              ))}
            </Card>
          );
        })}

        <div className="space-y-2 pb-6">
          <Button full disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? "Guardando…" : dirty ? "Guardar empaques" : "Sin cambios"}
          </Button>
          <p className="text-xs text-on-surface-soft">
            Los costos estimados son solo planeación: el cargo real sale de consumir los suministros
            vinculados al preparar cada pedido, y jamás entra al costo de inventario.
          </p>
        </div>
      </div>

      {materialDialog !== null && (
        <MaterialDialog
          material={materialDialog === "new" ? null : materialDialog}
          supplies={supplies}
          onClose={() => setMaterialDialog(null)}
          onSave={(material) => {
            patchDraft((packaging) => {
              const existing = packaging.materials.findIndex((m) => m.id === material.id);
              if (existing >= 0) packaging.materials[existing] = material;
              else packaging.materials.push(material);
            });
            setMaterialDialog(null);
          }}
        />
      )}
    </Screen>
  );
}

function MaterialDialog({
  material,
  supplies,
  onClose,
  onSave,
}: {
  material: PackagingMaterial | null;
  supplies: { id: string; description?: string }[];
  onClose: () => void;
  onSave: (material: PackagingMaterial) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(material?.name ?? "");
  const [costText, setCostText] = useState(material?.estimatedCost !== undefined ? String(material.estimatedCost) : "");
  const [supplyExpenseId, setSupplyExpenseId] = useState(material?.supplyExpenseId ?? "");
  const cost = parseAmount(costText);

  function save() {
    if (!name.trim()) {
      toast.error("Escribe el nombre del material.");
      return;
    }
    if (costText.trim() !== "" && (cost === undefined || cost < 0)) {
      toast.error("El costo estimado no es válido.");
      return;
    }
    onSave({
      id: material?.id ?? uid("mat"),
      name: name.trim(),
      ...(cost !== undefined ? { estimatedCost: cost } : {}),
      ...(supplyExpenseId ? { supplyExpenseId } : {}),
    });
  }

  return (
    <Dialog
      open
      title={material ? "Editar material" : "Nuevo material"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Nombre" placeholder="p. ej. Bolsa transparente" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Costo estimado por unidad (opcional)"
          inputMode="decimal"
          placeholder="p. ej. 0.50"
          value={costText}
          onChange={(e) => setCostText(sanitizeMoneyInput(e.target.value))}
          hint="Solo para estimar: el cargo real sale del suministro vinculado."
        />
        <SelectField
          label="Suministro vinculado (opcional)"
          value={supplyExpenseId}
          onChange={setSupplyExpenseId}
          options={[
            { value: "", label: "Sin vincular (solo estimado)" },
            ...supplies.map((s) => ({ value: s.id, label: s.description ?? s.id })),
          ]}
        />
      </div>
    </Dialog>
  );
}
