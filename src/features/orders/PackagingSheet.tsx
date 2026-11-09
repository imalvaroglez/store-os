// #253 — order-prep packaging suggestion: one tap consumes the linked
// supplies for this order (per-line level materials + once-per-order set).
// Execution reuses consumeSupplyTx via the store; each line's availability is
// re-validated by the transaction itself, so a stale view can never
// over-consume — it surfaces as a per-line problem instead.
import { useMemo, useState } from "react";
import { useStore } from "../../app/StoreProvider";
import { Button, Dialog, Sheet, TextField, useToast } from "../../design-system";
import { supplyAvailableQuantity, supplyUnitCostCents } from "../../lib/expenses";
import { formatMoneyExact } from "../../lib/money";
import { uid } from "../../lib/ids";
import { suggestOrderPackaging, type PackagingSuggestionLine } from "../../lib/packaging";
import type { Order } from "../../types";

export function PackagingSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const { state, activeStore, consumeSupply } = useStore();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [consumed, setConsumed] = useState<Record<string, boolean>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});

  const customerTier = state.customers.find((c) => c.id === order.customerId && c.storeId === order.storeId)
    ?.assignedPriceTierId;
  const suggestion = useMemo(
    () =>
      suggestOrderPackaging({
        order,
        packaging: activeStore?.packaging,
        fallbackTier: customerTier ?? activeStore?.defaultTierId,
      }),
    [order, activeStore, customerTier]
  );
  const [unitsByMaterial, setUnitsByMaterial] = useState<Record<string, string>>(() =>
    Object.fromEntries(suggestion.lines.map((line) => [line.materialId, String(line.units)]))
  );

  const expenseFor = (line: PackagingSuggestionLine) =>
    line.supplyExpenseId
      ? state.expenses.find((e) => e.id === line.supplyExpenseId && e.storeId === order.storeId)
      : undefined;

  async function run() {
    setBusy(true);
    const newConsumed: Record<string, boolean> = { ...consumed };
    const newProblems: Record<string, string> = {};
    let okCount = 0;
    for (const line of suggestion.lines) {
      const units = Math.round(Number(unitsByMaterial[line.materialId] ?? "0"));
      if (units <= 0) continue;
      const expense = expenseFor(line);
      if (!expense) {
        newProblems[line.materialId] = "sin suministro vinculado (solo estimado)";
        continue;
      }
      const available = supplyAvailableQuantity(expense);
      if (units > available) {
        newProblems[line.materialId] = `solo hay ${available} disponibles`;
        continue;
      }
      try {
        // The transaction re-validates against the fresh doc: a stale view
        // throws "Solo quedan N disponibles" instead of over-consuming.
        await consumeSupply(expense, { id: uid("sup"), quantity: units, orderId: order.id });
        newConsumed[line.materialId] = true;
        okCount += 1;
      } catch (error) {
        newProblems[line.materialId] = error instanceof Error && error.message ? error.message : "no se pudo consumir";
      }
    }
    setConsumed(newConsumed);
    setProblems(newProblems);
    setBusy(false);
    setConfirming(false);
    if (Object.keys(newProblems).length === 0) {
      toast.success(okCount > 0 ? `Consumo registrado: ${okCount} material(es) cargados al pedido.` : "Nada que consumir.");
      onClose();
    } else {
      toast.error("Algunos materiales no se pudieron consumir — revisa la lista.");
    }
  }

  return (
    <Sheet open onClose={onClose} title="Empaques del pedido">
      <div className="space-y-4">
        {suggestion.lines.length === 0 ? (
          <p className="text-sm text-on-surface-soft">
            No hay materiales sugeridos para los niveles de este pedido. Configura los perfiles en
            Productos → Empaques.
          </p>
        ) : (
          <>
            <p className="text-sm text-on-surface-soft">
              Sugerencia según el nivel de cada línea y el set por pedido del nivel dominante. Ajusta
              unidades antes de consumir; el cargo real sale de cada suministro vinculado.
            </p>
            <ul className="space-y-2">
              {suggestion.lines.map((line) => {
                const expense = expenseFor(line);
                const available = expense ? supplyAvailableQuantity(expense) : null;
                const unitCost = expense ? supplyUnitCostCents(expense) : null;
                return (
                  <li key={line.materialId} className="space-y-1 rounded-lg border border-edge bg-surface px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{line.name}</p>
                      {consumed[line.materialId] ? (
                        <span className="text-xs font-semibold text-success">Consumido</span>
                      ) : problems[line.materialId] ? (
                        <span className="text-xs font-semibold text-danger">{problems[line.materialId]}</span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="w-28">
                        <TextField
                          label="Unidades"
                          inputMode="numeric"
                          disabled={busy || consumed[line.materialId]}
                          value={unitsByMaterial[line.materialId] ?? "0"}
                          onChange={(e) =>
                            setUnitsByMaterial((current) => ({
                              ...current,
                              [line.materialId]: e.target.value.replace(/[^\d]/g, ""),
                            }))
                          }
                        />
                      </div>
                      <p className="pb-2 text-xs text-on-surface-soft">
                        {expense
                          ? `${available} disponibles × ${formatMoneyExact((unitCost ?? 0) / 100)}`
                          : line.estimatedCost !== undefined
                            ? `estimado ${formatMoneyExact(line.estimatedCost)} c/u (sin suministro)`
                            : "sin suministro vinculado"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Button full disabled={busy} onClick={() => setConfirming(true)}>
              {busy ? "Consumiendo…" : "Consumir materiales"}
            </Button>
          </>
        )}
      </div>
      <Dialog
        open={confirming}
        title="Confirmar consumo"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancelar</Button>
            <Button disabled={busy} onClick={() => void run()}>Confirmar</Button>
          </>
        }
      >
        <p className="text-sm text-on-surface-soft">
          Se descuentan de los suministros vinculados y el pedido carga el costo exacto como gasto de
          venta — reduce la ganancia del pedido, nunca su total ni el saldo de la clienta.
        </p>
      </Dialog>
    </Sheet>
  );
}
